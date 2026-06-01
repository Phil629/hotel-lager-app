// supabase/functions/start-learning/index.ts
//
// Cloud Learning Pipeline — "Das Dojo" v2
// Serverless Playwright + Browserbase Compiler für B2B-Webshop-Playbooks.
//
// Umgebungsvariablen:
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//   BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"
import { chromium }     from "npm:playwright-core@1.44.0"
import type { Page, Locator } from "npm:playwright-core@1.44.0"
import { encode as encodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts"

// ── Env ───────────────────────────────────────────────────────────────────────

const SUPABASE_URL           = Deno.env.get("SUPABASE_URL")!
const SUPABASE_ANON_KEY      = Deno.env.get("SUPABASE_ANON_KEY")!
const SUPABASE_SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const BROWSERBASE_API_KEY    = Deno.env.get("BROWSERBASE_API_KEY")!
const BROWSERBASE_PROJECT_ID = Deno.env.get("BROWSERBASE_PROJECT_ID")!

declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void }

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

// ── Timeouts ──────────────────────────────────────────────────────────────────

const GLOBAL_PIPELINE_TIMEOUT_MS = 140_000
const CDP_CONNECT_TIMEOUT_MS     =  30_000
const PAGE_LOAD_MS               =  20_000
const NETWORK_SETTLE_MS          =   3_500  // Extra SPA-Hydrations-Zeit nach DOMContentLoaded
const CLICK_MS                   =   8_000
const FILL_MS                    =   6_000
const DRY_RUN_TIMEOUT_MS         =  30_000

// ── Typen ─────────────────────────────────────────────────────────────────────

interface PlaybookStep {
  step:      string
  url?:      string
  selector?: string
  value?:    string
  key?:      string
  ms?:       number
  timeout?:  number
  pattern?:  string
}

interface Playbook {
  login_steps:    PlaybookStep[]
  item_steps:     PlaybookStep[]
  checkout_steps: PlaybookStep[]
}

interface BrowserbaseSession {
  id:         string
  connectUrl: string
}

type LogFn = (level: string, message: string) => void

// ── Cookie-Banner-Selektoren (statische Layer) ────────────────────────────────

const COOKIE_SELECTORS_DECLINE = [
  "#onetrust-reject-all-handler",
  "#CybotCookiebotDialogBodyButtonDecline",
  ".cm-btn-decline",
  '[data-testid="uc-deny-all-button"]',
  'button[id*="decline" i]',
  'button[id*="reject" i]',
  'button[id*="ablehnen" i]',
  'button[id*="notwendig" i]',
  'a[id*="decline" i]',
]

const COOKIE_SELECTORS_ACCEPT = [
  "#onetrust-accept-btn-handler",
  "#CybotCookiebotDialogBodyButtonAccept",
  ".cm-btn-accept-all",
  '[data-testid="uc-accept-all-button"]',
  'button[id*="accept-all" i]',
  'button[class*="accept-all" i]',
  'button[id*="akzeptieren" i]',
  'button[id*="zustimmen" i]',
  'button[class*="cookie-accept" i]',
]

// Regex für In-Browser-Textscan (Layer 3) und Shadow-DOM-Filter (Layer 2)
const COOKIE_TEXT_RE = /alle akzeptieren|alle zulassen|nur notwendige|cookies akzeptieren|zustimmen|einverstanden|accept all|allow all|i agree/i

