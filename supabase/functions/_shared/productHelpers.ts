export const PLACEHOLDER_UNKNOWN_EMAIL = 'hello@unbekannt.com'

const GENERIC_WEBMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'web.de',
  'gmx.de',
  'gmx.net',
  't-online.de',
  'outlook.com',
  'hotmail.com',
  'icloud.com',
  'yahoo.com',
  'unbekannt.com',
])

export function sanitizeSupplierEmail(email?: string | null): string | null {
  if (!email || typeof email !== 'string') return null
  const trimmed = email.trim()
  if (!trimmed || trimmed.toLowerCase() === PLACEHOLDER_UNKNOWN_EMAIL) return null
  return trimmed
}

/**
 * Bereinigt einen Produktnamen behutsam (Großhandels-Klassenkürzel & Leerzeichen),
 * OHNE Varianten, Sorten oder wichtige Details nach "-" oder "," abzuschneiden.
 */
export function cleanProductName(rawName: string): string {
  if (!rawName) return ''
  let s = rawName.replace(/\s+/g, ' ').trim()

  // Großhandels-Klassenkürzel wie "Kl.I CR", "HKL A", "-Kt: 200 St.-" am Rand entfernen
  s = s
    .replace(/\bKl\.?\s*(?:I{1,3}|1|2)\b(?:\s+[A-Z]{2,3})?/gi, '')
    .replace(/\b(?:HKL|Handelsklasse)\s*[A-Z1-3]+\b/gi, '')
    .replace(/\s+\b(?:CR|ES|IT|NL|FR|BE|GR|PL|TR|MA|PE|CL|ZA|BR|EC|WS)\b$/g, '')
    .replace(/[-–\s]*Kt:\s*\d+\s*St\.?[-–\s]*/gi, ' ')
    .replace(/\b1\s+(?:Stück|Stk\.?|Karton|Kasten|Packung|Pack|Beutel|Flasche|Rolle|Kanister)\b/gi, '')
    .replace(/\bStück\s+(ca\.\s*\d+[.,]?\d*\s*(?:kg|g|l|ml))\s+1\s*Stück\b/gi, '($1)')
    .replace(/\b(ca\.\s*\d+[.,]?\d*\s*(?:kg|g|l|ml))\s+1\s*Stück\b/gi, '($1)')

  // Führende Stückzahl wie "50 Stück Türschild Hotel" -> "Türschild Hotel (50 Stück)"
  const leadingCount = s.match(/^(\d+\s*(?:Stück|Stk\.?|x|er|Pack|Rollen))\s+(.{8,})$/i)
  if (leadingCount) {
    const countStr = leadingCount[1].trim()
    const rest = leadingCount[2].trim()
    if (!rest.includes(`(${countStr})`)) {
      s = `${rest} (${countStr})`
    }
  }

  s = s.replace(/\s{2,}/g, ' ').replace(/[,;:\-–|]+$/, '').trim()
  return s || rawName.trim()
}

/**
 * Erzeugt einen kompakten Suchbegriff ausschließlich für Suchmaschinen/Bing-Abfragen,
 * ohne den gespeicherten Produkt-Stammdatennamen zu verändern.
 */
export function toSearchQueryName(rawName: string): string {
  let s = cleanProductName(rawName).replace(/[×]/g, 'x')
  const dashParts = s.split(/\s+[-–|]\s+/)
  if (dashParts.length >= 2 && s.length > 55 && dashParts[0].trim().length >= 12) {
    s = dashParts[0].trim()
  }
  return s.replace(/\s{2,}/g, ' ').trim()
}

export function resolveSupplierDomainHint(supplierUrl?: string | null, supplierEmail?: string | null): string {
  if (supplierUrl && supplierUrl.trim()) {
    try {
      const normalized = /^https?:\/\//i.test(supplierUrl.trim()) ? supplierUrl.trim() : `https://${supplierUrl.trim()}`
      return new URL(normalized).hostname.replace(/^www\./i, '').toLowerCase()
    } catch {
      // ignore invalid url
    }
  }
  const cleanMail = sanitizeSupplierEmail(supplierEmail)
  if (cleanMail && cleanMail.includes('@')) {
    const dom = cleanMail.split('@')[1]?.trim().toLowerCase()
    if (dom && !GENERIC_WEBMAIL_DOMAINS.has(dom)) return dom
  }
  return ''
}

export function resolveWebshopDomain(options: {
  supplierUrl?: string | null
  supplierEmail?: string | null
  supplierOrderMethod?: string | null
  isWebshopFlag?: boolean
}): string {
  const { supplierUrl, supplierEmail, supplierOrderMethod, isWebshopFlag } = options
  if (supplierOrderMethod === 'email' || supplierOrderMethod === 'phone') {
    return ''
  }
  if (supplierUrl && supplierUrl.trim()) {
    const dom = resolveSupplierDomainHint(supplierUrl, null)
    if (dom && (isWebshopFlag || supplierOrderMethod === 'webshop' || supplierOrderMethod === 'link' || !!supplierUrl.trim())) {
      return dom
    }
  }
  if (isWebshopFlag || supplierOrderMethod === 'webshop' || supplierOrderMethod === 'link') {
    return resolveSupplierDomainHint(null, supplierEmail)
  }
  return ''
}

export function isDeepProductUrl(url?: string | null): boolean {
  if (!url || typeof url !== 'string' || !url.trim()) return false
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`)
    const p = u.pathname.toLowerCase()
    const cleanPath = p.replace(/^\/(de|en|de-de|de_de)?\/?$/i, '').trim()
    if (cleanPath.length <= 2) return false
    if (/^\/(index\.(html|php|asp)|home|startseite|default\.(html|aspx?))\/?$/i.test(cleanPath)) return false

    if (/(?:\/|^)(suche|search|catalogsearch|find|results|query|katalog|categories|kategorien)(?:\/|$)/i.test(p) || u.searchParams.has('q') || u.searchParams.has('k') || u.searchParams.has('query')) {
      return false
    }
    if (/(?:\/|^)(warenkorb|cart|basket|checkout|kasse|login|signin|anmelden|account|mein-konto|register|auth)(?:\/|$)/i.test(p)) {
      return false
    }
    if (/(?:\/|^)(progress-tracker|tracking|order-history|notification|widerruf|agb|impressum|datenschutz|hilfe|faq|kontakt)(?:\/|$)/i.test(p)) {
      return false
    }
    return true
  } catch {
    return false
  }
}

export function getEffectiveSupplierNoMinStock(supplier?: {
  default_no_min_stock?: boolean | null
  selectors?: Record<string, any> | null
} | null): boolean {
  if (!supplier) return false
  return !!(supplier.selectors?.defaultNoMinStock ?? supplier.default_no_min_stock ?? false)
}

export function computeSuggestedMinStock(options: {
  currentMinStock?: number | null
  aiMinStock?: number | null
  pastQuantitiesCount: number
  standardOrderQuantity: number
  supplierNoMinStock: boolean
}): number {
  const cur = Number(options.currentMinStock) || 0
  // Manueller Mindestbestand überschreibt immer die Lieferanten-Voreinstellung
  if (cur > 0) return cur
  if (options.supplierNoMinStock) return 0
  if (options.aiMinStock && Number(options.aiMinStock) > 0) {
    return Math.round(Number(options.aiMinStock))
  }
  if (options.pastQuantitiesCount >= 2) {
    return Math.max(1, Math.floor((Number(options.standardOrderQuantity) || 1) / 2))
  }
  return 0
}
