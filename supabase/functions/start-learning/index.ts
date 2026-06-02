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
const CDP_CONNECT_TIMEOUT_MS     =  15_000
const PAGE_LOAD_MS               =  25_000  // Snappy B2B page load timeout
const NETWORK_SETTLE_MS          =   2_000  // Snappy DOM settle timeout
const CLICK_MS                   =   5_000
const FILL_MS                    =   4_000
const DRY_RUN_TIMEOUT_MS         =  65_000

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
  optional?: boolean
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
const COOKIE_TEXT_RE = /alles akzeptieren|alle akzeptieren|alle zulassen|nur notwendige|cookies akzeptieren|zustimmen|einverstanden|accept all|allow all|i agree/i

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

    const body: { domain?: string; test_product?: string; phase?: string } = await req.json().catch(() => ({}))
    const { domain, test_product = "Reinigungsmittel", phase = "learn" } = body

    if (!domain) return respond({ error: "domain required" }, 400)

    if (!BROWSERBASE_API_KEY || !BROWSERBASE_PROJECT_ID) {
      return respond({
        error: "BROWSERBASE_API_KEY oder BROWSERBASE_PROJECT_ID nicht konfiguriert. " +
               "Bitte in Supabase-Secrets hinterlegen.",
      }, 500)
    }

    console.log(`[start-learning] Domain: ${domain}, phase: ${phase}, test_product: ${test_product}`)

    if (phase === "learn") {
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
    } else {
      const { error: updateErr } = await adminClient
        .from("shop_playbooks")
        .update({
          automation_status: "learning_cart",
          last_learning_run: new Date().toISOString(),
        })
        .eq("domain", domain)

      if (updateErr) {
        console.error("[start-learning] DB update dry_run fehlgeschlagen:", updateErr)
        return respond({ error: "DB-Fehler: " + updateErr.message }, 500)
      }
    }

    // Globaler 140s-Timeout-Guard
    EdgeRuntime.waitUntil(
      Promise.race([
        runLearningPipeline(domain, test_product, phase, adminClient),
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
      status:  phase === "learn" ? "learning_auth" : "learning_cart",
      domain,
      message: phase === "learn"
        ? `Lernprozess für ${domain} gestartet. Status wird live in shop_playbooks aktualisiert.`
        : `Dry-Run-Verifikation für ${domain} gestartet. Status wird live in shop_playbooks aktualisiert.`,
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
  phase:       string,
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
  const runLogs: Array<{ timestamp: string; level: string; message: string }> = []
  
  if (phase === "dry_run") {
    const { data: current } = await adminClient
      .from("shop_playbooks")
      .select("learning_logs")
      .eq("domain", domain)
      .single()
    if (current?.learning_logs) {
      runLogs.push(...current.learning_logs.filter(Boolean))
    }
  }

  let _logFlushPending = false
  let _logFlushQueued  = false

  const flushLogs = async (): Promise<void> => {
    if (_logFlushPending) { _logFlushQueued = true; return }
    _logFlushPending = true
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 8000)
    try {
      const snap = [...runLogs]
      const { error } = await Promise.race([
        adminClient
          .from("shop_playbooks")
          .update({ learning_logs: snap })
          .eq("domain", domain)
          .abortSignal(controller.signal),
        new Promise<{ error: { message: string } | null }>((_, reject) =>
          setTimeout(() => reject(new Error("Supabase Log Update Timeout")), 8000)
        )
      ])
      if (error) console.warn("[logDojo] DB-Fehler:", error.message)
    } catch (err) {
      console.error("[logDojo] Unerwarteter Fehler beim Log-Schreiben:", err)
    } finally {
      clearTimeout(timeoutId)
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
    if (phase === "learn") {
      logDojo("info", `🚀 Starte Dojo v2 Lernphase für ${domain}...`)
      logDojo("info", "Erstelle Browserbase-Session (Residential Proxy)...")
      const globalSession = await createBrowserbaseSession(true)
      currentSessionId    = globalSession.id

      logDojo("info", `📡 Session aktiv — ID: ${globalSession.id}`)
      logDojo("info", `🔴 Live-Browser: https://www.browserbase.com/sessions/${globalSession.id}`)

      const globalBrowser = await connectWithTimeout(globalSession.connectUrl)
      let loginSteps: PlaybookStep[] = []
      let itemSteps:      PlaybookStep[] = []
      let checkoutSteps:  PlaybookStep[] = []
      let testProductUrl: string | null = null

      try {
        const loginCtx  = await globalBrowser.newContext()
        const loginPage = await loginCtx.newPage()

        try {
          const resilientUrl = getResilientStartUrl(domain)
          logDojo("info", `🌐 Lade Homepage: ${resilientUrl}`)
          await loginPage.goto(resilientUrl, {
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
        } finally {
          await loginCtx.close().catch(() => {})
        }

        await setStatus("learning_cart")
        logDojo("info", "🛒 Phase 2 gestartet — lerne Warenkorb-Flow...")

        const cartCtx  = await globalBrowser.newContext()
        const cartPage = await cartCtx.newPage()

        try {
          const resilientUrl = getResilientStartUrl(domain)
          logDojo("info", `🌐 Lade Homepage für Phase 2: ${resilientUrl}`)
          await cartPage.goto(resilientUrl, {
            waitUntil: "domcontentloaded",
            timeout:   PAGE_LOAD_MS,
          })
          await smartWaitForLoad(cartPage)
          await checkForCloudflare(cartPage)

          const cookieStep2 = await dismissCookieBanner(cartPage, logDojo)
          if (cookieStep2) logDojo("info", "🍪 Cookie-Banner geschlossen (Phase 2).")

          const result   = await learnCartFlow(cartPage, domain, testProduct, logDojo)
          itemSteps      = result.item
          checkoutSteps  = result.checkout
          testProductUrl = result.productUrl
          logDojo("success", `✅ Phase 2 abgeschlossen: ${itemSteps.length} item_steps, ${checkoutSteps.length} checkout_steps.`)
        } finally {
          await cartCtx.close().catch(() => {})
        }

        if (itemSteps.length === 0) {
          throw new Error("Keine item_steps gelernt. Add-to-Cart-Button nicht gefunden.")
        }

        const candidatePlaybook: Playbook = {
          login_steps:    loginSteps,
          item_steps:     itemSteps,
          checkout_steps: checkoutSteps,
        }

        logDojo("info", "Speichere gelerntes Playbook temporär in Datenbank...")
        await adminClient.from("shop_playbooks").update({
          playbook: candidatePlaybook,
          learning_error: null,
          playbook_previous: { test_product_url: testProductUrl } as any,
          last_learning_run: new Date().toISOString(),
        }).eq("domain", domain)

        logDojo("info", "Triggere Dry-Run-Verifikation (Phase 3) in neuer serverloser Invocation...")
        triggerDryRunInvocation(domain, testProduct).catch((e) =>
          console.error("[learning] Fehler beim Triggern der Dry-Run Invocation:", e)
        )

        await setStatus("learning_cart")
      } finally {
        await globalBrowser.close().catch(() => {})
        await stopBrowserbaseSession(currentSessionId)
        currentSessionId = null
      }
    } else {
      logDojo("dry_run", "🧪 Phase 3: Dry-Run gestartet (Residential Proxy, max. 30 Sek.)...")

      const { data: row } = await adminClient
        .from("shop_playbooks")
        .select("playbook, playbook_previous")
        .eq("domain", domain)
        .single()

      if (!row || !row.playbook) {
        throw new Error("Fehler im Dry-Run: Kein Kandidaten-Playbook gefunden.")
      }

      const playbook = row.playbook as unknown as Playbook
      const payload = row.playbook_previous as unknown as { test_product_url?: string }
      const testProductUrl = payload?.test_product_url ?? null

      logDojo("dry_run", "Erstelle Browserbase-Session für Dry-Run...")
      const globalSession = await createBrowserbaseSession(true)
      currentSessionId    = globalSession.id

      const globalBrowser = await connectWithTimeout(globalSession.connectUrl)
      try {
        let dryRunPassed = false
        let dryRunError:  string | null = null

        const dryCtx  = await globalBrowser.newContext()
        const dryPage = await dryCtx.newPage()

        try {
          await Promise.race([
            executeDryRun(dryPage, domain, playbook, testProduct, testProductUrl, logDojo),
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error(`Dry-Run Timeout: 30s überschritten.`)),
                DRY_RUN_TIMEOUT_MS
              )
            ),
          ])
          dryRunPassed = true
        } catch (err) {
          dryRunError = err instanceof Error ? err.message : String(err)
          logDojo("error", `❌ Dry-Run fehlgeschlagen: ${dryRunError}`)
        } finally {
          await dryCtx.close().catch(() => {})
        }

        // Ergebnis committen
        if (dryRunPassed) {
          const { data: current } = await adminClient
            .from("shop_playbooks")
            .select("playbook, playbook_version")
            .eq("domain", domain)
            .single()

          const newVersion = (current?.playbook_version ?? 0) + 1
          logDojo("success", `🎉 Playbook v${newVersion} verifiziert und in Datenbank gespeichert!`)

          await setStatus("verified", {
            playbook:          playbook,
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
      } finally {
        await globalBrowser.close().catch(() => {})
        await stopBrowserbaseSession(currentSessionId)
        currentSessionId = null
      }
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

/** Prepend www. to naked root domains to bypass proxy DNS issues and redirect cycles. */
function getResilientStartUrl(domain: string): string {
  const parts = domain.split(".");
  if (parts.length === 2 && !domain.startsWith("www.")) {
    return `https://www.${domain}`;
  }
  return `https://${domain}`;
}

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
  await page.waitForTimeout(200)
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

  // Wait for lazy-loaded cookie banners (e.g. Usercentrics, Cookiebot) to inject into DOM.
  // Promise.race: resolve as soon as a known selector appears, or after 1200ms — whichever comes first.
  await Promise.race([
    page.waitForSelector(allStaticSelectors.join(", "), { timeout: 1200 }).catch(() => {}),
    page.waitForTimeout(1200),
  ])

  // Layer 1: Statische CSS-Selektoren (Playwright locates elements natively, piercing shadow DOM by default!)
  for (const sel of allStaticSelectors) {
    try {
      const loc = page.locator(sel).first()
      if (await safeIsVisible(loc, 1000)) {
        await loc.click({ timeout: 3000 })
        await page.waitForTimeout(800)
        logDojo("info", `🍪 Layer 1 (CSS + Shadow DOM): ${sel}`)
        return { step: "click", selector: sel, timeout: 3000, optional: true }
      }
    } catch { /* weiter */ }
  }

  // Layer 2: Shadow DOM piercing — Shopware 6, Usercentrics, Cookiebot v2
  for (const tag of ["button", "a"] as const) {
    try {
      const loc = page.locator(`pierce/${tag}`).filter({ hasText: COOKIE_TEXT_RE })
      if (await safeIsVisible(loc.first(), 1000)) {
        const el  = await loc.first().elementHandle()
        const sel = el ? (await extractStableSelector(page, el) ?? `pierce/${tag}`) : `pierce/${tag}`
        await loc.first().click({ timeout: 3000 })
        await page.waitForTimeout(800)
        logDojo("info", `🍪 Layer 2 (Shadow DOM text): ${sel}`)
        return { step: "click", selector: sel, timeout: 3000, optional: true }
      }
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

// ── Qty-Feld: React/Vue/Svelte/Alpine-kompatibler Wertschreiber ───────────────
// Direktes `el.value = val` umgeht Reacts Fiber-Tracker → onChange feuert nie.
// Lösung: nativer Prototyp-Setter täuscht React, als käme die Änderung vom Browser.
// composed:true lässt Events Shadow-DOM-Grenzen passieren (Shopware 6 Web Components).
// blur-Event triggert WooCommerce/JTL-Qty-Plugins, die erst bei Fokusverlust reagieren.
const reactSafeSetValue = (el: Element, val: string): void => {
  const input = el as HTMLInputElement
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  if (nativeSetter) {
    nativeSetter.call(input, val)
  } else {
    input.value = val
  }
  input.dispatchEvent(new InputEvent('input',  { bubbles: true, composed: true, data: val }))
  input.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
  input.dispatchEvent(new Event('blur',   { bubbles: true, composed: true }))
}

// ── Phase 2: Warenkorb-Flow lernen ────────────────────────────────────────────

async function learnCartFlow(
  page:        Page,
  domain:      string,
  testProduct: string,
  logDojo:     LogFn,
): Promise<{ item: PlaybookStep[]; checkout: PlaybookStep[]; productUrl: string | null }> {
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

  // ── 2c: Produkt-Link in Suchergebnissen ───────────────────────────────────
  const PRODUCT_LINK_SELECTORS = [
    '.product--box a.product--title',
    '.product--box a',
    '.product--info a',
    '.product-item a[href*="/"]',
    '.product-card a[href*="/"]',
    '.product-box a',
    '.product-title a',
    '.product-image a',
    '.product--image a',
    '.product--title a',
    '.product--box .product--title a',
    '.product--box .product--info a',
    '[class*="product-item"] a',
    '[class*="product-card"] a',
    '[class*="product--"] a',
  ]

  // ── 2b: Testprodukt suchen ────────────────────────────────────────────────
  let resolvedTestProduct = testProduct
  logDojo("info", `Starte automatische Testprodukt-Erkennung auf der Homepage…`)
  const discoveredProductName = await page.evaluate(({ selectors, domainStr }) => {
    // 1. Spezifische Produktselektoren
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (!el) continue;
        const text = el.innerText || el.getAttribute("title");
        if (text && text.trim().length > 3) return text.trim();
      } catch {}
    }
    
    // 2. Breitbandiger Scan über alle Links auf der Homepage
    const allLinks = Array.from(document.querySelectorAll("a[href]")).slice(0, 400);
    for (const link of allLinks) {
      const href = link.getAttribute("href");
      if (!href || href === "/" || href.startsWith("#") || href.startsWith("javascript:")) continue;
      const path = href.toLowerCase();
      
      const isProductPattern =
        path.includes("-p-") || path.includes("/p-") || path.includes("-p/") ||
        (path.endsWith(".html") && (/\d/.test(path.replace(/^https?:\/\/[^\/]+/, "")) || (path.replace(/^https?:\/\/[^\/]+/, "").match(/\//g) || []).length >= 2)) ||
        path.includes("/product/") || path.includes("/products/") ||
        path.includes("/produkt/") || path.includes("/produkte/") ||
        path.includes("/artikel/") || path.includes("/item/") || path.includes("/detail/") ||
        /\/a-[a-z0-9]+/i.test(href) ||
        /-\d+\.html$/i.test(href) ||
        /-\d{4,}(?:\/|$)/.test(href) ||
        path.includes("cl=details") ||
        path.includes("artnr=") || path.includes("artno=") ||
        path.includes("article_id=") || path.includes("articleid=");

      const isNotNavigation =
        !path.includes("category") && !path.includes("kategorie") &&
        !path.includes("search") && !path.includes("suche") &&
        !path.includes("cart") && !path.includes("warenkorb") &&
        !path.includes("checkout") && !path.includes("kasse") &&
        !path.includes("account") && !path.includes("login") &&
        !path.includes("impressum") && !path.includes("agb") &&
        !path.includes("datenschutz") && !path.includes("contact") &&
        !path.includes("kontakt") && !path.includes("about");

      if (isProductPattern && isNotNavigation) {
        const text = link.innerText || link.getAttribute("title") || link.querySelector("img")?.getAttribute("alt");
        if (text && text.trim().length > 3) return text.trim();
      }
    }
    return null;
  }, { selectors: PRODUCT_LINK_SELECTORS, domainStr: domain })

  let finalDiscoveredProductName = discoveredProductName
  if (!finalDiscoveredProductName) {
    logDojo("info", `Kein Produkt direkt auf der Homepage gefunden. Probiere Kategorie-Fallback…`)
    
    // 1. Finde Kategorie-Links auf der Homepage
    const categoryUrls = await page.evaluate(() => {
      const allLinks = Array.from(document.querySelectorAll("a[href]")).slice(0, 400);
      const urls = [];
      for (const link of allLinks) {
        const href = link.getAttribute("href");
        if (!href || href === "/" || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("tel:") || href.startsWith("mailto:")) continue;
        const path = href.toLowerCase();
        
        const isNotNavigation =
          !path.includes("search") && !path.includes("suche") &&
          !path.includes("cart") && !path.includes("warenkorb") &&
          !path.includes("checkout") && !path.includes("kasse") &&
          !path.includes("account") && !path.includes("login") &&
          !path.includes("impressum") && !path.includes("agb") &&
          !path.includes("datenschutz") && !path.includes("contact") &&
          !path.includes("kontakt") && !path.includes("about") &&
          !path.includes("widerruf") && !path.includes("versand") && !path.includes("zahlungs");

        // Erlaubnisliste statt Verbotsliste: schließt Asset-Dateien aus, erlaubt alles andere.
        // `!path.includes(".")` würde absolute URLs (https://domain.com/kat) fälschlich ausschließen.
        const isPage = !/\.(png|jpe?g|gif|svg|webp|ico|css|js|woff2?|ttf|pdf|zip|mp4|xml|json)(\?.*)?$/i.test(path);
        
        if (isNotNavigation && isPage) {
          try {
            const urlObj = new URL(href, window.location.origin);
            if (urlObj.origin === window.location.origin && !urls.includes(urlObj.href)) {
              urls.push(urlObj.href);
            }
          } catch {}
        }
      }
      return urls;
    });

    logDojo("info", `${categoryUrls.length} potenzielle Kategorie-Links auf der Homepage gefunden.`)

    // 2. Probiere die ersten 5 Kategorien aus, um ein Produkt zu finden
    for (const catUrl of categoryUrls.slice(0, 5)) {
      logDojo("info", `Navigiere zu Kategorie: ${catUrl}`)
      await page.goto(catUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => {});
      await smartWaitForLoad(page);
      
      const foundName = await page.evaluate(({ selectors }) => {
        for (const sel of selectors) {
          try {
            const el = document.querySelector(sel);
            if (!el) continue;
            const text = el.innerText || el.getAttribute("title");
            if (text && text.trim().length > 3) return text.trim();
          } catch {}
        }

        const allLinks = Array.from(document.querySelectorAll("a[href]")).slice(0, 400);
        for (const link of allLinks) {
          const href = link.getAttribute("href");
          if (!href || href === "/" || href.startsWith("#") || href.startsWith("javascript:")) continue;
          const path = href.toLowerCase();
          
          const isProductPattern =
            path.includes("-p-") || path.includes("/p-") || path.includes("-p/") ||
            path.endsWith(".html") ||
            path.includes("/product/") || path.includes("/products/") ||
            path.includes("/produkt/") || path.includes("/produkte/") ||
            path.includes("/artikel/") || path.includes("/item/") || path.includes("/detail/") ||
            /\/a-[a-z0-9]+/i.test(href) ||
            /-\d+\.html$/i.test(href) ||
            /-\d{4,}(?:\/|$)/.test(href) ||
            path.includes("cl=details") ||
            path.includes("artnr=") || path.includes("artno=") ||
            path.includes("article_id=") || path.includes("articleid=");

          const isNotNavigation =
            !path.includes("category") && !path.includes("kategorie") &&
            !path.includes("search") && !path.includes("suche") &&
            !path.includes("cart") && !path.includes("warenkorb") &&
            !path.includes("checkout") && !path.includes("kasse") &&
            !path.includes("account") && !path.includes("login") &&
            !path.includes("impressum") && !path.includes("agb") &&
            !path.includes("datenschutz") && !path.includes("contact") &&
            !path.includes("kontakt") && !path.includes("about");

          if (isProductPattern && isNotNavigation) {
            const text = link.innerText || link.getAttribute("title") || link.querySelector("img")?.getAttribute("alt");
            if (text && text.trim().length > 3) return text.trim();
          }
        }
        return null;
      }, { selectors: PRODUCT_LINK_SELECTORS });

      if (foundName) {
        finalDiscoveredProductName = foundName;
        logDojo("info", `🎯 Testprodukt in Kategorie entdeckt: "${finalDiscoveredProductName}"`);
        break;
      }
    }
  }

  if (finalDiscoveredProductName) {
    let clean = finalDiscoveredProductName.replace(/[\n\r]+/g, ' ').replace(/\s+/g, ' ').trim();
    // 1. Nur echte Preise entfernen: Dezimalzahl MUSS von Währungszeichen oder Preis-Suffix gefolgt werden.
    //    Ohne diese Einschränkung würden Maßangaben wie “2.5L”, “pH 7.0” fälschlich entfernt.
    clean = clean.replace(/\d+(?:[\.,]\d+)?\s*(?:€|EUR|CHF|\$)/gi, '');
    clean = clean.replace(/\d+[\.,]\d+\s*(?:netto|brutto|zzgl\.?\s*(?:mwst\.?)?|inkl\.?\s*(?:mwst\.?)?)/gi, '');
    // 2. Alleinstehende Währungszeichen (Überbleibsel)
    clean = clean.replace(/[€$]/g, '');
    // 3. Typische Marketing-Labels (nur als ganzes Wort)
    clean = clean.replace(/\b(?:NEW|NEU|SALE|BESTSELLER|AKTION|TOP|DEAL)\b/gi, '');
    // 4. Überflüssige Leerzeichen & Anführungszeichen säubern
    clean = clean.replace(/[“'””]+/g, ' ').replace(/\s+/g, ' ').trim();

    // 5. Metadaten-Trennzeichen abschneiden.
    //    Trennzeichen: Pipe, En/Em Dash, " - ", " : "
    //    Rating-Metadaten: "458 Bewertungen", "4,8 von 5 Sterne", "Gesamtbewertung", "Kundenbewertung"
    //    NICHT abschneiden: "(500ml)", "2.5L", "pH 7.0" — Maßangaben sind Teil des Produktnamens.
    const firstPart = clean.split(/(?:\||–|—|\s-\s|\s:\s|\s*Gesamtbewertung|\s*Kundenbewertung|\s*Produktbewertung|\s+\d+\s+Bewertung|\s+\d[\.,]\d+\s+(?:von\s+5\s+)?Stern)/)[0].trim();
    if (firstPart.length > 3) {
      clean = firstPart;
    }

    if (clean.length > 3) {
      resolvedTestProduct = clean;
    } else {
      resolvedTestProduct = finalDiscoveredProductName.replace(/[\n\r]+/g, ' ').replace(/\s+/g, ' ').trim();
    }
    logDojo("info", `🎯 Testprodukt dynamisch im Shop entdeckt und bereinigt: "${resolvedTestProduct}"`)
  } else {
    logDojo("info", `Kein Testprodukt auf Homepage oder in Kategorien entdeckt, nutze Standard-Suchbegriff: "${resolvedTestProduct}"`)
  }

  // Zur Homepage zurückkehren, falls wir sie verlassen haben (z. B. durch Kategorie-Tiefenscan)
  const currentUrl = page.url()
  const startUrl = getResilientStartUrl(domain)
  const isHomepage = currentUrl === startUrl || currentUrl === startUrl + "/" || currentUrl === startUrl + "/index.php" || currentUrl === startUrl + "/index.html"
  
  if (!isHomepage) {
    logDojo("info", `Kehre zur Homepage zurück, um die Suche zu starten…`)
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 35_000 }).catch(() => {})
    await smartWaitForLoad(page)
  } else {
    logDojo("info", `Bereits auf der Homepage, überspringe redundante Navigation.`)
  }

  logDojo("info", `Suche nach "${resolvedTestProduct}"...`)
  try {
    await page.fill(searchSelector, resolvedTestProduct, { timeout: 8000 })
    await page.keyboard.press("Enter")
  } catch (err: any) {
    logDojo("warning", `⚠️ Suche mit Selektor ${searchSelector} fehlgeschlagen: ${err.message}. Starte AI-Healing...`)
    const healed = await aiHealSelector(page, "search", searchSelector, logDojo)
    if (healed) {
      searchSelector = healed
      await page.fill(searchSelector, resolvedTestProduct, { timeout: 15000 })
      await page.keyboard.press("Enter")
    } else {
      throw err
    }
  }
  await page.waitForTimeout(2500)
  await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {})
  await smartWaitForLoad(page)
  await checkForCloudflare(page)

  let testProductUrl: string | null = null
  const visibleProductLink = await page.evaluate(({ selectors, domainStr }) => {
    // 1. Spezifische Produktselektoren prüfen
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (!el) continue;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) continue;
        const href = el.getAttribute("href");
        if (!href || href === "/" || href.startsWith("#") || href.startsWith("javascript:")) continue;
        
        // Verhindert, dass wir aus Versehen eine Kategorie-Seite als Produkt-Detailseite interpretieren
        const path = href.toLowerCase();
        if (path.includes("category") || path.includes("kategorie") || path.includes("search") || path.includes("suche")) continue;
        
        return href.startsWith("http") ? href : `https://${domainStr}${href}`;
      } catch { /* ungültiger Selektor */ }
    }
    
    // 2. Breitbandiger Fallback über alle Links der Seite natively im Browser (0 CDP Roundtrips) - Sliced auf 600 für max. Performance
    const allLinks = Array.from(document.querySelectorAll("a[href]")).slice(0, 600);
    for (const link of allLinks) {
      const href = link.getAttribute("href");
      if (!href || href === "/" || href.startsWith("#") || href.startsWith("javascript:")) continue;
      const path = href.toLowerCase();
      
      const isProductPattern =
        // Shopware 5: artikel-name-p-12345
        path.includes("-p-") || path.includes("/p-") || path.includes("-p/") ||
        // Universal SEO paths ending in .html (e.g. cent-online.de products)
        (path.endsWith(".html") && (/\d/.test(path.replace(/^https?:\/\/[^\/]+/, "")) || (path.replace(/^https?:\/\/[^\/]+/, "").match(/\//g) || []).length >= 2)) ||
        // Generic paths
        path.includes("/product/") || path.includes("/products/") ||
        path.includes("/produkt/") || path.includes("/produkte/") ||
        path.includes("/artikel/") || path.includes("/item/") || path.includes("/sku/") ||
        path.includes("/detail/") ||
        // Shopware 6: /a-UUID
        /\/a-[a-z0-9]+/i.test(href) ||
        // Magento / PrestaShop: slug-12345.html or -12345.html
        /-\d+\.html$/i.test(href) ||
        // Shopware 5 / JTL: slug-12345 (numeric ID suffix without .html)
        /-\d{4,}(?:\/|$)/.test(href) ||
        // OXID eShop
        path.includes("cl=details") ||
        // JTL Shop
        path.includes("artnr=") || path.includes("artno=") ||
        // Gambio
        path.includes("article_id=") || path.includes("articleid=") ||
        // UUID-based (some shops use MD5 or UUIDs as product IDs)
        /[a-f0-9]{32}/i.test(href);

      const isNotNavigation =
        !path.includes("category") && !path.includes("kategorie") &&
        !path.includes("search") && !path.includes("suche") &&
        !path.includes("cart") && !path.includes("warenkorb") &&
        !path.includes("checkout") && !path.includes("kasse") &&
        !path.includes("account") && !path.includes("login") &&
        !path.includes("impressum") && !path.includes("agb") &&
        !path.includes("datenschutz") && !path.includes("contact") &&
        !path.includes("kontakt") && !path.includes("about") &&
        !path.includes("faq") && !path.includes("blog") &&
        !path.includes("brand") && !path.includes("hersteller") &&
        !path.includes("manufacturer") && !path.includes("filter") &&
        !path.includes("sort=") && !path.includes("page=") &&
        !path.includes("view=") && !path.endsWith(".pdf");
        
      if (isProductPattern && isNotNavigation) {
        return href.startsWith("http") ? href : `https://${domainStr}${href}`;
      }
    }
    return null;
  }, { selectors: PRODUCT_LINK_SELECTORS, domainStr: domain })

  if (visibleProductLink) {
    testProductUrl = visibleProductLink
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
      
      try {
        const isReadonly = await loc.evaluate(el => el.hasAttribute('readonly') || (el as any).readOnly).catch(() => false);
        if (isReadonly) {
          logDojo("info", `🔢 Mengenfeld ist schreibgeschützt (readonly). Verwende JS-Fallback…`)
          await loc.evaluate(reactSafeSetValue, "2")
        } else {
          await loc.fill("2")
        }
        await page.waitForTimeout(300)
      } catch (e: any) {
        logDojo("warn", `Fehler beim Befüllen des Mengenfelds, versuche JS-Fallback: ${e.message}`)
        await loc.evaluate(reactSafeSetValue, "2").catch(() => {})
      }
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
    'form.add-cart-form button.add-cart',
    'form.add-cart-form button.btn-cart',
    '.add-cart-form button.add-cart',
    '.add-cart-form button.btn-cart',
    'button.add-cart',
    'button.btn-cart',
    'button[class*="btn-cart" i]',
    'button[class*="add-cart" i]',
    'button[title*="Warenkorb" i]',
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

  const urlBeforeAtc = page.url()

  if (visibleAddCartSelector) {
    const loc = page.locator(visibleAddCartSelector).first()
    const el = await loc.elementHandle()
    if (el) {
      addCartSelector = await extractStableSelector(page, el) ?? visibleAddCartSelector
      try {
        await loc.click({ timeout: CLICK_MS })
      } catch (clickErr: any) {
        logDojo("warning", `⚠️ Add-to-Cart Klick fehlgeschlagen: ${clickErr.message}. Versuche JS-Klick…`)
        await loc.evaluate((el) => (el as HTMLElement).click()).catch(() => {})
      }
      await page.waitForTimeout(1000)
    }
  }

  if (!addCartSelector) {
    addCartSelector = await aiHealSelector(page, "add_to_cart", ADD_CART_SELECTORS.join(", "), logDojo)
    if (addCartSelector) {
      try {
        await page.click(addCartSelector, { timeout: CLICK_MS })
      } catch (clickErr: any) {
        logDojo("warning", `⚠️ ATC AI-Heal Klick fehlgeschlagen: ${clickErr.message}. Versuche JS-Klick…`)
        await page.evaluate((sel) => {
          const el = document.querySelector(sel)
          if (el) (el as HTMLElement).click()
        }, addCartSelector).catch(() => {})
      }
      await page.waitForTimeout(1000)
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

  // If the ATC click already triggered a redirect (e.g. direct-to-cart shops), skip cart icon search.
  const atcNavigated = urlBeforeCart !== urlBeforeAtc
  if (atcNavigated) {
    logDojo("info", `↪️ ATC-Klick hat automatisch navigiert → ${urlBeforeCart}. Überspringe Warenkorb-Icon-Suche.`)
    console.log(`[learning] ATC auto-navigated to: ${urlBeforeCart}`)
  }

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

  if (!atcNavigated) {
  const visibleCartIconSelector = await page.evaluate(({ selectors, addCartSelector }) => {
    const isAddToCart = (element: Element): boolean => {
      const text = (element.textContent || "").toLowerCase();
      const label = (element.getAttribute("aria-label") || "").toLowerCase();
      const title = (element.getAttribute("title") || "").toLowerCase();
      const value = (element as any).value ? String((element as any).value).toLowerCase() : "";
      
      const addPatterns = [
        "in den", 
        "add to", 
        "zum warenkorb", 
        "in den korb", 
        "in den einkaufswagen", 
        "in den kasten", 
        "in den basket", 
        "ins körbchen",
        "warenkorb legen"
      ];
      return addPatterns.some(pat => text.includes(pat) || label.includes(pat) || title.includes(pat) || value.includes(pat));
    };

    for (const sel of selectors) {
      try {
        const elements = Array.from(document.querySelectorAll(sel));
        for (const el of elements) {
          if (!el) continue;

          // Skip if this is the addCartSelector element or inside it
          if (addCartSelector) {
            try {
              const addCartEl = document.querySelector(addCartSelector);
              if (addCartEl && (el === addCartEl || addCartEl.contains(el))) {
                continue;
              }
            } catch {}
          }

          // Skip if it contains typical Add-to-Cart keywords
          if (isAddToCart(el)) {
            continue;
          }

          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) continue;
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          
          // Try to generate a specific stable selector for this matched element
          const getStable = (element: Element): string | null => {
            const tag = element.tagName.toLowerCase();

            const isDynamicId = (id: string): boolean => {
              if (/^[0-9]/.test(id)) return true;
              if (/^[a-f0-9]{6,}$/i.test(id)) return true;
              if (/\d{2,}/.test(id)) return true;
              return false;
            };

            if (element.id && !isDynamicId(element.id)) {
              return `#${CSS.escape(element.id)}`;
            }

            const name = element.getAttribute("name");
            if (name) return `${tag}[name="${name}"]`;

            const testId = element.getAttribute("data-testid");
            if (testId) return `[data-testid="${testId}"]`;

            const action = element.getAttribute("data-action");
            if (action && action.length < 50) return `[data-action="${action}"]`;

            const ariaLabel = element.getAttribute("aria-label");
            if (ariaLabel && ariaLabel.length < 40) return `[aria-label="${ariaLabel}"]`;

            const classes = Array.from(element.classList).filter(
              (c) =>
                c.length > 2 &&
                !/^[a-f0-9]{5,}$/.test(c) &&
                !/^css-/.test(c) &&
                !/^sc-/.test(c) &&
                !/^[A-Z][a-z]+[A-Z]/.test(c) &&
                !/^_/.test(c)
            ).slice(0, 2);

            if (classes.length > 0) return `${tag}.${classes.join(".")}`;

            return null;
          };

          const stable = getStable(el);
          if (stable) {
            const root = el.getRootNode();
            const isShadow = (typeof ShadowRoot !== "undefined" && root instanceof ShadowRoot) || 
                             (root && (root as any).host !== undefined);
            return isShadow ? `pierce/${stable}` : stable;
          }
          
          return sel;
        }
      } catch { /* ungültiger Selektor */ }
    }
    return null;
  }, { selectors: CART_ICON_SELECTORS, addCartSelector })

  if (visibleCartIconSelector) {
    const loc = page.locator(visibleCartIconSelector).first()
    const el = await loc.elementHandle()
    if (el) {
      cartIconSelector = await extractStableSelector(page, el) ?? visibleCartIconSelector
      try {
        await loc.click({ timeout: 5000 })
      } catch (clickErr: any) {
        logDojo("warning", `⚠️ Warenkorb-Icon Klick fehlgeschlagen: ${clickErr.message}. Versuche JS-Klick…`)
        await loc.evaluate((el) => (el as HTMLElement).click()).catch(() => {})
      }
      await page.waitForTimeout(800)
    }
  }

  let usedUrlFallback = false
  let fallbackPath = ""

  // Fallback: direkte URL-Navigation zur Warenkorb-Seite
  if (!cartIconSelector) {
    for (const path of ["/cart", "/warenkorb", "/basket", "/shopping-cart"]) {
      try {
        const testUrl = `https://${domain}${path}`
        await page.goto(testUrl, { waitUntil: "domcontentloaded", timeout: 8000 })
        const currentUrl = page.url()
        if (!currentUrl.includes("404") && !currentUrl.includes("not-found")) {
          fallbackPath = path
          usedUrlFallback = true
          logDojo("info", `↩️ Warenkorb-URL-Fallback: ${path}`)
          console.log(`[learning] Warenkorb-URL-Fallback: ${path}`)
          break
        }
      } catch { /* weiter */ }
    }
  }

  if (usedUrlFallback) {
    checkoutSteps.push({ step: "navigate", url: `https://${domain}${fallbackPath}`, timeout: PAGE_LOAD_MS })
    checkoutSteps.push({ step: "sleep", ms: 1500 })
  } else {
    if (!cartIconSelector) {
      cartIconSelector = await aiHealSelector(page, "go_to_checkout", CART_ICON_SELECTORS.join(", "), logDojo)
      if (cartIconSelector) {
        try {
          await page.click(cartIconSelector, { timeout: 5000 })
        } catch (clickErr: any) {
          logDojo("warning", `⚠️ ATC AI-Heal Icon-Klick fehlgeschlagen: ${clickErr.message}. Versuche JS-Klick…`)
          await page.evaluate((sel) => {
            const el = document.querySelector(sel)
            if (el) (el as HTMLElement).click()
          }, cartIconSelector).catch(() => {})
        }
        await page.waitForTimeout(1500)
      }
    }

    if (cartIconSelector) {
      logDojo("info", `🛒 Warenkorb-Icon geklickt: ${cartIconSelector}`)
      checkoutSteps.push({ step: "click", selector: cartIconSelector, timeout: CLICK_MS })
      checkoutSteps.push({ step: "sleep", ms: 1500 })
    }
  }
  } // end if (!atcNavigated)

  const urlAfterCart = page.url()
  // atcNavigated: shop redirected to cart immediately on ATC click (no cart icon needed)
  const didNavigate  = atcNavigated || urlAfterCart !== urlBeforeCart

  if (didNavigate) {
    checkoutSteps.push({ step: "wait_for_load", timeout: 10_000, optional: true })
  } else {
    logDojo("info", "Offcanvas-Warenkorb erkannt (keine Seitennavigation). Warte 1500ms auf Offcanvas-Aktivierung...")
    await page.waitForTimeout(1500)
    checkoutSteps.push({ step: "sleep", ms: 1500 })
  }

  const finalUrl = page.url()
  const isCheckoutPage =
    /\/(checkout|kasse|bestellung|order|bezahlen)(\/|$|\?)/i.test(finalUrl) ||
    await safeIsVisible(
      page.locator('input[name*="firstname" i], input[name*="vorname" i], input[id*="billing" i]').first(),
      1500
    )

  const checkoutBtnSelector = await findProceedToCheckoutButton(page, logDojo)
  const isCartPage =
    /\/(cart|warenkorb|basket|shopping-cart|shoppingcart)(\/|$|\?)/i.test(finalUrl) ||
    checkoutBtnSelector !== null

  // Wenn wir im Offcanvas-Warenkorb sind (URL hat sich nicht geändert) und einen Kassen-Button gefunden haben,
  // klicken wir diesen aktiv an, um tatsächlich zur Warenkorb- oder Kassenseite zu navigieren!
  if (isCartPage && !isCheckoutPage && !/\/(cart|warenkorb|basket|shopping-cart|shoppingcart)(\/|$|\?)/i.test(finalUrl) && checkoutBtnSelector) {
    logDojo("info", `👉 Klicke Kassen-Button im Offcanvas-Warenkorb: ${checkoutBtnSelector}`)
    try {
      await page.click(checkoutBtnSelector, { timeout: 5000 })
      checkoutSteps.push({ step: "click", selector: checkoutBtnSelector, timeout: CLICK_MS })
      checkoutSteps.push({ step: "sleep", ms: 2000 })
      await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {})
      await smartWaitForLoad(page)
    } catch (clickErr: any) {
      logDojo("warning", `⚠️ Kassen-Button Klick fehlgeschlagen: ${clickErr.message}. Versuche JS-Klick…`)
      await page.locator(checkoutBtnSelector).first().evaluate((el) => (el as HTMLElement).click()).catch(() => {})
      checkoutSteps.push({ step: "click", selector: checkoutBtnSelector, timeout: CLICK_MS })
      checkoutSteps.push({ step: "sleep", ms: 2000 })
      await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {})
      await smartWaitForLoad(page)
    }
  }

  const finalUrlUpdated = page.url()
  const isCheckoutPageUpdated =
    /\/(checkout|kasse|bestellung|order|bezahlen)(\/|$|\?)/i.test(finalUrlUpdated) ||
    await safeIsVisible(
      page.locator('input[name*="firstname" i], input[name*="vorname" i], input[id*="billing" i]').first(),
      1500
    )
  const isCartPageUpdated =
    /\/(cart|warenkorb|basket|shopping-cart|shoppingcart)(\/|$|\?)/i.test(finalUrlUpdated) ||
    (await findProceedToCheckoutButton(page)) !== null

  if (isCheckoutPageUpdated || isCartPageUpdated) {
    logDojo("success", `✅ Warenkorb/Kasse erfolgreich erreicht: ${finalUrlUpdated}`)
    console.log(`[learning] ✅ Warenkorb oder Kassenseite: ${finalUrlUpdated}`)
  } else {
    logDojo("warning", `⚠️ Weder Warenkorb noch Kasse erkannt: ${finalUrlUpdated}`)
    console.warn(`[learning] Weder Warenkorb noch Kassenseite erkannt: ${finalUrlUpdated}`)
  }

  return { item: itemSteps, checkout: checkoutSteps, productUrl: testProductUrl }
}

// ── Dry-Run: Playbook mechanisch abspielen ────────────────────────────────────

async function executeDryRun(
  page:                 Page,
  domain:               string,
  playbook:             Playbook,
  testProduct:          string,
  testProductUrlPassed: string | null,
  logDojo:              LogFn,
): Promise<void> {
  let testProductUrl = testProductUrlPassed
  if (testProductUrl) {
    try {
      const urlObj = new URL(testProductUrl)
      urlObj.searchParams.delete("utctx")
      urlObj.searchParams.delete("sid")
      urlObj.searchParams.delete("sCoreId")
      urlObj.searchParams.delete("_sid")
      testProductUrl = urlObj.toString()
    } catch {}
  }

  if (testProductUrl) {
    logDojo("dry_run", `Nutze bereits gefundenes Produkt für Dry-Run (direkte Navigation): ${testProductUrl}`)
    await page.goto(testProductUrl, { waitUntil: "domcontentloaded", timeout: PAGE_LOAD_MS })
    await smartWaitForLoad(page)
    await checkForCloudflare(page)
    await dismissCookieBanner(page, logDojo)
  } else {
    logDojo("dry_run", "🌐 Lade Homepage für Dry-Run...")
    await page.goto(getResilientStartUrl(domain), { waitUntil: "domcontentloaded", timeout: PAGE_LOAD_MS })
    await smartWaitForLoad(page)
    await checkForCloudflare(page)
    await dismissCookieBanner(page, logDojo)
    logDojo("dry_run", `Suche Test-Produkt-URL für "${testProduct}"...`)
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

      const foundDryProductUrl = await page.evaluate((domainStr) => {
        const allLinks = Array.from(document.querySelectorAll("a[href]"));
        for (const link of allLinks.slice(0, 600)) {
          const href = link.getAttribute("href");
          if (!href || href === "/" || href.startsWith("#") || href.startsWith("javascript:")) continue;
          const path = href.toLowerCase();
          
          const isProductPattern =
            path.includes("-p-") || path.includes("/p-") || path.includes("-p/") ||
            path.includes("/product/") || path.includes("/products/") ||
            path.includes("/produkt/") || path.includes("/produkte/") ||
            path.includes("/artikel/") || path.includes("/item/") || path.includes("/sku/") ||
            path.includes("/detail/") ||
            /\/a-[a-z0-9]+/i.test(href) ||
            /-\d+\.html$/i.test(href) ||
            /-\d{4,}(?:\/|$)/.test(href) ||
            path.includes("cl=details") ||
            path.includes("artnr=") || path.includes("artno=") ||
            path.includes("article_id=") || path.includes("articleid=") ||
            /[a-f0-9]{32}/i.test(href);

          const isNotNavigation =
            !path.includes("category") && !path.includes("kategorie") &&
            !path.includes("search") && !path.includes("suche") &&
            !path.includes("cart") && !path.includes("warenkorb") &&
            !path.includes("checkout") && !path.includes("kasse") &&
            !path.includes("account") && !path.includes("login") &&
            !path.includes("impressum") && !path.includes("agb") &&
            !path.includes("datenschutz") && !path.includes("contact") &&
            !path.includes("kontakt") && !path.includes("about") &&
            !path.includes("faq") && !path.includes("blog") &&
            !path.includes("brand") && !path.includes("hersteller") &&
            !path.includes("manufacturer") && !path.includes("filter") &&
            !path.includes("sort=") && !path.includes("page=") &&
            !path.includes("view=") && !path.endsWith(".pdf");
            
          if (isProductPattern && isNotNavigation) {
            return href.startsWith("http") ? href : `https://${domainStr}${href}`;
          }
        }
        return null;
      }, domain);

      if (foundDryProductUrl) {
        testProductUrl = foundDryProductUrl;
      }
      if (testProductUrl) break
    }
  }

  if (!testProductUrl) {
    throw new Error(
      `Dry-Run: Produkt-URL für "${testProduct}" nicht gefunden. ` +
      "Suche hat kein Ergebnis mit Produkt-Pfad geliefert."
    )
  }

  logDojo("dry_run", `📦 Produkt-URL: ${testProductUrl}`)

  const ctx = {
    loginUrl: getResilientStartUrl(domain),
    username: "",
    password: "",
    item:     { url: testProductUrl, quantity: "2", product_name: testProduct },
  }

  logDojo("dry_run", `▶️ Führe ${playbook.item_steps.length} item_steps aus...`)
  for (const step of playbook.item_steps) {
    await executeStep(page, step, ctx, logDojo)
  }

  logDojo("dry_run", `▶️ Führe ${playbook.checkout_steps.length} checkout_steps aus...`)
  for (const step of playbook.checkout_steps) {
    await executeStep(page, step, ctx, logDojo)
  }

  const finalUrl    = page.url()
  const isCheckout  = /\/(checkout|kasse|bestellung|order|bezahlen)(\/|$|\?)/i.test(finalUrl)
  const hasAddrFields = await safeIsVisible(
    page.locator('input[name*="firstname" i], input[name*="vorname" i], input[id*="billing" i]').first(),
    1500
  )
  let isCart = /\/(cart|warenkorb|basket|shopping-cart|shoppingcart)(\/|$|\?)/i.test(finalUrl)
  if (!isCart) {
    const deadline = Date.now() + 4000
    while (Date.now() < deadline) {
      const btn = await findProceedToCheckoutButton(page, logDojo)
      if (btn !== null) {
        isCart = true
        break
      }
      await page.waitForTimeout(500)
    }
  }

  // === UNIVERSAL SELF-HEALING CART FALLBACK ===
  if (!isCheckout && !hasAddrFields && !isCart) {
    logDojo("dry_run", `[Self-Healing] Warenkorb nicht über Klick-Schritte erreicht. Führe direkte Navigation zu /cart o.ä. aus...`)
    const fallbackPaths = ["/cart", "/warenkorb", "/basket", "/shopping-cart"]
    for (const path of fallbackPaths) {
      try {
        const fallbackUrl = `https://${domain}${path}`
        logDojo("dry_run", `[Self-Healing] Versuche Direkt-Navigation: ${fallbackUrl}`)
        await page.goto(fallbackUrl, { waitUntil: "domcontentloaded", timeout: 8000 })
        await smartWaitForLoad(page)
        
        const currentUrl = page.url()
        const checkoutBtn = await findProceedToCheckoutButton(page)
        if (!currentUrl.includes("404") && (currentUrl.includes(path) || checkoutBtn !== null)) {
          logDojo("success", `[Self-Healing] Warenkorb-Seite erfolgreich über Direktlink geheilt: ${currentUrl}`)
          isCart = true
          break
        }
      } catch (err: any) {
        logDojo("dry_run", `[Self-Healing] Fallback-Pfad ${path} fehlgeschlagen: ${err.message}`)
      }
    }
  }

  const currentFinalUrl = page.url()
  logDojo("dry_run", `🔍 Finale URL: ${currentFinalUrl}`)

  if (!isCheckout && !hasAddrFields && !isCart) {
    const visibleElements = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll("a, button"));
      return elements
        .filter(el => {
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return style.display !== "none" && 
                 style.visibility !== "hidden" && 
                 parseFloat(style.opacity) !== 0 &&
                 rect.width > 0 && 
                 rect.height > 0;
        })
        .map(el => ({
          tag: el.tagName.toLowerCase(),
          id: el.id,
          class: el.className,
          text: (el.textContent || "").trim().replace(/\s+/g, " ").substring(0, 80),
          href: el.getAttribute("href") || ""
        }))
        .slice(0, 50); // limit to top 50 visible interactive elements
    });
    logDojo("dry_run", `[Diagnostics] Visible links & buttons: ${JSON.stringify(visibleElements, null, 2)}`);

    throw new Error(
      `Dry-Run: Weder Warenkorb noch Kassenseite erreicht. Finale URL: ${currentFinalUrl}. ` +
      "Erwartet: /cart, /warenkorb, /checkout, /kasse o.ä. oder 'Zur Kasse'-Button."
    )
  }
}

async function executeStep(
  page:    Page,
  step:    PlaybookStep,
  ctx:     { loginUrl: string; username: string; password: string; item: Record<string, string> },
  logDojo: LogFn,
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

  logDojo("dry_run", `▶️ Step: ${step.step} (selector=${step.selector || "-"}, value=${step.value || "-"})`)

  switch (step.step) {
    case "navigate":
      const targetUrl = ip(step.url)
      const currentUrl = page.url()
      if (currentUrl.replace(/\/$/, "") === targetUrl.replace(/\/$/, "")) {
        console.log(`[dry-run] Bereits auf Ziel-URL. Überspringe redundante Navigation zu: ${targetUrl}`)
      } else {
        await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: t })
        await smartWaitForLoad(page)
      }
      break
    case "fill":
      try {
        const selectorStr = ip(step.selector)!
        const valueStr = ip(step.value)
        const loc = page.locator(selectorStr).first()
        const isReadonly = await loc.evaluate(el => el.hasAttribute('readonly') || (el as any).readOnly).catch(() => false);
        if (isReadonly) {
          console.log(`[dry-run] Feld ${selectorStr} ist schreibgeschützt (readonly). Verwende JS-Fallback…`)
          await loc.evaluate(reactSafeSetValue, valueStr)
        } else {
          try {
            await page.fill(selectorStr, valueStr, { timeout: t })
          } catch (err: any) {
            console.log(`[dry-run] Standard fill fehlgeschlagen, versuche JS-Fallback für ${selectorStr}:`, err.message)
            await loc.evaluate(reactSafeSetValue, valueStr)
          }
        }
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
        const selectorStr = ip(step.selector)!
        // Matches cart-navigation selectors (flyout toggle, cart icon, basket link).
        // Explicitly excludes add-to-cart action selectors to prevent skipping product additions.
        const isCartOrBasket = (
          selectorStr === "#cartFlyoutLink" ||
          selectorStr.toLowerCase().includes("cart") ||
          selectorStr.toLowerCase().includes("basket")
        ) && !/add[-_]?to[-_]?cart|addtocart|btn[-_]?add|in[-_]?den[-_]?warenkorb/i.test(selectorStr)

        if (isCartOrBasket) {
          const checkoutBtn = await findProceedToCheckoutButton(page)
          if (checkoutBtn !== null) {
            logDojo("dry_run", `[Bypass] Offcanvas-Warenkorb ist bereits geöffnet (Kassen-Button sichtbar). Überspringe Klick auf ${selectorStr} um Schließen/Toggle zu verhindern.`)
            break
          }
        }

        if (isCartOrBasket) {
          logDojo("dry_run", `[Click] Offcanvas/Warenkorb geschlossen oder normaler Klick. Nutze JS-Klick: ${selectorStr}`)
          await page.locator(selectorStr).first().evaluate((el) => (el as HTMLElement).click())
        } else {
          await page.click(selectorStr, { timeout: t })
        }
      } catch (err: any) {
        console.log(`[dry-run] Physischer Klick fehlgeschlagen, versuche JS-Fallback für ${step.selector}:`, err.message)
        try {
          await page.locator(ip(step.selector)!).first().evaluate((el) => (el as HTMLElement).click())
        } catch (jsErr: any) {
          if (step.optional) {
            console.log(`[dry-run] Optionaler Klick-Schritt fehlgeschlagen: ${step.selector}`)
          } else {
            throw err
          }
        }
      }
      break
    case "wait_for_element":
      try {
        await page.waitForSelector(ip(step.selector)!, { timeout: t })
      } catch (err) {
        if (step.optional) {
          console.log(`[dry-run] Optionaler WaitForElement-Schritt fehlgeschlagen: ${step.selector}`)
        } else {
          throw err
        }
      }
      break
    case "wait_for_url":
      try {
        await page.waitForURL(new RegExp(step.pattern ?? "", "i"), { timeout: t })
      } catch (err) {
        if (step.optional) {
          console.log(`[dry-run] Optionaler WaitForURL-Schritt fehlgeschlagen: ${step.pattern}`)
        } else {
          throw err
        }
      }
      break
    case "wait_for_load":
      try {
        await page.waitForLoadState("domcontentloaded", { timeout: t })
        await smartWaitForLoad(page)
      } catch (err: any) {
        if (step.optional) {
          console.log(`[dry-run] Optionaler Load-Schritt fehlgeschlagen: ${err.message}`)
        } else {
          throw err
        }
      }
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

async function findProceedToCheckoutButton(page: Page, logDojo?: LogFn): Promise<string | null> {
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

  // AI-Healing Fallback
  if (logDojo) {
    logDojo("info", "🔎 Suche Kassen-Button mit AI-Healing...")
    const healed = await aiHealSelector(page, "proceed_to_checkout", SELECTORS.join(", "), logDojo)
    if (healed) {
      logDojo("success", `🎯 AI-Healing hat Kassen-Button gefunden: "${healed}"`)
      return healed
    }
  }

  return null
}

async function isLoginPage(page: Page): Promise<boolean> {
  try {
    const url   = page.url().toLowerCase()
    // safeTitle verhindert ewiges Hängen in headless/proxy Umgebungen
    const title = await safeTitle(page, 2000)
    const keywords = /(login|signin|sign-in|log-in|anmeld|anmeldung|auth|konto|kundenbereich|sso|oauth|passkey|webauthn|otp|passwordless)/i
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
      'input[autocomplete="one-time-code"], ' +
      'input[autocomplete="webauthn"], ' +
      'input[id*="passkey" i], ' +
      'input[name*="passkey" i], ' +
      'button[id*="passkey" i], ' +
      'button[class*="passkey" i], ' +
      'button[id*="sso" i], ' +
      'button[class*="sso" i], ' +
      '[data-testid*="passkey" i], ' +
      '[data-testid*="sso" i]'
    ).first()
    
    if (await safeIsVisible(passwordlessLoc, 2000)) {
      return true
    }

    // 3. SSO / Passkey / WebAuthn button text triggers (covers standard B2B auth walls)
    const ssoButtonLoc = page.locator(
      'button:has-text("passkey"), button:has-text("sso"), ' +
      'a:has-text("passkey"), a:has-text("sso"), ' +
      'button:has-text("sign in with"), button:has-text("log in with"), ' +
      'button:has-text("mit google anmelden"), button:has-text("mit google einloggen"), ' +
      'button:has-text("passwortlos"), button:has-text("passwordless")'
    ).first()
    
    return await safeIsVisible(ssoButtonLoc, 1500)
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
async function extractStableSelector(page: Page, el: any): Promise<string | null> {
  try {
    return await page.evaluate((element: Element) => {
      const getStable = (element: Element): string | null => {
        const tag = element.tagName.toLowerCase()

        const isDynamicId = (id: string): boolean => {
          if (/^[0-9]/.test(id)) return true;
          if (/^[a-f0-9]{6,}$/i.test(id)) return true;
          if (/\d{2,}/.test(id)) return true;
          return false;
        };

        if (element.id && !isDynamicId(element.id)) {
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

      // pierce/ prefix is Playwright-CDP-only. Chrome Extension document.querySelector cannot cross shadow roots.
      // Cookie steps use optional:true so the extension skips them — safe because consent was already accepted.
      // Non-cookie steps with pierce/ indicate a shop using web components for core flow (unsupported by extension).
      const root = element.getRootNode()
      const isShadow = (typeof ShadowRoot !== "undefined" && root instanceof ShadowRoot) || 
                       (root && (root as any).host !== undefined)
      
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
    const screenshot = await page.screenshot({ type: "jpeg", quality: 70 }).catch(() => null)
    let screenshotBase64 = ""
    if (screenshot) {
      screenshotBase64 = encodeBase64(screenshot)
    }
    
    const htmlSnippet = await page.evaluate(() => {
      try {
        // Flatten shadow roots into the clone so Gemini sees web-component internals
        const flattenShadow = (root: Element | ShadowRoot): string => {
          let html = ""
          for (const child of Array.from(root.childNodes)) {
            if (child.nodeType === Node.ELEMENT_NODE) {
              const el = child as Element
              const sr = (el as any).shadowRoot as ShadowRoot | null
              if (sr) {
                html += `<shadow-root host="${el.tagName.toLowerCase()}">${flattenShadow(sr)}</shadow-root>`
              } else {
                html += el.outerHTML
              }
            }
          }
          return html
        }

        const bodyClone = document.body.cloneNode(true) as HTMLElement

        // Remove non-semantic nodes
        bodyClone.querySelectorAll(
          "script, style, svg, noscript, iframe, link, path, symbol, head, meta, " +
          "template, [hidden], [aria-hidden='true']"
        ).forEach((el) => el.remove())

        // Strip noisy attributes — keep only selector-stable and semantic ones
        const KEEP_ATTRS = new Set([
          "id", "name", "type", "placeholder", "value", "role",
          "aria-label", "aria-labelledby", "aria-describedby",
          "data-testid", "data-action", "data-cy", "data-qa",
          "for", "href", "action", "method",
        ])
        bodyClone.querySelectorAll("*").forEach((el) => {
          const toRemove: string[] = []
          for (const attr of Array.from(el.attributes)) {
            if (KEEP_ATTRS.has(attr.name)) continue
            if (attr.name === "class") {
              // Keep class but strip hash/generated values
              const cleaned = attr.value
                .split(/\s+/)
                .filter(c =>
                  c.length > 2 &&
                  !/^[a-f0-9]{5,}$/.test(c) &&
                  !/^css-/.test(c) &&
                  !/^sc-/.test(c) &&
                  !/^_/.test(c)
                )
                .join(" ")
              if (cleaned) el.setAttribute("class", cleaned)
              else toRemove.push("class")
              continue
            }
            // Remove data-react*, data-n-*, inline base64 src
            if (attr.name.startsWith("data-react") || attr.name.startsWith("data-n-") || attr.name.startsWith("data-v-")) {
              toRemove.push(attr.name)
              continue
            }
            if (attr.name === "src" && attr.value.startsWith("data:")) {
              toRemove.push(attr.name)
              continue
            }
            if (!attr.name.startsWith("data-") && !attr.name.startsWith("aria-")) {
              toRemove.push(attr.name)
            }
          }
          toRemove.forEach(a => el.removeAttribute(a))
        })

        // Include shadow DOM content for web component shops (Shopware 6, etc.)
        const shadowFragments = Array.from(document.querySelectorAll("*"))
          .filter(el => !!(el as any).shadowRoot)
          .map(el => {
            const sr = (el as any).shadowRoot as ShadowRoot
            return `<shadow-root host="${el.tagName.toLowerCase()}" id="${el.id || ""}">${flattenShadow(sr)}</shadow-root>`
          })
          .join("\n")

        const lightHtml  = bodyClone.outerHTML
        const combined   = lightHtml + (shadowFragments ? `\n<!-- Shadow DOM -->\n${shadowFragments}` : "")

        // Truncate at last closing tag before 55KB to avoid sending malformed HTML to Gemini
        const MAX = 55_000
        if (combined.length <= MAX) return combined
        const cutoff = combined.lastIndexOf("</", MAX)
        return cutoff > 0 ? combined.substring(0, cutoff) + "…" : combined.substring(0, MAX)
      } catch {
        return document.body.innerText.substring(0, 20_000)
      }
    }).catch(() => "")

    const CONTEXT_DESCRIPTIONS: Record<string, string> = {
      search:              'Produkt im Shop suchen (Suchfeld befüllen)',
      add_to_cart:         'Produkt in den Warenkorb legen oder Bestellmenge in ein Zahlenfeld eingeben',
      go_to_checkout:      'Warenkorb-Icon oder Warenkorb-Link anklicken, um den Warenkorb zu öffnen',
      proceed_to_checkout: 'Klick auf den finalen "Zur Kasse"- oder "Checkout"-Button, der zur Bestellseite navigiert. Im Offcanvas-Warenkorb oder auf der /cart-Seite. Typisch: "Zur Kasse", "Checkout", "Weiter zur Kasse".',
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
      geminiParts.push({ inlineData: { mimeType: 'image/jpeg', data: screenshotBase64 } })
    }
    if (htmlSnippet) {
      geminiParts.push({ text: `HTML (max. 60 KB):\n\`\`\`html\n${htmlSnippet}\n\`\`\`` })
    }
    geminiParts.push({ text: taskPrompt })

    const geminiController = new AbortController();
    const geminiTimeoutId = setTimeout(() => geminiController.abort(), 25000);
    let geminiRes;
    try {
      geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${GEMINI_API_KEY}`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: geminiParts }],
            generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
          }),
          signal: geminiController.signal,
        }
      )
    } catch (err) {
      const isAbort = err instanceof DOMException && err.name === "AbortError";
      logDojo("warning", `🤖 Dojo AI-Healing fehlgeschlagen: ${isAbort ? "Gemini API-Timeout (25s) überschritten." : (err as Error).message}`)
      return null;
    } finally {
      clearTimeout(geminiTimeoutId);
    }

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
      blockAds: true,
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

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  let res;
  try {
    res = await fetch("https://api.browserbase.com/v1/sessions", {
      method:  "POST",
      headers: {
        "Content-Type": "application/json",
        "x-bb-api-key": BROWSERBASE_API_KEY,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    const isAbort = err instanceof DOMException && err.name === "AbortError";
    throw new Error(
      isAbort 
        ? "Browserbase API-Timeout (15s) überschritten bei Session-Erstellung. Keine Verbindung zu Residential Proxies möglich." 
        : `Browserbase API-Verbindung fehlgeschlagen: ${(err as Error).message}`
    );
  } finally {
    clearTimeout(timeoutId);
  }

  // HTTP 402: Residential Proxies nicht im Plan → Fallback auf Standard-Verbindung
  if (res.status === 402 && body.proxies) {
    console.warn("[browserbase] Residential Proxies nicht verfügbar (402). Fallback auf Standard...")
    delete body.proxies
    
    const fallbackController = new AbortController();
    const fallbackTimeoutId = setTimeout(() => fallbackController.abort(), 15000);
    try {
      res = await fetch("https://api.browserbase.com/v1/sessions", {
        method:  "POST",
        headers: {
          "Content-Type": "application/json",
          "x-bb-api-key": BROWSERBASE_API_KEY,
        },
        body: JSON.stringify(body),
        signal: fallbackController.signal,
      });
    } catch (err) {
      const isAbort = err instanceof DOMException && err.name === "AbortError";
      throw new Error(
        isAbort 
          ? "Browserbase Fallback API-Timeout (15s) überschritten." 
          : `Browserbase Fallback-Verbindung fehlgeschlagen: ${(err as Error).message}`
      );
    } finally {
      clearTimeout(fallbackTimeoutId);
    }
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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    await fetch(`https://api.browserbase.com/v1/sessions/${sessionId}`, {
      method:  "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-bb-api-key": BROWSERBASE_API_KEY,
      },
      body: JSON.stringify({ status: "REQUEST_RELEASE" }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId));
    console.log(`[browserbase] Session freigegeben: ${sessionId}`)
  } catch (e) {
    console.warn("[browserbase] Session-Freigabe fehlgeschlagen:", e)
  }
}

async function triggerDryRunInvocation(domain: string, testProduct: string): Promise<void> {
  const functionUrl = `${SUPABASE_URL}/functions/v1/start-learning`
  console.log(`[learning] Triggere Dry-Run für ${domain} via: ${functionUrl}`)
  
  try {
    await Promise.race([
      fetch(functionUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
        body: JSON.stringify({
          domain,
          test_product: testProduct,
          phase: "dry_run",
        }),
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 2000))
    ])
    console.log(`[learning] Dry-Run Invocation erfolgreich getriggert für ${domain}`)
  } catch (err) {
    console.warn(`[learning] Dry-Run Trigger completed or timed out (expected for loopback async triggers):`, err.message)
  }
}

// ── Response Helper ───────────────────────────────────────────────────────────

function respond(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  })
}
