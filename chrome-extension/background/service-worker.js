// background/service-worker.js
// MV3 Service Worker — orchestrates the full automation.

// ── Entry: receive CHECKOUT_START from webapp-bridge ─────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'CHECKOUT_START') return false

  sendResponse({ received: true }) // ACK immediately so bridge doesn't time out

  runAutomation(message.payload).catch((err) => {
    console.error('[sw] Unhandled automation error:', err)
  })

  return true
})

// ── Main automation orchestrator ──────────────────────────────────────────────

async function runAutomation(payload) {
  const {
    sessionId,
    extensionToken,
    supabaseUrl,
    supabaseAnonKey,
    userJwt,
    selfHealUrl,
    supplierId,
    loginUrl,
    username,
    password,
    selectors: SEL,
    items:     ITEMS,
    priceThresholdPct: THRESHOLD,
  } = payload

  // Persist to session storage so popup can read current state
  await chrome.storage.session.set({
    activeSession: { sessionId, supplierId, loginUrl, status: 'starting' },
  })

  const patch = (status, message, extra = {}) =>
    patchSession({ supabaseUrl, supabaseAnonKey, userJwt, sessionId, status, message, extra })

  let supplierTabId = null

  try {
    // ── Step 1: Open supplier tab ───────────────────────────────────────────

    await patch('logging_in', 'Browser-Tab wird geöffnet…')

    const tab = await chrome.tabs.create({ url: loginUrl, active: true })
    supplierTabId = tab.id

    await chrome.storage.session.set({
      activeSession: { sessionId, supplierId, loginUrl, tabId: supplierTabId, status: 'logging_in' },
    })

    await waitForTabLoad(supplierTabId)

    // ── Step 2: Inject automation worker into the supplier tab ─────────────

    await chrome.scripting.executeScript({
      target: { tabId: supplierTabId },
      files:  ['content-scripts/automation-worker.js'],
    })

    // Tiny pause so the worker's onMessage listener is registered
    await sleep(300)

    // ── Step 3: Login ───────────────────────────────────────────────────────

    if (SEL.login_username && SEL.login_password && username) {
      await withHeal({
        supplierTabId, sessionId, supplierId, selfHealUrl, userJwt,
        ctx: 'login', command: 'FILL', selector: SEL.login_username, value: username,
      })
      await withHeal({
        supplierTabId, sessionId, supplierId, selfHealUrl, userJwt,
        ctx: 'login', command: 'FILL', selector: SEL.login_password, value: password,
      })

      if (SEL.login_submit) {
        await withHeal({
          supplierTabId, sessionId, supplierId, selfHealUrl, userJwt,
          ctx: 'login', command: 'CLICK', selector: SEL.login_submit,
        })
      } else {
        await domAction(supplierTabId, { command: 'KEY_PRESS', value: 'Enter' })
      }

      await waitForTabLoad(supplierTabId)
      await sleep(500)
    }

    console.log('[sw] Login completed')

    // ── Step 4: Add items to cart ───────────────────────────────────────────

    const updatedItems = ITEMS.map((i) => ({ ...i }))

    for (let idx = 0; idx < ITEMS.length; idx++) {
      const item = ITEMS[idx]

      // Search
      await patch('searching', `Suche ${item.product_name}...`, { items: updatedItems })

      if (SEL.search_box) {
        await withHeal({
          supplierTabId, sessionId, supplierId, selfHealUrl, userJwt,
          ctx: 'search', command: 'FILL', selector: SEL.search_box, value: item.product_name,
        })
        if (SEL.search_submit) {
          await withHeal({
            supplierTabId, sessionId, supplierId, selfHealUrl, userJwt,
            ctx: 'search', command: 'CLICK', selector: SEL.search_submit,
          })
        } else {
          await domAction(supplierTabId, { command: 'KEY_PRESS', value: 'Enter' })
        }
        await waitForTabLoad(supplierTabId, 10_000)
      }

      await patch('adding', `${item.product_name} wird hinzugefuegt...`, { items: updatedItems })

      // Set quantity
      if (SEL.product_qty) {
        await withHeal({
          supplierTabId, sessionId, supplierId, selfHealUrl, userJwt,
          ctx: 'add_to_cart', command: 'FILL',
          selector: SEL.product_qty, value: String(item.quantity),
        }).catch((e) => console.warn('[sw] qty field failed (non-fatal):', e.message))
      }

      // Extract actual price from DOM
      let priceActual    = null
      let priceDeltaPct  = null
      let priceOk        = null

      if (SEL.price) {
        try {
          const res = await domAction(supplierTabId, { command: 'GET_TEXT', selector: SEL.price, timeout: 6000 })
          if (res.success && res.text) {
            const m = res.text.replace(/\s/g, '').match(/\d{1,3}(?:[.,]\d{3})*[.,]\d{1,2}|\d+[.,]\d{1,2}/)
            if (m) {
              priceActual = parseFloat(
                m[0].replace(/\.(\d{3})/g, '$1').replace(',', '.')
              )
            }
          }
        } catch (_) {}
      }

      if (priceActual !== null && item.price_expected != null && item.price_expected > 0) {
        priceDeltaPct = ((priceActual - item.price_expected) / item.price_expected) * 100
        priceOk       = Math.abs(priceDeltaPct) <= THRESHOLD
      }

      updatedItems[idx] = {
        ...item,
        price_actual:    priceActual,
        price_delta_pct: priceDeltaPct !== null ? Math.round(priceDeltaPct * 100) / 100 : null,
        price_ok:        priceOk,
      }

      // Add to cart
      if (SEL.add_to_cart) {
        await withHeal({
          supplierTabId, sessionId, supplierId, selfHealUrl, userJwt,
          ctx: 'add_to_cart', command: 'CLICK', selector: SEL.add_to_cart,
        })
        await sleep(1200)
      }

      console.log(
        `[sw] ${item.product_name} | qty=${item.quantity}` +
        ` | expected=${item.price_expected} | actual=${priceActual}` +
        ` | delta=${priceDeltaPct?.toFixed(1) ?? 'n/a'}%`
      )
    }

    // ── Step 5: Price check & handover ──────────────────────────────────────

    await patch('price_check', 'Preise werden abgeglichen...')

    const hasWarning = updatedItems.some((i) => i.price_ok === false)
    const allDeltas  = updatedItems.map((i) => Math.abs(i.price_delta_pct ?? 0)).filter((d) => d > 0)
    const maxDelta   = allDeltas.length > 0 ? Math.max(...allDeltas) : null

    // Resolve cart URL
    const tab2  = await chrome.tabs.get(supplierTabId)
    let cartUrl = tab2.url ?? loginUrl
    if (SEL.cart_url) {
      cartUrl = SEL.cart_url.startsWith('http')
        ? SEL.cart_url
        : new URL(SEL.cart_url, cartUrl).href
    }

    const statusMsg = hasWarning
      ? '[Warnung] Preisabweichung erkannt - bitte vor dem Bestellen pruefen!'
      : '[OK] Warenkorb bereit - jetzt bestellen.'

    await patch('ready', statusMsg, {
      cart_url:            cartUrl,
      items:               updatedItems,
      price_warning:       hasWarning,
      price_deviation_pct: maxDelta,
    })

    // Navigate the tab to the cart so the user only needs to click "Bestellen"
    if (cartUrl !== tab2.url) {
      await chrome.tabs.update(supplierTabId, { url: cartUrl })
    }

    await chrome.storage.session.set({
      activeSession: { sessionId, supplierId, loginUrl, tabId: supplierTabId, status: 'ready' },
    })

    console.log('[sw] Session ready. cartUrl=', cartUrl, 'priceWarning=', hasWarning)

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[sw] Automation failed:', msg)

    await patch('error', 'Fehler: ' + msg, { error_message: msg })

    await chrome.storage.session.set({
      activeSession: { sessionId, supplierId, loginUrl, tabId: supplierTabId, status: 'error', error: msg },
    })
  }
}

