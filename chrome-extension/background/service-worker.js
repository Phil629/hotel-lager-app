// background/service-worker.js
// MV3 Service Worker — orchestrates the full automation.

// ── Entry: receive CHECKOUT_START from webapp-bridge ─────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'CHECKOUT_START') {
    sendResponse({ received: true }) // ACK immediately so bridge doesn't time out

    runAutomation(message.payload).catch((err) => {
      console.error('[sw] Unhandled automation error:', err)
    })

    return true
  }

  if (message.type === 'CHECKOUT_FOCUS') {
    chrome.storage.session.get('activeSession').then(res => {
      const s = res.activeSession
      if (s?.tabId) {
        chrome.tabs.update(s.tabId, { active: true }).catch(() => {})
        chrome.tabs.get(s.tabId).then(t => {
          if (t.windowId) chrome.windows.update(t.windowId, { focused: true }).catch(() => {})
        }).catch(() => {})
      }
    })
    sendResponse({ ok: true })
    return true
  }

  return false
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

  // Debug overrides removed

  // SAFEGUARD: Protect against broken DB selectors from the Web App
  SEL.search_box = SEL.search_box || 'input[type="search"], input[name*="search"], input[name*="suche"], input[name="keywords"], input[name="q"]'
  SEL.add_to_cart = SEL.add_to_cart || 'button[name*="cart"], button[id*="cart"], button[name*="warenkorb"], button[id*="warenkorb"], button[class*="cart"], button[class*="warenkorb"], button[class*="add"]'
  SEL.cart_url = SEL.cart_url || (loginUrl?.includes('reinigungsberater') ? '/warenkorb' : '/cart')
  
  if (loginUrl?.includes('reinigungsberater')) {
    SEL.product_qty = 'input[type="number"]'
  }

  // Persist to session storage so popup can read current state
  await chrome.storage.session.set({
    activeSession: { sessionId, supplierId, loginUrl, status: 'starting' },
  })

  // Store auth context separately so the popup can call RPCs (e.g. report_checkout_failure)
  await chrome.storage.session.set({
    sessionAuth: { supabaseUrl, supabaseAnonKey, userJwt, supplierId },
  })

  const patch = (status, message, extra = {}) =>
    patchSession({ supabaseUrl, supabaseAnonKey, userJwt, sessionId, status, message, extra })

  let supplierTabId = null

  try {
    // ── Step 1: Open supplier tab ───────────────────────────────────────────

    await patch('logging_in', 'Browser-Tab wird geöffnet…')

    const loginRequired = SEL?.login_required ?? false
    // Wenn kein Login erforderlich ist, öffnen wir direkt die Homepage statt der Login-Seite
    const startUrl = loginRequired ? loginUrl : (loginUrl ? `https://${extractDomain(loginUrl)}` : loginUrl)

    const tab = await chrome.tabs.create({ url: startUrl, active: false })
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

    // ── Playbook path: try verified static playbook before legacy selector flow ──
    // If a cloud-validated playbook exists for this domain, execute it directly.
    // On success: skip all legacy steps and go straight to 'ready'.
    const playbookResult = await loadAndRunPlaybook(payload, supplierTabId, patch)
    if (playbookResult) {
      const { cartUrl, updatedItems, hasWarning, maxDelta } = playbookResult
      let statusMsg = '[OK] Warenkorb bereit - jetzt bestellen.'
      if (hasWarning) statusMsg = '[Warnung] Preisabweichung erkannt - bitte vor dem Bestellen prüfen!'

      await patch('ready', statusMsg, {
        cart_url:            cartUrl,
        items:               updatedItems,
        price_warning:       hasWarning,
        price_deviation_pct: maxDelta,
      })
      await chrome.storage.session.set({
        activeSession: { sessionId, supplierId, loginUrl, tabId: supplierTabId, status: 'ready' },
      })
      console.log('[sw] Playbook path completed. cartUrl=', cartUrl)
      return
    }

    // ── Step 3: Login ───────────────────────────────────────────────────────

    if (!loginRequired) {
      console.log('[sw] Login not required. Skipping legacy login steps.')
      await patch('logging_in', 'Login übersprungen (nicht erforderlich)…')
      await sleep(1000)
    } else {
      const loggedIn = await checkAlreadyLoggedIn(supplierTabId)
      if (loggedIn) {
        console.log('[sw] Already logged in. Skipping legacy login steps.')
        await patch('logging_in', 'Sitzung bereits angemeldet (überspringe Login)…')
        await sleep(1000)
      } else if (SEL.login_username && SEL.login_password && username) {
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
          await patch('logging_in', 'Login-Schritt übersprungen/fehlgeschlagen...')
          await sleep(1000)
        }
      } else {
        console.log('[sw] No login credentials provided, skipping login step')
      }
    }

    // ── Post-Login Verification ─────────────────────────────────────────────
    // Unabhängig davon, ob Login versucht wurde oder nicht: Sicherstellen,
    // dass wir nicht auf einer Login-Seite festhängen.
    if (loginRequired && await isAuthWall(supplierTabId)) {
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
      
      const isHomepage = (url) => {
        if (!url) return false
        try {
          const u = new URL(url)
          return u.pathname === '/' || u.pathname === ''
        } catch { return false }
      }

      if (item.url && item.url.startsWith('http') && !isHomepage(item.url)) {
        await patch('searching', `Öffne Direktlink für ${item.product_name}...`, { items: updatedItems })
        await navigateAndReinject(supplierTabId, item.url, 10_000)
        await sleep(1000)
        
        // Check if it's a 404 page
        const titleRes = await domAction(supplierTabId, {
          command: 'GET_TEXT', selector: 'title', timeout: 2000,
        })
        const title = (titleRes.text ?? '').toLowerCase()
        const is404 = title.includes('404') || title.includes('not found') || title.includes('fehler')

        if (is404) {
           console.log(`[sw] Direktlink 404, Fallback auf Suche: ${item.product_name}`)
           usedSearch = true
        }
      } else {
         usedSearch = true
      }

      // Fallback: Search
      if (usedSearch) {
        if (await isAuthWall(supplierTabId)) {
          console.warn('[sw] We might be on a login page, but proceeding with search anyway.')
        }

        await patch('searching', `Suche nach ${item.product_name}...`, { items: updatedItems })
        try {
          const badSearch = 'input[type="search"], input[name*="search"], input[name*="suche"], input[name="keywords"], input[name="q"]'
          let searchSelector = SEL.search_box === badSearch ? null : SEL.search_box
          searchSelector = searchSelector || 'input[type="search"], input[name*="search" i], input[name*="suche" i], input[name="q"], input[name="query"], input[name="keywords"], #search-query'
          
          if (searchSelector) {
            await withHeal({
              supplierTabId, sessionId, supplierId, selfHealUrl, userJwt,
              ctx: 'search', command: 'FILL', selector: searchSelector,
              value: item.product_name,
            })
            const badSearchSubmit = 'button[type="submit"], input[type="submit"], button[aria-label*="search" i], button[aria-label*="suche" i]'
            let searchSubmitSelector = SEL.search_submit === badSearchSubmit ? null : SEL.search_submit
            searchSubmitSelector = searchSubmitSelector || 'button[type="submit"], input[type="submit"], .search-submit, #search-submit'
            
            if (searchSubmitSelector) {
              try {
                await withHeal({
                  supplierTabId, sessionId, supplierId, selfHealUrl, userJwt,
                  ctx: 'search_submit', command: 'CLICK', selector: searchSubmitSelector,
                })
              } catch (e) {
                console.warn('[sw] search submit failed, trying Enter key fallback', e.message)
                await domAction(supplierTabId, { command: 'KEY_PRESS', value: 'Enter', timeout: 2000 })
              }
            } else {
              await domAction(supplierTabId, { command: 'KEY_PRESS', value: 'Enter', timeout: 2000 })
            }
            await waitForTabLoad(supplierTabId, 10_000)
            await chrome.scripting.executeScript({
              target: { tabId: supplierTabId },
              files:  ['content-scripts/automation-worker.js'],
            }).catch(e => console.warn('[sw] Re-inject failed:', e?.message))
          }
        } catch (searchErr) {
          console.error(`[sw] Search failed for ${item.product_name}:`, searchErr)
          // Continue to next item if search fails
          updatedItems[idx].status = 'error'
          const translated = translateError(searchErr.message || String(searchErr))
          await patch('error', `Fehler bei der Suche (${item.product_name}): ${translated}`, { items: updatedItems })
          continue
        }
      }

      if (await isAuthWall(supplierTabId)) {
        console.warn('[sw] We might be on a login page, but proceeding to add to cart anyway.')
      }

      await patch('adding', `${item.product_name} wird hinzugefuegt...`, { items: updatedItems })

      // Extract actual price from DOM
      let priceActual    = null
      let priceDeltaPct  = null
      let priceOk        = null

      try {

      // Set quantity
      const qtySelector = SEL.product_qty || 'input[type="number"], input[name*="qty" i], input[name*="quantity" i], input[name*="menge" i], input[name*="anzahl" i]'
      await withHeal({
        supplierTabId, sessionId, supplierId, selfHealUrl, userJwt,
        ctx: 'add_to_cart', command: 'FILL',
        selector: qtySelector, value: String(item.quantity),
      }).catch((e) => console.warn('[sw] qty field failed (non-fatal):', e.message))

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
      const badCarts = [
        'button[name*="cart"], button[id*="cart"], button[name*="warenkorb"], button[id*="warenkorb"], button[class*="cart"], button[class*="warenkorb"], button[class*="add"]',
        'button[name="inInBasket"]'
      ]
      let cartSelector = badCarts.includes(SEL.add_to_cart) ? null : SEL.add_to_cart
      cartSelector = cartSelector || 'button.add-to-cart, button[name="inInBasket"], input[name="inInBasket"], button[name*="warenkorb" i], button[name*="basket" i], button[name*="cart" i], input[name*="basket" i], input[name*="cart" i], button[id*="basket" i], button[id*="cart" i], button[class*="basket" i], button[class*="cart" i], button[title*="warenkorb" i], button[title*="basket" i], button[type="submit"][name*="add"], input[type="submit"][name*="add"], input[type="submit"][value*="warenkorb" i], input[type="image"][src*="warenkorb" i]'
      
      await withHeal({
        supplierTabId, sessionId, supplierId, selfHealUrl, userJwt,
        ctx: 'add_to_cart', command: 'CLICK', selector: cartSelector,
      })
      await sleep(2500) // Erhöht auf 2.5s, damit AJAX-Warenkörbe Zeit zum Speichern haben

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
              
            const looksLikeLoginPage = 
              newUrl?.includes('login') || 
              newUrl?.includes('anmeldung') || 
              newUrl?.includes('auth') || 
              newUrl?.includes('account')
              
            const isHome = isHomepage(newUrl)

            if (newUrl && !looksLikeSearchPage && !looksLikeLoginPage && !isHome && newUrl !== item.url) {
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
            console.warn('[sw] Produkt-URL-Update fehlgeschlagen:', err)
        }
      }

      } catch (cartErr) {
        console.error(`[sw] Add to cart failed for ${item.product_name}:`, cartErr)
        updatedItems[idx].status = 'error'
        const translated = translateError(cartErr.message || String(cartErr))
        await patch('error', `Fehler beim Einlegen in den Warenkorb (${item.product_name}): ${translated}`, { items: updatedItems })
      }

      console.log(
        `[sw] ${item.product_name} | qty=${item.quantity}` +
        ` | expected=${item.price_expected} | actual=${priceActual}` +
        ` | delta=${priceDeltaPct?.toFixed(1) ?? 'n/a'}%`
      )
    }

    // ── Step 5: Warenkorb öffnen & zur Kasse navigieren ───────────────────

    await patch('price_check', 'Preise werden abgeglichen...')

    const hasWarning = updatedItems.some((i) => i.price_ok === false)
    const hasError = updatedItems.some((i) => i.status === 'error')
    const allDeltas  = updatedItems.map((i) => Math.abs(i.price_delta_pct ?? 0)).filter((d) => d > 0)
    const maxDelta   = allDeltas.length > 0 ? Math.max(...allDeltas) : null

    // ── 5a: Warenkorb öffnen (Offcanvas ODER Navigation zu /cart) ──────────

    if (SEL.go_to_checkout) {
      await patch('searching', 'Öffne Warenkorb...')
      const urlBefore = (await chrome.tabs.get(supplierTabId)).url

      try {
        await withHeal({
          supplierTabId, sessionId, supplierId, selfHealUrl, userJwt,
          ctx: 'go_to_checkout', command: 'CLICK', selector: SEL.go_to_checkout,
          timeout: 5000,
        })

        await sleep(1500) // Navigation oder Offcanvas-Animation abwarten

        const urlAfterFirst = (await chrome.tabs.get(supplierTabId)).url
        if (urlAfterFirst !== urlBefore) {
          // Echte Navigation → Worker neu injizieren
          await waitForTabLoad(supplierTabId, 8000)
          await chrome.scripting.executeScript({
            target: { tabId: supplierTabId },
            files:  ['content-scripts/automation-worker.js'],
          }).catch(e => console.warn('[sw] Re-inject nach go_to_checkout fehlgeschlagen:', e?.message))
        }

        // ── 5b: Zur Kasse gehen — nur wenn noch NICHT auf Checkout-Seite ───

        const isOnCheckout = /\/(checkout|kasse|bestellung|order)(\/|$|\?)/i.test(urlAfterFirst)
        console.log('[sw] 5b Check. isOnCheckout:', isOnCheckout, 'urlAfterFirst:', urlAfterFirst, 'SEL.proceed_to_checkout:', !!SEL.proceed_to_checkout)

        // UX Refinement: Standardmäßig auf dem Warenkorb anstatt der Kasse stoppen.
        // Der Klick auf 'proceed_to_checkout' wird absichtlich übersprungen!
        if (false && !isOnCheckout && SEL.proceed_to_checkout) {
          await patch('searching', 'Warenkorb wird geöffnet...')
          await sleep(1500) // Offcanvas vollständig gerendert abwarten (Erhöht auf 1500ms)

          try {
            console.log('[sw] Executing proceed_to_checkout with selector:', SEL.proceed_to_checkout)
            const proceedRes = await withHeal({
              supplierTabId, sessionId, supplierId, selfHealUrl, userJwt,
              ctx: 'proceed_to_checkout', command: 'CLICK', selector: SEL.proceed_to_checkout,
              timeout: 8000,
            })
            console.log('[sw] proceed_to_checkout result:', proceedRes)

            const urlAfterProceed = (await chrome.tabs.get(supplierTabId)).url
            console.log('[sw] urlAfterProceed:', urlAfterProceed)
            if (urlAfterProceed !== urlAfterFirst) {
              await waitForTabLoad(supplierTabId, 12_000)
              await chrome.scripting.executeScript({
                target: { tabId: supplierTabId },
                files:  ['content-scripts/automation-worker.js'],
              }).catch(e => console.warn('[sw] Re-inject nach proceed_to_checkout fehlgeschlagen:', e?.message))
            }

          } catch (proceedErr) {
            // Non-fatal: User ist im Warenkorb, kann manuell weiter
            console.warn('[sw] proceed_to_checkout fehlgeschlagen (non-fatal):', proceedErr.message)
          }
        }

      } catch (checkoutErr) {
        console.warn('[sw] go_to_checkout fehlgeschlagen, URL-Fallback wird versucht:', checkoutErr.message)

        if (SEL.cart_url) {
          const tab = await chrome.tabs.get(supplierTabId)
          const fallbackUrl = SEL.cart_url.startsWith('http')
            ? SEL.cart_url
            : new URL(SEL.cart_url, tab.url).href
          await chrome.tabs.update(supplierTabId, { url: fallbackUrl })
          await waitForTabLoad(supplierTabId, 10_000)
        }
      }
    }

    // Der Tab bleibt im Hintergrund. Der User holt ihn erst durch Klick auf "Jetzt bestellen" 
    // in der Web-App in den Vordergrund (via CHECKOUT_FOCUS Message).

    const finalTab = await chrome.tabs.get(supplierTabId)
    const cartUrl  = finalTab.url ?? loginUrl

    let statusMsg = '[OK] Warenkorb bereit - jetzt bestellen.'
    if (hasError) {
      statusMsg = '[Fehler] Es konnten nicht alle Artikel hinzugefuegt werden!'
    } else if (hasWarning) {
      statusMsg = '[Warnung] Preisabweichung erkannt - bitte vor dem Bestellen pruefen!'
    }

    await patch('ready', statusMsg, {
      cart_url:            cartUrl,
      items:               updatedItems,
      price_warning:       hasWarning,
      price_deviation_pct: maxDelta,
    })

    await chrome.storage.session.set({
      activeSession: { sessionId, supplierId, loginUrl, tabId: supplierTabId, status: 'ready' },
    })

    console.log('[sw] Session ready. cartUrl=', cartUrl, 'priceWarning=', hasWarning)

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const translatedMsg = translateError(msg)
    console.error('[sw] Automation failed:', msg)

    await patch('error', 'Kritischer Fehler: ' + translatedMsg, { error_message: msg })

    await chrome.storage.session.set({
      activeSession: { sessionId, supplierId, loginUrl, tabId: supplierTabId, status: 'error', error: translatedMsg },
    })
  }
}

