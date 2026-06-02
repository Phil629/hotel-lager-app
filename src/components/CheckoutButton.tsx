import React, { useEffect, useState } from 'react'
import { ShoppingCart, AlertTriangle, CheckCircle, X, ExternalLink, XCircle, Copy, Save } from 'lucide-react'
import {
  useCheckout,
  type CheckoutRequestItem,
  type CheckoutSession,
  type CheckoutStatus,
} from '../hooks/useCheckout'
import { getSupabaseClient } from '../services/supabase'

// ── CSS keyframes injected once at module load ────────────────────────────────

function injectAnimations() {
  if (document.getElementById('checkout-keyframes')) return
  const s = document.createElement('style')
  s.id = 'checkout-keyframes'
  s.textContent = `
    @keyframes ck-spin   { to { transform: rotate(360deg); } }
    @keyframes ck-bounce {
      0%, 100% { transform: translateY(0);    opacity: 1;   }
      50%       { transform: translateY(-5px); opacity: 0.3; }
    }
  `
  document.head.appendChild(s)
}
injectAnimations()

// ── Status metadata ───────────────────────────────────────────────────────────

const STATUS: Record<CheckoutStatus, { label: string; color: string; bg: string }> = {
  idle:        { label: 'Bereit',             color: '#64748b', bg: '#f1f5f9' },
  pending:     { label: 'Vorbereitung…',      color: '#d97706', bg: '#fef3c7' },
  logging_in:  { label: 'Melde an…',          color: '#d97706', bg: '#fef3c7' },
  searching:   { label: 'Suche Produkte…',    color: '#2563eb', bg: '#eff6ff' },
  adding:      { label: 'Befülle Warenkorb…', color: '#2563eb', bg: '#eff6ff' },
  price_check: { label: 'Prüfe Preise…',      color: '#7c3aed', bg: '#f5f3ff' },
  ready:       { label: 'Warenkorb bereit!',  color: '#16a34a', bg: '#f0fdf4' },
  error:       { label: 'Fehler',             color: '#dc2626', bg: '#fef2f2' },
  expired:     { label: 'Abgelaufen',         color: '#64748b', bg: '#f1f5f9' },
}

const ACTIVE_STATUSES: CheckoutStatus[] = [
  'pending', 'logging_in', 'searching', 'adding', 'price_check',
]

// ── Props ─────────────────────────────────────────────────────────────────────

