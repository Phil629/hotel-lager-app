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

  // FORCE OVERRIDE to bypass any old DB poisoning from the Web App
  SEL.login_submit = 'button[name="login"], button[id*="login"], input[name="login"]'
  SEL.login_username = 'input[name="email_address"], input[name="email"], input[autocomplete="username"]'
  
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
      try {
        // Check if login field is visible
        const checkRes = await domAction(supplierTabId, { command: 'CHECK_EXISTS', selector: SEL.login_username, timeout: 2000 })
        
        if (!checkRes.success) {
          console.log('[sw] Login username field not found initially, trying to navigate to login page...')
          await patch('logging_in', 'Suche Login-Bereich...')
          await withHeal({
            supplierTabId, sessionId, supplierId, selfHealUrl, userJwt,
            ctx: 'login_navigate', command: 'CLICK', selector: SEL.login_navigate || 'a[href*="login"], a[href*="konto"], a[href*="anmelden"]', timeout: 5000
          })
          await waitForTabLoad(supplierTabId, 10_000)
          await chrome.scripting.executeScript({
            target: { tabId: supplierTabId },
            files:  ['content-scripts/automation-worker.js'],
          }).catch(e => console.warn('[sw] Re-inject failed:', e?.message))
          await sleep(1000)
        }

        await patch('logging_in', 'Melde an...')
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
        await chrome.scripting.executeScript({
          target: { tabId: supplierTabId },
          files:  ['content-scripts/automation-worker.js'],
        }).catch(e => console.warn('[sw] Re-inject failed:', e?.message))
        await sleep(500)
        console.log('[sw] Login completed')
      } catch (loginErr) {
        // Fehler wird hier bewusst nicht weitergeworfen.
        // Der Post-Login-Check direkt danach stellt sicher, dass wir tatsächlich eingeloggt sind.
        console.warn('[sw] Login step failed, continuing (user might already be logged in).', loginErr.message)
      }
    } else {
      console.log('[sw] No login credentials provided, skipping login step')
    }

    // ── Post-Login Verification ─────────────────────────────────────────────
    // Unabhängig davon, ob Login versucht wurde oder nicht: Sicherstellen,
    // dass wir nicht auf einer Login-Seite festhängen.
    if (await isAuthWall(supplierTabId)) {
      throw new Error(
        'Login fehlgeschlagen! Bitte Zugangsdaten und Selektoren in den Lieferanten-Einstellungen prüfen.'
      )
    }

    // ── Step 4: Add items to cart ───────────────────────────────────────────

    const updatedItems = ITEMS.map((i) => ({ ...i }))

    for (let idx = 0; idx < ITEMS.length; idx++) {
      const item = ITEMS[idx]

      // Try direct product link first
      let usedSearch = false
      if (item.url && item.url.startsWith('http')) {
        await patch('searching', `Öffne Direktlink für ${item.product_name}...`, { items: updatedItems })
        await navigateAndReinject(supplierTabId, item.url, 10_000)
        await sleep(1000)
        
        // Robust 404 / Invalid URL detection
        let isValidProductPage = false
        if (SEL.add_to_cart || SEL.product_qty) {
          const checkRes = await domAction(supplierTabId, {
            command:  'CHECK_EXISTS',
            selector: SEL.add_to_cart || SEL.product_qty,
            timeout:  4000,
          })
          isValidProductPage = checkRes.success
        } else {
          const titleRes = await domAction(supplierTabId, {
            command: 'GET_TEXT', selector: 'title', timeout: 2000,
          })
          const title = (titleRes.text ?? '').toLowerCase()
          isValidProductPage = !title.includes('404') && !title.includes('not found') && !title.includes('fehler')
        }

        if (!isValidProductPage) {
           console.log(`[sw] Direktlink ungültig, Fallback auf Suche: ${item.product_name}`)
           usedSearch = true
        }
      } else {
         usedSearch = true
      }

      // Fallback: Search
      if (usedSearch) {
        // Are we trapped on an Auth-Wall / Login page? (Lücke 1)
        if (await isAuthWall(supplierTabId)) {
          console.error('[sw] Redirected to login page. Authentication failed!')
          throw new Error('Auth-Wall erkannt! Der Login ist fehlgeschlagen oder abgelaufen. Bitte Zugangsdaten prüfen.')
        }

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
          await chrome.scripting.executeScript({
            target: { tabId: supplierTabId },
            files:  ['content-scripts/automation-worker.js'],
          }).catch(e => console.warn('[sw] Re-inject failed:', e?.message))
        }
        
        // Removed URL update from here (moved to add-to-cart)
      }

      // Are we trapped on an Auth-Wall / Login page? (Lücke 2 & 3)
      if (await isAuthWall(supplierTabId)) {
        console.error('[sw] Redirected to login page. Authentication failed!')
        throw new Error('Auth-Wall erkannt! Der Login ist fehlgeschlagen oder abgelaufen. Bitte Zugangsdaten prüfen.')
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

        // JETZT URL speichern: Tab ist auf der Produktseite
        if (usedSearch && item.product_id) {
          try {
            const productTab = await chrome.tabs.get(supplierTabId)
            const newUrl = productTab.url
            // Suchseiten-URLs explizit ausschließen
            const looksLikeSearchPage =
              newUrl?.includes('search') ||
              newUrl?.includes('query') ||
              newUrl?.includes('?q=')

            if (newUrl && !looksLikeSearchPage && newUrl !== item.url) {
              await fetch(`${supabaseUrl}/rest/v1/products?id=eq.${item.product_id}`, {
                method: 'PATCH',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization:  `Bearer ${userJwt}`,
                  apikey:          supabaseAnonKey,
                  Prefer:          'return=minimal',
                },
                body: JSON.stringify({ order_url: newUrl }),
              })
              console.log(`[sw] Produkt-URL in DB aktualisiert: ${newUrl}`)
            }
          } catch (err) {
            if (err.message && (err.message.includes('API Error') || err.message.includes('Auth session'))) {
              throw err; // Niemals kritische KI- oder Auth-Fehler verschlucken!
            }
            console.warn('[sw] Produkt-URL-Update fehlgeschlagen:', err)
          }
        }
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
    } else {
      console.warn('[sw] Self-heal returned ok, but no new_selector:', body)
    }
  } else {
    const errText = healRes ? await healRes.text().catch(() => 'unknown') : 'fetch failed'
    console.error('[sw] Self-heal HTTP error:', healRes?.status, errText)
    throw new Error(`Step failed after self-heal [${ctx}]: ${selector}. API Error: ${errText.substring(0, 100)}`)
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
    let settled = false

    function settle() {
      if (settled) return
      settled = true
      chrome.tabs.onUpdated.removeListener(onUpdated)
      clearTimeout(deadline)
      resolve()
    }

    function onUpdated(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        setTimeout(settle, 400) // small settle delay for SPA hydration
      }
    }

    chrome.tabs.onUpdated.addListener(onUpdated)
    const deadline = setTimeout(settle, timeout)
  })
}

