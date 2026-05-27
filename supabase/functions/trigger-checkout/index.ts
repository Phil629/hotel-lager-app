import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'
import { buildBrowserlessScript } from './_playwright_script.ts'

// Deno/Supabase edge runtime global
declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void }

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY    = Deno.env.get('SUPABASE_ANON_KEY')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const BROWSERLESS_TOKEN    = Deno.env.get('BROWSERLESS_TOKEN') ?? ''
// Endpoint for the self-heal function (step 2); used inside the Playwright script
const SELF_HEAL_URL        = `${SUPABASE_URL}/functions/v1/self-heal-selector`

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CheckoutItem {
  product_id:      string | null
  product_name:    string
  quantity:        number
  unit:            string
  price_expected:  number | null
  price_actual:    number | null
  price_delta_pct: number | null
  price_ok:        boolean | null
}

// ── Entry point ───────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    // 1. Auth: validate JWT from frontend
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return respond({ error: 'Missing Authorization header' }, 401)

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    const { data: { user }, error: authErr } = await userClient.auth.getUser()
    if (authErr || !user) return respond({ error: 'Unauthorized' }, 401)

    // 2. Parse & validate body
    const body: {
      supplier_id:        string
      items:              Array<{ product_id?: string; product_name: string; quantity: number; unit?: string; price_expected?: number }>
      price_threshold_pct?: number
    } = await req.json()

    const { supplier_id, items, price_threshold_pct = 5.0 } = body

    if (!supplier_id)                          return respond({ error: 'supplier_id required' }, 400)
    if (!Array.isArray(items) || !items.length) return respond({ error: 'items[] must be non-empty' }, 400)

    // 3. Load caller's profile (company + role check)
    const { data: profile } = await adminClient
      .from('profiles')
      .select('company_id, role')
      .eq('id', user.id)
      .single()

    if (!profile?.company_id) return respond({ error: 'User has no company' }, 403)
    if (!['owner', 'admin'].includes(profile.role)) {
      return respond({ error: 'Nur Owner und Admins können Checkouts starten.' }, 403)
    }

    // 4. Load supplier — must belong to the same company
    const { data: supplier, error: supErr } = await adminClient
      .from('suppliers')
      .select('id, name, strategy, has_persistent_cart, is_mfa_incompatible, mfa_type, selectors, login_url')
      .eq('id', supplier_id)
      .eq('company_id', profile.company_id)
      .single()

    if (supErr || !supplier) return respond({ error: 'Lieferant nicht gefunden.' }, 404)

    if (supplier.is_mfa_incompatible) {
      return respond({
        error: 'Dieser Lieferant hat SMS-Zwang (MFA inkompatibel). Automatisierung nicht möglich.',
        code: 'MFA_INCOMPATIBLE',
      }, 422)
    }

    const strategy: 'cloud' | 'extension' = supplier.strategy ?? 'cloud'

    // 5. Load credentials via user-scoped RPC so SECURITY DEFINER can resolve auth.uid()
    let credentials: { loginUrl?: string; loginUsername?: string; loginPassword?: string } = {}
    if (strategy === 'cloud') {
      try {
        const { data: creds, error: credErr } = await userClient.rpc('get_supplier_credentials', {
          p_supplier_id: supplier_id,
        })
        if (credErr) throw credErr
        if (creds) {
          credentials = {
            loginUrl:      creds.login_url,
            loginUsername: creds.login_username,
            loginPassword: creds.login_password,
          }
        }
      } catch (e) {
        console.warn('[trigger-checkout] Credentials nicht ladbar:', e)
      }
    }

    // 6. Normalize items
    const normalizedItems: CheckoutItem[] = items.map(item => ({
      product_id:      item.product_id ?? null,
      product_name:    String(item.product_name).trim(),
      quantity:        Math.max(1, Number(item.quantity)),
      unit:            item.unit ?? 'Stk',
      price_expected:  item.price_expected != null ? Number(item.price_expected) : null,
      price_actual:    null,
      price_delta_pct: null,
      price_ok:        null,
    }))

    // 7. Create checkout_session row
    const sessionPayload: Record<string, unknown> = {
      company_id:          profile.company_id,
      supplier_id,
      initiated_by:        user.id,
      strategy,
      status:              'pending',
      status_message:      'Vorbereitung…',
      items:               normalizedItems,
      price_threshold_pct: Number(price_threshold_pct),
    }

    if (strategy === 'extension') {
      const raw = crypto.getRandomValues(new Uint8Array(32))
      const token = btoa(String.fromCharCode(...raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
      sessionPayload.extension_token      = token
      sessionPayload.extension_expires_at = new Date(Date.now() + 5 * 60_000).toISOString()
    }

    const { data: session, error: sessionErr } = await adminClient
      .from('checkout_sessions')
      .insert(sessionPayload)
      .select('id, strategy, extension_token, extension_expires_at')
      .single()

    if (sessionErr || !session) {
      console.error('[trigger-checkout] Session insert failed:', sessionErr)
      return respond({ error: 'Checkout-Session konnte nicht erstellt werden.' }, 500)
    }

    console.log(`[trigger-checkout] Session ${session.id} erstellt (strategy=${strategy})`)

    // 8. Strategy dispatch ─────────────────────────────────────────────────────

    if (strategy === 'cloud') {
      EdgeRuntime.waitUntil(
        runCloudAutomation({
          sessionId:         session.id,
          supplier,
          credentials,
          items:             normalizedItems,
          priceThresholdPct: Number(price_threshold_pct),
          adminClient,
        })
      )

      await adminClient
        .from('checkout_sessions')
        .update({ status: 'logging_in', status_message: 'Verbindung wird aufgebaut…' })
        .eq('id', session.id)

      return respond({ session_id: session.id, strategy: 'cloud', status: 'logging_in' })
    }

    return respond({
      session_id:           session.id,
      strategy:             'extension',
      extension_token:      session.extension_token,
      extension_expires_at: session.extension_expires_at,
      status:               'pending',
    })

  } catch (err) {
    console.error('[trigger-checkout] Fatal:', err)
    return respond({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

// ── Cloud automation via Browserless.io ───────────────────────────────────────

async function runCloudAutomation(params: {
  sessionId:         string
  supplier:          Record<string, unknown>
  credentials:       { loginUrl?: string; loginUsername?: string; loginPassword?: string }
  items:             CheckoutItem[]
  priceThresholdPct: number
  adminClient:       ReturnType<typeof createClient>
}): Promise<void> {
  const { sessionId, supplier, credentials, items, priceThresholdPct, adminClient } = params

  const patch = async (
    status: string,
    message: string,
    extra: Record<string, unknown> = {},
  ) => {
    const { error } = await adminClient
      .from('checkout_sessions')
      .update({ status, status_message: message, ...extra })
      .eq('id', sessionId)
    if (error) console.error('[cloud] DB patch error:', error)
  }

  try {
    if (!BROWSERLESS_TOKEN) {
      await patch('error', 'BROWSERLESS_TOKEN nicht konfiguriert.', {
        error_message: 'Missing BROWSERLESS_TOKEN env var',
      })
      return
    }

    const loginUrl = credentials.loginUrl ?? String(supplier.login_url ?? '')
    if (!loginUrl) {
      await patch('error', 'Keine Login-URL hinterlegt.', { error_message: 'No loginUrl' })
      return
    }

    const context = {
      sessionId,
      supabaseUrl:      SUPABASE_URL,
      serviceKey:       SUPABASE_SERVICE_KEY,
      selfHealUrl:      SELF_HEAL_URL,
      supplierId:       String(supplier.id),
      loginUrl,
      username:         credentials.loginUsername ?? '',
      password:         credentials.loginPassword ?? '',
      selectors:        (supplier.selectors as Record<string, string>) ?? {},
      items,
      priceThresholdPct,
    }

    console.log(`[cloud] Rufe Browserless für Session ${sessionId}`)

    const bRes = await fetch(
      `https://chrome.browserless.io/playwright?token=${BROWSERLESS_TOKEN}&stealth&blockAds`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: buildBrowserlessScript(), context }),
        signal: AbortSignal.timeout(90_000),
      }
    )

    if (!bRes.ok) {
      const text = await bRes.text()
      throw new Error(`Browserless HTTP ${bRes.status}: ${text.substring(0, 400)}`)
    }

    const result = await bRes.json().catch(() => ({}))
    console.log(`[cloud] Session ${sessionId} abgeschlossen:`, result)

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[cloud] Automation-Fehler:', msg)
    await patch('error', 'Automatisierung fehlgeschlagen.', { error_message: msg })
  }
}

// ── Utility ───────────────────────────────────────────────────────────────────

function respond(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}