interface CheckoutButtonProps {
  supplierId:         string
  supplierName:       string
  items:              CheckoutRequestItem[]
  priceThresholdPct?: number
  /** Called when user clicks "Jetzt bestellen" */
  onCartReady?:       (cartUrl: string) => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export const CheckoutButton: React.FC<CheckoutButtonProps> = ({
  supplierId,
  supplierName,
  items,
  priceThresholdPct = 5,
  onCartReady,
}) => {
  const { extensionAvailable, isActive, session, start, cancel, reset } = useCheckout({
    supplierId,
    items,
    priceThresholdPct,
  })

  const disabled    = items.length === 0 || isActive || session?.status === 'ready'
  const showOverlay = session !== null

  const handleStart = () => { start().catch(() => {}) }

  const handleOpenCart = () => {
    if (session?.cartUrl) {
      if (extensionAvailable) {
        window.postMessage({ type: 'HOTEL_CHECKOUT_FOCUS' }, window.location.origin)
      } else {
        window.open(session.cartUrl, '_blank', 'noopener,noreferrer')
      }
      onCartReady?.(session.cartUrl)
    }
  }

  // Lock body scroll while overlay is open
  useEffect(() => {
    if (showOverlay) document.body.style.overflow = 'hidden'
    else             document.body.style.overflow = ''
    return () => { document.body.style.overflow = '' }
  }, [showOverlay])

  return (
    <>
      {/* ── Trigger button ─────────────────────────────────────────────── */}
      <button
        onClick={handleStart}
        disabled={disabled}
        title={
          items.length === 0
            ? 'Keine Artikel ausgewählt'
            : `Warenkorb bei ${supplierName} automatisch befüllen`
        }
        style={{
          display:         'inline-flex',
          alignItems:      'center',
          gap:             '7px',
          padding:         '9px 16px',
          backgroundColor: isActive ? '#1d4ed8' : '#2563eb',
          color:           '#fff',
          border:          'none',
          borderRadius:    'var(--radius-md, 8px)',
          fontSize:        '14px',
          fontWeight:      600,
          cursor:          disabled ? 'not-allowed' : 'pointer',
          opacity:         disabled ? 0.6 : 1,
          transition:      'background-color 0.15s',
          position:        'relative',
          whiteSpace:      'nowrap',
        }}
      >
        {isActive ? <Spinner size={15} /> : <ShoppingCart size={15} />}
        {isActive ? 'Packt Warenkorb…' : 'Warenkorb packen'}

        {/* Amber dot: extension not available (cloud fallback will be used) */}
        {!extensionAvailable && !isActive && (
          <span
            title="Chrome Extension nicht installiert – Cloud-Fallback aktiv"
            style={{
              position:        'absolute',
              top:             '-5px',
              right:           '-5px',
              width:           '13px',
              height:          '13px',
              backgroundColor: '#f59e0b',
              borderRadius:    '50%',
              border:          '2px solid #fff',
              fontSize:        '8px',
              color:           '#fff',
              display:         'flex',
              alignItems:      'center',
              justifyContent:  'center',
              fontWeight:      900,
            }}
          >!</span>
        )}
      </button>

      {/* ── Status overlay ─────────────────────────────────────────────── */}
      {showOverlay && session && (
        <div
          onClick={(e) => {
            // Backdrop click closes only in terminal states
            if (
              e.target === e.currentTarget &&
              ['ready', 'error', 'expired'].includes(session.status)
            ) reset()
          }}
          style={{
            position:        'fixed',
            inset:           0,
            backgroundColor: 'rgba(15,23,42,0.5)',
            backdropFilter:  'blur(3px)',
            zIndex:          2000,
            display:         'flex',
            alignItems:      'center',
            justifyContent:  'center',
            padding:         '20px',
          }}
        >
          <div style={{
            backgroundColor: 'var(--color-surface, #fff)',
            borderRadius:    '16px',
            padding:         '28px',
            maxWidth:        '500px',
            width:           '100%',
            boxShadow:       '0 25px 60px rgba(0,0,0,0.3)',
          }}>
            <StatusPanel
              session={session}
              supplierId={supplierId}
              supplierName={supplierName}
              priceThresholdPct={priceThresholdPct}
              isActive={isActive}
              onOpenCart={handleOpenCart}
              onCancel={cancel}
              onClose={reset}
            />
          </div>
        </div>
      )}
    </>
  )
}

// ── Status Panel ──────────────────────────────────────────────────────────────

const StatusPanel: React.FC<{
  session:           CheckoutSession
  supplierId:        string
  supplierName:      string
  priceThresholdPct: number
  isActive:          boolean
  onOpenCart:        () => void
  onCancel:          () => void
  onClose:           () => void
}> = ({ session, supplierId, supplierName, priceThresholdPct, isActive, onOpenCart, onCancel, onClose }) => {
  const cfg      = STATUS[session.status] ?? STATUS.idle
  const [isReporting, setIsReporting] = React.useState(false);
  const [reportSuccess, setReportSuccess] = React.useState(false);

  const handleReportError = async () => {
    const confirmed = window.confirm(
      "Möchtest du diesen Fehler wirklich melden? Dadurch wird das gelernte KI-Gedächtnis (Selektoren) für diesen Shop zurückgesetzt und beim nächsten Mal frisch erlernt."
    );
    if (!confirmed) return;

    setIsReporting(true);
    try {
      const supabase = getSupabaseClient();
      if (supabase) {
        // Reset learned selectors for this supplier
        await supabase.from('suppliers').update({ selectors: {} }).eq('id', supplierId);
      }
      setReportSuccess(true);
      setTimeout(() => {
        onClose();
      }, 3000);
    } catch (e) {
      console.error(e);
    } finally {
      setIsReporting(false);
    }
  };
  const isReady  = session.status === 'ready'
  const isError  = session.status === 'error'
  const isDone   = isReady || isError || session.status === 'expired'
  const spinning = ACTIVE_STATUSES.includes(session.status)

  const fmtPct = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
        {/* Icon bubble */}
        <div style={{
          padding:         '11px',
          backgroundColor: cfg.bg,
          borderRadius:    '12px',
          flexShrink:      0,
          display:         'flex',
          alignItems:      'center',
          justifyContent:  'center',
        }}>
          {isReady  && <CheckCircle   size={22} color={cfg.color} />}
          {isError  && <AlertTriangle size={22} color={cfg.color} />}
          {!isReady && !isError && spinning && <Spinner size={22} color={cfg.color} />}
          {!isReady && !isError && !spinning && <ShoppingCart size={22} color={cfg.color} />}
        </div>

        {/* Title + live status */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '16px', color: 'var(--color-text-main, #0f172a)', lineHeight: 1.3 }}>
            {isReady ? '✅ Warenkorb bereit!' :
             isError ? '❌ Automatisierung fehlgeschlagen' :
                       `🛒 ${supplierName}`}
          </div>
          <div style={{ fontSize: '13px', color: cfg.color, marginTop: '4px', fontWeight: 500 }}>
            {session.statusMessage ?? cfg.label}
          </div>
        </div>

