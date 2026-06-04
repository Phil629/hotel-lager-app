import { useState, useEffect, useRef, useCallback } from 'react'
import { getSupabaseClient } from '../services/supabase'

// ── Types ─────────────────────────────────────────────────────────────────────

export type CheckoutStatus =
  | 'idle' | 'pending' | 'logging_in' | 'searching'
  | 'adding' | 'price_check' | 'ready' | 'error' | 'expired'

export interface CheckoutLineItem {
  product_id:      string | null
  product_name:    string
  quantity:        number
  unit:            string
  price_expected:  number | null
  price_actual:    number | null
  price_delta_pct: number | null
  price_ok:        boolean | null
}

export interface CheckoutSession {
  id:                string
  status:            CheckoutStatus
  statusMessage:     string | null
  items:             CheckoutLineItem[]
  priceWarning:      boolean
  priceDeviationPct: number | null
  cartUrl:           string | null
  errorMessage:      string | null
}

export interface CheckoutRequestItem {
  product_id?:     string
  product_name:    string
  quantity:        number
  unit?:           string
  price_expected?: number
}

interface UseCheckoutOptions {
  supplierId:         string
  items:              CheckoutRequestItem[]
  priceThresholdPct?: number
}

export interface UseCheckoutReturn {
  extensionAvailable: boolean
  isActive:           boolean
  session:            CheckoutSession | null
  start:              () => Promise<void>
  cancel:             () => void
  reset:              () => void
}

// ── Extension detection (module-level singleton) ──────────────────────────────
// Cached so any number of CheckoutButton instances share one detection run.

let _detectionResult:  boolean | null       = null
let _detectionPromise: Promise<boolean> | null = null