// ── Entry Point ───────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })

  try {
    const authHeader = req.headers.get("Authorization") ?? ""
    if (!authHeader.startsWith("Bearer ")) {
      return respond({ error: "Missing Authorization header" }, 401)
    }

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const isServiceKey = authHeader === `Bearer ${SUPABASE_SERVICE_KEY}`
    if (!isServiceKey) {
      const tmpClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: authHeader } },
      })
      const token = authHeader.replace("Bearer ", "").trim()
      const { data: { user }, error: authErr } = await tmpClient.auth.getUser(token)
      if (authErr || !user) {
        return respond({ error: "Unauthorized", details: authErr?.message }, 401)
      }
      const { data: profile } = await adminClient
        .from("profiles").select("role").eq("id", user.id).single()
      if (profile?.role !== "admin" && profile?.role !== "owner") {
        return respond({ error: "Nur SaaS-Admins oder Inhaber dürfen den Lernprozess starten." }, 403)
      }
    }

    const body: { domain?: string; test_product?: string } = await req.json().catch(() => ({}))
    const { domain, test_product = "Reinigungsmittel" } = body

    if (!domain) return respond({ error: "domain required" }, 400)

    if (!BROWSERBASE_API_KEY || !BROWSERBASE_PROJECT_ID) {
      return respond({
        error: "BROWSERBASE_API_KEY oder BROWSERBASE_PROJECT_ID nicht konfiguriert. " +
               "Bitte in Supabase-Secrets hinterlegen.",
      }, 500)
    }

    console.log(`[start-learning] Domain: ${domain}, test_product: ${test_product}`)

    const { error: upsertErr } = await adminClient
      .from("shop_playbooks")
      .upsert(
        {
          domain,
          automation_status: "learning_auth",
          last_learning_run: new Date().toISOString(),
          learning_error:    null,
          learning_logs:     [],
        },
        { onConflict: "domain" }
      )

    if (upsertErr) {
      console.error("[start-learning] DB upsert fehlgeschlagen:", upsertErr)
      return respond({ error: "DB-Fehler: " + upsertErr.message }, 500)
    }

    // Globaler 140s-Timeout-Guard: verhindert, dass automation_status auf "learning_auth"
    // hängen bleibt wenn die Pipeline bei einem CDP-Hang das 150s-Limit erreicht.
    EdgeRuntime.waitUntil(
      Promise.race([
        runLearningPipeline(domain, test_product, adminClient),
        new Promise<void>((_, reject) =>
          setTimeout(
            () => reject(new Error(
              `Pipeline globaler Timeout: ${GLOBAL_PIPELINE_TIMEOUT_MS / 1000}s überschritten.`
            )),
            GLOBAL_PIPELINE_TIMEOUT_MS
          )
        ),
      ]).catch(async (err) => {
        const msg = err instanceof Error ? err.message : String(err)
        console.error("[start-learning] Pipeline abgebrochen:", msg)
        await adminClient.from("shop_playbooks").update({
          automation_status: "failed",
          learning_error:    msg,
          last_learning_run: new Date().toISOString(),
        }).eq("domain", domain).catch(() => {})
      })
    )

    return respond({
      ok:      true,
      status:  "learning_auth",
      domain,
      message: `Lernprozess für ${domain} gestartet. Status wird live in shop_playbooks aktualisiert.`,
    })

  } catch (err) {
    console.error("[start-learning] Fatal:", err)
    return respond({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

// ── Haupt-Pipeline ────────────────────────────────────────────────────────────

async function runLearningPipeline(
  domain:      string,
  testProduct: string,
  adminClient: ReturnType<typeof createClient>,
): Promise<void> {
  const setStatus = async (status: string, extra: Record<string, unknown> = {}) => {
    const { error } = await adminClient
      .from("shop_playbooks")
      .update({ automation_status: status, ...extra })
      .eq("domain", domain)
    if (error) console.error("[learning] setStatus DB-Fehler:", error)
  }

  // ── Log-Infrastruktur mit serialisiertem Write-Queue ─────────────────────
  // Verhindert Race Conditions: rapid aufeinanderfolgende logDojo-Aufrufe können
  // bei einfachem fire-and-forget die DB in falscher Reihenfolge überschreiben.
  const runLogs: Array<{ timestamp: string; level: string; message: string }> = []
  let _logFlushPending = false
  let _logFlushQueued  = false

  const flushLogs = async (): Promise<void> => {
    if (_logFlushPending) { _logFlushQueued = true; return }
    _logFlushPending = true
    try {
      const snap = [...runLogs]
      const { error } = await adminClient
        .from("shop_playbooks")
        .update({ learning_logs: snap })
        .eq("domain", domain)
      if (error) console.warn("[logDojo] DB-Fehler:", error.message)
    } catch (err) {
      console.error("[logDojo] Unerwarteter Fehler beim Log-Schreiben:", err)
    } finally {
      _logFlushPending = false
      if (_logFlushQueued) {
        _logFlushQueued = false
        void flushLogs()
      }
    }
  }

  const logDojo: LogFn = (level, message) => {
    runLogs.push({ timestamp: new Date().toISOString(), level, message })
    console.log(`[dojo:${level}] ${message}`)
    void flushLogs()
  }

  let currentSessionId: string | null = null

  try {
    // ════════════════════════════════════════════════════════════════════
    // PHASE 1 — Login-Formular-Selektoren lernen (anonymer Besuch)
    // Ziel: login_steps erzeugen
    // Kosten: Residential Proxy (erster Eindruck, Fingerprint wichtig)
    // ════════════════════════════════════════════════════════════════════
    logDojo("info", `🚀 Starte Dojo v2 für ${domain}...`)

    logDojo("info", "Erstelle Browserbase-Session (Residential Proxy)...")
    const loginSession = await createBrowserbaseSession(true)
    currentSessionId   = loginSession.id

    // VNC-Link im Admin-Terminal (Admin.tsx parst "ID: ..." und zeigt Live-Video-Button)
    logDojo("info", `📡 Session aktiv — ID: ${loginSession.id}`)
    logDojo("info", `🔴 Live-Browser: https://www.browserbase.com/sessions/${loginSession.id}`)

    const loginBrowser = await connectWithTimeout(loginSession.connectUrl)
    let loginSteps: PlaybookStep[] = []

    try {
      const loginCtx  = loginBrowser.contexts()[0]
      const loginPage = loginCtx.pages()[0] ?? await loginCtx.newPage()

      logDojo("info", `🌐 Lade Homepage: https://${domain}`)
      await loginPage.goto(`https://${domain}`, {
        waitUntil: "domcontentloaded",
        timeout:   PAGE_LOAD_MS,
      })
      await smartWaitForLoad(loginPage)

      await checkForCloudflare(loginPage)

      const cookieStep = await dismissCookieBanner(loginPage, logDojo)
      if (cookieStep) logDojo("info", "🍪 Cookie-Banner erfolgreich geschlossen.")
      else            logDojo("info", "Kein Cookie-Banner erkannt.")

      loginSteps = await learnLoginFlow(loginPage, domain, cookieStep, logDojo)
      logDojo("success", `✅ Phase 1 abgeschlossen: ${loginSteps.length} Login-Steps gelernt.`)
      console.log(`[learning] Phase 1 abgeschlossen: ${loginSteps.length} Login-Steps`)
    } finally {
      await loginBrowser.close().catch(() => {})
      await stopBrowserbaseSession(currentSessionId)
      currentSessionId = null
    }

    // ════════════════════════════════════════════════════════════════════
    // PHASE 2 — Warenkorb & Checkout-Flow lernen (anonymer Gast)
    // Ziel: item_steps + checkout_steps erzeugen
    // Kosten: Residential Proxy (fresh session, andere IP)
    // ════════════════════════════════════════════════════════════════════
    await setStatus("learning_cart")
    logDojo("info", "🛒 Phase 2 gestartet — lerne Warenkorb-Flow...")
    console.log(`[learning] ═══ Phase 2 Start: ${domain} ═══`)

    logDojo("info", "Erstelle neue Browserbase-Session (Residential Proxy)...")
    const cartSession = await createBrowserbaseSession(true)
    currentSessionId  = cartSession.id

    logDojo("info", `📡 Neue Session aktiv — ID: ${cartSession.id}`)
    logDojo("info", `🔴 Live-Browser: https://www.browserbase.com/sessions/${cartSession.id}`)

    const cartBrowser = await connectWithTimeout(cartSession.connectUrl)
    let itemSteps:     PlaybookStep[] = []
    let checkoutSteps: PlaybookStep[] = []

    try {
      const cartCtx  = cartBrowser.contexts()[0]
      const cartPage = cartCtx.pages()[0] ?? await cartCtx.newPage()

      logDojo("info", `🌐 Lade Homepage für Phase 2: https://${domain}`)
      await cartPage.goto(`https://${domain}`, {
        waitUntil: "domcontentloaded",
        timeout:   PAGE_LOAD_MS,
      })
      await smartWaitForLoad(cartPage)

      await checkForCloudflare(cartPage)

      const cookieStep2 = await dismissCookieBanner(cartPage, logDojo)
      if (cookieStep2) logDojo("info", "🍪 Cookie-Banner geschlossen (Phase 2).")

      const result  = await learnCartFlow(cartPage, domain, testProduct, logDojo)
      itemSteps     = result.item
      checkoutSteps = result.checkout
      logDojo("success", `✅ Phase 2 abgeschlossen: ${itemSteps.length} item_steps, ${checkoutSteps.length} checkout_steps.`)
      console.log(`[learning] Phase 2: ${itemSteps.length} item_steps, ${checkoutSteps.length} checkout_steps`)
    } finally {
      await cartBrowser.close().catch(() => {})
      await stopBrowserbaseSession(currentSessionId)
      currentSessionId = null
    }

    if (itemSteps.length === 0) {
      throw new Error(
        "Keine item_steps gelernt. Add-to-Cart-Button konnte nicht gefunden werden. " +
        "Möglicherweise ist ein Login für den Warenkorb erforderlich."
      )
    }

    // ════════════════════════════════════════════════════════════════════
    // PHASE 3 — Dry-Run (Garantieschranke, max. 30s, Datacenter-Proxy)
    // Spielt das Playbook BLIND ab — kein AI, rein mechanisch.
    // Kosten: Datacenter-Proxy (günstig, nur Selector-Validierung)
    // ════════════════════════════════════════════════════════════════════
    logDojo("dry_run", "🧪 Dry-Run gestartet (Datacenter-Proxy, max. 30 Sek.)...")
    console.log(`[learning] ═══ Dry-Run Start: ${domain} ═══`)

    const drySession = await createBrowserbaseSession(false)
    currentSessionId = drySession.id

    logDojo("dry_run", `📡 Dry-Run Session — ID: ${drySession.id}`)
    logDojo("info", `🔴 Live-Browser: https://www.browserbase.com/sessions/${drySession.id}`)

    const dryBrowser = await connectWithTimeout(drySession.connectUrl)

    const candidatePlaybook: Playbook = {
      login_steps:    loginSteps,
      item_steps:     itemSteps,
      checkout_steps: checkoutSteps,
    }

    let dryRunPassed = false
    let dryRunError:  string | null = null

    try {
      const dryCtx  = dryBrowser.contexts()[0]
      const dryPage = dryCtx.pages()[0] ?? await dryCtx.newPage()

      await Promise.race([
        executeDryRun(dryPage, domain, candidatePlaybook, testProduct, logDojo),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(
              `Dry-Run Timeout: ${DRY_RUN_TIMEOUT_MS / 1000}s überschritten.`
            )),
            DRY_RUN_TIMEOUT_MS
          )
        ),
      ])

      dryRunPassed = true
      logDojo("dry_run", "✅ Dry-Run bestanden! Kassenseite erfolgreich erreicht.")
      console.log(`[learning] ✅ Dry-Run bestanden für ${domain}`)
    } catch (err) {
      dryRunError = err instanceof Error ? err.message : String(err)
      logDojo("error", `❌ Dry-Run fehlgeschlagen: ${dryRunError}`)
      console.error(`[learning] ❌ Dry-Run fehlgeschlagen für ${domain}: ${dryRunError}`)
    } finally {
      await dryBrowser.close().catch(() => {})
      await stopBrowserbaseSession(currentSessionId)
      currentSessionId = null
    }

    // ── Ergebnis in DB committen ──────────────────────────────────────────────
    if (dryRunPassed) {
      const { data: current } = await adminClient
        .from("shop_playbooks")
        .select("playbook, playbook_version")
        .eq("domain", domain)
        .single()

      const newVersion = (current?.playbook_version ?? 0) + 1
      logDojo("success", `🎉 Playbook v${newVersion} verifiziert und in Datenbank gespeichert!`)

      await setStatus("verified", {
        playbook:          candidatePlaybook,
        playbook_previous: current?.playbook ?? null,
        playbook_version:  newVersion,
        learning_error:    null,
        last_learning_run: new Date().toISOString(),
      })

      console.log(`[learning] 🎉 ${domain} verifiziert! Playbook v${newVersion} gespeichert.`)
    } else {
      logDojo("error", "Lernprozess fehlgeschlagen. Fehler in Datenbank gespeichert.")
      await setStatus("failed", {
        learning_error:    dryRunError ?? "Dry-Run fehlgeschlagen ohne Fehlermeldung.",
        last_learning_run: new Date().toISOString(),
      })
    }

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[learning] Fataler Fehler für ${domain}:`, msg)

    if (currentSessionId) {
      await stopBrowserbaseSession(currentSessionId).catch((e) =>
        console.warn("[learning] Session-Freigabe fehlgeschlagen:", e)
      )
    }

    runLogs.push({ timestamp: new Date().toISOString(), level: "error", message: `💀 Fataler Fehler: ${msg}` })

    await adminClient.from("shop_playbooks").update({
      automation_status: "failed",
      learning_error:    msg,
      last_learning_run: new Date().toISOString(),
      learning_logs:     [...runLogs],
    }).eq("domain", domain)
  }
}

// ── Playwright-Helfer ─────────────────────────────────────────────────────────

/** Sicheres isVisible: gibt false zurück statt zu werfen. Niemals hängend. */
async function safeIsVisible(locator: Locator, timeoutMs = 2000): Promise<boolean> {
  return locator.isVisible({ timeout: timeoutMs }).catch(() => false)
}

/**
 * page.title() mit hartem Timeout. Ohne diesen Guard hängt der Aufruf in
 * Proxy-Umgebungen bei langsamen DNS-Lookups oder Cloudflare-Challenges.
 */
async function safeTitle(page: Page, timeoutMs = 3000): Promise<string> {
  return Promise.race([
    page.title(),
    new Promise<string>((_, reject) =>
      setTimeout(() => reject(new Error("title timeout")), timeoutMs)
    ),
  ]).catch(() => "")
}

/**
 * CDP-Verbindung mit Timeout. Verhindert ewiges Hängen wenn Browserbase
 * den WebSocket-Endpoint nicht rechtzeitig bereitstellt.
 */
async function connectWithTimeout(connectUrl: string) {
  return Promise.race([
    chromium.connectOverCDP(connectUrl),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(
          `CDP-Verbindungs-Timeout (${CDP_CONNECT_TIMEOUT_MS / 1000}s). Browserbase-Endpoint nicht erreichbar.`
        )),
        CDP_CONNECT_TIMEOUT_MS
      )
    ),
  ])
}

/**
 * Intelligente Seitenladewartezeit nach goto().
 * Wartet auf body-Inhalt > 500 Zeichen (schließt Blank-Pages und Cloudflare-Spinners aus)
 * ODER läuft nach NETWORK_SETTLE_MS ab — was zuerst eintritt.
 * Plus kurzer Settle-Delay für React/Vue Event-Handler-Registrierung.
 */
async function smartWaitForLoad(page: Page): Promise<void> {
  await Promise.race([
    page.waitForFunction(
      () => document.body && document.body.innerHTML.length > 500,
      { timeout: NETWORK_SETTLE_MS }
    ),
    page.waitForTimeout(NETWORK_SETTLE_MS),
  ]).catch(() => {})
  await page.waitForTimeout(600)
}

/**
 * Cloudflare-Challenge-Erkennung. Wirft, falls blockiert.
 * Nach jedem page.goto() aufrufen.
 */
async function checkForCloudflare(page: Page): Promise<void> {
  const title = await safeTitle(page, 2000)
  if (/(cloudflare|attention required|checking your browser|just a moment)/i.test(title)) {
    throw new Error(
      `🛡️ Cloudflare Bot-Detection ausgelöst (Titel: "${title}"). ` +
      "Bitte Proxy wechseln oder Shop-Domain prüfen."
    )
  }

  const cfLocator = page.locator(
    'h1:has-text("Cloudflare"), h2:has-text("Checking your browser"), ' +
    '#cf-error-details, .cf-error-overview, [data-translate="block_headline"]'
  )
  if (await safeIsVisible(cfLocator.first(), 1200)) {
    throw new Error("🛡️ Cloudflare Challenge-Seite erkannt. Residential Proxy wurde geblockt.")
  }
}

// ── Cookie-Banner-Engine (v2, 3 Layer) ───────────────────────────────────────

/**
 * Layer 1: Statische CSS-Selektoren (schnell, präzise für bekannte CMPs).
 * Layer 2: Shadow DOM piercing via Playwright pierce/ engine (Shopware 6, Usercentrics, Cookiebot v2).
 * Layer 3: In-Browser Textscan via page.evaluate() — 0 CDP-Roundtrips, maximale Reichweite.
 *
 * Alle Layer führen einen vertrauenswürdigen Playwright-CDP-Klick aus,
 * damit Overlay-Animationen korrekt abgespielt werden und keine Blocking-Layer bleiben.
 */
async function dismissCookieBanner(page: Page, logDojo: LogFn): Promise<PlaybookStep | null> {
  const allStaticSelectors = [...COOKIE_SELECTORS_DECLINE, ...COOKIE_SELECTORS_ACCEPT]

  // Warte auf Banner-Erscheinen: Race zwischen bekannten Selektoren und 2.5s Timeout.
  // Lazy-geladene CMPs (z.B. Cookiebot) erscheinen oft erst nach 1-2s.
  await Promise.race([
    page.waitForSelector(allStaticSelectors.join(","), { timeout: 2500 }),
    page.waitForTimeout(2500),
  ]).catch(() => {})

  // Layer 1: Statische CSS-Selektoren
  const foundSelector = await page.evaluate((selectors) => {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (!el) continue;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        return sel;
      } catch { /* ungültiger Selektor */ }
    }
    return null;
  }, allStaticSelectors);

  if (foundSelector) {
    try {
      const loc = page.locator(foundSelector).first()
      await loc.click({ timeout: 3000 })
      await page.waitForTimeout(700)
      logDojo("info", `🍪 Layer 1 (CSS): ${foundSelector}`)
      return { step: "click", selector: foundSelector, timeout: 3000, optional: true }
    } catch { /* weiter */ }
  }

  // Layer 2: Shadow DOM piercing — Shopware 6, Usercentrics, Cookiebot v2
  // pierce/ engine durchdringt Shadow Roots, die document.querySelectorAll nicht sieht.
  for (const tag of ["button", "a"] as const) {
    try {
      const loc = page.locator(`pierce/${tag}`).filter({ hasText: COOKIE_TEXT_RE })
      if (!(await safeIsVisible(loc.first(), 1500))) continue
      const el  = await loc.first().elementHandle()
      const sel = el ? (await extractStableSelector(page, el) ?? `pierce/${tag}`) : `pierce/${tag}`
      await loc.first().click({ timeout: 3000 })
      await page.waitForTimeout(800)
      logDojo("info", `🍪 Layer 2 (Shadow DOM): ${sel}`)
      return { step: "click", selector: sel, timeout: 3000, optional: true }
    } catch { /* weiter */ }
  }

  // Layer 3: In-Browser Textsuche (0 CDP-Roundtrips, maximale Performance)
  try {
    const result = await page.evaluate((textReSource: string) => {
      const re = new RegExp(textReSource, "i")
      const elements = [
        ...Array.from(document.querySelectorAll("button")),
        ...Array.from(document.querySelectorAll("a")),
      ]
      for (const el of elements) {
        const style = window.getComputedStyle(el)
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          parseFloat(style.opacity) === 0
        ) continue
        const rect = el.getBoundingClientRect()
        if (rect.width === 0 && rect.height === 0) continue
        if (!re.test((el.textContent ?? "").trim())) continue
        ;(el as HTMLElement).click()
        if (el.id && !/^[0-9]/.test(el.id)) return `#${el.id}`
        const name = el.getAttribute("name")
        if (name) return `${el.tagName.toLowerCase()}[name="${name}"]`
        const aria = el.getAttribute("aria-label")
        if (aria) return `[aria-label="${aria}"]`
        const cls = Array.from(el.classList).find(c => c.length > 2 && !/^[a-f0-9]{4,}$/.test(c))
        if (cls) return `${el.tagName.toLowerCase()}.${cls}`
        const txt = (el.textContent ?? "").trim().substring(0, 60)
        return txt ? `text=${txt}` : null
      }
      return null
    }, COOKIE_TEXT_RE.source)

    if (result) {
      // Playwright-Klick für korrekte Overlay-Animation (Layer-3 hat nur JS-click gemacht)
      const playbookSel = result.startsWith("text=")
        ? `button >> text="${result.substring(5).replace(/"/g, "")}"`
        : result
      await page.click(playbookSel, { timeout: 4000 }).catch(() => {})
      await page.waitForTimeout(1000)
      logDojo("info", `🍪 Layer 3 (In-Browser): ${playbookSel}`)
      return { step: "click", selector: playbookSel, timeout: 3000, optional: true }
    }
  } catch (err) {
    console.warn("[cookie] Layer-3-Scan fehlgeschlagen:", (err as Error).message?.substring(0, 100))
  }

  return null
}