function translateError(msg) {
  if (msg.includes('Receiving end does not exist') || msg.includes('No tab with id') || msg.includes('tab was closed')) {
    return 'Der Shop-Tab wurde unerwartet geschlossen oder die Shop-Seite hat im Hintergrund neugeladen. Bitte starte den Bestellvorgang neu.'
  }
  if (msg.includes('Timeout')) {
    return 'Ein wichtiges Element auf der Shop-Seite konnte nicht rechtzeitig gefunden werden (Timeout).'
  }
  if (msg.includes('context must be one of')) {
    return 'Interner KI-Fehler: Unbekannter Reparaturbefehl.'
  }
  if (msg.includes('Gemini 404') || msg.includes('not supported for generateContent') || msg.includes('Gemini 400')) {
    return 'Die künstliche Intelligenz ist aktuell nicht erreichbar. Wir versuchen es später noch einmal.'
  }
  if (msg.includes('Failed to fetch')) {
    return 'Netzwerkfehler: Keine Verbindung zum Shop oder zur Cloud möglich. Prüfe deine Internetverbindung.'
  }
  return msg
}

// 🧰 withHeal: DOM action + self-healing fallback ──────────────────────────────

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

async function waitForTabLoad(tabId, timeout = 20_000) {
  // Fast-path: Wenn der Tab bereits geladen ist, können wir die Event-Listener überspringen
  try {
    const current = await chrome.tabs.get(tabId)
    if (current && current.status === 'complete') {
      await new Promise(r => setTimeout(r, 400))
      return
    }
  } catch {}

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
  let pathname = ''
  try { pathname = new URL(currentTab.url ?? '').pathname } catch {}
  
  const titleRes = await domAction(tabId, { command: 'GET_TEXT', selector: 'title', timeout: 2000 })
  const currentTitle = (titleRes.text ?? '').toLowerCase()
  
  const loginKeywords = /(login|signin|anmelden|anmeldung|auth|kundenbereich)/i
  const looksLikeLogin = loginKeywords.test(pathname) || loginKeywords.test(currentTitle)

  if (!looksLikeLogin) return false

  const passwordFieldExists = await domAction(tabId, {
    command: 'CHECK_EXISTS',
    selector: 'input[type="password"]',
    timeout: 2000
  })

  return passwordFieldExists.success && looksLikeLogin
}

