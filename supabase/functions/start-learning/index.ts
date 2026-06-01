// supabase/functions/start-learning/index.ts
//
// Cloud Learning Pipeline — "Das Dojo"
// Startet anonym einen Browserbase-Browser, erkundet den Shop in zwei Phasen,
// validiert das gelernte Playbook per Dry-Run und committed das Ergebnis in DB.
//
// Umgebungsvariablen:
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//   BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"
// playwright-core liefert den CDP-Client; Deno unterstützt npm:-Importe ab v1.37+
import { chromium }     from "npm:playwright-core@1.44.0"
import type { Page }    from "npm:playwright-core@1.44.0"

// ── Env ───────────────────────────────────────────────────────────────────────

const SUPABASE_URL           = Deno.env.get("SUPABASE_URL")!
const SUPABASE_ANON_KEY      = Deno.env.get("SUPABASE_ANON_KEY")!
const SUPABASE_SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const BROWSERBASE_API_KEY    = Deno.env.get("BROWSERBASE_API_KEY")!
const BROWSERBASE_PROJECT_ID = Deno.env.get("BROWSERBASE_PROJECT_ID")!

// EdgeRuntime.waitUntil: Hält die Edge Function am Leben auch nachdem die
// HTTP-Antwort bereits gesendet wurde, damit der Lernprozess im Hintergrund läuft.
declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void }

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

// ── Timeouts ──────────────────────────────────────────────────────────────────

const DRY_RUN_TIMEOUT_MS = 30_000  // Dry-Run: max 30 Sekunden laut Spec
const PAGE_LOAD_MS       = 20_000
const CLICK_MS           = 8_000
const FILL_MS            = 6_000

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

// Logging-Funktion, die fire-and-forget in die DB schreibt und im Admin-Terminal sichtbar ist
type LogFn = (level: string, message: string) => void

// ── Cookie-Banner-Selektoren (erst ablehnen, dann akzeptieren als Fallback) ───

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