// ── Phase 1: Login-Flow lernen ─────────────────────────────────────────────────

async function learnLoginFlow(
  page:       Page,
  domain:     string,
  cookieStep: PlaybookStep | null,
  logDojo:    LogFn,
): Promise<PlaybookStep[]> {
  const steps: PlaybookStep[] = []
  steps.push({ step: "navigate", url: "{loginUrl}", timeout: PAGE_LOAD_MS })
  if (cookieStep) steps.push(cookieStep)

  let onLoginPage = await isLoginPage(page)

  if (!onLoginPage) {
    logDojo("info", "Suche Login-Navigations-Button im Header/Nav...")
    const LOGIN_NAV_SELECTORS = [
      'a[href*="/login" i]',
      'a[href*="/anmeld" i]',
      'a[href*="/signin" i]',
      'a[href*="/konto" i]',
      'a[href*="/account" i]',
      'a[href*="/kundenbereich" i]',
      'a[href*="/mein-konto" i]',
      '[data-action*="login" i]',
      'button[id*="login" i]',
      'a[class*="login" i]',
      ".user-login a",
      ".account-link",
    ]

    const visibleLoginNav = await page.evaluate((selectors) => {
      for (const sel of selectors) {
        try {
          const el = document.querySelector(sel);
          if (!el) continue;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) continue;
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          return sel;
        } catch { /* ungültiger Selektor */ }
      }
      return null;
    }, LOGIN_NAV_SELECTORS)

    if (visibleLoginNav) {
      try {
        const loc = page.locator(visibleLoginNav).first()
        const el = await loc.elementHandle()
        if (el) {
          const stableSel = await extractStableSelector(page, el) ?? visibleLoginNav
          const urlBefore = page.url()

          await loc.click({ timeout: 5000 })

          // URL-Änderungs-Poll (max. 3s) — robuster als waitForNavigation bei SPAs
          const deadline = Date.now() + 3000
          let navigated = false
          while (Date.now() < deadline) {
            if (page.url() !== urlBefore) { navigated = true; break }
            await page.waitForTimeout(200)
          }

          if (navigated) {
            await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {})
            await smartWaitForLoad(page)
          } else {
            await page.waitForTimeout(800)
          }

          await checkForCloudflare(page)
          onLoginPage = await isLoginPage(page)

          if (onLoginPage) {
            steps.push({ step: "click", selector: stableSel, timeout: CLICK_MS })
            steps.push({ step: "wait_for_load", timeout: 10_000 })
            logDojo("info", `🔑 Login-Navigation geklickt: ${stableSel}`)
            console.log(`[learning] Login-Nav-Button: ${stableSel}`)
          }
        }
      } catch (err) {
        const msg = (err as Error).message?.substring(0, 80) ?? "unbekannt"
        console.warn(`[login-nav] Login-Nav-Button fehlgeschlagen: ${msg}`)
      }
    }
  }

  if (!onLoginPage) {
    logDojo("warning", `Kein Login-Formular auf ${domain} gefunden — Login-Steps werden minimal generiert.`)
    console.warn(`[learning] Kein Login-Formular auf ${domain} gefunden`)
    return steps
  }

  logDojo("info", "Login-Formular erkannt. Scanne Eingabefelder...")

  // 1. Passwort-Feld zuerst finden und das übergeordnete Formular ermitteln
  const pwdLoc = page.locator('input[type="password"]').first()
  const passwordSelector = (await safeIsVisible(pwdLoc, 2000)) ? 'input[type="password"]' : null
  if (passwordSelector) logDojo("info", "🔒 Passwort-Feld gefunden.")

  let formLoc = page.locator('form:has(input[type="password"])').first()
  let hasLoginForm = await safeIsVisible(formLoc, 1500)
  
  if (hasLoginForm) {
    logDojo("info", "Semantische Gruppierung: Nutze das Passwort-Formular als Such-Scope.")
  } else {
    logDojo("info", "Kein übergeordnetes Formular gefunden. Weiche auf globalen Seiten-Scan aus.")
    formLoc = page.locator('body')
  }

  // ── Username-Feld ──────────────────────────────────────────────────────────
  const USERNAME_SELECTORS = [
    'input[type="email"]',
    'input[name="email"]',
    'input[name="user_email"]',
    'input[name="username"]',
    'input[name="login"]',
    'input[name="user"]',
    'input[autocomplete="email"]',
    'input[autocomplete="username"]',
    'input[id*="email" i]:not([type="hidden"])',
    'input[id*="login" i]:not([type="hidden"])',
    'input[id*="username" i]:not([type="hidden"])',
  ]

  let usernameSelector: string | null = null
  const formSel = hasLoginForm ? 'form:has(input[type="password"])' : 'body'
  const visibleUsernameSelector = await page.evaluate(({ selectors, formSelector }) => {
    const container = document.querySelector(formSelector) || document.body;
    for (const sel of selectors) {
      try {
        const el = container.querySelector(sel);
        if (!el) continue;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) continue;
        return sel;
      } catch { /* ungültiger Selektor */ }
    }
    return null;
  }, { selectors: USERNAME_SELECTORS, formSelector: formSel })

  if (visibleUsernameSelector) {
    const loc = formLoc.locator(visibleUsernameSelector).first()
    const el = await loc.elementHandle()
    if (el) {
      usernameSelector = await extractStableSelector(page, el) ?? visibleUsernameSelector
      logDojo("info", `📧 E-Mail/Benutzername-Feld: ${usernameSelector}`)
    }
  }

  // ── Submit-Button ─────────────────────────────────────────────────────────
  const SUBMIT_SELECTORS = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button[name="login"]',
    'button[id*="login" i]',
    'button[class*="login" i]',
    'button[class*="anmeld" i]',
    '[data-action*="login" i]',
    ".login-submit",
    "form button:last-of-type",
  ]

  let submitSelector: string | null = null
  const visibleSubmitSelector = await page.evaluate(({ selectors, formSelector }) => {
    const container = document.querySelector(formSelector) || document.body;
    for (const sel of selectors) {
      try {
        const el = container.querySelector(sel);
        if (!el) continue;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) continue;
        return sel;
      } catch { /* ungültiger Selektor */ }
    }
    return null;
  }, { selectors: SUBMIT_SELECTORS, formSelector: formSel })

  if (visibleSubmitSelector) {
    const loc = formLoc.locator(visibleSubmitSelector).first()
    const el = await loc.elementHandle()
    if (el) {
      submitSelector = await extractStableSelector(page, el) ?? visibleSubmitSelector
      logDojo("info", `🖱️ Submit-Button: ${submitSelector}`)
    }
  }

  // ── Steps zusammenstellen ─────────────────────────────────────────────────
  if (usernameSelector) {
    steps.push({ step: "fill", selector: usernameSelector, value: "{username}", timeout: FILL_MS })
  }
  if (passwordSelector) {
    steps.push({ step: "fill", selector: passwordSelector, value: "{password}", timeout: FILL_MS })
  }
  if (submitSelector) {
    steps.push({ step: "click", selector: submitSelector, timeout: CLICK_MS })
    steps.push({ step: "wait_for_load", timeout: 12_000 })
  } else if (usernameSelector) {
    steps.push({ step: "key_press", key: "Enter" })
    steps.push({ step: "wait_for_load", timeout: 12_000 })
  }

  logDojo("success", `Login-Steps: ${steps.length} (user=${!!usernameSelector}, pass=${!!passwordSelector}, submit=${!!submitSelector}).`)
  console.log(
    `[learning] Login-Selektoren: username=${usernameSelector} ` +
    `password=${passwordSelector} submit=${submitSelector}`
  )
  return steps
}