async function checkAlreadyLoggedIn(tabId) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const isLogoutLink = (el) => {
          const href = (el.getAttribute('href') || '').toLowerCase();
          const text = (el.innerText || '').toLowerCase();
          
          const isNewsletter = href.includes('newsletter') || text.includes('newsletter') || text.includes('news');
          if (isNewsletter) return false;
          
          const matchesHref = href.includes('logout') || href.includes('abmelden') || href.includes('signout') || href.includes('logoff') || href.includes('log-out');
          const matchesText = text === 'abmelden' || text === 'logout' || text === 'ausloggen' || text === 'abmeldung' || 
                              text.includes('abmelden') || text.includes('logout') || text.includes('ausloggen');
                              
          return matchesHref || matchesText;
        };
        
        const links = Array.from(document.querySelectorAll('a[href], button, [onclick]'));
        const hasRealLogout = links.some(isLogoutLink);
        const hasPasswordInput = !!document.querySelector('input[type="password"]');
        
        if (hasPasswordInput) return false;
        
        return hasRealLogout;
      }
    });
    return !!result?.result;
  } catch (err) {
    console.warn('[sw] Error checking already logged in status:', err.message);
    return false;
  }
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

// ── Playbook System ───────────────────────────────────────────────────────────

function extractDomain(url) {
  if (!url) return null
  try {
    const normalized = url.startsWith('http') ? url : `https://${url}`
    return new URL(normalized).hostname.replace(/^www\./, '').toLowerCase()
  } catch { return null }
}