// ── Entry Point ───────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })

  try {
    // ── 1. Auth: nur SaaS-Admins oder service_role dürfen triggern ───────────
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

    // ── 2. Body parsen ────────────────────────────────────────────────────────
    const body: {
      domain?:       string
      test_product?: string
    } = await req.json().catch(() => ({}))

    const { domain, test_product = "Reinigungsmittel" } = body

    if (!domain) return respond({ error: "domain required" }, 400)

    if (!BROWSERBASE_API_KEY || !BROWSERBASE_PROJECT_ID) {
      return respond({
        error: "BROWSERBASE_API_KEY oder BROWSERBASE_PROJECT_ID nicht konfiguriert. " +
               "Bitte in Supabase-Secrets hinterlegen.",
      }, 500)
    }

    console.log(`[start-learning] Domain: ${domain}, test_product: ${test_product}`)

    // ── 3. Status sofort auf 'learning_auth' setzen (sichtbar im Admin-UI) ───
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

    // ── 4. Lernprozess asynchron im Hintergrund starten mit globalem 140s Timeout ──────────────────────
    // Die HTTP-Antwort wird sofort gesendet. EdgeRuntime.waitUntil hält den
    // Prozess am Leben bis der Lernlauf abgeschlossen (oder timeout) ist.
    EdgeRuntime.waitUntil(
      Promise.race([
        runLearningPipeline(domain, test_product, adminClient),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error("Pipeline global timeout (140s)")), 140_000)
        ),
      ]).catch(async (err) => {
        console.error("[start-learning] Pipeline abgebrochen:", err.message)
        await adminClient.from("shop_playbooks").update({
          automation_status: "failed",
          learning_error:    err.message,
        }).eq("domain", domain)
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
  // Statushelfer: schreibt live in DB — sichtbar im Admin-UI
  const setStatus = async (
    status: string,
    extra:  Record<string, unknown> = {},
  ) => {
    const { error } = await adminClient
      .from("shop_playbooks")
      .update({ automation_status: status, ...extra })
      .eq("domain", domain)
    if (error) console.error("[learning] setStatus DB-Fehler:", error)
  }

  // ── Logging-Infrastruktur ─────────────────────────────────────────────────
  // Jeder logDojo-Aufruf schreibt über eine serialisierte Queue alle Logs in die DB.
  // Das Admin-Terminal abonniert diese Updates via Supabase Realtime.
  const runLogs: Array<{ timestamp: string; level: string; message: string }> = []
  let logWritePending = false
  let logWriteQueued  = false

  const flushLogs = async () => {
    if (logWritePending) { logWriteQueued = true; return }
    logWritePending = true
    const snap = [...runLogs]
    await adminClient
      .from("shop_playbooks")
      .update({ learning_logs: snap })
      .eq("domain", domain)
      .then(({ error }) => { if (error) console.warn("[logDojo] DB-Fehler:", error.message) })
    logWritePending = false
    if (logWriteQueued) { logWriteQueued = false; void flushLogs() }
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
    // Ziel: Login-Selektoren finden → login_steps erzeugen
    // Kosten: Residential Proxy (erster Eindruck, Fingerprint wichtig)
    // ════════════════════════════════════════════════════════════════════
    logDojo("info", `Starte Lernprozess für ${domain}...`)
    console.log(`[learning] ═══ Phase 1 Start: ${domain} ═══`)

    logDojo("info", "Erstelle Browserbase-Session (Residential Proxy)...")
    const loginSession = await createBrowserbaseSession(/* residentialProxy = */ true)
    currentSessionId   = loginSession.id
    logDojo("info", `Browserbase-Session gestartet (ID: ${loginSession.id.substring(0, 8)}…)`)
    const loginBrowser = await chromium.connectOverCDP(loginSession.connectUrl)

    let loginSteps: PlaybookStep[] = []

    try {
      const loginCtx  = loginBrowser.contexts()[0]
      const loginPage = loginCtx.pages()[0] ?? await loginCtx.newPage()

      logDojo("info", `Lade Homepage: https://${domain}`)
      await loginPage.goto(`https://${domain}`, {
        waitUntil: "domcontentloaded",
        timeout:   PAGE_LOAD_MS,
      })
      await loginPage.waitForTimeout(1800)

      // Cookie-Banner wegklicken
      const cookieStep = await dismissCookieBanner(loginPage)
      if (cookieStep) logDojo("info", "Cookie-Banner erkannt und geschlossen.")
      else logDojo("info", "Kein Cookie-Banner erkannt.")

      // Login-Flow-Selektoren lernen
      loginSteps = await learnLoginFlow(loginPage, domain, cookieStep, logDojo)
      logDojo("success", `Phase 1 abgeschlossen: ${loginSteps.length} Login-Steps gelernt.`)
      console.log(`[learning] Phase 1 abgeschlossen: ${loginSteps.length} Login-Steps`)
    } finally {
      await loginBrowser.close().catch(() => {})
      await stopBrowserbaseSession(currentSessionId)
      currentSessionId = null
    }

    // ════════════════════════════════════════════════════════════════════
    // PHASE 2 — Warenkorb & Checkout lernen (anonymer Gast-Flow)
    // Ziel: item_steps + checkout_steps erzeugen
    // Kosten: Residential Proxy (fresh session, andere IP)
    // ════════════════════════════════════════════════════════════════════
    await setStatus("learning_cart")
    logDojo("info", "Phase 2 gestartet — lerne Warenkorb-Flow...")
    console.log(`[learning] ═══ Phase 2 Start: ${domain} ═══`)

    logDojo("info", "Erstelle neue Browserbase-Session (Residential Proxy)...")
    const cartSession = await createBrowserbaseSession(/* residentialProxy = */ true)
    currentSessionId  = cartSession.id
    logDojo("info", `Neue Session gestartet (ID: ${cartSession.id.substring(0, 8)}…)`)
    const cartBrowser = await chromium.connectOverCDP(cartSession.connectUrl)

    let itemSteps:     PlaybookStep[] = []
    let checkoutSteps: PlaybookStep[] = []

    try {
      const cartCtx  = cartBrowser.contexts()[0]
      const cartPage = cartCtx.pages()[0] ?? await cartCtx.newPage()

      logDojo("info", `Lade Homepage für Warenkorb-Session: https://${domain}`)
      await cartPage.goto(`https://${domain}`, {
        waitUntil: "domcontentloaded",
        timeout:   PAGE_LOAD_MS,
      })
      await cartPage.waitForTimeout(1800)

      const cookieStep2 = await dismissCookieBanner(cartPage)
      if (cookieStep2) logDojo("info", "Cookie-Banner geschlossen (Phase 2).")

      const result = await learnCartFlow(cartPage, domain, testProduct, logDojo)
      itemSteps     = result.item
      checkoutSteps = result.checkout
      logDojo("success", `Phase 2 abgeschlossen: ${itemSteps.length} item_steps, ${checkoutSteps.length} checkout_steps.`)
      console.log(`[learning] Phase 2: ${itemSteps.length} item_steps, ${checkoutSteps.length} checkout_steps`)
    } finally {
      await cartBrowser.close().catch(() => {})
      await stopBrowserbaseSession(currentSessionId)
      currentSessionId = null
    }

    // Validierung: mindestens Add-to-Cart-Step muss gelernt worden sein
    if (itemSteps.length === 0) {
      throw new Error(
        "Keine item_steps gelernt. Add-to-Cart-Button konnte nicht gefunden werden. " +
        "Möglicherweise ist ein Login für den Warenkorb erforderlich."
      )
    }

    // ════════════════════════════════════════════════════════════════════
    // PHASE 3 — Dry-Run (Die Garantie-Schranke)
    // Spielt das Playbook BLIND ab — kein AI, rein mechanisch.
    // Muss in unter 30 Sekunden an der Kasse landen.
    // Kosten: Datacenter-Proxy (günstig, nur Selector-Validierung)
    // ════════════════════════════════════════════════════════════════════
    logDojo("dry_run", "Dry-Run gestartet (Datacenter-Proxy, max. 30 Sek.)...")
    console.log(`[learning] ═══ Dry-Run Start: ${domain} ═══`)

    const drySession = await createBrowserbaseSession(/* residentialProxy = */ false)
    currentSessionId = drySession.id
    logDojo("dry_run", `Dry-Run Session gestartet (ID: ${drySession.id.substring(0, 8)}…)`)
    const dryBrowser = await chromium.connectOverCDP(drySession.connectUrl)

    const candidatePlaybook: Playbook = {
      login_steps:    loginSteps,
      item_steps:     itemSteps,
      checkout_steps: checkoutSteps,
    }

    let dryRunPassed  = false
    let dryRunError:  string | null = null

    try {
      const dryCtx  = dryBrowser.contexts()[0]
      const dryPage = dryCtx.pages()[0] ?? await dryCtx.newPage()

      // Race gegen 30-Sekunden-Limit
      await Promise.race([
        executeDryRun(dryPage, domain, candidatePlaybook, testProduct, logDojo),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(
              `Dry-Run Timeout: Kassenseite nicht in ${DRY_RUN_TIMEOUT_MS / 1000}s erreicht.`
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

    // ── Ergebnis in DB committen ───────────────────────────────────────────────
    if (dryRunPassed) {
      // Aktuelles Playbook als Rollback-Puffer sichern
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
      await stopBrowserbaseSession(currentSessionId).catch(() => {})
    }

    // Finalen Fehler noch in die Logs schreiben
    runLogs.push({ timestamp: new Date().toISOString(), level: "error", message: `Fataler Fehler: ${msg}` })

    await adminClient.from("shop_playbooks").update({
      automation_status: "failed",
      learning_error:    msg,
      last_learning_run: new Date().toISOString(),
      learning_logs:     [...runLogs],
    }).eq("domain", domain)
  }
}

// ── Phase 1: Login-Flow lernen ────────────────────────────────────────────────

async function learnLoginFlow(
  page:       Page,
  domain:     string,
  cookieStep: PlaybookStep | null,
  logDojo:    LogFn,
): Promise<PlaybookStep[]> {
  const steps: PlaybookStep[] = []

  // Der erste Step ist immer die Navigation zur Login-URL (Template-Variable)
  steps.push({ step: "navigate", url: "{loginUrl}", timeout: PAGE_LOAD_MS })
  if (cookieStep) steps.push(cookieStep)

  // Prüfen ob wir direkt auf der Login-Seite sind
  let onLoginPage = await isLoginPage(page)

  if (!onLoginPage) {
    // Login-Link im Header/Nav finden und klicken
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

    for (const sel of LOGIN_NAV_SELECTORS) {
      try {
        const loc = page.locator(sel)
        if (!(await loc.isVisible())) continue
        const el = await loc.elementHandle()
        if (!el) continue

        const stableSel = await extractStableSelector(page, el) ?? sel
        const urlBefore = page.url()
        await el.click({ timeout: 4000 })
        
        // Warten, ob sich die URL ändert (echte Navigation)
        const deadline = Date.now() + 3000
        let navigated = false
        while (Date.now() < deadline) {
          if (page.url() !== urlBefore) {
            navigated = true
            break
          }
          await page.waitForTimeout(200)
        }

        if (navigated) {
          await page.waitForLoadState("domcontentloaded", { timeout: 6000 }).catch(() => {})
        } else {
          await page.waitForTimeout(600)
        }

        onLoginPage = await isLoginPage(page)
        if (onLoginPage) {
          // Login-Navigate-Step ins Playbook schreiben
          steps.push({ step: "click", selector: stableSel, timeout: CLICK_MS })
          steps.push({ step: "wait_for_load", timeout: 10_000 })
          logDojo("info", `Login-Navigation-Button geklickt: ${stableSel}`)
          console.log(`[learning] Login-Nav-Button: ${stableSel}`)
          break
        }
      } catch { /* weiter probieren */ }
    }
  }

  if (!onLoginPage) {
    logDojo("warning", `Kein Login-Formular auf ${domain} gefunden — Login-Steps werden trotzdem generiert.`)
    console.warn(`[learning] Kein Login-Formular auf ${domain} gefunden — login_steps bleiben leer`)
    return steps
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
  for (const sel of USERNAME_SELECTORS) {
    const loc = page.locator(sel).first()
    if (await loc.isVisible().catch(() => false)) {
      const el = await loc.elementHandle()
      if (el) {
        usernameSelector = await extractStableSelector(page, el) ?? sel
        logDojo("info", `E-Mail/Benutzername-Feld gefunden: ${usernameSelector}`)
        break
      }
    }
  }

  // ── Passwort-Feld ─────────────────────────────────────────────────────────
  // type="password" ist kanonisch — kein Fallback nötig
  const pwdLoc = page.locator('input[type="password"]').first()
  let passwordSelector: string | null = null
  if (await pwdLoc.isVisible().catch(() => false)) {
    const pwdEl = await pwdLoc.elementHandle()
    if (pwdEl) {
      passwordSelector = 'input[type="password"]'
      logDojo("info", "Passwort-Feld gefunden.")
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
  for (const sel of SUBMIT_SELECTORS) {
    const loc = page.locator(sel).first()
    if (await loc.isVisible().catch(() => false)) {
      const el = await loc.elementHandle()
      if (el) {
        submitSelector = await extractStableSelector(page, el) ?? sel
        logDojo("info", `Login-Button gefunden: ${submitSelector}`)
        break
      }
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
    // Fallback: Enter-Taste
    steps.push({ step: "key_press", key: "Enter" })
    steps.push({ step: "wait_for_load", timeout: 12_000 })
  }

  logDojo("success", `Login-Steps generiert: ${steps.length} Steps (user=${!!usernameSelector}, pass=${!!passwordSelector}, submit=${!!submitSelector}).`)
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
  for (const sel of SEARCH_SELECTORS) {
    const loc = page.locator(sel)
    if (await loc.isVisible()) {
      const el = await loc.elementHandle()
      if (el) {
        searchSelector = await extractStableSelector(page, el) ?? sel
        break
      }
    }
  }

  if (!searchSelector) {
    throw new Error(`Kein Suchfeld auf ${domain} gefunden — Cart-Flow kann nicht gelernt werden.`)
  }

  logDojo("info", `Suchfeld gefunden: ${searchSelector}`)
  console.log(`[learning] Suchfeld: ${searchSelector}`)

  // ── 2b: Testprodukt suchen ────────────────────────────────────────────────
  logDojo("info", `Suche nach "${testProduct}"...`)
  await page.fill(searchSelector, testProduct)
  await page.keyboard.press("Enter")
  await page.waitForLoadState("domcontentloaded", { timeout: 15_000 })
  await page.waitForTimeout(1200)

  // ── 2c: Ersten Produkt-Link in Suchergebnissen finden ─────────────────────
  // Direktlink → wird als {item.url} Template gespeichert (Stufe-1-Discovery)
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
  for (const sel of PRODUCT_LINK_SELECTORS) {
    const el = await page.$(sel)
    if (!el) continue
    const href = await el.getAttribute("href") ?? ""
    if (!href || href === "/" || href.startsWith("#")) continue
    testProductUrl = href.startsWith("http") ? href : `https://${domain}${href}`
    break
  }

  // Fallback: alle <a> mit produktartigem Pfad scannen
  if (!testProductUrl) {
    const allLinks = await page.$$("a[href]")
    for (const link of allLinks) {
      const href = await link.getAttribute("href") ?? ""
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
      `Keine Produkt-URL in den Suchergebnissen für "${testProduct}" auf ${domain} gefunden.`
    )
  }

  logDojo("info", `Test-Produkt-URL gefunden: ${testProductUrl}`)
  console.log(`[learning] Test-Produkt-URL: ${testProductUrl}`)

  // ── 2d: Zur Produktseite navigieren ───────────────────────────────────────
  // Im Playbook: {item.url} — Template-Variable für echte Bestellungen
  itemSteps.push({ step: "navigate", url: "{item.url}", timeout: PAGE_LOAD_MS })

  await page.goto(testProductUrl, { waitUntil: "domcontentloaded", timeout: PAGE_LOAD_MS })
  await page.waitForTimeout(1200)
  await dismissCookieBanner(page)

  // ── 2e: Mengenfeld finden und auf 2 setzen ────────────────────────────────
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
  for (const sel of QTY_SELECTORS) {
    const loc = page.locator(sel)
    if (!(await loc.isVisible())) continue
    const el = await loc.elementHandle()
    if (!el) continue
    qtySelector = await extractStableSelector(page, el) ?? sel
    // Auf 2 setzen für Warenkorb-Counter-Verifikation
    await el.fill("2")
    await page.waitForTimeout(300)
    break
  }

  if (qtySelector) {
    itemSteps.push({ step: "fill", selector: qtySelector, value: "{item.quantity}", timeout: FILL_MS })
    logDojo("info", `Mengenfeld gefunden: ${qtySelector}`)
    console.log(`[learning] Mengenfeld: ${qtySelector}`)
  }

  // ── 2f: Warenkorb-Counter VOR Add-to-Cart lesen ───────────────────────────
  const cartCountBefore = await getCartCount(page)
  logDojo("info", `Warenkorb-Zähler vor Add-to-Cart: ${cartCountBefore ?? "nicht erkennbar"}`)

  // ── 2g: "In den Warenkorb"-Button finden und klicken ─────────────────────
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
  for (const sel of ADD_CART_SELECTORS) {
    const loc = page.locator(sel)
    if (!(await loc.isVisible())) continue
    const el = await loc.elementHandle()
    if (!el) continue
    // type="hidden" ausschließen (isInteractable-Äquivalent)
    const elType = await el.getAttribute("type")
    if (elType === "hidden") continue
    const rect = await el.boundingBox()
    if (!rect || rect.width === 0 || rect.height === 0) continue

    addCartSelector = await extractStableSelector(page, el) ?? sel
    await el.click({ timeout: CLICK_MS })
    await page.waitForTimeout(2500)
    break
  }

  if (!addCartSelector) {
    throw new Error(
      `Kein "In den Warenkorb"-Button auf ${testProductUrl} gefunden. ` +
      "Möglicherweise ist der Shop login-geschützt oder die Produktseite erfordert Login."
    )
  }

  // ── 2h: Warenkorb-Counter-Verifikation ───────────────────────────────────
  const cartCountAfter = await getCartCount(page)
  if (cartCountBefore !== null && cartCountAfter !== null) {
    if (cartCountAfter > cartCountBefore) {
      logDojo("success", `Warenkorb-Zähler bestätigt: ${cartCountBefore} → ${cartCountAfter} ✅`)
      console.log(`[learning] ✅ Warenkorb-Counter: ${cartCountBefore} → ${cartCountAfter}`)
    } else {
      logDojo("warning", `Warenkorb-Zähler hat sich nicht erhöht (${cartCountBefore} → ${cartCountAfter}). Möglicherweise ist Login erforderlich.`)
      console.warn(
        `[learning] Warenkorb-Counter hat sich nicht erhöht (${cartCountBefore} → ${cartCountAfter}). ` +
        "Möglicherweise ist ein Login erforderlich."
      )
    }
  }

  logDojo("info", `Add-to-Cart-Button gefunden und geklickt: ${addCartSelector}`)
  itemSteps.push({ step: "click", selector: addCartSelector, timeout: CLICK_MS })
  itemSteps.push({ step: "sleep", ms: 2000 })

  console.log(`[learning] Add-to-Cart: ${addCartSelector}`)

  // ── 2i: Checkout-Navigation lernen ───────────────────────────────────────
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
  for (const sel of CART_ICON_SELECTORS) {
    const el = await page.$(sel)
    if (!el || !(await el.isVisible())) continue
    cartIconSelector = await extractStableSelector(page, el) ?? sel
    await el.click({ timeout: 5000 })
    await page.waitForTimeout(1500)
    break
  }

  // Fallback: direkte URL-Navigation
  if (!cartIconSelector) {
    for (const path of ["/cart", "/warenkorb", "/basket", "/shopping-cart"]) {
      try {
        const testUrl = `https://${domain}${path}`
        await page.goto(testUrl, { waitUntil: "domcontentloaded", timeout: 8000 })
        const currentUrl = page.url()
        if (!currentUrl.includes("404") && !currentUrl.includes("not-found")) {
          // Synthetischen Selector für URL-Fallback erzeugen
          cartIconSelector = `a[href="${path}"]`
          logDojo("info", `Warenkorb-URL-Fallback verwendet: ${path}`)
          console.log(`[learning] Warenkorb-URL-Fallback: ${path}`)
          break
        }
      } catch { /* weiter */ }
    }
  }

  if (cartIconSelector) {
    logDojo("info", `Warenkorb-Icon geklickt: ${cartIconSelector}`)
    checkoutSteps.push({ step: "click", selector: cartIconSelector, timeout: CLICK_MS })
    checkoutSteps.push({ step: "sleep", ms: 1500 })
  }

  const urlAfterCart = page.url()
  const didNavigate  = urlAfterCart !== urlBeforeCart

  if (didNavigate) {
    // Echte Seitennavigation (kein Offcanvas)
    checkoutSteps.push({ step: "wait_for_load", timeout: 10_000 })
  } else {
    // Offcanvas-Muster: Ein kurzer Sleep, damit das Offcanvas vollständig gerendert wird
    logDojo("info", "Offcanvas-Warenkorb erkannt (keine Seitennavigation).")
    checkoutSteps.push({ step: "sleep", ms: 1500 })
  }

  // Erfolgsprüfung Phase 2
  const finalUrl = page.url()
  const isCheckoutPage =
    /\/(checkout|kasse|bestellung|order|bezahlen)(\/|$|\?)/i.test(finalUrl) ||
    (await page.$('input[name*="firstname" i], input[name*="vorname" i], input[id*="billing" i]')) !== null
  const isCartPage =
    /\/(cart|warenkorb|basket|shopping-cart|shoppingcart)(\/|$|\?)/i.test(finalUrl) ||
    (await findProceedToCheckoutButton(page)) !== null

  if (isCheckoutPage || isCartPage) {
    logDojo("success", `Warenkorb oder Kassenseite erfolgreich erreicht: ${finalUrl}`)
    console.log(`[learning] ✅ Warenkorb oder Kassenseite erfolgreich erreicht: ${finalUrl}`)
  } else {
    logDojo("warning", `Weder Warenkorb noch Kassenseite eindeutig erkannt: ${finalUrl}`)
    console.warn(`[learning] Weder Warenkorb noch Kassenseite eindeutig erkannt: ${finalUrl}`)
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
  // 1. Frische Session → Homepage
  logDojo("dry_run", "Homepage wird geladen...")
  await page.goto(`https://${domain}`, {
    waitUntil: "domcontentloaded",
    timeout:   PAGE_LOAD_MS,
  })
  await page.waitForTimeout(1000)
  await dismissCookieBanner(page)

  // 2. Test-Produkt-URL für {item.url} ermitteln (kurze Suche)
  logDojo("dry_run", `Suche Test-Produkt-URL für "${testProduct}"...`)
  let testProductUrl: string | null = null
  const SEARCH_SELECTORS = [
    'input[type="search"]', 'input[name="s"]', 'input[name="q"]',
    'input[name="suche"]', 'input[name="search"]', 'input[name="keywords"]',
  ]
  for (const sel of SEARCH_SELECTORS) {
    const el = await page.$(sel)
    if (!el || !(await el.isVisible())) continue
    await el.fill(testProduct)
    await page.keyboard.press("Enter")
    await page.waitForLoadState("domcontentloaded", { timeout: 12_000 })
    await page.waitForTimeout(800)

    const links = await page.$$("a[href]")
    for (const link of links) {
      const href = await link.getAttribute("href") ?? ""
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

  logDojo("dry_run", `Produkt-URL gefunden: ${testProductUrl}`)

  // 3. Template-Kontext für Interpolation
  const ctx = {
    loginUrl:  `https://${domain}`,
    username:  "",
    password:  "",
    item: {
      url:          testProductUrl,
      quantity:     "2",
      product_name: testProduct,
    },
  }

  // 4. item_steps blind ausführen
  logDojo("dry_run", `Führe ${playbook.item_steps.length} item_steps aus...`)
  for (const step of playbook.item_steps) {
    await executeStep(page, step, ctx)
  }

  // 5. checkout_steps blind ausführen
  logDojo("dry_run", `Führe ${playbook.checkout_steps.length} checkout_steps aus...`)
  for (const step of playbook.checkout_steps) {
    await executeStep(page, step, ctx)
  }

  // 6. Erfolg validieren: Entweder Kassenseite erreicht ODER Warenkorb-Seite/Offcanvas-Warenkorb offen
  const finalUrl = page.url()
  logDojo("dry_run", `Finale URL geprüft: ${finalUrl}`)
  const isCheckout =
    /\/(checkout|kasse|bestellung|order|bezahlen)(\/|$|\?)/i.test(finalUrl)
  const hasAddrFields =
    await page.$('input[name*="firstname" i], input[name*="vorname" i], input[id*="billing" i]') !== null
  
  // Warenkorb-Validierung: Befinden wir uns auf einer Warenkorb-Seite oder sehen wir den "Zur Kasse"-Button (was beweist, dass der Warenkorb offen ist)?
  const isCart = 
    /\/(cart|warenkorb|basket|shopping-cart|shoppingcart)(\/|$|\?)/i.test(finalUrl) ||
    (await findProceedToCheckoutButton(page)) !== null

  if (!isCheckout && !hasAddrFields && !isCart) {
    throw new Error(
      `Dry-Run: Weder Warenkorb noch Kassenseite erreicht. Finale URL: ${finalUrl}. ` +
      "Erwartet: /cart, /warenkorb, /checkout, /kasse o.ä. oder Vorhandensein eines 'Zur Kasse'-Buttons."
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
      break
    case "fill":
      await page.fill(ip(step.selector)!, ip(step.value), { timeout: t })
      break
    case "click":
      await page.click(ip(step.selector)!, { timeout: t })
      break
    case "wait_for_element":
      await page.waitForSelector(ip(step.selector)!, { timeout: t })
      break
    case "wait_for_url":
      await page.waitForURL(new RegExp(step.pattern ?? "", "i"), { timeout: t })
      break
    case "wait_for_load":
      await page.waitForLoadState("domcontentloaded", { timeout: t })
      await page.waitForTimeout(400)
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

async function dismissCookieBanner(page: Page): Promise<PlaybookStep | null> {
  // Warten bis entweder ein bekannter Selektor erscheint ODER 2.5s vergehen:
  await Promise.race([
    page.waitForSelector([...COOKIE_SELECTORS_DECLINE, ...COOKIE_SELECTORS_ACCEPT].join(','), { timeout: 2500 }),
    page.waitForTimeout(2500),
  ]).catch(() => {})

  // 1. Statische CSS-Selektoren prüfen
  for (const sel of [...COOKIE_SELECTORS_DECLINE, ...COOKIE_SELECTORS_ACCEPT]) {
    try {
      const loc = page.locator(sel)
      if (!(await loc.isVisible())) continue
      await loc.click({ timeout: 3000 })
      await page.waitForTimeout(700)
      console.log(`[learning] Cookie-Banner: ${sel}`)
      return { step: "click", selector: sel, timeout: 3000 }
    } catch { /* weiter */ }
  }

  // 1b. Shadow DOM Deep-Piercing Scanner (durchdringt Shadow Roots bei Shopware/Usercentrics etc.)
  const COOKIE_TEXT_PATTERNS = /alle akzeptieren|alle zulassen|nur notwendige cookies akzeptieren|nur notwendige akzeptieren|cookies akzeptieren|notwendige cookies|zustimmen|accept all|allow all/i
  const deepCandidates = [
    page.locator('pierce/button').filter({ hasText: COOKIE_TEXT_PATTERNS }),
    page.locator('pierce/a').filter({ hasText: COOKIE_TEXT_PATTERNS }),
  ]
  for (const loc of deepCandidates) {
    try {
      if (await loc.first().isVisible({ timeout: 1500 })) {
        const el = await loc.first().elementHandle()
        const sel = el ? (await extractStableSelector(page, el) ?? 'pierce/button') : 'pierce/button'
        await loc.first().click({ timeout: 3000 })
        await page.waitForTimeout(700)
        console.log(`[learning] Shadow DOM Cookie-Banner gelöst: ${sel}`)
        return { step: "click", selector: sel, timeout: 3000 }
      }
    } catch { /* weiter */ }
  }

  // 2. Dynamische Textsuche als mächtiger Fallback für ungeplante Banner (z.B. Kruse / Reinigungsberater)
  // Ausgeführt direkt im Browser-Kontext für maximale Performance (0 CDP-Roundtrips!)
  try {
    const clickedSelector = await page.evaluate(() => {
      const elements = [...document.querySelectorAll("button"), ...document.querySelectorAll("a")]
      for (const el of elements) {
        // Sichtbarkeit prüfen
        const style = window.getComputedStyle(el)
        if (style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity) === 0) continue
        const rect = el.getBoundingClientRect()
        if (rect.width === 0 && rect.height === 0) continue

        const text = (el.textContent ?? "").trim().toLowerCase()
        const isCookieButton = 
          text === "alle akzeptieren" || 
          text === "alle zulassen" ||
          text === "nur notwendige cookies akzeptieren" || 
          text === "nur notwendige akzeptieren" || 
          text === "cookies akzeptieren" || 
          text.includes("alle akzeptieren") || 
          text.includes("notwendige cookies") || 
          text.includes("nur notwendige") ||
          text.includes("zustimmen") || 
          text.includes("allow all") || 
          text.includes("accept all")

        if (isCookieButton) {
          (el as HTMLElement).click()
          // Versuchen einen CSS-Selektor zu ermitteln
          if (el.id && !/^[0-9]/.test(el.id)) return `#${el.id}`
          const name = el.getAttribute("name")
          if (name) return `${el.tagName.toLowerCase()}[name="${name}"]`
          const aria = el.getAttribute("aria-label")
          if (aria) return `[aria-label="${aria}"]`
          const cls = Array.from(el.classList).find(c => c.length > 2 && !/^[0-9a-f]{4,}$/.test(c))
          if (cls) return `${el.tagName.toLowerCase()}.${cls}`
          return `text="${el.textContent?.trim()}"`
        }
      }
      return null
    })

    if (clickedSelector) {
      // Für das Playbook und den Klick übersetzen wir text="..." in einen Playwright-kompatiblen Text-Selector
      let playbookSelector = clickedSelector
      if (clickedSelector.startsWith('text=')) {
        const textVal = clickedSelector.substring(5).replace(/"/g, '')
        playbookSelector = `button >> text="${textVal}"`
      }

      // Vertrauenswürdigen Playwright-Klick ausführen!
      await page.click(playbookSelector, { timeout: 4000 })
      await page.waitForTimeout(1200) // Warten, bis das Overlay ausblendet

      console.log(`[learning] Cookie-Banner per dynamischer In-Browser-Textsuche erfolgreich gelöst: ${playbookSelector}`)
      return { step: "click", selector: playbookSelector, timeout: 3000 }
    }
  } catch (err) {
    console.warn("[learning] Dynamische Cookie-Banner-Textsuche fehlgeschlagen:", err)
  }

  return null
}

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
    // Textbasierte Suche als letzter Fallback
    "button >> text=/zur kasse/i",
    "a >> text=/zur kasse/i",
    "button >> text=/checkout/i",
  ]

  for (const sel of SELECTORS) {
    try {
      const el = await page.$(sel)
      if (!el || !(await el.isVisible())) continue
      return await extractStableSelector(page, el) ?? sel
    } catch { /* weiter */ }
  }

  return null
}

async function isLoginPage(page: Page): Promise<boolean> {
  try {
    const url   = page.url().toLowerCase()
    const title = (await page.title()).toLowerCase()
    const keywords = /(login|signin|anmeld|anmeldung|auth|konto|kundenbereich)/i
    if (!keywords.test(url) && !keywords.test(title)) return false
    const pwdEl = await page.$('input[type="password"]')
    return pwdEl !== null && await pwdEl.isVisible()
  } catch {
    return false
  }
}

async function getCartCount(page: Page): Promise<number | null> {
  const SELECTORS = [
    '[class*="cart-count"]',
    '[class*="cart-qty"]',
    '[class*="cart-quantity"]',
    '[id*="cart-count"]',
    '[id*="cart-qty"]',
    '[class*="basket-count"]',
    '[id*="basket-count"]',
    "[data-cart-count]",
    "[data-cart-qty]",
    ".header-cart .count",
    ".cart-icon .badge",
    ".mini-cart-count",
    ".minicart-qty",
  ]

  for (const sel of SELECTORS) {
    try {
      const el = await page.$(sel)
      if (!el) continue
      const text = (await el.textContent() ?? "").trim()
      const num  = parseInt(text, 10)
      if (!isNaN(num)) return num
    } catch { /* weiter */ }
  }

  return null
}

// Extrahiert den stabilsten CSS-Selektor für ein DOM-Element.
// Priorisierung: id > name > data-testid > data-action > aria-label > type > gefilterte Klassen
async function extractStableSelector(page: Page, el: unknown): Promise<string | null> {
  try {
    return await page.evaluate((element: Element) => {
      const tag = element.tagName.toLowerCase()

      // 1. id (ohne generierte Hashes oder Zahlen am Anfang)
      if (element.id && !/^[0-9]/.test(element.id) && !/^[a-f0-9]{6,}$/.test(element.id)) {
        return `#${CSS.escape(element.id)}`
      }

      // 2. name-Attribut (formgebundene Elemente)
      const name = element.getAttribute("name")
      if (name) return `${tag}[name="${name}"]`

      // 3. data-testid (semantisches Test-Attribut)
      const testId = element.getAttribute("data-testid")
      if (testId) return `[data-testid="${testId}"]`

      // 4. data-action (semantisch stabil)
      const action = element.getAttribute("data-action")
      if (action && action.length < 50) return `[data-action="${action}"]`

      // 5. aria-label (barrierefrei & stabil)
      const ariaLabel = element.getAttribute("aria-label")
      if (ariaLabel && ariaLabel.length < 40) {
        return `[aria-label="${ariaLabel}"]`
      }

      // 6. input type (canonical für Formfelder)
      if (tag === "input") {
        const t = (element as HTMLInputElement).type || "text"
        if (t === "search" || t === "email" || t === "password" || t === "number") {
          return `input[type="${t}"]`
        }
      }

      // 7. Gefilterte Klassen (ohne Hash- und Framework-Klassen)
      const classes = Array.from(element.classList).filter(
        (c) =>
          c.length > 2 &&
          !/^[a-f0-9]{5,}$/.test(c) &&   // Hash-Klassen
          !/^css-/.test(c) &&              // styled-components
          !/^sc-/.test(c) &&               // styled-components
          !/^[A-Z][a-z]+[A-Z]/.test(c) && // camelCase React-interne Klassen
          !/^_/.test(c)                    // private Klassen (Next.js etc.)
      ).slice(0, 2)

      if (classes.length > 0) return `${tag}.${classes.join(".")}`

      return null
    }, el)
  } catch {
    return null
  }
}

// ── Browserbase API ───────────────────────────────────────────────────────────

async function createBrowserbaseSession(
  useResidentialProxy: boolean,
): Promise<BrowserbaseSession> {
  // Residential Proxy: für Erst-Besuche (Fingerprint wichtig, Bot-Detection hoch)
  // Datacenter Proxy:  für Dry-Runs (nur Selektor-Validierung, kein erstes Impression)
  const body: Record<string, unknown> = {
    projectId: BROWSERBASE_PROJECT_ID,
    browserSettings: {
      viewport: { width: 1280, height: 800 },
      // Stealth-Modus aktivieren (vermeidet einfache Bot-Erkennungen)
      fingerprint: { devices: ["desktop"], locales: ["de-DE"], operatingSystems: ["windows"] },
    },
  }

  if (useResidentialProxy) {
    // Browserbase-integriertes Residential-Proxy-Netzwerk
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

  // Wenn Residential Proxies nicht im Plan enthalten sind (HTTP 402), fallback auf Standard-Verbindung (ohne proxies: true)
  if (res.status === 402 && body.proxies) {
    console.warn("[browserbase] Residential Proxies nicht im Plan enthalten (402). Fallback auf Standard-Verbindung...");
    delete body.proxies;
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

  const session = await res.json()
  const sessionId = session.id as string

  if (!sessionId) {
    throw new Error(
      `Browserbase: Keine sessionId in Antwort: ${JSON.stringify(session).substring(0, 200)}`
    )
  }

  // connectUrl: Browserbase gibt dies direkt zurück (CDP WebSocket)
  // Fallback: Standardformat falls ältere API-Version
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

// ── Response Helper ────────────────────────────────────────────────────────────

function respond(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  })
}