// ── Phase 2: Warenkorb-Flow lernen ────────────────────────────────────────────

async function learnCartFlow(
  page:        Page,
  domain:      string,
  testProduct: string,
  logDojo:     LogFn,
): Promise<{ item: PlaybookStep[]; checkout: PlaybookStep[] }> {
  const itemSteps:     PlaybookStep[] = []
  const checkoutSteps: PlaybookStep[] = []

  // ── 2a: Suchfeld finden ───────────────────────────────────────────────────
  const SEARCH_SELECTORS = [
    'input[type="search"]',
    'input[name="search"]',
    'input[name="s"]',
    'input[name="q"]',
    'input[name="query"]',
    'input[name="suche"]',
    'input[name="keywords"]',
    'input[placeholder*="suche" i]',
    'input[placeholder*="search" i]',
    'input[aria-label*="suche" i]',
    'input[aria-label*="search" i]',
    "#search-query",
    "#searchInput",
    ".search-input",
  ]

  let searchSelector: string | null = null
  const visibleSearchSelector = await page.evaluate((selectors) => {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (!el) continue;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        return sel;
      } catch { /* ungültiger Selektor */ }
    }
    return null;
  }, SEARCH_SELECTORS)

  if (visibleSearchSelector) {
    const loc = page.locator(visibleSearchSelector).first()
    const el = await loc.elementHandle()
    if (el) {
      searchSelector = await extractStableSelector(page, el) ?? visibleSearchSelector
    }
  }

  if (!searchSelector) {
    searchSelector = await aiHealSelector(page, "search", SEARCH_SELECTORS.join(", "), logDojo)
  }

  if (!searchSelector) {
    throw new Error(`Kein Suchfeld auf ${domain} gefunden — Cart-Flow kann nicht gelernt werden.`)
  }

  logDojo("info", `🔍 Suchfeld gefunden: ${searchSelector}`)
  console.log(`[learning] Suchfeld: ${searchSelector}`)

  // ── 2b: Testprodukt suchen ────────────────────────────────────────────────
  logDojo("info", `Suche nach "${testProduct}"...`)
  await page.fill(searchSelector, testProduct)
  await page.keyboard.press("Enter")
  await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {})
  await smartWaitForLoad(page)
  await checkForCloudflare(page)

  // ── 2c: Produkt-Link in Suchergebnissen ───────────────────────────────────
  const PRODUCT_LINK_SELECTORS = [
    '.product-item a[href*="/"]',
    '.product-card a[href*="/"]',
    ".search-result a",
    ".product a",
    "article a",
    "li.product a",
    ".products a",
    '[class*="product-item"] a',
    '[class*="product-card"] a',
  ]

  let testProductUrl: string | null = null
  const visibleProductLink = await page.evaluate(({ selectors, domainStr }) => {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (!el) continue;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) continue;
        const href = el.getAttribute("href");
        if (!href || href === "/" || href.startsWith("#")) continue;
        return href.startsWith("http") ? href : `https://${domainStr}${href}`;
      } catch { /* ungültiger Selektor */ }
    }
    return null;
  }, { selectors: PRODUCT_LINK_SELECTORS, domainStr: domain })

  if (visibleProductLink) {
    testProductUrl = visibleProductLink
  }

  // Fallback: alle <a> mit produktartigem Pfad (max. 60 Links scannen)
  if (!testProductUrl) {
    const allLinks = await page.locator("a[href]").all()
    for (const link of allLinks.slice(0, 60)) {
      const href = await link.getAttribute("href").catch(() => null) ?? ""
      if (
        (href.includes("/product") || href.includes("/artikel") ||
         href.includes("/p/") || href.includes("/item") || href.includes("/produkt")) &&
        !href.includes("category") && !href.includes("kategorie") && !href.includes("search")
      ) {
        testProductUrl = href.startsWith("http") ? href : `https://${domain}${href}`
        break
      }
    }
  }

  if (!testProductUrl) {
    throw new Error(
      `Keine Produkt-URL in Suchergebnissen für "${testProduct}" auf ${domain} gefunden.`
    )
  }

  logDojo("info", `📦 Produkt-URL gefunden: ${testProductUrl}`)
  console.log(`[learning] Test-Produkt-URL: ${testProductUrl}`)
  itemSteps.push({ step: "navigate", url: "{item.url}", timeout: PAGE_LOAD_MS })

  await page.goto(testProductUrl, { waitUntil: "domcontentloaded", timeout: PAGE_LOAD_MS })
  await smartWaitForLoad(page)
  await dismissCookieBanner(page, logDojo)

  // Login-Wall frühzeitig erkennen — kein sinnloser Selektor-Scan danach
  if (await isLoginPage(page)) {
    throw new Error(
      `Produktseite ${testProductUrl} erfordert Login. ` +
      "Der Shop benötigt Gast-Checkout für das Dojo-Lernen."
    )
  }

  // ── 2d: Mengenfeld ────────────────────────────────────────────────────────
  const QTY_SELECTORS = [
    'input[type="number"][name*="qty" i]',
    'input[type="number"][name*="quantity" i]',
    'input[type="number"][name*="menge" i]',
    'input[type="number"][name*="anzahl" i]',
    'input[type="number"][id*="qty" i]',
    'input[type="number"][id*="quantity" i]',
    'input[type="number"]',
    'input[name*="quantity" i]:not([type="hidden"])',
    'input[name*="menge" i]:not([type="hidden"])',
  ]

  let qtySelector: string | null = null
  const visibleQtySelector = await page.evaluate((selectors) => {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (!el) continue;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        return sel;
      } catch { /* ungültiger Selektor */ }
    }
    return null;
  }, QTY_SELECTORS)

  if (visibleQtySelector) {
    const loc = page.locator(visibleQtySelector).first()
    const el = await loc.elementHandle()
    if (el) {
      qtySelector = await extractStableSelector(page, el) ?? visibleQtySelector
      await loc.fill("2")
      await page.waitForTimeout(300)
    }
  }

  if (qtySelector) {
    itemSteps.push({ step: "fill", selector: qtySelector, value: "{item.quantity}", timeout: FILL_MS })
    logDojo("info", `🔢 Mengenfeld: ${qtySelector}`)
    console.log(`[learning] Mengenfeld: ${qtySelector}`)
  }

  // ── 2e: Warenkorb-Counter VOR Add-to-Cart ────────────────────────────────
  const cartCountBefore = await getCartCount(page)
  logDojo("info", `🛒 Warenkorb-Zähler vorher: ${cartCountBefore ?? "nicht erkennbar"}`)

  // ── 2f: "In den Warenkorb"-Button ────────────────────────────────────────
  const ADD_CART_SELECTORS = [
    'button[name="inInBasket"]',
    'input[name="inInBasket"]',
    'button[id*="add-to-cart" i]',
    'button[id*="addtocart" i]',
    'button[id*="add_to_cart" i]',
    'button[class*="add-to-cart" i]',
    'button[class*="addtocart" i]',
    'button[name*="basket" i]',
    'button[name*="cart" i]',
    'button[name*="warenkorb" i]',
    'button[data-action*="cart" i]',
    'button[aria-label*="cart" i]',
    'button[aria-label*="warenkorb" i]',
    'input[type="submit"][value*="warenkorb" i]',
    'input[type="submit"][value*="cart" i]',
    'input[type="image"][src*="warenkorb" i]',
    "#product-addtocart-button",
    'form[action*="cart"] button[type="submit"]',
    'form[action*="warenkorb"] button[type="submit"]',
    '.add-to-cart button',
    '.addtocart button',
  ]

  let addCartSelector: string | null = null
  const visibleAddCartSelector = await page.evaluate((selectors) => {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (!el) continue;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) continue;
        if (el.getAttribute("type") === "hidden") continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        return sel;
      } catch { /* ungültiger Selektor */ }
    }
    return null;
  }, ADD_CART_SELECTORS)

  if (visibleAddCartSelector) {
    const loc = page.locator(visibleAddCartSelector).first()
    const el = await loc.elementHandle()
    if (el) {
      addCartSelector = await extractStableSelector(page, el) ?? visibleAddCartSelector
      await loc.click({ timeout: CLICK_MS })
      await page.waitForTimeout(2500)
    }
  }

  if (!addCartSelector) {
    logDojo("info", "Womöglich auf einer Kategorieseite gelandet. Suche nach direkten B2B-Produkt-Links...")
    
    const fallbackDetailUrl = await page.evaluate((domainStr: string) => {
      const allLinks = Array.from(document.querySelectorAll("a[href]"))
      for (const link of allLinks.slice(0, 100)) {
        const href = link.getAttribute("href")
        if (!href || href === "/" || href.startsWith("#") || href.startsWith("javascript:")) continue
        
        const path = href.toLowerCase()
        const isProductPattern =
          // Shopware 5 / Gambio
          path.includes("-p-") || path.includes("/p-") || path.includes("-p/") ||
          // WooCommerce / Shopify
          path.includes("/product/") || path.includes("/products/") || path.includes("/produkt/") || path.includes("/produkte/") ||
          // WooCommerce / JTL / Generic
          path.includes("/artikel/") || path.includes("/item/") || path.includes("/sku/") ||
          // JTL
          /\/a-[a-z0-9]+/i.test(href) ||
          // PrestaShop
          /-\d+\.html$/i.test(href) ||
          // Shopware 6 (UUID check)
          /[a-f0-9]{32}/i.test(href)
          
        const isNotNavigation =
          !path.includes("category") && !path.includes("kategorie") &&
          !path.includes("search") && !path.includes("suche") &&
          !path.includes("cart") && !path.includes("warenkorb") &&
          !path.includes("account") && !path.includes("login")

        if (isProductPattern && isNotNavigation) {
          return href.startsWith("http") ? href : `https://${domainStr}${href}`
        }
      }
      return null
    }, domain)
    
    if (fallbackDetailUrl) {
      logDojo("info", `🔄 Fallback: Kategorieseite erkannt. Navigiere zu echtem Produkt: ${fallbackDetailUrl}`)
      testProductUrl = fallbackDetailUrl
      await page.goto(fallbackDetailUrl, { waitUntil: "domcontentloaded", timeout: PAGE_LOAD_MS })
      await smartWaitForLoad(page)
      await checkForCloudflare(page)
      await dismissCookieBanner(page, logDojo)

      // Nochmal versuchen, den Add-to-Cart-Button auf der neuen Produktseite zu scannen
      const visibleAddCartSelectorFallback = await page.evaluate((selectors) => {
        for (const sel of selectors) {
          try {
            const el = document.querySelector(sel);
            if (!el) continue;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) continue;
            if (el.getAttribute("type") === "hidden") continue;
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            return sel;
          } catch { /* ungültiger Selektor */ }
        }
        return null;
      }, ADD_CART_SELECTORS)

      if (visibleAddCartSelectorFallback) {
        const loc = page.locator(visibleAddCartSelectorFallback).first()
        const el = await loc.elementHandle()
        if (el) {
          addCartSelector = await extractStableSelector(page, el) ?? visibleAddCartSelectorFallback
          await loc.click({ timeout: CLICK_MS })
          await page.waitForTimeout(2500)
        }
      }
    }
  }

  if (!addCartSelector) {
    addCartSelector = await aiHealSelector(page, "add_to_cart", ADD_CART_SELECTORS.join(", "), logDojo)
    if (addCartSelector) {
      await page.click(addCartSelector, { timeout: CLICK_MS })
      await page.waitForTimeout(2500)
    }
  }

  if (!addCartSelector) {
    throw new Error(
      `Kein "In den Warenkorb"-Button auf ${testProductUrl} gefunden. ` +
      "Möglicherweise Login-Schutz oder unbekanntes Shop-Layout."
    )
  }

  // ── 2g: Warenkorb-Counter-Verifikation ───────────────────────────────────
  const cartCountAfter = await getCartCount(page)
  if (cartCountBefore !== null && cartCountAfter !== null) {
    if (cartCountAfter > cartCountBefore) {
      logDojo("success", `🛒 Counter bestätigt: ${cartCountBefore} → ${cartCountAfter} ✅`)
      console.log(`[learning] ✅ Warenkorb-Counter: ${cartCountBefore} → ${cartCountAfter}`)
    } else {
      logDojo("warning", `⚠️ Counter unverändert (${cartCountBefore} → ${cartCountAfter}). Login evtl. erforderlich.`)
      console.warn(
        `[learning] Warenkorb-Counter hat sich nicht erhöht (${cartCountBefore} → ${cartCountAfter}). ` +
        "Möglicherweise ist ein Login erforderlich."
      )
    }
  }

  logDojo("info", `✅ Add-to-Cart geklickt: ${addCartSelector}`)
  itemSteps.push({ step: "click", selector: addCartSelector, timeout: CLICK_MS })
  itemSteps.push({ step: "sleep", ms: 2000 })

  console.log(`[learning] Add-to-Cart: ${addCartSelector}`)

  // ── 2h: Checkout-Navigation lernen ───────────────────────────────────────
  const urlBeforeCart = page.url()

  const CART_ICON_SELECTORS = [
    'a[href*="/cart" i]',
    'a[href*="/warenkorb" i]',
    'a[href*="/basket" i]',
    'a[href*="/kasse" i]',
    'button[aria-label*="cart" i]',
    'button[aria-label*="warenkorb" i]',
    '[class*="cart-icon"]',
    '[class*="cart-link"]',
    '[data-action*="cart" i]',
    "#cartButton",
    ".header-cart a",
    ".mini-cart a",
  ]

  let cartIconSelector: string | null = null
  const visibleCartIconSelector = await page.evaluate((selectors) => {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (!el) continue;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        return sel;
      } catch { /* ungültiger Selektor */ }
    }
    return null;
  }, CART_ICON_SELECTORS)

  if (visibleCartIconSelector) {
    const loc = page.locator(visibleCartIconSelector).first()
    const el = await loc.elementHandle()
    if (el) {
      cartIconSelector = await extractStableSelector(page, el) ?? visibleCartIconSelector
      await loc.click({ timeout: 5000 })
      await page.waitForTimeout(1500)
    }
  }

  // Fallback: direkte URL-Navigation zur Warenkorb-Seite
  if (!cartIconSelector) {
    for (const path of ["/cart", "/warenkorb", "/basket", "/shopping-cart"]) {
      try {
        const testUrl = `https://${domain}${path}`
        await page.goto(testUrl, { waitUntil: "domcontentloaded", timeout: 8000 })
        const currentUrl = page.url()
        if (!currentUrl.includes("404") && !currentUrl.includes("not-found")) {
          cartIconSelector = `a[href="${path}"]`
          logDojo("info", `↩️ Warenkorb-URL-Fallback: ${path}`)
          console.log(`[learning] Warenkorb-URL-Fallback: ${path}`)
          break
        }
      } catch { /* weiter */ }
    }
  }

  if (!cartIconSelector) {
    cartIconSelector = await aiHealSelector(page, "go_to_checkout", CART_ICON_SELECTORS.join(", "), logDojo)
    if (cartIconSelector) {
      await page.click(cartIconSelector, { timeout: 5000 })
      await page.waitForTimeout(1500)
    }
  }

  if (cartIconSelector) {
    logDojo("info", `🛒 Warenkorb-Icon geklickt: ${cartIconSelector}`)
    checkoutSteps.push({ step: "click", selector: cartIconSelector, timeout: CLICK_MS })
    checkoutSteps.push({ step: "sleep", ms: 1500 })
  }

  const urlAfterCart = page.url()
  const didNavigate  = urlAfterCart !== urlBeforeCart

  if (didNavigate) {
    checkoutSteps.push({ step: "wait_for_load", timeout: 10_000 })
  } else {
    logDojo("info", "Offcanvas-Warenkorb erkannt (keine Seitennavigation).")
    checkoutSteps.push({ step: "sleep", ms: 1500 })
  }

  const finalUrl = page.url()
  const isCheckoutPage =
    /\/(checkout|kasse|bestellung|order|bezahlen)(\/|$|\?)/i.test(finalUrl) ||
    await safeIsVisible(
      page.locator('input[name*="firstname" i], input[name*="vorname" i], input[id*="billing" i]').first(),
      1500
    )
  const isCartPage =
    /\/(cart|warenkorb|basket|shopping-cart|shoppingcart)(\/|$|\?)/i.test(finalUrl) ||
    (await findProceedToCheckoutButton(page)) !== null

  if (isCheckoutPage || isCartPage) {
    logDojo("success", `✅ Warenkorb/Kasse erfolgreich erreicht: ${finalUrl}`)
    console.log(`[learning] ✅ Warenkorb oder Kassenseite: ${finalUrl}`)
  } else {
    logDojo("warning", `⚠️ Weder Warenkorb noch Kasse erkannt: ${finalUrl}`)
    console.warn(`[learning] Weder Warenkorb noch Kassenseite erkannt: ${finalUrl}`)
  }

  return { item: itemSteps, checkout: checkoutSteps }
}