async function isAuthWall(tabId) {
  const currentTab = await chrome.tabs.get(tabId)
  const currentUrl = currentTab.url ?? ''
  
  const titleRes = await domAction(tabId, { command: 'GET_TEXT', selector: 'title', timeout: 2000 })
  const currentTitle = (titleRes.text ?? '').toLowerCase()
  
  const loginKeywords = /(login|signin|anmelden|anmeldung|auth|konto|account|kundenbereich|customer)/i
  const looksLikeLogin = loginKeywords.test(currentUrl) || loginKeywords.test(currentTitle)

  if (!looksLikeLogin) return false

  const passwordFieldExists = await domAction(tabId, {
    command: 'CHECK_EXISTS',
    selector: 'input[type="password"]',
    timeout: 2000
  })

  return passwordFieldExists.success && looksLikeLogin
}

async function navigateAndReinject(tabId, url, timeout = 20_000) {
  await chrome.tabs.update(tabId, { url })
  await waitForTabLoad(tabId, timeout)

  // Worker nach jeder Navigation neu injizieren
  await chrome.scripting.executeScript({
    target: { tabId },
    files:  ['content-scripts/automation-worker.js'],
  }).catch(e => console.warn('[sw] Re-inject failed:', e?.message))

  await sleep(300) // Listener-Registrierung abwarten
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
