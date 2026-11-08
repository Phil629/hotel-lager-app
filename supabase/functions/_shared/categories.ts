export const STANDARD_CATEGORIES = [
  'Lebensmittel',
  'Getränke',
  'Reinigung',
  'Hygiene',
  'Bürobedarf',
  'Instandhaltung',
  'Hotel & Gastro',
  'Sonstiges',
] as const

export function normalizeCategory(rawCat?: string | null, customAllowed: string[] = []): string {
  if (!rawCat || typeof rawCat !== 'string') return ''
  const c = rawCat.trim()
  const lower = c.toLowerCase()

  // 1. Wenn das Hotel selbst eine Kategorie angelegt hat, exakt beibehalten
  const matchedCustom = customAllowed.find((ca) => ca && ca.trim().toLowerCase() === lower)
  if (matchedCustom) return matchedCustom.trim()

  // 2. Bekannte Synonyme auf Standard-Kategorien normalisieren
  if (lower === 'büro' || lower === 'büroartikel' || lower === 'schreibwaren' || lower === 'office' || lower === 'büro & verwaltung') return 'Bürobedarf'
  if (lower === 'reinigungsmittel' || lower === 'putzmittel' || lower === 'cleaning') return 'Reinigung'
  if (lower === 'hygieneartikel' || lower === 'drogerie' || lower === 'körperpflege' || lower === 'hygiene & sanitär') return 'Hygiene'
  if (lower === 'technik' || lower === 'reparatur' || lower === 'ersatzteile' || lower === 'werkzeug' || lower === 'wasserfilter' || lower === 'sanitär' || lower === 'instandhaltung & technik') return 'Instandhaltung'
  if (lower === 'hotelbedarf' || lower === 'gastronomiebedarf' || lower === 'gastronomie' || lower === 'gastro' || lower === 'geschirr' || lower === 'porzellan' || lower === 'tischwäsche' || lower === 'zimmerausstattung' || lower === 'rezeption & lobby') return 'Hotel & Gastro'
  if (lower === 'speisen' || lower === 'frühstück' || lower === 'food' || lower === 'frühstück & küche') return 'Lebensmittel'
  if (lower === 'drinks' || lower === 'beverages' || lower === 'getränke & minibar') return 'Getränke'
  if (lower === 'ohne kategorie' || lower === 'importiert' || lower === 'ki-import' || lower === 'keine') return ''

  const matched = STANDARD_CATEGORIES.find((v) => v.toLowerCase() === lower)
  return matched || c
}