// ── Dry-Run: Playbook mechanisch abspielen ────────────────────────────────────

async function executeDryRun(
  page:        Page,
  domain:      string,
  playbook:    Playbook,
  testProduct: string,
  logDojo:     LogFn,
): Promise<void> {
  logDojo("dry_run", "🌐 Lade Homepage für Dry-Run...")
  await page.goto(`https://${domain}`, { waitUntil: "domcontentloaded", timeout: PAGE_LOAD_MS })
  await smartWaitForLoad(page)
  await checkForCloudflare(page)
  await dismissCookieBanner(page, logDojo)

  logDojo("dry_run", `Suche Test-Produkt-URL für "${testProduct}"...`)
  let testProductUrl: string | null = null
  const SEARCH_SELECTORS = [
    'input[type="search"]', 'input[name="s"]', 'input[name="q"]',
    'input[name="suche"]', 'input[name="search"]', 'input[name="keywords"]',
  ]
  for (const sel of SEARCH_SELECTORS) {
    const loc = page.locator(sel).first()
    if (!(await safeIsVisible(loc, 1500))) continue
    await loc.fill(testProduct)
    await page.keyboard.press("Enter")
    await page.waitForLoadState("domcontentloaded", { timeout: 12_000 }).catch(() => {})
    await smartWaitForLoad(page)

    const links = await page.locator("a[href]").all()
    for (const link of links.slice(0, 80)) {
      const href = await link.getAttribute("href").catch(() => null) ?? ""
      if (
        href.includes("/product") || href.includes("/artikel") ||
        href.includes("/p/") || href.includes("/item") || href.includes("/produkt")
      ) {
        testProductUrl = href.startsWith("http") ? href : `https://${domain}${href}`
        break
      }
    }
    if (testProductUrl) break
  }

  if (!testProductUrl) {
    throw new Error(
      `Dry-Run: Produkt-URL für "${testProduct}" nicht gefunden. ` +
      "Suche hat kein Ergebnis mit Produkt-Pfad geliefert."
    )
  }

  logDojo("dry_run", `📦 Produkt-URL: ${testProductUrl}`)

  const ctx = {
    loginUrl: `https://${domain}`,
    username: "",
    password: "",
    item:     { url: testProductUrl, quantity: "2", product_name: testProduct },
  }

  logDojo("dry_run", `▶️ Führe ${playbook.item_steps.length} item_steps aus...`)
  for (const step of playbook.item_steps) {
    await executeStep(page, step, ctx)
  }

  logDojo("dry_run", `▶️ Führe ${playbook.checkout_steps.length} checkout_steps aus...`)
  for (const step of playbook.checkout_steps) {
    await executeStep(page, step, ctx)
  }

  const finalUrl    = page.url()
  const isCheckout  = /\/(checkout|kasse|bestellung|order|bezahlen)(\/|$|\?)/i.test(finalUrl)
  const hasAddrFields = await safeIsVisible(
    page.locator('input[name*="firstname" i], input[name*="vorname" i], input[id*="billing" i]').first(),
    1500
  )
  const isCart = /\/(cart|warenkorb|basket|shopping-cart|shoppingcart)(\/|$|\?)/i.test(finalUrl) ||
    (await findProceedToCheckoutButton(page)) !== null

  logDojo("dry_run", `🔍 Finale URL: ${finalUrl}`)

  if (!isCheckout && !hasAddrFields && !isCart) {
    throw new Error(
      `Dry-Run: Weder Warenkorb noch Kassenseite erreicht. Finale URL: ${finalUrl}. ` +
      "Erwartet: /cart, /warenkorb, /checkout, /kasse o.ä. oder 'Zur Kasse'-Button."
    )
  }
}