function interpolate(template, ctx) {
  if (!template) return template
  return template
    .replace(/\{loginUrl\}/g,      ctx.loginUrl      ?? '')
    .replace(/\{username\}/g,      ctx.username       ?? '')
    .replace(/\{password\}/g,      ctx.password       ?? '')
    .replace(/\{item\.url\}/g,     ctx.item?.url      ?? '')
    .replace(/\{item\.quantity\}/g, String(ctx.item?.quantity ?? ''))
    .replace(/\{item\.name\}/g,    ctx.item?.product_name ?? '')
    .replace(/\{item\.sku\}/g,     ctx.item?.product_number ?? '')
}

async function waitForUrlPattern(tabId, pattern, timeout = 10_000) {
  const re = new RegExp(pattern, 'i')
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId)
    if (re.test(tab.url ?? '')) return
    await sleep(300)
  }
  throw new Error(`URL-Pattern /${pattern}/ nicht erreicht nach ${timeout}ms`)
}

async function executeSteps(supplierTabId, steps, ctx, patch, patchMsg, payload) {
  if (!Array.isArray(steps) || steps.length === 0) return

  for (const step of steps) {
    const selector = step.selector ? interpolate(step.selector, ctx) : undefined
    const value    = step.value    ? interpolate(step.value, ctx)    : undefined

    try {
      switch (step.step) {
        case 'navigate': {
          const url = interpolate(step.url, ctx)
          if (patchMsg) await patch('searching', patchMsg)
          await navigateAndReinject(supplierTabId, url, step.timeout ?? 15_000)
          break
        }
        case 'fill': {
          if (payload) {
            const { sessionId, supplierId, selfHealUrl, userJwt } = payload
            await withHeal({
              supplierTabId, sessionId, supplierId, selfHealUrl, userJwt,
              ctx: step.step_context || 'playbook_fill', command: 'FILL',
              selector, value, timeout: step.timeout ?? 8_000
            })
          } else {
            const res = await domAction(supplierTabId, {
              command: 'FILL', selector, value, timeout: step.timeout ?? 8_000,
            })
            if (!res.success) throw new Error(`[playbook] FILL fehlgeschlagen: ${selector} — ${res.error}`)
          }
          break
        }
        case 'click': {
          if (payload) {
            const { sessionId, supplierId, selfHealUrl, userJwt } = payload
            await withHeal({
              supplierTabId, sessionId, supplierId, selfHealUrl, userJwt,
              ctx: step.step_context || 'playbook_click', command: 'CLICK',
              selector, timeout: step.timeout ?? 8_000
            })
          } else {
            const res = await domAction(supplierTabId, {
              command: 'CLICK', selector, timeout: step.timeout ?? 8_000,
            })
            if (!res.success) throw new Error(`[playbook] CLICK fehlgeschlagen: ${selector} — ${res.error}`)
          }
          break
        }
        case 'wait_for_element': {
          // Poll via CHECK_EXISTS until found or timeout
          const pollDeadline = Date.now() + (step.timeout ?? 10_000)
          let found = false
          while (Date.now() < pollDeadline) {
            const r = await domAction(supplierTabId, { command: 'CHECK_EXISTS', selector, timeout: 1500 })
            if (r.success) { found = true; break }
            await sleep(400)
          }
          if (!found) throw new Error(`[playbook] wait_for_element timeout: ${selector}`)
          break
        }
        case 'wait_for_url': {
          await waitForUrlPattern(supplierTabId, step.pattern, step.timeout ?? 10_000)
          break
        }
        case 'wait_for_load': {
          await waitForTabLoad(supplierTabId, step.timeout ?? 12_000)
          await chrome.scripting.executeScript({
            target: { tabId: supplierTabId },
            files:  ['content-scripts/automation-worker.js'],
          }).catch(e => console.warn('[playbook] Re-inject failed:', e?.message))
          break
        }
        case 'key_press': {
          await domAction(supplierTabId, {
            command: 'KEY_PRESS', value: step.key ?? 'Enter', timeout: 2_000,
          })
          break
        }
        case 'sleep': {
          await sleep(step.ms ?? 1_000)
          break
        }
        default:
          console.warn('[playbook] Unbekannter Step-Typ:', step.step)
      }
    } catch (err) {
      if (step.optional) {
        console.log(`[playbook] Optionaler Schritt fehlgeschlagen (wird uebersprungen): ${step.step} - ${err.message || err}`)
      } else {
        throw err
      }
    }
  }
}

