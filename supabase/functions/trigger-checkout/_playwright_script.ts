// supabase/functions/trigger-checkout/_playwright_script.ts
//
// Generates the JavaScript string that Browserless.io executes inside a
// real Chromium instance via its /playwright endpoint.
//
// The script receives all dynamic data through the `context` object
// (injected by Browserless from the POST body) so no secrets are
// string-interpolated into the code itself.
//
// Runtime environment: Node.js inside Browserless — NOT Deno.
// Uses native fetch (available in Node 18+, which Browserless runs).

export function buildBrowserlessScript(): string {
  return /* javascript */ `
// ─── Browserless Playwright script ────────────────────────────────────────────
// Entry point: Browserless calls this function and passes { page, context }.
// context = { sessionId, supabaseUrl, serviceKey, selfHealUrl, supplierId,
//             loginUrl, username, password, selectors, items, priceThresholdPct }

export default async function ({ page, context }) {
  const {
    sessionId,
    supabaseUrl,
    serviceKey,
    selfHealUrl,
    supplierId,
    loginUrl,
    username,
    password,
    selectors: SEL,
    items:     ITEMS,
    priceThresholdPct: THRESHOLD,
  } = context

  // ── Helper: PATCH checkout_sessions via Supabase REST ─────────────────────
  // Each call triggers a Supabase Realtime event → frontend updates live.

  async function patchSession(status, message, extra = {}) {
    try {
      const res = await fetch(
        supabaseUrl + '/rest/v1/checkout_sessions?id=eq.' + sessionId,
        {
          method: 'PATCH',
          headers: {
            apikey:          serviceKey,
            Authorization:   'Bearer ' + serviceKey,
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
      if (!res.ok) {
        console.error('[script] patchSession HTTP ' + res.status + ': ' + await res.text())
      }
    } catch (e) {
      console.error('[script] patchSession fetch failed:', e.message)
    }
  }

  // ── Helper: run a Playwright action; self-heal on selector timeout ─────────
  // ctx   - action context name (used in selector_heal_log.context)
  // action - async (selector: string, timeout: number) => T
  // selector - current CSS selector to try
  // timeout  - ms before giving up and asking the AI

  async function withHeal(ctx, action, selector, timeout = 8000) {
    try {
      return await action(selector, timeout)
    } catch (primaryErr) {
      console.log(
        '[script] Selector failed [' + ctx + '] "' + selector + '": ' + primaryErr.message
      )

      // Capture current viewport screenshot (base64) and DOM snapshot
      const screenshot = await page
        .screenshot({ type: 'png', encoding: 'base64', fullPage: false })
        .catch(() => '')

      // Limit HTML to 50 KB to stay within edge function payload limits
      const html = await page
        .evaluate(() => document.documentElement.outerHTML)
        .catch(() => '')

      // Call self-heal-selector Edge Function (step 2 — must be deployed first)
      const healRes = await fetch(selfHealUrl, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization:  'Bearer ' + serviceKey,
        },
        body: JSON.stringify({
          session_id:        sessionId,
          supplier_id:       supplierId,
          context:           ctx,
          failed_selector:   selector,
          screenshot_base64: screenshot,
          html_snippet:      html.substring(0, 50000),
        }),
      }).catch(() => null)

      if (healRes && healRes.ok) {
        const payload = await healRes.json().catch(() => ({}))
        const newSelector = payload.new_selector

        if (newSelector) {
          console.log('[script] Self-heal → new selector:', newSelector)
          // One retry with the AI-provided selector
          return await action(newSelector, timeout)
        }
      }

      // Self-heal unavailable or returned nothing → propagate original error
      throw new Error('Self-heal failed [' + ctx + ']: ' + selector)
    }
  }

  // ── Working copy of items (enriched with live price data) ─────────────────
  const updatedItems = ITEMS.map(i => ({ ...i }))

  try {
    // ── Step 1: Login ────────────────────────────────────────────────────────

    await patchSession('logging_in', 'Verbinde mit ' + new URL(loginUrl).hostname + '…')

    await page.goto(loginUrl, { waitUntil: 'networkidle', timeout: 30000 })

    const isAlreadyLoggedIn = await page.evaluate(() => {
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
    });

    if (isAlreadyLoggedIn) {
      console.log('[script] Sitzung bereits angemeldet (überspringe Login).')
      await patchSession('logging_in', 'Sitzung bereits angemeldet (überspringe Login)…')
      await page.waitForTimeout(1000)
    } else if (SEL.login_username && SEL.login_password && username) {
      await withHeal(
        'login',
        (s, t) => page.fill(s, username, { timeout: t }),
        SEL.login_username
      )
      await withHeal(
        'login',
        (s, t) => page.fill(s, password, { timeout: t }),
        SEL.login_password
      )

      if (SEL.login_submit) {
        await withHeal(
          'login',
          (s, t) => page.click(s, { timeout: t }),
          SEL.login_submit
        )
      } else {
        await page.keyboard.press('Enter')
      }

      // Wait for redirect after login; non-fatal if it takes longer
      await page
        .waitForLoadState('networkidle', { timeout: 20000 })
        .catch(() => console.warn('[script] networkidle after login timed out — continuing'))
    }

    console.log('[script] Login abgeschlossen')

    // ── Step 2: For each item → search → set qty → extract price → add to cart

    for (let idx = 0; idx < ITEMS.length; idx++) {
      const item = ITEMS[idx]

      // ── 2a. Search ─────────────────────────────────────────────────────────

      await patchSession('searching', 'Suche ' + item.product_name + '…', {
        items: updatedItems,
      })

      if (SEL.search_box) {
        // Clear the search box first (some shops keep previous term)
        await withHeal(
          'search',
          async (s, t) => {
            await page.fill(s, '', { timeout: t })
            await page.fill(s, item.product_name, { timeout: t })
          },
          SEL.search_box
        )

        if (SEL.search_submit) {
          await withHeal(
            'search',
            (s, t) => page.click(s, { timeout: t }),
            SEL.search_submit
          )
        } else {
          await page.keyboard.press('Enter')
        }

        await page
          .waitForLoadState('networkidle', { timeout: 12000 })
          .catch(() => {})
      }

      // ── 2b. Set quantity ───────────────────────────────────────────────────

      await patchSession('adding', item.product_name + ' wird hinzugefügt…', {
        items: updatedItems,
      })

      if (SEL.product_qty) {
        await withHeal(
          'add_to_cart',
          async (s, t) => {
            await page.fill(s, '', { timeout: t })
            await page.fill(s, String(item.quantity), { timeout: t })
          },
          SEL.product_qty
        ).catch(e => {
          // Non-fatal: some shops derive qty from individual "add" clicks
          console.warn('[script] Qty-Feld nicht befüllbar:', e.message)
        })
      }

      // ── 2c. Extract actual price from DOM ─────────────────────────────────

      let priceActual    = null
      let priceDeltaPct  = null
      let priceOk        = null

      if (SEL.price) {
        try {
          const priceText = await page.textContent(SEL.price, { timeout: 6000 })
          // Match european/us decimal formats: "12,99" "12.99" "1.234,56"
          const m = (priceText ?? '')
            .replace(/\\s/g, '')
            .match(/\\d{1,3}(?:[.,]\\d{3})*[.,]\\d{1,2}|\\d+[.,]\\d{1,2}/)
          if (m) {
            // Normalize: remove thousand separators, convert comma-decimal to dot
            const normalized = m[0]
              .replace(/\\.(\\d{3})/g, '$1') // remove dot-thousands
              .replace(/,/g, '.')             // comma → dot
            priceActual = parseFloat(normalized)
          }
        } catch (_) {
          console.warn('[script] Preis für "' + item.product_name + '" nicht extrahierbar')
        }
      }

      if (priceActual !== null && item.price_expected !== null && item.price_expected > 0) {
        priceDeltaPct = ((priceActual - item.price_expected) / item.price_expected) * 100
        priceOk       = Math.abs(priceDeltaPct) <= THRESHOLD
      }

      updatedItems[idx] = {
        ...item,
        price_actual:    priceActual,
        price_delta_pct: priceDeltaPct !== null ? Math.round(priceDeltaPct * 100) / 100 : null,
        price_ok:        priceOk,
      }

      // ── 2d. Click "Add to cart" ────────────────────────────────────────────

      if (SEL.add_to_cart) {
        await withHeal(
          'add_to_cart',
          (s, t) => page.click(s, { timeout: t }),
          SEL.add_to_cart
        )
        // Give the shop cart endpoint time to respond before the next item
        await page.waitForTimeout(1200)
      }

      console.log(
        '[script] ' + item.product_name +
        ' | qty=' + item.quantity +
        ' | price_expected=' + item.price_expected +
        ' | price_actual=' + priceActual +
        ' | delta=' + (priceDeltaPct !== null ? priceDeltaPct.toFixed(1) + '%' : 'n/a')
      )
    }

    // ── Step 3: Price validation & session handover ────────────────────────

    await patchSession('price_check', 'Preise werden abgeglichen…')

    const hasWarning = updatedItems.some(i => i.price_ok === false)
    const allDeltas  = updatedItems
      .map(i => Math.abs(i.price_delta_pct ?? 0))
      .filter(d => d > 0)
    const maxDelta = allDeltas.length > 0 ? Math.max(...allDeltas) : null

    // Resolve the cart handover URL.
    // SEL.cart_url can be an absolute URL or a path relative to the current origin.
    let cartUrl = page.url()
    if (SEL.cart_url) {
      cartUrl = SEL.cart_url.startsWith('http')
        ? SEL.cart_url
        : new URL(SEL.cart_url, page.url()).href
    }

    const statusMessage = hasWarning
      ? '⚠️ Preisabweichung erkannt – bitte vor dem Bestellen prüfen!'
      : '✅ Warenkorb bereit – jetzt übernehmen und bestellen.'

    await patchSession('ready', statusMessage, {
      cart_url:            cartUrl,
      items:               updatedItems,
      price_warning:       hasWarning,
      price_deviation_pct: maxDelta,
    })

    console.log(
      '[script] Session ' + sessionId + ' bereit.' +
      ' cartUrl=' + cartUrl +
      ' priceWarning=' + hasWarning
    )

    return {
      success:  true,
      cartUrl,
      items:    updatedItems,
      hasWarning,
    }

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[script] Fatal error:', msg)

    await patchSession('error', 'Fehler: ' + msg, { error_message: msg })

    // Re-throw so Browserless logs it and returns a non-200 response,
    // which trigger-checkout catches in runCloudAutomation.
    throw err
  }
}
`
}