async function executeStep(
  page: Page,
  step: PlaybookStep,
  ctx:  { loginUrl: string; username: string; password: string; item: Record<string, string> },
): Promise<void> {
  const ip = (s?: string): string => {
    if (!s) return s ?? ""
    return s
      .replace("{loginUrl}",      ctx.loginUrl)
      .replace("{username}",      ctx.username)
      .replace("{password}",      ctx.password)
      .replace("{item.url}",      ctx.item.url ?? "")
      .replace("{item.quantity}", ctx.item.quantity ?? "1")
      .replace("{item.name}",     ctx.item.product_name ?? "")
  }

  const t = step.timeout ?? 10_000

  switch (step.step) {
    case "navigate":
      await page.goto(ip(step.url), { waitUntil: "domcontentloaded", timeout: t })
      await smartWaitForLoad(page)
      break
    case "fill":
      try {
        await page.fill(ip(step.selector)!, ip(step.value), { timeout: t })
      } catch (err) {
        if (step.optional) {
          console.log(`[dry-run] Optionaler Fill-Schritt fehlgeschlagen: ${step.selector}`)
        } else {
          throw err
        }
      }
      break
    case "click":
      try {
        await page.click(ip(step.selector)!, { timeout: t })
      } catch (err) {
        if (step.optional) {
          console.log(`[dry-run] Optionaler Klick-Schritt fehlgeschlagen: ${step.selector}`)
        } else {
          throw err
        }
      }
      break
    case "wait_for_element":
      await page.waitForSelector(ip(step.selector)!, { timeout: t })
      break
    case "wait_for_url":
      await page.waitForURL(new RegExp(step.pattern ?? "", "i"), { timeout: t })
      break
    case "wait_for_load":
      await page.waitForLoadState("domcontentloaded", { timeout: t })
      await smartWaitForLoad(page)
      break
    case "key_press":
      await page.keyboard.press(step.key ?? "Enter")
      break
    case "sleep":
      await page.waitForTimeout(step.ms ?? 1000)
      break
    default:
      console.warn("[dry-run] Unbekannter Step-Typ:", step.step)
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function findProceedToCheckoutButton(page: Page): Promise<string | null> {
  const SELECTORS = [
    'a[href*="checkout" i]',
    'a[href*="kasse" i]',
    'button[class*="checkout" i]',
    'button[id*="checkout" i]',
    'button[class*="zur-kasse" i]',
    'a[class*="checkout" i]',
    '[data-action*="checkout" i]',
    'button[name*="checkout" i]',
    'input[type="submit"][value*="kasse" i]',
    'input[type="submit"][value*="checkout" i]',
    "button >> text=/zur kasse/i",
    "a >> text=/zur kasse/i",
    "button >> text=/checkout/i",
  ]

  const standardSelectors = SELECTORS.filter(s => !s.includes(">>"));
  const textSelectors = SELECTORS.filter(s => s.includes(">>"));

  const visibleStandard = await page.evaluate((selectors) => {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (!el) continue;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        return sel;
      } catch { /* ungültiger Selektor */ }
    }
    return null;
  }, standardSelectors);

  if (visibleStandard) {
    try {
      const loc = page.locator(visibleStandard).first()
      const el = await loc.elementHandle()
      return el ? (await extractStableSelector(page, el) ?? visibleStandard) : visibleStandard
    } catch {
      return visibleStandard
    }
  }

  for (const sel of textSelectors) {
    try {
      const loc = page.locator(sel).first()
      if (!(await safeIsVisible(loc, 1000))) continue
      const el = await loc.elementHandle()
      return el ? (await extractStableSelector(page, el) ?? sel) : sel
    } catch { /* weiter */ }
  }

  return null
}