// ── withHeal: DOM action + self-healing fallback ──────────────────────────────

async function withHeal({ supplierTabId, sessionId, supplierId, selfHealUrl, userJwt,
                           ctx, command, selector, value, timeout = 8000 }) {
  const result = await domAction(supplierTabId, { command, selector, value, timeout })
  if (result.success) return result

  console.log(`[sw] Selector failed [${ctx}] "${selector}": ${result.error} - attempting self-heal`)

  // Capture screenshot from service worker (requires "tabs" permission)
  let screenshotBase64 = ''
  try {
    const dataUrl   = await chrome.tabs.captureVisibleTab(null, { format: 'png' })
    screenshotBase64 = dataUrl.replace(/^data:image\/png;base64,/, '')
  } catch (e) {
    console.warn('[sw] Screenshot capture failed:', e.message)
  }

  // Get HTML snapshot via injected worker
  let htmlSnippet = ''
  try {
    const htmlRes = await domAction(supplierTabId, { command: 'GET_HTML', timeout: 5000 })
    if (htmlRes.success) htmlSnippet = htmlRes.html ?? ''
  } catch (_) {}

  // Call self-heal-selector Edge Function
  const healRes = await fetch(selfHealUrl, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization:  `Bearer ${userJwt}`,
    },
    body: JSON.stringify({
      session_id:        sessionId,
      supplier_id:       supplierId,
      context:           ctx,
      failed_selector:   selector,
      screenshot_base64: screenshotBase64,
      html_snippet:      htmlSnippet.substring(0, 50_000),
    }),
  }).catch(() => null)

  if (healRes?.ok) {
    const body = await healRes.json().catch(() => ({}))
    if (body.new_selector) {
      console.log(`[sw] Self-heal → new selector: "${body.new_selector}"`)
      const retryResult = await domAction(supplierTabId, { command, selector: body.new_selector, value, timeout })
      if (retryResult.success) return retryResult
    }
  }

  throw new Error(`Step failed after self-heal [${ctx}]: ${selector}`)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function domAction(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: 'DOM_ACTION', ...message }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message })
      } else {
        resolve(response ?? { success: false, error: 'No response from worker' })
      }
    })
  })
}

function waitForTabLoad(tabId, timeout = 20_000) {
  return new Promise((resolve) => {
    const deadline = setTimeout(resolve, timeout) // non-fatal timeout

    function onUpdated(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(deadline)
        chrome.tabs.onUpdated.removeListener(onUpdated)
        setTimeout(resolve, 400) // small settle delay for SPA hydration
      }
    }

    chrome.tabs.onUpdated.addListener(onUpdated)
  })
}

async function patchSession({ supabaseUrl, supabaseAnonKey, userJwt, sessionId, status, message, extra }) {
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/checkout_sessions?id=eq.${sessionId}`,
      {
        method: 'PATCH',
        headers: {
          apikey:          supabaseAnonKey,
          Authorization:   `Bearer ${userJwt}`,
          'Content-Type':  'application/json',
          Prefer:          'return=minimal',
        },
        body: JSON.stringify({
          status,
          status_message: message,
          updated_at:     new Date().toISOString(),
          ...extra,
        }),
      }
    )
    if (!res.ok) console.error('[sw] patchSession HTTP', res.status, await res.text())
  } catch (e) {
    console.error('[sw] patchSession fetch failed:', e.message)
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