function detectExtension(timeoutMs = 1500): Promise<boolean> {
  if (_detectionResult !== null) return Promise.resolve(_detectionResult)
  if (_detectionPromise)         return _detectionPromise

  _detectionPromise = new Promise<boolean>((resolve) => {
    function cleanup(found: boolean) {
      window.removeEventListener('message', onMessage)
      clearTimeout(timer)
      _detectionResult = found
      resolve(found)
    }

    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return
      if (e.data?.type === 'HOTEL_CHECKOUT_EXTENSION_READY') cleanup(true)
    }

    window.addEventListener('message', onMessage)

    // Ping the content script — webapp-bridge.js responds with EXTENSION_READY
    window.postMessage({ type: 'HOTEL_CHECKOUT_PING' }, window.location.origin)

    const timer = setTimeout(() => cleanup(false), timeoutMs)
  })

  return _detectionPromise
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useCheckout({
  supplierId,
  items,
  priceThresholdPct = 5,
}: UseCheckoutOptions): UseCheckoutReturn {
  const supabase = getSupabaseClient()

  const [extensionAvailable, setExtensionAvailable] = useState(false)
  const [isActive, setIsActive]                     = useState(false)
  const [session,  setSession]                      = useState<CheckoutSession | null>(null)

  const channelRef = useRef<ReturnType<NonNullable<typeof supabase>['channel']> | null>(null)

  // ── Detect extension on mount ─────────────────────────────────────────────

  useEffect(() => {
    detectExtension().then(setExtensionAvailable)

    // Also catch the event if the content script fires it after mount
    function onExtensionReady(e: MessageEvent) {
      if (e.origin !== window.location.origin) return
      if (e.data?.type === 'HOTEL_CHECKOUT_EXTENSION_READY') setExtensionAvailable(true)
    }
    window.addEventListener('message', onExtensionReady)
    return () => window.removeEventListener('message', onExtensionReady)
  }, [])

  // ── Cleanup channel on unmount ────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (channelRef.current && supabase) supabase.removeChannel(channelRef.current)
    }
  }, [supabase])

  // ── Realtime subscription ─────────────────────────────────────────────────

  const subscribeToSession = useCallback((sessionId: string) => {
    if (!supabase) return

    if (channelRef.current) supabase.removeChannel(channelRef.current)

    channelRef.current = supabase
      .channel(`checkout_${sessionId}`)
      .on(
        'postgres_changes',
        {
          event:  'UPDATE',
          schema: 'public',
          table:  'checkout_sessions',
          filter: `id=eq.${sessionId}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown>

          setSession({
            id:                row.id as string,
            status:            row.status as CheckoutStatus,
            statusMessage:     (row.status_message as string) ?? null,
            items:             (row.items as CheckoutLineItem[]) ?? [],
            priceWarning:      (row.price_warning as boolean) ?? false,
            priceDeviationPct: (row.price_deviation_pct as number) ?? null,
            cartUrl:           (row.cart_url as string) ?? null,
            errorMessage:      (row.error_message as string) ?? null,
          })

          if (['ready', 'error', 'expired'].includes(row.status as string)) {
            setIsActive(false)
          }
        }
      )
      .subscribe()
  }, [supabase])

  // ── start() ───────────────────────────────────────────────────────────────

  const start = useCallback(async () => {
    if (!supabase || isActive) return

    setIsActive(true)
    setSession(null)

    try {
      // 1. Call trigger-checkout — determines strategy, creates session row
      const { data, error } = await supabase.functions.invoke('trigger-checkout', {
        body: {
          supplier_id:        supplierId,
          items,
          price_threshold_pct: priceThresholdPct,
        },
      })

      if (error) throw new Error(error.message ?? JSON.stringify(error))
      if (data?.code === 'MFA_INCOMPATIBLE') throw new Error(data.error)

      const {
        session_id,
        strategy,
        extension_token,
      } = data as {
        session_id:       string
        strategy:         'cloud' | 'extension'
        extension_token?: string
        status:           string
      }

      // 2. Optimistic local state — shown before first Realtime event arrives
      setSession({
        id:                session_id,
        status:            (data.status ?? 'pending') as CheckoutStatus,
        statusMessage:     'Vorbereitung…',
        items:             items.map(i => ({
          product_id:      i.product_id ?? null,
          product_name:    i.product_name,
          quantity:        i.quantity,
          unit:            i.unit ?? 'Stk',
          price_expected:  i.price_expected ?? null,
          price_actual:    null,
          price_delta_pct: null,
          price_ok:        null,
        })),
        priceWarning:      false,
        priceDeviationPct: null,
        cartUrl:           null,
        errorMessage:      null,
      })

      // 3. Subscribe to Realtime for live status updates (both strategies update DB)
      subscribeToSession(session_id)

      // 4. Extension strategy: send full payload to Chrome Extension
      if (strategy === 'extension') {
        if (!extensionAvailable) {
          throw new Error(
            'Die Chrome Extension ist nicht installiert. ' +
            'Bitte installiere sie und versuche es erneut. ' +
            '(Alternativ: Lieferant auf Cloud-Strategie umstellen)'
          )
        }

        // Decrypt credentials server-side (SECURITY DEFINER RPC, vault)
        const { data: creds } = await supabase.rpc('get_supplier_credentials', {
          p_supplier_id: supplierId,
        })

        // Load selectors and loginUrl for this supplier
        const { data: supplierRow } = await supabase
          .from('suppliers')
          .select('login_url, selectors')
          .eq('id', supplierId)
          .single()

        // Current session JWT — used by extension for authenticated Supabase REST calls
        const { data: { session: authSession } } = await supabase.auth.getSession()
        if (!authSession?.access_token) throw new Error('Keine aktive Sitzung.')

        window.postMessage(
          {
            type: 'HOTEL_CHECKOUT_START',
            payload: {
              sessionId:       session_id,
              extensionToken:  extension_token,
              supabaseUrl:     import.meta.env.VITE_SUPABASE_URL  as string,
              supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
              userJwt:         authSession.access_token,
              selfHealUrl:     `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/self-heal-selector`,
              supplierId,
              loginUrl:        creds?.login_url  ?? supplierRow?.login_url  ?? '',
              username:        creds?.login_username ?? '',
              password:        creds?.login_password ?? '',
              selectors:       supplierRow?.selectors ?? {},
              items,
              priceThresholdPct,
            },
          },
          window.location.origin
        )
      }
      // Cloud: Browserless is already running — Realtime carries all further updates.

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setSession(prev =>
        prev
          ? { ...prev, status: 'error', statusMessage: msg, errorMessage: msg }
          : {
              id: '', status: 'error', statusMessage: msg, errorMessage: msg,
              items: [], priceWarning: false, priceDeviationPct: null, cartUrl: null,
            }
      )
      setIsActive(false)
    }
  }, [supabase, supplierId, items, priceThresholdPct, isActive, extensionAvailable, subscribeToSession])

  // ── cancel() ──────────────────────────────────────────────────────────────

  const cancel = useCallback(async () => {
    if (session?.id && supabase) {
      await supabase
        .from('checkout_sessions')
        .update({ status: 'expired', status_message: 'Vom Nutzer abgebrochen.' })
        .eq('id', session.id)
    }
    if (channelRef.current && supabase) {
      supabase.removeChannel(channelRef.current)
      channelRef.current = null
    }
    setIsActive(false)
    setSession(null)
  }, [session, supabase])

  // ── reset() ───────────────────────────────────────────────────────────────

  const reset = useCallback(() => {
    if (channelRef.current && supabase) {
      supabase.removeChannel(channelRef.current)
      channelRef.current = null
    }
    setIsActive(false)
    setSession(null)
  }, [supabase])

  return { extensionAvailable, isActive, session, start, cancel, reset }
}