async function isLoginPage(page: Page): Promise<boolean> {
  try {
    const url   = page.url().toLowerCase()
    // safeTitle verhindert ewiges Hängen in headless/proxy Umgebungen
    const title = await safeTitle(page, 2000)
    const keywords = /(login|signin|anmeld|anmeldung|auth|konto|kundenbereich)/i
    if (!keywords.test(url) && !keywords.test(title)) return false
    
    // 1. Password field check
    if (await safeIsVisible(page.locator('input[type="password"]').first(), 2000)) {
      return true
    }
    
    // 2. Passwordless fallback check: email fields or OTP/code inputs
    const passwordlessLoc = page.locator(
      'input[type="email"], ' +
      'input[name*="email" i], ' +
      'input[name*="username" i], ' +
      'input[name*="otp" i], ' +
      'input[id*="otp" i], ' +
      'input[name*="code" i], ' +
      'input[id*="code" i], ' +
      'input[autocomplete="one-time-code"]'
    ).first()
    
    return await safeIsVisible(passwordlessLoc, 2000)
  } catch {
    return false
  }
}

async function getCartCount(page: Page): Promise<number | null> {
  const SELECTORS = [
    '[class*="cart-count"]', '[class*="cart-qty"]', '[class*="cart-quantity"]',
    '[id*="cart-count"]',   '[id*="cart-qty"]',    '[class*="basket-count"]',
    '[id*="basket-count"]', "[data-cart-count]",   "[data-cart-qty]",
    ".header-cart .count",  ".cart-icon .badge",   ".mini-cart-count", ".minicart-qty",
  ]

  const visibleCartCountSelector = await page.evaluate((selectors) => {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (!el) continue;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) continue;
        const text = (el.textContent || "").trim();
        const num = parseInt(text, 10);
        if (!isNaN(num)) return { selector: sel, count: num };
      } catch { /* ungültiger Selektor */ }
    }
    return null;
  }, SELECTORS)

  if (visibleCartCountSelector) {
    return visibleCartCountSelector.count;
  }

  return null
}

/**
 * Extrahiert den stabilsten CSS-Selektor für ein DOM-Element.
 * Priorisierung: id > name > data-testid > data-action > aria-label > input[type] > gefilterte Klassen
 * Fix: input[type="text"] wird nur als absoluter Fallback genutzt (nicht vor Klassen-Check).
 */