async function loadAndRunPlaybook(payload, supplierTabId, patch) {
  const {
    supabaseUrl, supabaseAnonKey, userJwt,
    loginUrl, username, password,
    selectors: SEL,
    items: ITEMS, sessionId, supplierId,
    priceThresholdPct: THRESHOLD,
  } = payload

  const domain = extractDomain(loginUrl)
  if (!domain) return null

  let playbookRow = null
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/shop_playbooks?domain=eq.${encodeURIComponent(domain)}&select=playbook,automation_status`,
      { headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${userJwt}` } }
    )
    const rows = await res.json()
    playbookRow = rows?.[0]
  } catch (e) {
    console.warn('[playbook] Fetch fehlgeschlagen, Legacy-Pfad wird genutzt:', e.message)
    return null
  }

  if (!playbookRow?.playbook || playbookRow.automation_status !== 'verified') {
    console.log(`[playbook] Kein verifiziertes Playbook für ${domain} (status: ${playbookRow?.automation_status ?? 'nicht gefunden'})`)
    return null
  }

  const { login_steps = [], item_steps = [], checkout_steps = [] } = playbookRow.playbook
  console.log(`[playbook] Verifiziertes Playbook gefunden für ${domain} — starte Playbook-Pfad`)

  const baseCtx = { loginUrl, username, password }

  try {
    // Phase 1: Login
    const loginRequired = SEL?.login_required ?? false
    if (!loginRequired) {
      console.log('[playbook] Login not required. Skipping playbook login steps.')
      await patch('logging_in', 'Login übersprungen (nicht erforderlich)…')
      await sleep(1000)
    } else {
      const loggedIn = await checkAlreadyLoggedIn(supplierTabId)
      if (loggedIn) {
        console.log('[playbook] Already logged in. Skipping playbook login steps.')
        await patch('logging_in', 'Sitzung bereits angemeldet (überspringe Login)…')
        await sleep(1000)
      } else if (login_steps.length > 0) {
        await patch('logging_in', 'Melde an (Playbook)...')
        await executeSteps(supplierTabId, login_steps, baseCtx, patch, null, payload)
        await sleep(500)

        if (await isAuthWall(supplierTabId)) {
          throw new Error('Login fehlgeschlagen! Bitte Zugangsdaten in den Lieferanten-Einstellungen prüfen.')
        }
      }
    }

    // Phase 2: Pro Artikel
    const updatedItems = ITEMS.map(i => ({ ...i }))

    for (let idx = 0; idx < ITEMS.length; idx++) {
      const item = ITEMS[idx]
      const itemCtx = { ...baseCtx, item }

      await patch('searching', `Öffne Produkt: ${item.product_name}...`, { items: updatedItems })

      try {
        await executeSteps(supplierTabId, item_steps, itemCtx, patch, `Suche ${item.product_name}...`, payload)

        // Produkt-URL nach erfolgreichem Add-to-Cart in DB sichern
        if (item.product_id) {
          try {
            const currentTab = await chrome.tabs.get(supplierTabId)
            const url = currentTab.url
            if (url && !url.includes('search') && !url.includes('?q=')) {
              await fetch(`${supabaseUrl}/rest/v1/products?id=eq.${item.product_id}`, {
                method: 'PATCH',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization:  `Bearer ${userJwt}`,
                  apikey:          supabaseAnonKey,
                  Prefer:          'return=minimal',
                },
                body: JSON.stringify({ order_url: url }),
              })
            }
          } catch (_) {}
        }

        updatedItems[idx] = { ...item, status: 'ok' }
      } catch (itemErr) {
        console.error(`[playbook] Artikel fehlgeschlagen: ${item.product_name}`, itemErr.message)
        updatedItems[idx] = { ...item, status: 'error' }
        await patch('error', `Fehler bei ${item.product_name}: ${itemErr.message}`, { items: updatedItems })
      }
    }

    // Phase 3: Checkout
    if (checkout_steps.length > 0) {
      await patch('searching', 'Warenkorb wird geöffnet...')
      await executeSteps(supplierTabId, checkout_steps, baseCtx, patch, 'Öffne Warenkorb...', payload)
    }

    await chrome.tabs.update(supplierTabId, { active: false })
    const finalTab  = await chrome.tabs.get(supplierTabId)
    const cartUrl   = finalTab.url ?? loginUrl
    const hasWarning = updatedItems.some(i => i.status === 'error')
    const maxDelta   = null

    return { cartUrl, updatedItems, hasWarning, maxDelta }

  } catch (err) {
    console.error('[playbook] Playbook-Ausführung fehlgeschlagen, Fallback auf Legacy-Pfad:', err.message)
    // Reopen tab fresh for the legacy path
    await navigateAndReinject(supplierTabId, loginUrl, 15_000)
    return null
  }
}
