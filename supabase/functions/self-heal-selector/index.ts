import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY    = Deno.env.get('SUPABASE_ANON_KEY')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const GEMINI_API_KEY       = Deno.env.get('GEMINI_API_KEY')!

// Globale Cache-Einträge, die älter als N Tage sind, werden ignoriert.
// Shops ändern ihren HTML selten radikal — 90 Tage sind konservativ sicher.
const GLOBAL_CACHE_TTL_DAYS = 90

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const CONTEXT_DESCRIPTIONS: Record<string, string> = {
  login_navigate:      'Klick auf den Login-, Anmelden- oder Mein-Konto-Button, um zur Login-Seite zu navigieren',
  login:               'Einloggen in einen B2B-Webshop (Benutzername/Passwort eingeben und absenden)',
  search:              'Produkt im Shop suchen (Suchfeld befüllen und Suche starten)',
  search_submit:       'Klick auf den Suchen-Button, um die Suchanfrage abzusenden',
  add_to_cart:         'Produkt in den Warenkorb legen oder Bestellmenge in ein Zahlenfeld eingeben',
  price_check:         'Aktuellen Produktpreis aus der Produktseite auslesen',
  go_to_checkout:      'Klick auf das Warenkorb-Icon oder den Warenkorb-Link, um den Warenkorb zu öffnen. Ergebnis ist Navigation zu /cart oder Öffnen eines Offcanvas-Panels. Typisch: Warenkorb-Icon oben rechts, "Warenkorb anzeigen", "View Cart".',
  proceed_to_checkout: 'Klick auf den finalen "Zur Kasse"- oder "Checkout"-Button, der zur Bestellseite navigiert. Im Offcanvas-Warenkorb oder auf der /cart-Seite. Typisch: "Zur Kasse", "Checkout", "Weiter zur Kasse". Nur Buttons/Links die zu /checkout oder /kasse führen.',
  other:               'Allgemeine Interaktion mit einem B2B-Webshop-Element',
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function extractDomain(url: string): string | null {
  if (!url) return null
  try {
    const normalized = url.startsWith('http') ? url : `https://${url}`
    return new URL(normalized).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return null
  }
}

function respond(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}

// ── Entry point ───────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    // ── Auth ─────────────────────────────────────────────────────────────────

    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) {
      return respond({ error: 'Missing Authorization header' }, 401)
    }

    const isServiceKey = authHeader === `Bearer ${SUPABASE_SERVICE_KEY}`
    if (!isServiceKey) {
      const tmpClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      })
      const { error: authErr } = await tmpClient.auth.getUser(authHeader.replace('Bearer ', '').trim())
      if (authErr) {
        console.error('[auth] getUser failed:', authErr.message)
        return respond({ error: 'Unauthorized', details: authErr.message }, 401)
      }
    }

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // ── Parse & validate body ─────────────────────────────────────────────────

    const body: {
      session_id?:        string
      supplier_id:        string
      context:            string
      failed_selector:    string
      screenshot_base64?: string
      html_snippet?:      string
    } = await req.json()

    const { session_id, supplier_id, context, failed_selector, screenshot_base64, html_snippet } = body

    if (!supplier_id || !context || !failed_selector) {
      return respond({ error: 'supplier_id, context, failed_selector required' }, 400)
    }
    if (!CONTEXT_DESCRIPTIONS[context]) {
      return respond({ error: `context must be one of: ${Object.keys(CONTEXT_DESCRIPTIONS).join(', ')}` }, 400)
    }

    console.log(`[self-heal] supplier=${supplier_id} context=${context} selector="${failed_selector}"`)

    // ── Schwarmintelligenz: Domain des Lieferanten ermitteln ──────────────────

    let domain: string | null = null
    try {
      const { data: supplierRow } = await adminClient
        .from('suppliers')
        .select('order_url, url')
        .eq('id', supplier_id)
        .single()

      domain = extractDomain(supplierRow?.order_url || supplierRow?.url)
      if (domain) console.log(`[self-heal] domain resolved: ${domain}`)
    } catch (e) {
      console.warn('[self-heal] Domain-Ermittlung fehlgeschlagen:', e)
    }

    // ── Schwarmintelligenz: Globalen Cache prüfen (Cache-Hit?) ────────────────

    if (domain) {
      const cacheFromDate = new Date(
        Date.now() - GLOBAL_CACHE_TTL_DAYS * 86_400_000
      ).toISOString()

      const { data: globalMatch } = await adminClient
        .from('global_learned_selectors')
        .select('id, healed_selector, confidence, use_count')
        .eq('domain', domain)
        .eq('selector_key', context)
        .gte('last_used_at', cacheFromDate)
        .order('use_count',    { ascending: false })
        .order('confidence',   { ascending: false })
        .limit(1)
        .maybeSingle()

      if (globalMatch?.healed_selector) {
        console.log(
          `[self-heal] ✅ Cache-Hit: domain=${domain} context=${context}` +
          ` → "${globalMatch.healed_selector}" (${globalMatch.use_count}x verwendet)`
        )

        // Selektor lokal beim Kunden persistieren
        await persistNewSelector(adminClient, supplier_id, failed_selector, globalMatch.healed_selector)

        // Nutzungsstatistik im globalen Cache aktualisieren
        await adminClient
          .from('global_learned_selectors')
          .update({
            use_count:    globalMatch.use_count + 1,
            last_used_at: new Date().toISOString(),
          })
          .eq('id', globalMatch.id)

        // Heal-Log für Nachvollziehbarkeit (kein AI-Aufruf → ai_model = 'global_cache')
        await adminClient.from('selector_heal_log').insert({
          supplier_id,
          session_id:     session_id ?? null,
          context,
          failed_selector,
          new_selector:   globalMatch.healed_selector,
          html_snippet:   null,
          ai_model:       'global_cache',
          healed:         true,
          applied_at:     new Date().toISOString(),
          ai_response:    { source: 'global_cache', domain, use_count: globalMatch.use_count },
        }).then(({ error }) => {
          if (error) console.warn('[self-heal] Heal-Log (cache-hit) fehlgeschlagen:', error.message)
        })

        return respond({
          new_selector: globalMatch.healed_selector,
          healed:       true,
          confidence:   globalMatch.confidence,
          source:       'global_cache',
          reasoning:    `Selektor aus globalem Cache für Domain "${domain}" (${globalMatch.use_count}x erfolgreich verwendet).`,
        })
      }
    }

    // ── Cache-Miss: Heal-Log einfügen (vor Gemini-Aufruf) ────────────────────

    const { data: logEntry, error: logErr } = await adminClient
      .from('selector_heal_log')
      .insert({
        supplier_id,
        session_id:   session_id ?? null,
        context,
        failed_selector,
        html_snippet: html_snippet ? html_snippet.substring(0, 50_000) : null,
        ai_model:     'gemini-1.5-flash-latest',
        healed:       false,
      })
      .select('id')
      .single()

    if (logErr) console.error('[self-heal] selector_heal_log insert failed:', logErr)
    const logId = logEntry?.id ?? null

    // ── Gemini API aufrufen ───────────────────────────────────────────────────

    if (!GEMINI_API_KEY) {
      console.error('[self-heal] GEMINI_API_KEY not configured')
      return respond({ new_selector: null, healed: false, error: 'AI not configured' })
    }

    const taskPrompt = `Du bist ein Experte für Web-Scraping und CSS-Selektoren. \
Du hilfst dabei, kaputte Selektoren in einem B2B-Automatisierungssystem zu reparieren.

**Situation:** Ein CSS-Selektor hat aufgehört zu funktionieren.

**Aktion, die durchgeführt werden soll:**
${CONTEXT_DESCRIPTIONS[context]}

**Fehlgeschlagener Selektor:** \`${failed_selector}\`

**Deine Aufgabe:**
1. Analysiere den Screenshot und den HTML-Code sorgfältig.
2. Finde das Element, das die gewünschte Aktion ermöglicht.
3. Erstelle einen stabilen, spezifischen CSS-Selektor.

**Regeln:**
- Bevorzuge \`id\`, \`name\`, \`data-*\`, \`aria-label\`, \`type\`-Attribute
- Meide positionsbasierte Selektoren (\`:nth-child\`, \`:first-child\`)
- Meide generierte Hash-Klassen (\`._3xKj8\`, \`.css-1a2b3c\`)
- NIEMALS generische Selektoren wie \`input[type="text"]\` oder \`div\`
- Element darf NICHT \`type="hidden"\` haben
- Selektor muss auf GENAU EIN Element matchen

Antworte ausschließlich als JSON:
{"selector":"...","confidence":0.0,"reasoning":"..."}`

    const geminiParts: unknown[] = []
    if (screenshot_base64) {
      geminiParts.push({ inlineData: { mimeType: 'image/png', data: screenshot_base64 } })
    }
    if (html_snippet) {
      geminiParts.push({ text: `HTML (max. 45 KB):\n\`\`\`html\n${html_snippet.substring(0, 45_000)}\n\`\`\`` })
    }
    geminiParts.push({ text: taskPrompt })

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`
    const geminiRes = await fetch(
      geminiUrl,
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
      console.error('[self-heal] Gemini HTTP', geminiRes.status, errText.substring(0, 300))
      if (logId) {
        await adminClient.from('selector_heal_log')
          .update({ ai_response: { error: `HTTP ${geminiRes.status}` } }).eq('id', logId)
      }
      return respond({ new_selector: null, healed: false, error: `Gemini ${geminiRes.status}: ${errText.substring(0, 150)}` })
    }

    const geminiData = await geminiRes.json()
    const rawText    = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    const inputTokens: number | null = geminiData?.usageMetadata?.promptTokenCount ?? null

    console.log('[self-heal] Gemini output:', rawText.substring(0, 400))

    let aiParsed: { selector?: string; confidence?: number; reasoning?: string } = {}
    try {
      aiParsed = JSON.parse(rawText.replace(/```json/g, '').replace(/```/g, '').trim())
    } catch (e) {
      console.error('[self-heal] JSON parse failed:', e, '— raw:', rawText)
    }

    const newSelector = (typeof aiParsed.selector === 'string' && aiParsed.selector.trim())
      ? aiParsed.selector.trim() : null
    const confidence  = aiParsed.confidence ?? 0
    const healed      = newSelector !== null && confidence >= 0.6

    // ── Heal-Log aktualisieren ────────────────────────────────────────────────

    if (logId) {
      await adminClient.from('selector_heal_log').update({
        new_selector:     newSelector,
        ai_prompt_tokens: inputTokens,
        ai_response:      aiParsed,
        healed,
        applied_at:       healed ? new Date().toISOString() : null,
      }).eq('id', logId)
    }

    // ── Bei Erfolg: lokal UND global persistieren ─────────────────────────────

    if (healed && newSelector) {
      await persistNewSelector(adminClient, supplier_id, failed_selector, newSelector)

      if (domain) {
        await persistGlobalSelector(
          adminClient, domain, context, failed_selector, newSelector, confidence
        )
      }
    }

    console.log(
      `[self-heal] ${healed ? '✅ Geheilt' : '❌ Nicht geheilt'}` +
      ` "${failed_selector}" → "${newSelector}" (confidence=${confidence.toFixed(2)})`
    )

    return respond({
      new_selector: healed ? newSelector : null,
      healed,
      confidence,
      source:    'gemini',
      reasoning: aiParsed.reasoning ?? null,
    })

  } catch (err) {
    console.error('[self-heal] Fatal:', err)
    return respond({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

// ── Lokaler Selektor-Persist (suppliers.selectors JSONB) ──────────────────────

async function persistNewSelector(
  adminClient:    ReturnType<typeof createClient>,
  supplierId:     string,
  failedSelector: string,
  newSelector:    string,
): Promise<void> {
  const { data: supplier, error: loadErr } = await adminClient
    .from('suppliers')
    .select('selectors')
    .eq('id', supplierId)
    .single()

  if (loadErr || !supplier) {
    console.error('[self-heal] persistNewSelector: Lieferant nicht gefunden:', loadErr)
    return
  }

  const selectors: Record<string, string> = { ...(supplier.selectors ?? {}) }
  let changed = false

  for (const [key, value] of Object.entries(selectors)) {
    if (value === failedSelector) {
      selectors[key] = newSelector
      changed = true
      console.log(`[self-heal] suppliers.selectors.${key}: "${failedSelector}" → "${newSelector}"`)
    }
  }

  if (!changed) {
    console.warn(`[self-heal] "${failedSelector}" nicht in suppliers.selectors gefunden — kein DB-Write`)
    return
  }

  const { error } = await adminClient.from('suppliers').update({ selectors }).eq('id', supplierId)
  if (error) console.error('[self-heal] suppliers.selectors update fehlgeschlagen:', error)
}

// ── Globaler Selektor-Persist (Schwarmintelligenz) ────────────────────────────

async function persistGlobalSelector(
  adminClient:    ReturnType<typeof createClient>,
  domain:         string,
  selectorKey:    string,
  failedSelector: string,
  healedSelector: string,
  confidence:     number,
): Promise<void> {
  // Prüfen ob Eintrag für diese Domain+Context bereits existiert
  const { data: existing } = await adminClient
    .from('global_learned_selectors')
    .select('id, use_count')
    .eq('domain', domain)
    .eq('selector_key', selectorKey)
    .maybeSingle()

  if (existing) {
    // Bestehenden Eintrag aktualisieren (neuer healed_selector + Statistik)
    const { error } = await adminClient
      .from('global_learned_selectors')
      .update({
        failed_selector: failedSelector,
        healed_selector: healedSelector,
        confidence,
        use_count:       existing.use_count + 1,
        last_used_at:    new Date().toISOString(),
      })
      .eq('id', existing.id)

    if (error) {
      console.error('[self-heal] persistGlobalSelector update fehlgeschlagen:', error)
    } else {
      console.log(`[self-heal] 🌍 Global aktualisiert: ${domain}/${selectorKey} → "${healedSelector}"`)
    }
  } else {
    // Neuen Eintrag anlegen
    const { error } = await adminClient
      .from('global_learned_selectors')
      .insert({
        domain,
        selector_key:    selectorKey,
        failed_selector: failedSelector,
        healed_selector: healedSelector,
        confidence,
      })

    if (error) {
      console.error('[self-heal] persistGlobalSelector insert fehlgeschlagen:', error)
    } else {
      console.log(`[self-heal] 🌍 Global gelernt (neu): ${domain}/${selectorKey} → "${healedSelector}"`)
    }
  }
}