async function extractStableSelector(page: Page, el: unknown): Promise<string | null> {
  try {
    return await page.evaluate((element: Element) => {
      const getStable = (element: Element): string | null => {
        const tag = element.tagName.toLowerCase()

        if (element.id && !/^[0-9]/.test(element.id) && !/^[a-f0-9]{6,}$/.test(element.id)) {
          return `#${CSS.escape(element.id)}`
        }

        const name = element.getAttribute("name")
        if (name) return `${tag}[name="${name}"]`

        const testId = element.getAttribute("data-testid")
        if (testId) return `[data-testid="${testId}"]`

        const action = element.getAttribute("data-action")
        if (action && action.length < 50) return `[data-action="${action}"]`

        const ariaLabel = element.getAttribute("aria-label")
        if (ariaLabel && ariaLabel.length < 40) return `[aria-label="${ariaLabel}"]`

        if (tag === "input") {
          const t = (element as HTMLInputElement).type || "text"
          // Semantisch stabile Typen zuerst (search/email/password/number)
          if (t === "search" || t === "email" || t === "password" || t === "number") {
            return `input[type="${t}"]`
          }
          // type="text": erst nach Klassen-Check (weiter unten)
        }

        const classes = Array.from(element.classList).filter(
          (c) =>
            c.length > 2 &&
            !/^[a-f0-9]{5,}$/.test(c) &&    // Hash-Klassen
            !/^css-/.test(c) &&               // styled-components
            !/^sc-/.test(c) &&                // styled-components
            !/^[A-Z][a-z]+[A-Z]/.test(c) &&  // camelCase React-Internals
            !/^_/.test(c)                     // private Klassen (Next.js)
        ).slice(0, 2)

        if (classes.length > 0) return `${tag}.${classes.join(".")}`

        // type="text" als absoluter letzter Fallback
        if (tag === "input" && (element as HTMLInputElement).type === "text") {
          return `input[type="text"]`
        }

        return null
      }

      const stable = getStable(element)
      if (!stable) return null

      // Check if element lives inside a Shadow Root
      const root = element.getRootNode()
      const isShadow = root instanceof ShadowRoot || (root && (root as DocumentFragment).host !== undefined)
      
      return isShadow ? `pierce/${stable}` : stable
    }, el)
  } catch {
    return null
  }
}

async function aiHealSelector(
  page: Page,
  context: string,
  failedSelector: string,
  logDojo: LogFn
): Promise<string | null> {
  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")
  if (!GEMINI_API_KEY) {
    logDojo("warning", "🤖 Dojo AI-Healing übersprungen: GEMINI_API_KEY nicht in Supabase hinterlegt.")
    return null
  }

  logDojo("info", `🤖 Dojo AI-Healing wird gestartet für Kontext: "${context}"...`)
  try {
    const screenshot = await page.screenshot({ type: "png" }).catch(() => null)
    let screenshotBase64 = ""
    if (screenshot) {
      screenshotBase64 = encodeBase64(screenshot)
    }
    
    const htmlSnippet = await page.content().catch(() => "")

    const CONTEXT_DESCRIPTIONS: Record<string, string> = {
      search:              'Produkt im Shop suchen (Suchfeld befüllen)',
      add_to_cart:         'Produkt in den Warenkorb legen oder Bestellmenge in ein Zahlenfeld eingeben',
      go_to_checkout:      'Warenkorb-Icon oder Warenkorb-Link anklicken, um den Warenkorb zu öffnen',
    }

    const taskPrompt = `Du bist ein Experte für Web-Scraping und CSS-Selektoren. \
Du hilfst dabei, kaputte Selektoren in unserem asynchronen B2B-Dojo-Compiler zu reparieren.

**Situation:** Wir finden das Element für den Kontext "${context}" nicht.
**Aktion, die durchgeführt werden soll:**
${CONTEXT_DESCRIPTIONS[context] || 'Element finden und anklicken'}

**Fehlgeschlagener Selektor/Muster:** \`${failedSelector}\`

**Deine Aufgabe:**
1. Analysiere den HTML-Code und den Screenshot.
2. Finde das Element, das der gewünschten Aktion entspricht.
3. Erstelle einen stabilen, spezifischen CSS-Selektor.

**Regeln:**
- Bevorzuge id, name, data-*, aria-label, type-Attribute.
- Vermeide positionsbasierte Selektoren (:nth-child) und generierte Hash-Klassen.
- Element darf NICHT vom Typ hidden sein.
- Selektor muss auf GENAU EIN Element matchen.
- Wenn das Element im Shadow-DOM lebt, deklariere es zwingend mit dem Präfix "pierce/" (z.B. "pierce/button[name='accept']").

Antworte ausschließlich als JSON:
{"selector":"...","confidence":0.0,"reasoning":"..."}`

    const geminiParts: unknown[] = []
    if (screenshotBase64) {
      geminiParts.push({ inlineData: { mimeType: 'image/png', data: screenshotBase64 } })
    }
    if (htmlSnippet) {
      geminiParts.push({ text: `HTML (max. 45 KB):\n\`\`\`html\n${htmlSnippet.substring(0, 45_000)}\n\`\`\`` })
    }
    geminiParts.push({ text: taskPrompt })

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${GEMINI_API_KEY}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: geminiParts }],
          generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
        }),
      }
    )

    if (!geminiRes.ok) {
      const errText = await geminiRes.text()
      logDojo("warning", `🤖 Dojo AI-Healing fehlgeschlagen: API Fehler ${geminiRes.status} — ${errText.substring(0, 100)}`)
      return null
    }

    const geminiData = await geminiRes.json()
    const rawText    = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    const aiParsed   = JSON.parse(rawText.replace(/```json/g, '').replace(/```/g, '').trim())

    const selector = aiParsed.selector?.trim() ?? null
    const confidence = aiParsed.confidence ?? 0

    if (selector && confidence >= 0.6) {
      logDojo("success", `🤖 Dojo AI-Healing erfolgreich! Neuer Selektor: "${selector}" (Grund: ${aiParsed.reasoning})`)
      return selector
    } else {
      logDojo("warning", `🤖 Dojo AI-Healing unzureichend: Konfidenz ${confidence.toFixed(2)} für Selektor "${selector}"`)
    }
  } catch (err) {
    logDojo("warning", `🤖 Dojo AI-Healing unerwarteter Fehler: ${(err as Error).message}`)
  }
  return null
}


// ── Browserbase API ───────────────────────────────────────────────────────────

async function createBrowserbaseSession(
  useResidentialProxy: boolean,
): Promise<BrowserbaseSession> {
  const body: Record<string, unknown> = {
    projectId: BROWSERBASE_PROJECT_ID,
    browserSettings: {
      // 1440×900: einige Shops verstecken kritische Buttons bei kleinen Viewports
      viewport: { width: 1440, height: 900 },
      fingerprint: {
        devices:          ["desktop"],
        locales:          ["de-DE", "de"],
        operatingSystems: ["windows"],
        browsers:         ["chrome"],
      },
    },
  }

  if (useResidentialProxy) {
    body.proxies = true
  }

  let res = await fetch("https://api.browserbase.com/v1/sessions", {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      "x-bb-api-key": BROWSERBASE_API_KEY,
    },
    body: JSON.stringify(body),
  })

  // HTTP 402: Residential Proxies nicht im Plan → Fallback auf Standard-Verbindung
  if (res.status === 402 && body.proxies) {
    console.warn("[browserbase] Residential Proxies nicht verfügbar (402). Fallback auf Standard...")
    delete body.proxies
    res = await fetch("https://api.browserbase.com/v1/sessions", {
      method:  "POST",
      headers: {
        "Content-Type": "application/json",
        "x-bb-api-key": BROWSERBASE_API_KEY,
      },
      body: JSON.stringify(body),
    })
  }

  if (!res.ok) {
    const text = await res.text()
    throw new Error(
      `Browserbase Session-Erstellung fehlgeschlagen (HTTP ${res.status}): ${text.substring(0, 300)}`
    )
  }

  const session   = await res.json()
  const sessionId = session.id as string

  if (!sessionId) {
    throw new Error(
      `Browserbase: Keine sessionId in Antwort: ${JSON.stringify(session).substring(0, 200)}`
    )
  }

  const connectUrl: string =
    session.connectUrl ??
    `wss://connect.browserbase.com?apiKey=${BROWSERBASE_API_KEY}&sessionId=${sessionId}`

  console.log(`[browserbase] Session gestartet: ${sessionId} (residential=${useResidentialProxy})`)
  return { id: sessionId, connectUrl }
}

async function stopBrowserbaseSession(sessionId: string): Promise<void> {
  try {
    await fetch(`https://api.browserbase.com/v1/sessions/${sessionId}`, {
      method:  "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-bb-api-key": BROWSERBASE_API_KEY,
      },
      body: JSON.stringify({ status: "REQUEST_RELEASE" }),
    })
    console.log(`[browserbase] Session freigegeben: ${sessionId}`)
  } catch (e) {
    console.warn("[browserbase] Session-Freigabe fehlgeschlagen:", e)
  }
}

// ── Response Helper ───────────────────────────────────────────────────────────

function respond(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  })
}
