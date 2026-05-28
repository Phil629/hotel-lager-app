import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY    = Deno.env.get('SUPABASE_ANON_KEY')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Human-readable action descriptions injected into the AI prompt
const CONTEXT_DESCRIPTIONS: Record<string, string> = {
  login:       'Einloggen in einen B2B-Webshop (Benutzername/Passwort eingeben und absenden)',
  search:      'Produkt im Shop suchen (Suchfeld befüllen und Suche starten)',
  add_to_cart: 'Produkt in den Warenkorb legen oder Bestellmenge in ein Zahlenfeld eingeben',
  price_check: 'Aktuellen Produktpreis aus der Produktseite auslesen',
  other:       'Allgemeine Interaktion mit einem B2B-Webshop-Element',
}

// ── Entry point ───────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    // Auth: primary caller is our own Playwright script (service key).
    // Fallback: valid user JWT for future admin tooling.
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) {
      return respond({ error: 'Missing Authorization header' }, 401)
    }

    const isServiceKey = authHeader === `Bearer ${SUPABASE_SERVICE_KEY}`
    if (!isServiceKey) {
      const tmpClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      })
      const { error: authErr } = await tmpClient.auth.getUser()
      if (authErr) return respond({ error: 'Unauthorized' }, 401)
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

    const {
      session_id,
      supplier_id,
      context,
      failed_selector,
      screenshot_base64,
      html_snippet,
    } = body

    if (!supplier_id || !context || !failed_selector) {
      return respond({ error: 'supplier_id, context, failed_selector required' }, 400)
    }
    if (!CONTEXT_DESCRIPTIONS[context]) {
      return respond({ error: `context must be one of: ${Object.keys(CONTEXT_DESCRIPTIONS).join(', ')}` }, 400)
    }

    console.log(
      `[self-heal] supplier=${supplier_id}` +
      ` context=${context}` +
      ` selector="${failed_selector}"`
    )

    // ── Insert heal log entry (always, even if AI fails) ──────────────────────

    const { data: logEntry, error: logErr } = await adminClient
      .from('selector_heal_log')
      .insert({
        supplier_id,
        session_id:   session_id ?? null,
        context,
        failed_selector,
        html_snippet: html_snippet ? html_snippet.substring(0, 50_000) : null,
        ai_model:     'claude-sonnet-4-6',
        healed:       false,
      })
      .select('id')
      .single()

    if (logErr) {
      console.error('[self-heal] selector_heal_log insert failed:', logErr)
    }
    const logId = logEntry?.id ?? null

    // ── Build Gemini API payload ──────────────────────────────────────

    if (!GEMINI_API_KEY) {
      console.error('[self-heal] GEMINI_API_KEY not configured')
      return respond({ new_selector: null, healed: false, error: 'AI not configured' })
    }

    const contextDescription = CONTEXT_DESCRIPTIONS[context]

    const taskPrompt = `Du bist ein Experte für Web-Scraping und CSS-Selektoren. \
Du hilfst dabei, kaputte Selektoren in einem B2B-Automatisierungssystem zu reparieren.

**Situation:**
Ein CSS-Selektor hat aufgehört zu funktionieren, weil der Webshop seine HTML-Struktur geändert hat.

**Aktion, die durchgeführt werden soll:**
${contextDescription}

**Fehlgeschlagener Selektor:** \`${failed_selector}\`

**Deine Aufgabe:**
1. Analysiere den Screenshot und den HTML-Code sorgfältig.
2. Finde das Element, das die gewünschte Aktion ermöglicht.
3. Erstelle einen stabilen, spezifischen CSS-Selektor für genau dieses Element.

**Regeln für den neuen Selektor:**
- Bevorzuge \`id\`, \`name\`, \`data-*\`, \`aria-label\`, \`type\`-Attribute (stabil über Layout-Änderungen)
- Meide rein positionsbasierte Selektoren wie \`:nth-child(3)\` oder \`:first-child\`
- Meide generierte Hash-Klassen wie \`._3xKj8\` oder \`.css-1a2b3c\`
- Der Selektor muss auf GENAU EIN Element matchen

Antworte ausschließlich als JSON (kein Markdown, kein erklärender Text):
{
  "selector": "der-neue-css-selektor",
  "confidence": 0.0,
  "reasoning": "Kurze Begründung auf Deutsch warum dieses Element korrekt ist"
}`

    const geminiParts: any[] = [{ text: taskPrompt }];

    if (screenshot_base64) {
      geminiParts.push({
        inlineData: {
          mimeType: 'image/png',
          data: screenshot_base64
        }
      });
    }

    if (html_snippet) {
      geminiParts.push({
        text: `HTML der Seite (Ausschnitt, max. 45 KB):\n\`\`\`html\n${html_snippet.substring(0, 45_000)}\n\`\`\``
      });
    }

    // ── Call Gemini API ───────────────────────────────────────────────────────

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`

    const claudeRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: geminiParts }],
        generationConfig: {
            temperature: 0.2, 
            responseMimeType: "application/json"
        }
      })
    })

    if (!claudeRes.ok) {
      const errText = await claudeRes.text()
      console.error('[self-heal] Gemini API HTTP', claudeRes.status, errText.substring(0, 300))

      if (logId) {
        await adminClient
          .from('selector_heal_log')
          .update({ ai_response: { error: `HTTP ${claudeRes.status}` } })
          .eq('id', logId)
      }
      return respond({ new_selector: null, healed: false, error: 'AI API error' })
    }

    const claudeData = await claudeRes.json()
    const rawText    = claudeData?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    const inputTokens: number | null = claudeData?.usageMetadata?.promptTokenCount ?? null

    console.log('[self-heal] Gemini raw output:', rawText.substring(0, 400))

    // ── Parse AI response ─────────────────────────────────────────────────────

    let aiParsed: { selector?: string; confidence?: number; reasoning?: string } = {}
    try {
      const cleaned = rawText.replace(/```json/g, '').replace(/```/g, '').trim()
      aiParsed = JSON.parse(cleaned)
    } catch (parseErr) {
      console.error('[self-heal] JSON parse failed:', parseErr, '— raw:', rawText)
    }

    const newSelector = (
      typeof aiParsed.selector === 'string' && aiParsed.selector.trim()
    ) ? aiParsed.selector.trim() : null

    const confidence = aiParsed.confidence ?? 0
    const healed     = newSelector !== null && confidence >= 0.6

    // ── Update heal log with AI result ────────────────────────────────────────

    if (logId) {
      await adminClient
        .from('selector_heal_log')
        .update({
          new_selector:     newSelector,
          ai_prompt_tokens: inputTokens,
          ai_response:      aiParsed,
          healed,
          applied_at:       healed ? new Date().toISOString() : null,
        })
        .eq('id', logId)
    }

    // ── Persist repaired selector into suppliers.selectors ────────────────────

    if (healed && newSelector) {
      await persistNewSelector(adminClient, supplier_id, failed_selector, newSelector)
    }

    console.log(
      `[self-heal] ${healed ? '✅ Geheilt' : '❌ Nicht geheilt'}` +
      ` "${failed_selector}" → "${newSelector}"` +
      ` (confidence=${confidence.toFixed(2)})`
    )

    return respond({
      new_selector: healed ? newSelector : null,
      healed,
      confidence:   confidence,
      reasoning:    aiParsed.reasoning ?? null,
    })

  } catch (err) {
    console.error('[self-heal] Fatal:', err)
    return respond({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

// ── Write repaired selector back to suppliers.selectors (JSONB) ───────────────

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
    console.error('[self-heal] Could not load supplier for selector update:', loadErr)
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
    console.warn(
      `[self-heal] "${failedSelector}" not found in suppliers.selectors — skipping DB write`
    )
    return
  }

  const { error: updateErr } = await adminClient
    .from('suppliers')
    .update({ selectors })
    .eq('id', supplierId)

  if (updateErr) {
    console.error('[self-heal] selectors update failed:', updateErr)
  } else {
    console.log(`[self-heal] suppliers.selectors persisted for supplier ${supplierId}`)
  }
}

// ── Utility ───────────────────────────────────────────────────────────────────

function respond(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}