        {isDone && (
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: '2px', flexShrink: 0 }}
          >
            <X size={18} />
          </button>
        )}
      </div>

      {/* ── Price warning banner ────────────────────────────────────────── */}
      {isReady && session.priceWarning && (
        <div style={{
          display:         'flex',
          gap:             '10px',
          alignItems:      'flex-start',
          backgroundColor: '#fef3c7',
          border:          '1px solid #fcd34d',
          borderRadius:    '10px',
          padding:         '12px 14px',
        }}>
          <AlertTriangle size={18} color="#d97706" style={{ flexShrink: 0, marginTop: '1px' }} />
          <div style={{ fontSize: '13px', color: '#92400e', lineHeight: 1.55 }}>
            <strong>Preisabweichung erkannt!</strong> Mindestens ein Artikel weicht um mehr als{' '}
            {priceThresholdPct}% vom erwarteten Preis ab
            {session.priceDeviationPct != null && ` (max. ${fmtPct(session.priceDeviationPct)})`}.
            {' '}Bitte prüfe die markierten Artikel vor dem Bestellen.
          </div>
        </div>
      )}

      {/* ── Error detail ─────────────────────────────────────────────────── */}
      {isError && session.errorMessage && (
        <div style={{
          backgroundColor: '#fef2f2',
          border:          '1px solid #fecaca',
          borderRadius:    '10px',
          padding:         '12px 14px',
          fontSize:        '13px',
          color:           '#991b1b',
          lineHeight:      1.55,
        }}>
          {session.errorMessage}
        </div>
      )}

      {/* ── Item list ────────────────────────────────────────────────────── */}
      {session.items.length > 0 && (
        <div style={{
          border:       '1px solid var(--color-border, #e2e8f0)',
          borderRadius: '10px',
          overflow:     'hidden',
        }}>
          <div style={{
            padding:         '7px 14px',
            backgroundColor: 'var(--color-surface-elevated, #f8fafc)',
            borderBottom:    '1px solid var(--color-border, #e2e8f0)',
            fontSize:        '11px',
            fontWeight:      700,
            color:           'var(--color-text-muted, #64748b)',
            textTransform:   'uppercase',
            letterSpacing:   '0.07em',
          }}>
            Artikel ({session.items.length})
          </div>
          <div style={{ maxHeight: '240px', overflowY: 'auto' }}>
            {session.items.map((item, i) => (
              <ItemRow
                key={i}
                item={item}
                spinning={spinning}
                priceThresholdPct={priceThresholdPct}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Loading dots (before items arrive) ───────────────────────────── */}
      {spinning && session.items.length === 0 && (
        <div style={{ display: 'flex', gap: '7px', justifyContent: 'center', padding: '6px 0' }}>
          {[0, 1, 2].map(i => (
            <div
              key={i}
              style={{
                width:           '9px',
                height:          '9px',
                borderRadius:    '50%',
                backgroundColor: '#2563eb',
                animation:       `ck-bounce 1.1s ease-in-out ${i * 0.18}s infinite`,
              }}
            />
          ))}
        </div>
      )}

      {/* ── Actions ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '10px' }}>
        {isReady && session.cartUrl && (
          <button
            onClick={onOpenCart}
            style={{
              flex:            1,
              padding:         '12px',
              backgroundColor: session.priceWarning ? '#d97706' : '#16a34a',
              color:           '#fff',
              border:          'none',
              borderRadius:    '9px',
              fontSize:        '14px',
              fontWeight:      700,
              cursor:          'pointer',
              display:         'flex',
              alignItems:      'center',
              justifyContent:  'center',
              gap:             '8px',
              transition:      'opacity 0.15s',
            }}
            onMouseOver={e => (e.currentTarget.style.opacity = '0.88')}
            onMouseOut={e  => (e.currentTarget.style.opacity = '1')}
          >
            <ExternalLink size={16} />
            {session.priceWarning ? 'Trotzdem zum Warenkorb →' : 'Warenkorb öffnen →'}
          </button>
        )}

        {isReady && !reportSuccess && (
          <button
            onClick={handleReportError}
            disabled={isReporting}
            style={{
              padding:         '12px 16px',
              backgroundColor: 'var(--color-surface-elevated, #f1f5f9)',
              color:           '#64748b',
              border:          '1px solid var(--color-border, #e2e8f0)',
              borderRadius:    '9px',
              fontSize:        '13px',
              fontWeight:      600,
              cursor:          isReporting ? 'wait' : 'pointer',
              display:         'flex',
              alignItems:      'center',
              justifyContent:  'center',
              gap:             '6px',
              opacity:         isReporting ? 0.7 : 1,
            }}
          >
            {isReporting ? 'Melde...' : 'Fehler melden'}
          </button>
        )}

        {reportSuccess && (
          <div style={{ padding: '10px', fontSize: '13px', color: '#16a34a', fontWeight: 600, flex: 1, textAlign: 'center', border: '1px solid #bbf7d0', borderRadius: '9px', backgroundColor: '#f0fdf4' }}>
            Erfolgreich gemeldet! KI-Gedächtnis gelöscht.
          </div>
        )}

        {isActive && (
          <button
            onClick={onCancel}
            style={{
              flex:            isReady ? 'none' : 1,
              padding:         '12px 20px',
              backgroundColor: 'var(--color-surface-elevated, #f1f5f9)',
              color:           'var(--color-text-muted, #64748b)',
              border:          '1px solid var(--color-border, #e2e8f0)',
              borderRadius:    '9px',
              fontSize:        '13px',
              fontWeight:      600,
              cursor:          'pointer',
            }}
          >
            Abbrechen
          </button>
        )}

        {isDone && !isReady && (
          <button
            onClick={onClose}
            style={{
              flex:            1,
              padding:         '12px',
              backgroundColor: 'var(--color-surface-elevated, #f1f5f9)',
              color:           'var(--color-text-main, #0f172a)',
              border:          '1px solid var(--color-border, #e2e8f0)',
              borderRadius:    '9px',
              fontSize:        '13px',
              fontWeight:      600,
              cursor:          'pointer',
            }}
          >
            Schließen
          </button>
        )}
      </div>
    </div>
  )
}

// ── Item Row ──────────────────────────────────────────────────────────────────────────────

const ItemRow: React.FC<{
  item:              CheckoutSession['items'][0]
  spinning:          boolean
  priceThresholdPct: number
}> = ({ item, spinning }) => {
  const hasPriceData = item.price_actual != null && item.price_actual > 0
  const isError      = item.status === 'error'
  const isWarn       = item.price_ok === false && !isError
  const isOk         = item.price_ok === true && !isError
  const isPending    = item.price_ok === null && !isError

  const [directLink, setDirectLink] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const handleSaveLink = async () => {
    if (!directLink || !item.product_id) return
    setIsSaving(true)
    try {
      const supabase = getSupabaseClient()
      if (!supabase) throw new Error('Supabase Client nicht verfügbar')
      
      // URL validation / auto-protocol
      let finalUrl = directLink.trim()
      if (finalUrl && !/^https?:\/\//i.test(finalUrl)) {
        finalUrl = 'https://' + finalUrl
      }
      await supabase.from('products').update({ order_url: finalUrl }).eq('id', item.product_id)
      setSaveSuccess(true)
    } catch (err) {
      console.error('Failed to save link', err)
    } finally {
      setIsSaving(false)
    }
  }

  const fmtPrice = (v: number | null | undefined) => {
    if (v == null) return '-'
    return Number(v).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
  }

  const fmtDelta = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`

  return (
    <div style={{
      borderBottom:    '1px solid var(--color-border, #e2e8f0)',
      backgroundColor: isError ? '#fef2f2' : (isWarn ? '#fffbeb' : 'transparent'),
      transition:      'background-color 0.4s',
      padding:         '10px 14px',
      display:         'flex',
      flexDirection:   'column',
      gap:             '10px',
    }}>
      <div style={{
        display:         'flex',
        alignItems:      'center',
        gap:             '10px',
      }}>
        {/* State icon */}
        <div style={{ width: '18px', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
          {isError && <XCircle size={15} color="#dc2626" />}
          {isOk  && <CheckCircle   size={15} color="#16a34a" />}
          {isWarn && <AlertTriangle size={15} color="#d97706" />}
          {isPending && spinning && <Spinner size={13} color="#94a3b8" />}
          {isPending && !spinning && (
            <div style={{ width: 11, height: 11, borderRadius: '50%', backgroundColor: '#e2e8f0' }} />
          )}
        </div>

        {/* Name + qty */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{
              fontSize:     '13px',
              fontWeight:   600,
              color:        isError ? '#991b1b' : 'var(--color-text-main, #0f172a)',
              whiteSpace:   'nowrap',
              overflow:     'hidden',
              textOverflow: 'ellipsis',
            }}>
              {item.product_name}
            </div>
            {isError && (
              <button
                onClick={() => navigator.clipboard.writeText(item.product_name)}
                title="Produktname kopieren"
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center', color: '#991b1b', opacity: 0.7
                }}
                onMouseOver={e => e.currentTarget.style.opacity = '1'}
                onMouseOut={e => e.currentTarget.style.opacity = '0.7'}
              >
                <Copy size={13} />
              </button>
            )}
          </div>
          <div style={{ fontSize: '12px', color: isError ? '#b91c1c' : 'var(--color-text-muted, #64748b)', marginTop: '1px' }}>
            {item.quantity} {item.unit}
            {item.price_expected != null && (
              <span style={{ marginLeft: '6px' }}>• erw. {fmtPrice(item.price_expected)}</span>
            )}
          </div>
        </div>

        {/* Actual price + delta */}
        {hasPriceData && (
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: isWarn ? '#d97706' : '#16a34a' }}>
              {fmtPrice(item.price_actual!)}
            </div>
            {item.price_delta_pct !== null && (
              <div style={{ fontSize: '11px', fontWeight: 600, color: isWarn ? '#d97706' : '#64748b' }}>
                {fmtDelta(item.price_delta_pct)}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Fallback Error UI */}
      {isError && (
        <div style={{
          marginLeft: '28px',
          padding: '10px',
          backgroundColor: '#fee2e2',
          borderRadius: '6px',
          border: '1px solid #fca5a5',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px'
        }}>
          <div style={{ fontSize: '12px', color: '#991b1b', fontWeight: 500 }}>
            Das Produkt konnte nicht automatisch gefunden werden. Bitte kopiere oben den Namen, suche es manuell im Shop und füge hier den direkten Produkt-Link ein:
          </div>
          {saveSuccess ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#16a34a', fontSize: '13px', fontWeight: 600 }}>
              <CheckCircle size={14} /> Link erfolgreich für die nächste Bestellung gespeichert!
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '6px' }}>
              <input
                type="url"
                placeholder="https://..."
                value={directLink}
                onChange={e => setDirectLink(e.target.value)}
                style={{
                  flex: 1,
                  padding: '6px 10px',
                  fontSize: '12px',
                  borderRadius: '4px',
                  border: '1px solid #f87171',
                  outline: 'none',
                  backgroundColor: '#fff'
                }}
                onKeyDown={e => { if (e.key === 'Enter') handleSaveLink() }}
              />
              <button
                onClick={handleSaveLink}
                disabled={!directLink || isSaving}
                style={{
                  padding: '6px 12px',
                  backgroundColor: '#dc2626',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: directLink && !isSaving ? 'pointer' : 'not-allowed',
                  opacity: directLink && !isSaving ? 1 : 0.6,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                {isSaving ? <Spinner size={12} color="#fff" /> : <Save size={12} />}
                Speichern
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Spinner ───────────────────────────────────────────────────────────────────

const Spinner: React.FC<{ size?: number; color?: string }> = ({
  size  = 16,
  color = 'currentColor',
}) => (
  <div
    style={{
      width:          size,
      height:         size,
      borderRadius:   '50%',
      border:         `2px solid ${color}30`,
      borderTopColor: color,
      animation:      'ck-spin 0.7s linear infinite',
      flexShrink:     0,
    }}
  />
)
