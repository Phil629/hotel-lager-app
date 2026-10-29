import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { encode } from "https://deno.land/std@0.168.0/encoding/base64.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

// Initialisiere Supabase Client
const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

async function callGeminiJson(geminiParts: any[], totalBudgetMs = 110_000): Promise<{
  ok: boolean;
  parsedData: any;
  apiErrorData: any;
  rawText: string;
}> {
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent?key=${GEMINI_API_KEY}`
  const geminiBody = JSON.stringify({
    contents: [{ parts: geminiParts }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json"
    }
  })

  // Starte mit gemini-flash-lite-latest (antwortet in ~3-4 Sek. ohne Thinking-Verzögerung), danach Fallbacks
  const GEMINI_MODELS = [
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${GEMINI_API_KEY}`,
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${GEMINI_API_KEY}`,
    geminiUrl,
  ]
  const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504])
  const MAX_ATTEMPTS_PER_MODEL = 2
  const PER_ATTEMPT_TIMEOUT_MS = 18_000
  const startedAt = Date.now()
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

  let geminiRes: Response | null = null
  let geminiData: any = null

  modelLoop:
  for (let m = 0; m < GEMINI_MODELS.length; m++) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_MODEL; attempt++) {
      const remaining = totalBudgetMs - (Date.now() - startedAt)
      if (remaining < 4_000) break modelLoop

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), Math.min(PER_ATTEMPT_TIMEOUT_MS, remaining))
      let retryAfterMs = 0
      try {
        geminiRes = await fetch(GEMINI_MODELS[m], {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: geminiBody,
          signal: controller.signal,
        })
        geminiData = await geminiRes.json().catch(() => ({ error: { code: geminiRes!.status, message: 'Invalid JSON from Gemini' } }))

        if (geminiRes.ok && geminiData?.candidates?.length) break modelLoop
        if (!RETRYABLE_STATUS.has(geminiRes.status) && geminiRes.ok) {
          break modelLoop
        }
        if (!geminiRes.ok && !RETRYABLE_STATUS.has(geminiRes.status)) {
          if (geminiRes.status === 404) continue modelLoop
          break modelLoop
        }
        if (geminiRes.status === 429) {
          const errText = JSON.stringify(geminiData)
          const delayMatch = errText.match(/"retryDelay":"(\d+)s"/)
          const retryDelaySec = delayMatch ? Number(delayMatch[1]) : 0
          if (/PerDay|FreeTier|quota/i.test(errText) || retryDelaySec > 30) {
            console.warn(`Gemini model #${m + 1}: quota exhausted (retryDelay ${retryDelaySec}s) – switching model`)
            continue modelLoop
          }
        }
        const ra = Number(geminiRes.headers.get('retry-after'))
        if (Number.isFinite(ra) && ra > 0) retryAfterMs = ra * 1000
        if (retryAfterMs > 30_000) continue modelLoop
        console.warn(`Gemini model #${m + 1} attempt ${attempt} failed with ${geminiRes.status}, retrying...`)
      } catch (err) {
        console.warn(`Gemini model #${m + 1} attempt ${attempt} network/timeout error:`, String(err))
        geminiRes = null
        geminiData = { error: { code: 504, message: `Network/timeout error: ${String(err)}` } }
      } finally {
        clearTimeout(timer)
      }

      if (attempt < MAX_ATTEMPTS_PER_MODEL) {
        const backoff = Math.max(retryAfterMs, 1000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 400)
        const remainingAfter = totalBudgetMs - (Date.now() - startedAt)
        if (backoff > remainingAfter - 4_000) break
        await sleep(backoff)
      }
    }
  }

  const geminiOk = !!(geminiRes?.ok && geminiData?.candidates?.length)
  console.log("Raw Gemini API response snippet:", JSON.stringify(geminiData).substring(0, 500))

  if (!geminiOk) {
    return {
      ok: false,
      parsedData: {
        parse_error: "Gemini API HTTP Error",
        raw_text: JSON.stringify(geminiData)
      },
      apiErrorData: geminiData,
      rawText: JSON.stringify(geminiData),
    }
  }

  let extractedJsonText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '{}'
  extractedJsonText = extractedJsonText.replace(/```json/g, '').replace(/```/g, '').trim()

  try {
    const parsedData = JSON.parse(extractedJsonText)
    return { ok: true, parsedData, apiErrorData: null, rawText: extractedJsonText }
  } catch (e) {
    console.error("Error parsing JSON from Gemini:", e)
    return {
      ok: false,
      parsedData: {
        parse_error: String(e),
        raw_text: extractedJsonText
      },
      apiErrorData: null,
      rawText: extractedJsonText,
    }
  }
}

// =====================================================================
// HILFSFUNKTIONEN FÜR BILD-, LINK- & DATEN-VERVOLLSTÄNDIGUNG
// =====================================================================
const SUPPLIER_DOMAIN_HINTS: Record<string, string> = {
  'amazon business': 'amazon.de',
  'amazon': 'amazon.de',
  'böttcher ag': 'bueromarkt-ag.de',
  'böttcher': 'bueromarkt-ag.de',
  'hygi.de': 'hygi.de',
  'hygi': 'hygi.de',
  'reinigungsberater': 'reinigungsberater.de',
  'lusini': 'lusini.com',
  'papstar': 'papstar.de',
  'ronnefeldt': 'ronnefeldt.com',
  'coffee perfect': 'coffee-perfect.de',
  'porzellantreff': 'porzellantreff.de',
  'deutsche post': 'shop.deutschepost.de',
  'ada cosmetics': 'ada-cosmetics.com',
  'eofficeshop': 'eofficeshop.de',
  'tecserv': 'eofficeshop.de',
  'gottron': 'gottron-hygiene.de',
  'hamburgpapier': 'hamburgpapier-shop.de',
  'kaeferling': 'kaeferlingpro.com',
  'zoells': 'zoells.de',
  'cent direktvertrieb': 'cent-online.de',
  'fixpart': 'fixpart.de',
  'faironto': 'faironto.com',
  'google cloud': 'cloud.google.com',
  'hewo': 'hewo-mainz.de',
  'schwälbchen': 'schwaelbchen-frischdienst.de',
  'schwaelbchen': 'schwaelbchen-frischdienst.de'
}

const EMAIL_ONLY_SUPPLIER_KEYWORDS = [
  'hewo',
  'schwälbchen',
  'schwaelbchen',
  'frischdienst',
  'getränke-vertrieb',
  'getraenke-vertrieb',
  'wäscherei',
  'waescherei',
  'bäckerei',
  'baeckerei',
  'metzgerei'
]

const isEmailOnlyWholesaler = (supplierName?: string, supplierEmail?: string): boolean => {
  const lower = `${supplierName || ''} ${supplierEmail || ''}`.toLowerCase()
  return EMAIL_ONLY_SUPPLIER_KEYWORDS.some(k => lower.includes(k))
}

const cleanProductName = (rawName: string): string => {
  if (!rawName) return ''
  let s = rawName.replace(/\s+/g, ' ').trim()

  // 1. Großhandels-Zusätze wie "Kl.I CR", "Kl. I", "HKL A", "1 Stück" am Ende bereinigen
  s = s
    .replace(/\bKl\.?\s*(?:I{1,3}|1|2)\b(?:\s+[A-Z]{2,3})?/gi, '')
    .replace(/\b(?:HKL|Handelsklasse)\s*[A-Z1-3]+\b/gi, '')
    .replace(/\s+\b(?:CR|ES|IT|NL|FR|BE|GR|PL|TR|MA|PE|CL|ZA|BR|EC|WS)\b$/g, '')
    .replace(/[-–\s]*Kt:\s*\d+\s*St\.?[-–\s]*/gi, ' ')
    .replace(/\b1\s+(?:Stück|Stk\.?|Karton|Kasten|Packung|Pack|Beutel|Flasche|Rolle|Kanister)\b/gi, '')
    .replace(/\bStück\s+(ca\.\s*\d+[.,]?\d*\s*(?:kg|g|l|ml))\s+1\s*Stück\b/gi, '($1)')
    .replace(/\b(ca\.\s*\d+[.,]?\d*\s*(?:kg|g|l|ml))\s+1\s*Stück\b/gi, '($1)')

  // 2. Überlange Amazon-/Webshop-SEO-Titel am Bindestrich " - " / " – " / " | " sinnvoll kürzen
  const dashParts = s.split(/\s+[-–|]\s+/)
  if (dashParts.length >= 2 && s.length > 48) {
    const first = dashParts[0].trim()
    const second = dashParts[1].trim()
    // Falls im zweiten Teil eine wichtige Stückzahl wie "30x ..." steht, diese in Klammern retten
    const countMatch = second.match(/\b(\d+\s*(?:x|Stück|Stk\.?|er\s*Pack|Rollen|Blatt))\b/i)
    if (first.length >= 12) {
      s = countMatch && !first.toLowerCase().includes(countMatch[1].toLowerCase())
        ? `${first} (${countMatch[1]})`
        : first
    }
  }

  // 3. Falls noch ein langer Komma-SEO-Schweif anhängt (ab > 55 Zeichen)
  if (s.length > 55 && s.includes(', ')) {
    const commaParts = s.split(', ')
    if (commaParts[0].length >= 15) {
      s = commaParts[0].trim()
    }
  }

  // 4. Führende Stückzahl wie "50 Stück Türschild Hotel Bitte nicht stören" -> "Türschild Hotel Bitte nicht stören (50 Stück)"
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

const resolveSupplierDomainHint = (supplierName?: string, supplierUrl?: string, supplierEmail?: string): string => {
  if (supplierUrl) {
    try {
      const u = new URL(supplierUrl.startsWith('http') ? supplierUrl : `https://${supplierUrl}`)
      return u.hostname.replace(/^www\./i, '').toLowerCase()
    } catch {}
  }
  const lowerSup = (supplierName || '').toLowerCase().trim()
  for (const [k, dom] of Object.entries(SUPPLIER_DOMAIN_HINTS)) {
    if (lowerSup.includes(k)) return dom
  }
  if (supplierEmail && supplierEmail.includes('@') && supplierEmail !== 'hello@unbekannt.com') {
    const dom = supplierEmail.split('@')[1]?.trim().toLowerCase()
    const generic = new Set(['gmail.com', 'googlemail.com', 'web.de', 'gmx.de', 'gmx.net', 't-online.de', 'outlook.com', 'hotmail.com', 'icloud.com', 'yahoo.com'])
    if (dom && !generic.has(dom)) return dom
  }
  return ''
}

const resolveWebshopDomain = (supplierName?: string, supplierUrl?: string, isWebshopMethod?: boolean, supplierEmail?: string): string => {
  if (isEmailOnlyWholesaler(supplierName, supplierEmail)) return ''
  const lowerSup = (supplierName || '').toLowerCase().trim()
  for (const [k, dom] of Object.entries(SUPPLIER_DOMAIN_HINTS)) {
    if (lowerSup.includes(k)) return dom
  }
  if (supplierUrl) {
    try {
      const u = new URL(supplierUrl.startsWith('http') ? supplierUrl : `https://${supplierUrl}`)
      const host = u.hostname.replace(/^www\./i, '').toLowerCase()
      if (isWebshopMethod || /shop\.|store\.|bueromarkt|amazon|hygi|lusini|papstar|kaeferling|eofficeshop|gottron|hamburgpapier|zoells|porzellantreff|reinigungsberater|ada-cosmetics|ronnefeldt|fixpart|faironto/i.test(host)) {
        return host
      }
    } catch {}
  }
  const domFromEmail = resolveSupplierDomainHint(supplierName, supplierUrl, supplierEmail)
  if (domFromEmail && (isWebshopMethod || /shop\.|store\.|bueromarkt|amazon|hygi|lusini|papstar|kaeferling|eofficeshop|gottron|hamburgpapier|zoells|porzellantreff|reinigungsberater|ada-cosmetics|ronnefeldt|fixpart|faironto|deutschepost/i.test(domFromEmail))) {
    return domFromEmail
  }
  return ''
}

const searchBingProductMeta = async (query: string, webshopDomain?: string) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    const bq = encodeURIComponent(query.trim())
    const br = await fetch(`https://www.bing.com/images/search?q=${bq}&FORM=HDRSC2`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept-Language': 'de-DE,de;q=0.9'
      },
      signal: controller.signal
    })
    const bhtml = await br.text()
    const metas = [...bhtml.matchAll(/\bm="(\{[^"]+\})"/gi)]
      .map(m => {
        try {
          return JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'))
        } catch {
          return null
        }
      })
      .filter(x => x && (x.murl || x.turl))

    // WICHTIG: Ein Shop-Bestell-Link (orderUrl) darf NUR dann vorgeschlagen werden,
    // wenn die gefundene Seite tatsächlich zur Domain des zugeordneten Webshop-Lieferanten gehört!
    // Niemals fremde Shops (z.B. getraenke-taxi-do.de bei HEWO) als Bestell-Link eintragen!
    const preferred = webshopDomain
      ? metas.find(x => {
          try {
            const host = new URL(x.purl || '').hostname.replace(/^www\./i, '').toLowerCase()
            return host === webshopDomain || host.endsWith('.' + webshopDomain) || webshopDomain.endsWith('.' + host)
          } catch {
            return false
          }
        })
      : null
    const best = preferred || metas[0] || null
    const alternatives = [...new Set(
      metas.slice(0, 6).map(x => x.turl || x.murl).filter(Boolean)
    )]

    return {
      orderUrl: preferred?.purl || '',
      image: best?.turl || best?.murl || '',
      highResImage: best?.murl || '',
      title: (best?.t || '').replace(/[\ue000-\uf8ff]/g, '').trim(),
      alternatives
    }
  } catch (err) {
    console.warn('Bing search fallback error:', err)
    return { orderUrl: '', image: '', highResImage: '', title: '', alternatives: [] as string[] }
  } finally {
    clearTimeout(timer)
  }
}

const inferCategoryAndUnit = (name: string, currentCat?: string, currentUnit?: string) => {
  const lower = (name || '').toLowerCase()
  let category = currentCat && currentCat !== 'Sonstiges' && currentCat !== 'Ohne Kategorie' ? currentCat : ''
  if (!category) {
    // 0. Handwerk / Instandhaltung / Technik
    if (/(?:kleber|montagekleber|klebeband|leim|schraube|nagel|dübel|duschkopf|kühlschrank|türfach|filter|lampe|leuchtmittel|led|batterie)/i.test(lower)) {
      category = 'Instandhaltung'
    } else if (/(?:melone|käse|schinken|butter|rührei|honig|zucker|tomaten|gurken|paprika|zitronen|heidelbeeren|ananas|bananen|wurst|aufschnitt|joghurt|marmelade|konfitüre)/i.test(lower)) {
      // 1. Lebensmittel (z.B. Melone "Wasser" vor Getränke prüfen)
      category = 'Lebensmittel'
    } else if (/(?:reiniger|kalklöser|milizid|spülmittel|waschmittel|müllbeutel|toilettenpapier|kosmetiktücher|seife|shampoo|desinfektion|schwamm|entkalker|schaben|kakerlaken|ungeziefer|mülleimer|handschuhe)/i.test(lower)) {
      // 2. Reinigung (erkennt auch Komposita wie Glasreiniger, Sanitärreiniger, Essigreiniger)
      category = 'Reinigung'
    } else if (/(?:pils|bier|cola|saft|schorle|\bwasser\b|mineralwasser|sprudel|bionade|orangina|milch|kaffee|espresso|teavelope|tee\b|wein\b|sekt|zäpfle|getränk)/i.test(lower)) {
      // 3. Getränke (wasser nur als eigenständiges Wort, nicht in wasserresistent)
      category = 'Getränke'
    } else if (/(?:papier|briefmarke|kugelschreiber|marker|edding|klemmbrett|schere|ordner|etiketten|rfid|briefumschlag|tacker|heftklammer|büro)/i.test(lower)) {
      // 4. Bürobedarf
      category = 'Bürobedarf'
    }
  }

  let unit = currentUnit || 'Stück'
  if (!currentUnit || currentUnit === 'Stk' || currentUnit === 'Stück') {
    if (/\b(\d+\s*x\s*\d+[,\.]?\d*\s*l|kasten|kiste)\b/i.test(lower)) unit = 'Kasten'
    else if (/\b(karton|kt:|paket|pakete)\b/i.test(lower)) unit = 'Karton'
    else if (/\b(rolle|rollen)\b/i.test(lower)) unit = 'Rolle'
    else if (/\bkanister\b|(?<![\d,\.])(?:5|10)\s*l\b/i.test(lower)) unit = 'Kanister'
    else if (/\bflasche\b|(?<![\d,\.])(?:1\s*l|500\s*ml|750\s*ml)\b/i.test(lower)) unit = 'Flasche'
    else if (/\b(pack|packung|beutel)\b/i.test(lower)) unit = 'Packung'
  }
  return { category: category || currentCat || 'Sonstiges', unit }
}

const formatEuro = (val: number) => val.toFixed(2).replace('.', ',')

const extractPriceFromHtml = (html: string): number | null => {
  // 1. Meta-Tags (product:price:amount, og:price:amount)
  const metaPrice =
    html.match(/<meta[^>]+(?:property|name)=["'](?:product|og):price:amount["'][^>]+content=["']([0-9]+(?:[.,][0-9]{1,2})?)["']/i) ||
    html.match(/<meta[^>]+content=["']([0-9]+(?:[.,][0-9]{1,2})?)["'][^>]+(?:property|name)=["'](?:product|og):price:amount["']/i) ||
    html.match(/itemprop=["']price["'][^>]+content=["']([0-9]+(?:[.,][0-9]{1,2})?)["']/i)
  if (metaPrice?.[1]) {
    const v = parseFloat(metaPrice[1].replace(',', '.'))
    if (!isNaN(v) && v > 0 && v < 10000) return v
  }

  // 2. JSON-LD Product Schema
  const ldMatches = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
  for (const m of ldMatches) {
    try {
      const parsed = JSON.parse(m[1].trim())
      const nodes = Array.isArray(parsed) ? parsed : (parsed['@graph'] || [parsed])
      for (const node of nodes) {
        if (node && (node['@type'] === 'Product' || node.sku || node.offers)) {
          const offer = Array.isArray(node.offers) ? node.offers[0] : node.offers
          const pVal = parseFloat(String(offer?.price || offer?.lowPrice || '').replace(',', '.'))
          if (!isNaN(pVal) && pVal > 0 && pVal < 10000) return pVal
        }
      }
    } catch {}
  }

  // 3. Typische Preis-Patterns im HTML (z.B. Amazon / B2B-Shops)
  const inlinePrice =
    html.match(/"priceAmount"\s*:\s*([0-9]+(?:\.[0-9]{1,2})?)/i) ||
    html.match(/class=["'][^"']*price[^"']*["'][^>]*>\s*([0-9]{1,4},[0-9]{2})\s*(?:€|&euro;|EUR)/i)
  if (inlinePrice?.[1]) {
    const v = parseFloat(inlinePrice[1].replace(',', '.'))
    if (!isNaN(v) && v > 0 && v < 10000) return v
  }
  return null
}

const evaluatePricePlausibility = (
  shopPrice: number | null,
  knownPrice: number | null | undefined
): {
  status: 'ok' | 'warning' | 'new_price' | 'none'
  shopPrice: number | null
  knownPrice: number | null
  message: string
} => {
  const kp = knownPrice && Number(knownPrice) > 0 ? Number(knownPrice) : null
  if (!shopPrice || shopPrice <= 0) {
    return { status: 'none', shopPrice: null, knownPrice: kp, message: '' }
  }
  if (shopPrice > 2500 || shopPrice < 0.05) {
    return {
      status: 'warning',
      shopPrice,
      knownPrice: kp,
      message: `⚠️ Ungewöhnlicher Shop-Preis (${formatEuro(shopPrice)} €) – bitte Link prüfen!`
    }
  }
  if (!kp) {
    return {
      status: 'new_price',
      shopPrice,
      knownPrice: null,
      message: `✨ Shop-Preis erkannt: ${formatEuro(shopPrice)} € (als Artikelpreis vorgeschlagen)`
    }
  }

  const ratio = shopPrice / kp
  // Prüfe, ob Netto vs. Brutto (+7% oder +19% MwSt.)
  if (ratio >= 1.16 && ratio <= 1.22) {
    return {
      status: 'ok',
      shopPrice,
      knownPrice: kp,
      message: `✓ Preis plausibel: ${formatEuro(shopPrice)} € brutto im Shop passt zu ${formatEuro(kp)} € netto`
    }
  }
  if (ratio >= 0.72 && ratio <= 1.35) {
    return {
      status: 'ok',
      shopPrice,
      knownPrice: kp,
      message: `✓ Preis-Check OK: ${formatEuro(shopPrice)} € im Shop (bisher: ${formatEuro(kp)} €)`
    }
  }
  // Prüfe, ob es wahrscheinlich ein Karton vs. Einzelstück ist (Faktor >= 2 oder <= 0.5)
  const mult = ratio > 1 ? Math.round(ratio) : Math.round(1 / ratio)
  if (mult >= 2 && mult <= 50) {
    return {
      status: 'warning',
      shopPrice,
      knownPrice: kp,
      message: `⚠️ Preis-Warnung: Shop zeigt ${formatEuro(shopPrice)} € statt ${formatEuro(kp)} € (ca. Faktor ${mult}x – evtl. Karton vs. Einzelstück oder falscher Artikel!)`
    }
  }
  return {
    status: 'warning',
    shopPrice,
    knownPrice: kp,
    message: `⚠️ Preis weicht stark ab: Shop zeigt ${formatEuro(shopPrice)} € statt bisher ${formatEuro(kp)} € – bitte Link prüfen!`
  }
}



async function enrichSingleProduct(params: {
  name: string;
  sku?: string | null;
  supplierName?: string | null;
  supplierUrl?: string | null;
  supplierEmail?: string | null;
  knownPrice?: number | null;
}): Promise<{
  cleanName: string;
  orderUrl: string;
  image: string;
  alternatives: string[];
  sku: string;
  category: string;
  unit: string;
}> {
  const cleanName = cleanProductName(params.name) || params.name
  const webshopDomain = resolveWebshopDomain(params.supplierName || '', params.supplierUrl || '', false, params.supplierEmail || '')
  const { category, unit } = inferCategoryAndUnit(params.name)
  let orderUrl = ''
  let image = ''
  let alternatives: string[] = []
  let effectiveSku = params.sku || ''

  // 1. Amazon ASIN Direkt-Check
  if ((webshopDomain === 'amazon.de' || (params.supplierName || '').toLowerCase().includes('amazon')) && effectiveSku && /^B0[A-Z0-9]{8}$/i.test(effectiveSku)) {
    orderUrl = `https://www.amazon.de/dp/${effectiveSku.toUpperCase()}`
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 2600)
      const r = await fetch(orderUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' },
        signal: ctrl.signal
      })
      clearTimeout(t)
      if (r.ok) {
        const html = await r.text()
        const m = html.match(/"hiRes"\s*:\s*"(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+)"/i) ||
          html.match(/"large"\s*:\s*"(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+)"/i) ||
          html.match(/src=["'](https:\/\/m\.media-amazon\.com\/images\/I\/[^"']+)["']/i)
        if (m?.[1]) {
          image = m[1]
          alternatives.push(image)
        }
      }
    } catch {}
  }

  // 2. Reinigungsberater Direkt-Check
  if (!image && webshopDomain === 'reinigungsberater.de') {
    const skuCandidate = effectiveSku || params.name.match(/\b([1-9]\d{4,6})\b/)?.[1]
    if (skuCandidate) {
      try {
        const targetUrl = `https://www.reinigungsberater.de/,p-${skuCandidate}.html`
        const ctrl = new AbortController()
        const t = setTimeout(() => ctrl.abort(), 2600)
        const r = await fetch(targetUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          signal: ctrl.signal,
          redirect: 'follow'
        })
        clearTimeout(t)
        if (r.ok && r.url && /-p-[A-Za-z0-9_-]+/i.test(r.url)) {
          orderUrl = r.url
          effectiveSku = skuCandidate
          const html = await r.text()
          let ogImg = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] || ''
          if (!ogImg || /manifest|favicon|icon[-_.]|apple-touch|logo/i.test(ogImg)) {
            const cdnImg = html.match(/src=["'](https:\/\/cdn\.reinigungsberater\.de\/products\/[^"']+)["']/i)?.[1]
            ogImg = cdnImg || ''
          }
          if (ogImg) {
            image = ogImg
            alternatives.push(ogImg)
          }
        }
      } catch {}
    }
  }

  // 3. Fallback: Gezielte Bing-Suche
  if (!image) {
    const coreName = cleanName
      .replace(/\s*\(\s*(?:\d+\s*(?:st(?:ü|ue)ck|x|er|pack|rollen|kg|g|l|ml)|ca\.[^)]+)\s*\)/gi, '')
      .replace(/\b\d+\s*x\s*\d+[,\.]?\d*\s*(?:l|g|kg|ml)\b/gi, '')
      .replace(/\bca\.\s*\d+[.,]?\d*\s*(?:kg|g|l|ml)\b/gi, '')
      .replace(/\b\d+[.,]?\d*\s*(?:kg|g|l|ml)\b/gi, '')
      .trim()
    const query = webshopDomain
      ? `site:${webshopDomain} ${effectiveSku ? effectiveSku + ' ' : ''}${coreName}`.trim()
      : `${cleanName} ${params.supplierName || ''}`.trim()

    const bingRes = await searchBingProductMeta(query, webshopDomain)
    if (bingRes.image) {
      image = bingRes.highResImage || bingRes.image
      if (!orderUrl && bingRes.orderUrl) orderUrl = bingRes.orderUrl
      alternatives = bingRes.alternatives || []
    }
  }

  return {
    cleanName: cleanName || params.name,
    orderUrl,
    image,
    alternatives,
    sku: effectiveSku,
    category,
    unit
  }
}


async function processEmailWithAi(params: {
  user_id: string;
  company_id: string;
  valuation_method: string;
  fromAddress: string;
  subject: string;
  bodyText: string;
  attachmentParts?: any[];
  existingLogId?: string;
  emailCreatedAt?: string;
}) {
  const { user_id, company_id, valuation_method, fromAddress, subject, attachmentParts = [], existingLogId, emailCreatedAt } = params
  // Entferne unsichtbare Preheader-Füllzeichen (z.B. aus Amazon-Mails), die sonst den Anfang des Textes aufblähen
  const bodyText = (params.bodyText || '').replace(/[\u034f\u200b-\u200f\u202a-\u202e\u2060-\u206f\u00ad\ufeff]+/g, ' ').replace(/[ \t]{3,}/g, ' ').trim()
  const fallbackOrderDate = (emailCreatedAt ? String(emailCreatedAt).slice(0, 10) : '') || new Date().toISOString().slice(0, 10)

  // Vorhandene Lieferanten & Produkte dieser Firma laden (verhindert Duplikate direkt beim Import!)
  const [{ data: existingSuppliersData }, { data: existingProductsData }] = await Promise.all([
    supabase.from('suppliers')
      .select('id, name, email, customer_number, phone, iban')
      .eq('company_id', company_id)
      .order('name', { ascending: true }),
    supabase.from('products')
      .select('id, name, category, price, stock, supplier_id')
      .eq('company_id', company_id)
      .order('name', { ascending: true })
  ])

  const allSuppliers = existingSuppliersData || []
  const allProducts = existingProductsData || []

  const existingCategories = [...new Set(
    allProducts.map((r: any) => r.category as string).filter(Boolean)
  )].filter(c => c !== 'KI-Import (E-Mail)' && c !== 'Importiert' && c !== 'Ohne Kategorie')

  const categoryHint = existingCategories.length > 0
    ? existingCategories.join(', ')
    : '(keine vorhanden — du MUSST zwingend selbst eine passende kurze Kategorie auf Deutsch erfinden)'

  const suppliersHint = allSuppliers.length > 0
    ? allSuppliers.map((s: any) => `- ID: "${s.id}" | Name: "${s.name}" | E-Mail: "${s.email || ''}"`).join('\n')
    : '(noch keine Lieferanten vorhanden)'

  const productsHint = allProducts.length > 0
    ? allProducts.slice(0, 250).map((p: any) => `- ID: "${p.id}" | Name: "${p.name}" | Kat: "${p.category || ''}"`).join('\n')
    : '(noch keine Produkte vorhanden)'

  const prompt = `
Du analysierst E-Mails und Anhänge für ein Hotel-Bestellwesen.

WICHTIG:
Bestimme ZUERST den Dokumenttyp.
Erlaubte Typen:
- "invoice"
- "order_confirmation"
- "delivery_note"
- "unknown"

Regeln:
1. supplier_email darf NIEMALS die E-Mail des Hotels/Käufers sein (z.B. niemals @hotelschottenhof.de).
2. Bevorzuge als supplier_email:
   a) Absenderadresse des Lieferanten (auch in weitergeleiteten Mails unter "Von:")
   b) Kontakt-/Rechnungsmail in Mail-Signatur
   c) Kontakt-/Rechnungsmail in PDF-Kopf/Fußzeile
3. Falls nicht eindeutig: supplier_email = null
4. LIEFERANTEN-ABGLEICH (KEINE DUPLIKATE!): Prüfe die unten gelisteten "Vorhandene Lieferanten". Wenn der Lieferant der E-Mail (auch mit leicht abweichender Schreibweise, Rechtsform wie GmbH/KG oder gleicher E-Mail-Domain) bereits in der Liste existiert, trage seine ID in 'matched_supplier_id' ein und verwende EXAKT seinen vorhandenen Namen für 'supplier_name'!
5. PRODUKT-ABGLEICH (KEINE DUPLIKATE!): Prüfe für jeden Artikel die Liste "Vorhandene Produkte". Wenn dasselbe Produkt dort bereits existiert (auch mit kürzerem/längerem Namen, z.B. "Rothaus Tannenzäpfle Pils 24x0,33L" vs. "Rothaus Pils Zäpfle 24x0,33L" oder "Teavelope English Breakfast Schwarzer Tee" vs. "Teavelope English Breakfast"), trage seine ID in 'matched_product_id' ein und verwende EXAKT den vorhandenen Produktnamen für 'product_name'! Achtung: Verschiedene Sorten (z.B. "Coca Cola" vs. "Coca Cola ZERO") sind KEINE Duplikate.
6. Erzeuge should_create_order = true NUR bei:
   - order_confirmation
   - delivery_note
7. Bei invoice: should_create_order = false
8. Nimm bei order_date bevorzugt das Haupt-Belegdatum/Druckdatum oben im Kopf (z.B. "Datum: 07.04."). Nimm zur Not das Bestelldatum, aber NIEMALS ein zukünftiges Lieferdatum oder Zahlungsziel.
9. In items dürfen KEINE Versandkosten, Pfand, Rabatte, Steuerzeilen, Leergut, Paletten, Versandschutz (Shipping Protection) oder Gebühren auftauchen.
10. Wenn zu wenig Sicherheit besteht, document_type = "unknown".
11. Extrahiere die Kundennummer des Hotels (customer_number) bei diesem Lieferanten, falls sie auf dem Beleg steht (oft als "Kd-Nr.", "Kunden-Nr." oder "Customer No.").
12. WICHTIG zu 'product_name' (falls neues Produkt): Filtere alle Artikelnummern, EANs, SKUs und kryptischen Codes aus dem Produktnamen heraus! 'product_name' darf NUR den menschenlesbaren Namen enthalten. Packe die Artikelnummer stattdessen in das Feld 'sku'.
13. KATEGORIE: Weise jedem Artikel ZWINGEND eine logische Warengruppe/Kategorie auf Deutsch zu (z.B. "Getränke", "Reinigung", "Lebensmittel", "Hygiene", "Bürobedarf"). Nutze bevorzugt EXAKT eine der vorhandenen Kategorien. Verwende NIEMALS generische Begriffe wie "Importiert" oder "KI-Import".
14. TELEFON & IBAN: Falls Telefonnummer oder IBAN des Lieferanten auf dem Beleg stehen, trage sie unter supplier_phone bzw. supplier_iban ein.
15. LIEFERTERMIN: Extrahiere den voraussichtlichen oder tatsächlichen Liefertermin als 'delivery_date' (Format YYYY-MM-DD).
16. TRACKING: Extrahiere einen eventuellen Tracking-Link ODER eine Sendungsnummer als 'tracking_link'.
17. STATUS-NOTIZEN: Fasse wichtige Versand- und Statusinformationen in 'order_notes' zusammen.

Vorhandene Kategorien (bevorzugt verwenden): ${categoryHint}

Vorhandene Lieferanten (bevorzugt zuordnen!):
${suppliersHint}

Vorhandene Produkte (bevorzugt zuordnen!):
${productsHint}

Metadaten:
Heutiges Datum: ${new Date().toLocaleDateString('de-DE')}
Betreff: ${subject}
Absender: ${fromAddress}
Text: ${bodyText}

Antworte ausschließlich als JSON:
{
  "document_type": "invoice",
  "should_create_order": false,
  "matched_supplier_id": "string | null",
  "supplier_name": "string | null",
  "supplier_email": "string | null",
  "supplier_phone": "string | null",
  "supplier_iban": "string | null",
  "customer_number": "string | null",
  "invoice_number": "string | null",
  "order_reference": "string | null",
  "items": [
    {
      "matched_product_id": "string | null",
      "product_name": "string (nur lesbarer Name)",
      "sku": "string | null",
      "category": "string (passende Kategorie auf Deutsch)",
      "quantity": 1,
      "price": 0
    }
  ],
  "total_price": 0,
  "order_date": "YYYY-MM-DD | null",
  "delivery_date": "YYYY-MM-DD | null",
  "tracking_link": "string | null",
  "order_notes": "string | null",
  "confidence": 0.0
}
`

  const geminiParts: any[] = [{ text: prompt }, ...attachmentParts]
  const geminiResult = await callGeminiJson(geminiParts)
  const geminiError = !geminiResult.ok
  const parsedData = geminiResult.parsedData

  let inboundLogId = existingLogId || null
  if (existingLogId) {
    const { error: updLogErr } = await supabase.from('inbound_emails').update({
      extracted_data: parsedData,
      status: geminiError ? 'gemini_error' : 'processed'
    }).eq('id', existingLogId)
    if (updLogErr) console.error("Error updating inbound_emails row:", updLogErr)
  } else {
    const { data: inboundLog, error: logErr } = await supabase.from('inbound_emails').insert({
      user_id: user_id,
      company_id: company_id,
      supplier_name: fromAddress || '',
      subject: subject,
      body_text: bodyText || '',
      extracted_data: parsedData,
      status: geminiError ? 'gemini_error' : 'processed'
    }).select('id').single()
    if (logErr) console.error("CRITICAL ERROR inserting into inbound_emails:", logErr)
    else inboundLogId = inboundLog?.id || null
  }

  if (geminiError) {
    return {
      success: false,
      status: 'gemini_error',
      message: 'Gemini error — email logged, no data imported',
      extracted_data: parsedData
    }
  }

  const shouldCreateOrder = parsedData.should_create_order === true
  const docType = parsedData.document_type || 'unknown'
  console.log(`Document type: ${docType}. Should create order? ${shouldCreateOrder}`)

  // Lieferant bestimmen oder anlegen (nur wenn kein unbekannter/Newsletter-Beleg!)
  console.log("Processing supplier...")
  let supplier_id: string | null = null
  let supName: string = parsedData.supplier_name?.trim() || 'Unbekannter Lieferant (KI)'
  let matchedSupplier: any = null

  // 1. Durch KI zugeordnete Supplier-ID prüfen
  if (parsedData.matched_supplier_id) {
    matchedSupplier = allSuppliers.find((s: any) => s.id === parsedData.matched_supplier_id) || null
  }

  // 2. Exakte E-Mail oder gleiche Domain prüfen
  const emailToMatch = parsedData.supplier_email?.trim().toLowerCase()
  const genericDomains = new Set(['gmail.com', 'googlemail.com', 'web.de', 'gmx.de', 'gmx.net', 't-online.de', 'outlook.com', 'hotmail.com', 'icloud.com', 'yahoo.com', 'unbekannt.com'])
  if (!matchedSupplier && emailToMatch && emailToMatch !== 'hello@unbekannt.com') {
    matchedSupplier = allSuppliers.find((s: any) => (s.email || '').trim().toLowerCase() === emailToMatch) || null
    if (!matchedSupplier && emailToMatch.includes('@')) {
      const domain = emailToMatch.split('@')[1]
      if (domain && !genericDomains.has(domain)) {
        matchedSupplier = allSuppliers.find((s: any) => (s.email || '').toLowerCase().endsWith(`@${domain}`)) || null
      }
    }
  }

  // 3. Name-Fallback
  if (!matchedSupplier && supName !== 'Unbekannter Lieferant (KI)') {
    const norm = (str: string) => str.toLowerCase().replace(/\b(gmbh|mbh|kg|ag|co\.?|ohg|ug|e\.?k\.?|deutschland|international|vertriebs?)\b/gi, '').replace(/[^a-z0-9äöüß]/gi, '').trim()
    const targetNorm = norm(supName)
    if (targetNorm.length >= 3) {
      matchedSupplier = allSuppliers.find((s: any) => {
        const sNorm = norm(s.name || '')
        return sNorm.length >= 3 && (sNorm === targetNorm || sNorm.includes(targetNorm) || targetNorm.includes(sNorm))
      }) || null
    }
  }

  if (matchedSupplier) {
    supplier_id = matchedSupplier.id
    // WICHTIG: Verwende den kanonischen Lieferantennamen aus der Datenbank!
    supName = matchedSupplier.name.trim()
    parsedData.supplier_name = supName
    console.log("Matched existing supplier:", supplier_id, supName)

    const updatePayload: any = {}
    if (parsedData.supplier_email && parsedData.supplier_email.trim() !== '' && parsedData.supplier_email !== 'hello@unbekannt.com' && (!matchedSupplier.email || matchedSupplier.email === 'hello@unbekannt.com')) {
      updatePayload.email = parsedData.supplier_email.trim()
    }
    if (parsedData.customer_number && parsedData.customer_number.trim() !== '' && !matchedSupplier.customer_number) {
      updatePayload.customer_number = parsedData.customer_number.trim()
    }
    if (parsedData.supplier_phone && parsedData.supplier_phone.trim() !== '' && !matchedSupplier.phone) {
      updatePayload.phone = parsedData.supplier_phone.trim()
    }
    if (parsedData.supplier_iban && parsedData.supplier_iban.trim() !== '' && !matchedSupplier.iban) {
      updatePayload.iban = parsedData.supplier_iban.trim()
    }

    if (Object.keys(updatePayload).length > 0 && docType !== 'unknown') {
      await supabase.from('suppliers').update(updatePayload).eq('id', supplier_id)
    }
  } else if (supName !== 'Unbekannter Lieferant (KI)' && docType !== 'unknown') {
    const { data: newSupp, error: newSupErr } = await supabase.from('suppliers').insert({
      id: crypto.randomUUID(),
      user_id: user_id,
      company_id: company_id,
      name: supName,
      email: parsedData.supplier_email || 'hello@unbekannt.com',
      customer_number: parsedData.customer_number || null,
      phone: parsedData.supplier_phone || null,
      iban: parsedData.supplier_iban || null,
      is_auto_generated: true
    }).select('id').single()

    if (newSupErr) {
      console.error("Error creating new supplier:", JSON.stringify(newSupErr, null, 2))
    } else if (newSupp) {
      supplier_id = newSupp.id
      console.log("Successfully created new supplier:", supplier_id)
    }
  }

  let createdOrdersCount = 0
  let updatedOrdersCount = 0

  const cleanRef = (ref: string | null) => ref ? ref.replace(/^[#\s]+/, '').trim() : null
  if (parsedData.order_reference) parsedData.order_reference = cleanRef(parsedData.order_reference)
  if (parsedData.invoice_number) parsedData.invoice_number = cleanRef(parsedData.invoice_number)

  // Globale Metadaten-Aktualisierung (z.B. für Versandbestätigungen)
  const globalOrderRef = parsedData.order_reference || parsedData.invoice_number || null
  if (parsedData.tracking_link || parsedData.order_notes || parsedData.delivery_date) {
    let matchedOrders: any[] | null = null

    if (globalOrderRef) {
      let qGlobal = supabase.from('orders')
        .select('id, notes')
        .eq('status', 'open')
        .eq('order_number', globalOrderRef)
      if (company_id) qGlobal = qGlobal.eq('company_id', company_id)
      else qGlobal = qGlobal.eq('user_id', user_id)

      const { data } = await qGlobal
      matchedOrders = data
    } else if (supName && supName !== 'Unbekannter Lieferant (KI)' && (docType === 'delivery_note' || docType === 'order_confirmation')) {
      let qSup = supabase.from('orders')
        .select('id, notes')
        .eq('status', 'open')
        .eq('supplier_name', supName)
      if (company_id) qSup = qSup.eq('company_id', company_id)
      else qSup = qSup.eq('user_id', user_id)

      const { data } = await qSup
      matchedOrders = data
    }

    if (matchedOrders && matchedOrders.length > 0) {
      for (const o of matchedOrders) {
        const updatePayload: any = {}
        if (parsedData.delivery_date) updatePayload.expected_delivery_date = parsedData.delivery_date
        if (parsedData.tracking_link) updatePayload.trackingLink = parsedData.tracking_link
        if (parsedData.order_notes) {
          const baseNotes = o.notes ? `${o.notes}\n\n` : ''
          if (!baseNotes.includes(parsedData.order_notes)) {
            updatePayload.notes = `${baseNotes}Update (System): ${parsedData.order_notes}`
          }
        }
        await supabase.from('orders').update(updatePayload).eq('id', o.id)
      }
      updatedOrdersCount += matchedOrders.length
    }
  }

  // Aktualisiere oder lege Produkte & Bestellungen an
  const items = parsedData.items || []
  console.log(`Found ${items.length} items to process.`)
  const normProd = (s: string) => s.toLowerCase().replace(/[^a-z0-9äöüß]/gi, '').trim()

  const isShippingEmail = docType === 'delivery_note' || /\b(versendet|versandt|in zustellung|versandbestätigung|unterwegs|spediteur)\b/i.test(subject || '')

  for (const item of items) {
    if (!item?.product_name) continue

    const lowerName = item.product_name.toLowerCase()
    if (
      lowerName.includes('versand') ||
      lowerName.includes('pfand') ||
      lowerName.includes('porto') ||
      lowerName.includes('gebühr') ||
      lowerName.includes('logistik') ||
      lowerName.includes('shipping') ||
      lowerName.includes('insurance') ||
      lowerName.includes('discount') ||
      lowerName.includes('protection') ||
      lowerName.includes('rabatt') ||
      lowerName.includes('dhl-paket') ||
      lowerName.includes('dhl paket') ||
      lowerName.includes('deutsche post') ||
      lowerName.includes('lieferkosten') ||
      lowerName.includes('fracht') ||
      lowerName.includes('mindermengenzuschlag')
    ) {
      console.log("Skipping non-product item:", item.product_name)
      continue
    }

    // Produkt im vorhandenen Katalog abgleichen (KI-ID -> exakter Name -> normalisierter Name)
    let matchedProd: any = null
    if (item.matched_product_id) {
      matchedProd = allProducts.find((p: any) => p.id === item.matched_product_id) || null
    }
    if (!matchedProd) {
      matchedProd = allProducts.find((p: any) => (p.name || '').trim().toLowerCase() === lowerName.trim()) || null
    }
    if (!matchedProd) {
      const targetNorm = normProd(item.product_name)
      if (targetNorm.length >= 5) {
        matchedProd = allProducts.find((p: any) => normProd(p.name || '') === targetNorm) || null
      }
    }

    const cleanedName = cleanProductName(item.product_name || '')
    const canonicalProductName = matchedProd ? matchedProd.name : (cleanedName || item.product_name.trim())
    item.product_name = canonicalProductName

    let resolvedImage = matchedProd?.image || ''
    let resolvedOrderUrl = matchedProd?.order_url || ''
    let resolvedSku = matchedProd?.product_number || item.sku || ''
    let resolvedCategory = (matchedProd?.category && matchedProd.category !== 'Sonstiges') ? matchedProd.category : (item.category && item.category !== 'Sonstiges' ? item.category : '')
    let resolvedUnit = (matchedProd?.unit && matchedProd.unit !== 'Stk' && matchedProd.unit !== 'Stück') ? matchedProd.unit : ''
    let resolvedName = canonicalProductName

    // Automatische KI-Anreicherung bei neuen oder unvollständigen Produkten für maximalen Wow-Effekt
    if (docType !== 'unknown' && (!resolvedImage || !resolvedOrderUrl || !resolvedCategory || !resolvedUnit)) {
      try {
        const enriched = await enrichSingleProduct({
          name: canonicalProductName,
          sku: item.sku || matchedProd?.product_number || null,
          supplierName: supName,
          supplierUrl: matchedSupplier?.url || matchedSupplier?.order_url || '',
          supplierEmail: parsedData.supplier_email || matchedSupplier?.email || fromAddress,
          knownPrice: Number(item.price) || 0
        })
        if (enriched.image && !resolvedImage) resolvedImage = enriched.image
        if (enriched.orderUrl && !resolvedOrderUrl) resolvedOrderUrl = enriched.orderUrl
        if (enriched.sku && !resolvedSku) resolvedSku = enriched.sku
        if (enriched.category && !resolvedCategory) resolvedCategory = enriched.category
        if (enriched.unit && !resolvedUnit) resolvedUnit = enriched.unit
        if (enriched.cleanName && !matchedProd) resolvedName = enriched.cleanName
      } catch (enrichErr) {
        console.warn('Auto-enrich error on inbound item:', item.product_name, enrichErr)
      }
    }

    let orderStatus: string | null = null
    if (docType === 'order_confirmation' || docType === 'delivery_note') {
      orderStatus = 'open'
    }

    if (shouldCreateOrder && orderStatus) {
      const orderRef = parsedData.order_reference || parsedData.invoice_number || null

      // Stufe 1: Deduplication Check mit Belegnummer
      let existingOrder: any = null
      if (orderRef) {
        let q1 = supabase.from('orders')
          .select('id, status, quantity, price, date, notes')
        if (company_id) q1 = q1.eq('company_id', company_id)
        else q1 = q1.eq('user_id', user_id)

        const { data: existingOrders } = await q1.eq('order_number', orderRef).ilike('product_name', canonicalProductName).limit(1)
        if (existingOrders && existingOrders.length > 0) existingOrder = existingOrders[0]
      }

      // Stufe 2: Offene Bestellung desselben Produkts (manuell angelegt oder vor Versandbestätigung)
      if (!existingOrder) {
        let q2 = supabase.from('orders')
          .select('id, status, quantity, price, date, notes, order_number')
          .eq('status', 'open')
          .ilike('product_name', canonicalProductName)
        if (company_id) q2 = q2.eq('company_id', company_id)
        else q2 = q2.eq('user_id', user_id)

        const { data: openOrders } = await q2.limit(5)
        if (openOrders && openOrders.length > 0) {
          existingOrder = openOrders.find((o: any) => !o.order_number || o.order_number === orderRef) || (docType === 'delivery_note' ? openOrders[0] : null)
        }
      }

      if (existingOrder) {
        updatedOrdersCount++
        console.log(`Order for ${canonicalProductName} already exists (status=${existingOrder.status}). Updating it...`)

        const aiQuantity = Math.round(Number(item.quantity)) || 1
        const aiPrice = Number(item.price) || 0

        const updatePayload: any = {
          supplier_name: supName
        }

        // Nur bei noch offenen Bestellungen und nur bei echten Bestellbestätigungen Menge/Preis prüfen.
        // WICHTIG: Das ursprüngliche Bestelldatum (existingOrder.date) wird NIEMALS durch spätere Mails
        // (z.B. Versandbestätigungen 2 Tage später) überschrieben, da das zu falschen Datums-Warnungen führt!
        if (existingOrder.status === 'open' && !isShippingEmail) {
          const ai_revisions: any = {}
          let hasRevisions = false

          const existingQty = Math.round(Number(existingOrder.quantity)) || 1
          const existingPrice = Number(existingOrder.price) || 0

          if (existingQty !== aiQuantity) {
            ai_revisions.quantity = { original: existingQty, suggested: aiQuantity, reverted: false }
            hasRevisions = true
          }
          if (existingPrice > 0 && aiPrice > 0 && Math.abs(existingPrice - aiPrice) >= 0.01) {
            ai_revisions.price = { original: existingPrice, suggested: aiPrice, reverted: false }
            hasRevisions = true
          }

          updatePayload.quantity = aiQuantity
          updatePayload.price = aiPrice > 0 ? aiPrice : existingOrder.price
          if (hasRevisions) updatePayload.ai_revisions = ai_revisions
        } else if (existingOrder.status === 'open' && (!existingOrder.price || Number(existingOrder.price) === 0) && aiPrice > 0) {
          updatePayload.price = aiPrice
        }

        if (!existingOrder.product_image && resolvedImage) updatePayload.product_image = resolvedImage
        if (orderRef) updatePayload.order_number = orderRef
        if (parsedData.delivery_date) updatePayload.expected_delivery_date = parsedData.delivery_date
        if (parsedData.tracking_link) updatePayload.trackingLink = parsedData.tracking_link
        if (parsedData.order_notes) {
          const base = existingOrder.notes || ''
          if (!base.includes(parsedData.order_notes)) {
            updatePayload.notes = base
              ? `${base}\n\nUpdate (System): ${parsedData.order_notes}`
              : `Update (System): ${parsedData.order_notes}`
          }
        }

        await supabase.from('orders').update(updatePayload).eq('id', existingOrder.id)
      } else {
        createdOrdersCount++
        const baseNotes = `KI-Import (${docType}) aus Betreff: ${subject}. Referenz: ${orderRef || 'Keine'}`
        const finalNotes = parsedData.order_notes ? `${baseNotes}\n\nNotiz: ${parsedData.order_notes}` : baseNotes

        const { error: orderErr } = await supabase.from('orders').insert({
          id: crypto.randomUUID(),
          user_id: user_id,
          company_id: company_id,
          product_name: resolvedName,
          product_image: resolvedImage || null,
          quantity: Math.round(Number(item.quantity)) || 1,
          price: Number(item.price) || 0,
          date: parsedData.order_date || fallbackOrderDate,
          expected_delivery_date: parsedData.delivery_date || null,
          trackingLink: parsedData.tracking_link || null,
          status: orderStatus,
          supplier_name: supName,
          order_number: orderRef,
          notes: finalNotes
        })
        if (orderErr) console.error("Error creating order:", JSON.stringify(orderErr, null, 2))
      }
    }

    // Produkt nur aktualisieren oder neu anlegen, wenn es KEIN unbekannter/Newsletter-Beleg ist!
    if (docType !== 'unknown') {
      if (matchedProd) {
        let newPrice = Number(item.price) || 0
        if (newPrice > 0 && valuation_method === 'average' && matchedProd.stock > 0 && matchedProd.price > 0) {
          newPrice = ((matchedProd.stock * matchedProd.price) + ((item.quantity || 1) * newPrice)) / (matchedProd.stock + (item.quantity || 1))
        }
        const prodUpdate: any = {}
        if (newPrice > 0) prodUpdate.price = newPrice
        if (!matchedProd.supplier_id && supplier_id) prodUpdate.supplier_id = supplier_id
        if (!matchedProd.image && resolvedImage) prodUpdate.image = resolvedImage
        if (!matchedProd.order_url && resolvedOrderUrl) prodUpdate.order_url = resolvedOrderUrl
        if (!matchedProd.product_number && resolvedSku) prodUpdate.product_number = resolvedSku
        if ((!matchedProd.category || matchedProd.category === 'Sonstiges') && resolvedCategory && resolvedCategory !== 'Sonstiges') {
          prodUpdate.category = resolvedCategory
        }
        if ((!matchedProd.unit || matchedProd.unit === 'Stk' || matchedProd.unit === 'Stück') && resolvedUnit && resolvedUnit !== 'Stk') {
          prodUpdate.unit = resolvedUnit
        }
        if (Object.keys(prodUpdate).length > 0) {
          await supabase.from('products').update(prodUpdate).eq('id', matchedProd.id)
        }
      } else if (supplier_id) {
        const newProd = {
          id: crypto.randomUUID(),
          user_id: user_id,
          company_id: company_id,
          name: resolvedName,
          category: resolvedCategory || 'Sonstiges',
          price: Number(item.price) || 0,
          supplier_id: supplier_id,
          is_auto_generated: true,
          stock: 0,
          unit: resolvedUnit || 'Stück',
          image: resolvedImage || null,
          order_url: resolvedOrderUrl || null,
          product_number: resolvedSku || null,
          preferred_order_method: resolvedOrderUrl ? 'webshop' : undefined
        }
        const { error: newProdErr } = await supabase.from('products').insert(newProd)
        if (!newProdErr) {
          allProducts.push(newProd)
        }
      }
    }
  }

  let finalStatus = 'processed'
  if (shouldCreateOrder && createdOrdersCount === 0 && updatedOrdersCount > 0 && inboundLogId) {
    finalStatus = 'processed_duplicate'
  }
  if (inboundLogId) {
    await supabase.from('inbound_emails').update({
      status: finalStatus,
      extracted_data: parsedData
    }).eq('id', inboundLogId)

    // Falls es zu genau diesem Betreff noch alte fehlgeschlagene Webhook-Retries (gemini_error) gibt, bereinige diese automatisch
    if (subject) {
      await supabase.from('inbound_emails')
        .delete()
        .eq('company_id', company_id)
        .eq('status', 'gemini_error')
        .eq('subject', subject)
        .neq('id', inboundLogId)
    }
  }

  return {
    success: true,
    status: finalStatus,
    createdOrdersCount,
    updatedOrdersCount,
    extracted_data: parsedData,
    message: 'Processed successfully'
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const contentType = req.headers.get('content-type') || ''

    // =========================================================================
    // MODUS A: Authentifizierte App-Aktionen (JSON Body aus dem Frontend)
    // =========================================================================
    if (contentType.includes('application/json')) {
      const authHeader = req.headers.get('Authorization') || ''
      const token = authHeader.replace(/^Bearer\s+/i, '').trim()
      if (!token) {
        return new Response(JSON.stringify({ error: 'Nicht autorisiert (Token fehlt)' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const { data: authData, error: authErr } = await supabase.auth.getUser(token)
      if (authErr || !authData?.user) {
        return new Response(JSON.stringify({ error: 'Ungültige Sitzung' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const user_id = authData.user.id
      const { data: userProfile } = await supabase
        .from('profiles')
        .select('id, inventory_valuation_method, company_id')
        .eq('id', user_id)
        .maybeSingle()

      if (!userProfile?.company_id) {
        return new Response(JSON.stringify({ error: 'Kein Firmenprofil gefunden' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const company_id = userProfile.company_id
      const valuation_method = userProfile.inventory_valuation_method || 'latest'
      const body = await req.json()
      const action = body?.action

      // 1. REPROCESS: E-Mail aus dem KI-Log erneut verarbeiten
      if (action === 'reprocess') {
        const emailId = body?.inbound_email_id
        if (!emailId) {
          return new Response(JSON.stringify({ error: 'inbound_email_id fehlt' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }

        const { data: emailRow, error: emailFetchErr } = await supabase
          .from('inbound_emails')
          .select('*')
          .eq('id', emailId)
          .eq('company_id', company_id)
          .maybeSingle()

        if (emailFetchErr || !emailRow) {
          return new Response(JSON.stringify({ error: 'E-Mail nicht gefunden' }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }

        const result = await processEmailWithAi({
          user_id,
          company_id,
          valuation_method,
          fromAddress: emailRow.supplier_name || '',
          subject: emailRow.subject || '',
          bodyText: emailRow.body_text || '',
          existingLogId: emailRow.id,
          emailCreatedAt: emailRow.created_at,
        })

        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // 2. SMART PASTE: Eingefügten Bestelltext für Einmalbestellung analysieren
      if (action === 'smart_paste') {
        const rawText = (body?.text || '').trim()
        if (!rawText) {
          return new Response(JSON.stringify({ error: 'Kein Text übergeben' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }

        const { data: existingSuppliersData } = await supabase
          .from('suppliers')
          .select('id, name, email')
          .eq('company_id', company_id)
          .order('name', { ascending: true })

        const suppliersList = (existingSuppliersData || [])
          .map((s: any) => `- ID: "${s.id}" | Name: "${s.name}" | E-Mail: "${s.email || ''}"`)
          .join('\n')

        const pastePrompt = `
Du extrahierst Bestelldaten aus einem vom Nutzer eingefügten Text (z.B. einer kopierten Bestellbestätigung, E-Mail oder Warenkorb-Zeile) für ein Hotel-Bestellsystem.

WICHTIG:
1. Entferne alle Begrüßungsfloskeln ("Vielen Dank für Ihre Bestellung...", "wir bestätigen...") aus 'product_name'!
2. 'product_name' darf NUR den sauberen, menschenlesbaren Artikelnamen enthalten (z.B. "Teavelope Darjeeling Schwarzer Tee" oder falls kein einzelner Artikel genannt ist, eine kurze treffende Bezeichnung wie "Ronnefeldt Tee-Bestellung").
3. Falls mehrere Artikel im Text stehen, liste alle in 'items' auf und setze das Hauptfeld 'product_name' auf den ersten Artikel (oder bei vielen Artikeln zusammenfassend).
4. Prüfe die vorhandenen Lieferanten: Wenn einer passt, gib seine ID als 'matched_supplier_id' und seinen exakten Namen als 'supplier_name' zurück.
5. Extrahiere Bestellnummer ('order_reference', ohne #), Menge ('quantity', Standard 1) und Einzelpreis ('price', als Zahl, sonst null).

Vorhandene Lieferanten:
${suppliersList || '(keine)'}

Eingefügter Text:
"""
${rawText}
"""

Antworte ausschließlich als JSON:
{
  "product_name": "string",
  "quantity": 1,
  "price": null,
  "matched_supplier_id": "string | null",
  "supplier_name": "string | null",
  "order_reference": "string | null",
  "items": [
    {
      "product_name": "string",
      "quantity": 1,
      "price": null
    }
  ]
}
`
        const res = await callGeminiJson([{ text: pastePrompt }], 45_000)
        if (!res.ok) {
          return new Response(JSON.stringify({ success: false, error: 'KI-Analyse fehlgeschlagen', details: res.parsedData }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }
        return new Response(JSON.stringify({ success: true, data: res.parsedData }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // 3. FIND DUPLICATES: KI-Prüfung auf Produkt- und Lieferanten-Duplikate
      if (action === 'find_duplicates') {
        const [{ data: sups }, { data: prods }] = await Promise.all([
          supabase.from('suppliers')
            .select('id, name, email, is_auto_generated')
            .eq('company_id', company_id)
            .order('name', { ascending: true }),
          supabase.from('products')
            .select('id, name, category, price, stock, supplier_id, is_auto_generated')
            .eq('company_id', company_id)
            .order('name', { ascending: true })
        ])

        const suppliersList = sups || []
        const productsList = prods || []
        const supNameById = new Map(suppliersList.map((s: any) => [s.id, s.name]))

        // --- A) Lieferanten-Vorfilter & Paar-Prüfung ---
        const genericEmailDomains = new Set([
          'gmail.com', 'googlemail.com', 'web.de', 'gmx.de', 'gmx.net',
          't-online.de', 'outlook.com', 'hotmail.com', 'icloud.com', 'yahoo.com', 'unbekannt.com'
        ])
        const supplierStopWords = new Set([
          'gmbh', 'mbh', 'deutschland', 'international', 'limited', 'emea',
          'direktvertriebs', 'vertriebs', 'vertrieb', 'online', 'shop', 'service',
          'handel', 'technik', 'bedarf', 'frischdienst', 'getraenke',
          'reinigungsmittel', 'reinigungstechnik', 'reinigungs', 'reinigung',
          'hygienebedarf', 'hygiene', 'hotel', 'gastro'
        ])

        const getSupplierEmail = (s: any): string => {
          const e = (s?.email || '').trim().toLowerCase()
          return (!e || e === 'hello@unbekannt.com' || !e.includes('@')) ? '' : e
        }
        const getSupplierDomain = (s: any): string => {
          const e = getSupplierEmail(s)
          if (!e) return ''
          const dom = e.split('@')[1] || ''
          return genericEmailDomains.has(dom) ? '' : dom
        }
        const extractSupplierTokens = (name: string): string[] => {
          return (name || '')
            .toLowerCase()
            .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
            .split(/[^a-z0-9]+/)
            .filter(w => w.length >= 4 && !supplierStopWords.has(w) && !/^\d+$/.test(w))
        }

        const areSuppliersRelated = (s1: any, s2: any): boolean => {
          if (!s1 || !s2 || s1.id === s2.id) return false
          const e1 = getSupplierEmail(s1)
          const e2 = getSupplierEmail(s2)
          if (e1 && e2 && e1 === e2) return true

          const d1 = getSupplierDomain(s1)
          const d2 = getSupplierDomain(s2)
          if (d1 && d2 && d1 === d2) return true

          const t1 = extractSupplierTokens(s1.name)
          const t2 = new Set(extractSupplierTokens(s2.name))
          if (t1.some(t => t2.has(t))) return true

          const n1 = t1.join('')
          const n2 = [...t2].join('')
          if (n1.length >= 5 && n2.length >= 5 && (n1.includes(n2) || n2.includes(n1))) return true
          return false
        }

        const candidateSuppliers = suppliersList.filter((s1: any) =>
          suppliersList.some((s2: any) => areSuppliersRelated(s1, s2))
        )

        // --- B) Produkt-Vorfilter & Paar-Prüfung ---
        const stopWords = new Set(['stck', 'stueck', 'pack', 'paket', 'liter', 'glas', 'weiss', 'schwarz', 'blau', 'fuer', 'ohne', 'oder', 'karton', 'flasche', 'beutel', 'schale', 'eimer', 'rolle', 'rollen', 'blatt'])
        const extractTokens = (name: string): string[] => {
          return (name || '')
            .toLowerCase()
            .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
            .split(/[^a-z0-9]+/)
            .filter(w => w.length >= 4 && !stopWords.has(w) && !/^\d+$/.test(w))
        }

        const prodTokens = new Map<string, string[]>()
        const tokenFreq = new Map<string, number>()
        const normNameFreq = new Map<string, number>()
        for (const p of productsList) {
          const tokens = [...new Set(extractTokens(p.name))]
          prodTokens.set(p.id, tokens)
          for (const t of tokens) {
            tokenFreq.set(t, (tokenFreq.get(t) || 0) + 1)
          }
          const nName = (p.name || '').trim().toLowerCase()
          normNameFreq.set(nName, (normNameFreq.get(nName) || 0) + 1)
        }

        const areProductsRelated = (p1: any, p2: any): boolean => {
          if (!p1 || !p2 || p1.id === p2.id) return false
          const n1 = (p1.name || '').trim().toLowerCase()
          const n2 = (p2.name || '').trim().toLowerCase()
          if (n1 && n1 === n2) return true
          const t1 = prodTokens.get(p1.id) || extractTokens(p1.name)
          const t2 = new Set(prodTokens.get(p2.id) || extractTokens(p2.name))
          return t1.some(t => t2.has(t))
        }

        const candidateProducts = productsList.filter((p: any) => {
          const nName = (p.name || '').trim().toLowerCase()
          if ((normNameFreq.get(nName) || 0) > 1) return true
          const tokens = prodTokens.get(p.id) || []
          return tokens.some(t => (tokenFreq.get(t) || 0) > 1)
        })

        // Wenn weder bei Lieferanten noch bei Produkten Kandidaten existieren, sofort leer zurückgeben
        if (candidateSuppliers.length === 0 && candidateProducts.length === 0) {
          return new Response(JSON.stringify({
            success: true,
            duplicates: [],
            stats: {
              totalSuppliers: suppliersList.length,
              totalProducts: productsList.length,
              candidateSuppliers: 0,
              candidateProducts: 0
            }
          }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }

        const dupPrompt = `
Du prüfst vorselektierte Kandidaten eines Hotel-Bestellsystems auf ECHTE doppelte Lieferanten und ECHTE doppelte Produkte.

STRENGE GRUNDREGEL (EXTREM WICHTIG):
- Wenn unter den Kandidaten KEINE echten Duplikate sind, gib ZWINGEND ein leeres Array zurück: {"duplicates": []}
- Erfinde NIEMALS Platzhalter-, Test- oder Verlegenheits-Einträge! Schlage niemals zwei verschiedene Firmen oder verschiedene Produkte vor, nur um die Liste zu füllen!

REGELN FÜR LIEFERANTEN-DUPLIKATE:
1. Zwei Lieferanten sind NUR DANN Duplikate, wenn sie eindeutig dieselbe Firma sind (z.B. exakt gleiche E-Mail-Adresse/Domain oder Kurzname vs. GmbH-Name derselben Firma).
2. Zwei verschiedene Firmen mit unterschiedlichen E-Mail-Domains sind NIEMALS Duplikate!
3. 'keepId' soll bevorzugt der manuell gepflegte (auto=false) oder kürzere, sauberere Name sein. 'mergeId' ist das Duplikat, das in 'keepId' überführt wird.

REGELN FÜR PRODUKT-DUPLIKATE:
1. Zwei Produkte sind NUR DANN Duplikate, wenn sie offensichtlich denselben Artikel bezeichnen (exakt gleicher Name oder Kurzname vs. langer Rechnungsname desselben Artikels).
2. STRENG VERBOTEN zusammenzuführen sind:
   - Verschiedene Geschmacksrichtungen, Sorten oder Varianten (z.B. "Coca Cola" vs. "Coca Cola light" vs. "Coca Cola ZERO", "Elisabethen PUR" vs. "Elisabethen SPRUDEL", "Bionade Holunder" vs. "Bionade Ingwer Orange")
   - Verschiedene Gebindegrößen oder Flaschengrößen (z.B. "12x0,75L" vs. "20x0,25L")
   - Verschiedene Produkte derselben Marke (z.B. "Topfreiniger" vs. "Scheuerschwamm", "Gabel" vs. "Löffel", "Müllbeutel 30L" vs. "Müllbeutel 60L")
3. Wenn es 3 Einträge für dasselbe Produkt gibt (A, B, C), erstelle zwei Merge-Einträge mit demselben 'keepId' (z.B. B -> A und C -> A).
4. Bevorzuge als 'keepId' den Eintrag mit Bestand (stock > 0), manuell gepflegt (auto=false) oder mit dem klareren Namen.

LIEFERANTEN-KANDIDATEN (${candidateSuppliers.length}):
${candidateSuppliers.length > 0 ? candidateSuppliers.map((s: any) => `${s.id} | ${s.name} | ${s.email || ''} | auto=${!!s.is_auto_generated}`).join('\n') : '(keine Lieferanten-Kandidaten vorhanden – erstelle KEINE supplier-Duplikate!)'}

PRODUKT-KANDIDATEN (${candidateProducts.length}):
${candidateProducts.length > 0 ? candidateProducts.map((p: any) => `${p.id} | ${p.name} | Kat:${p.category || '-'} | Bestand:${p.stock ?? 0} | Lief:${supNameById.get(p.supplier_id) || '-'} | auto=${!!p.is_auto_generated}`).join('\n') : '(keine Produkt-Kandidaten vorhanden – erstelle KEINE product-Duplikate!)'}

Antworte ausschließlich als JSON im Format {"duplicates": [...]} (oder {"duplicates": []}, falls keine echten Duplikate vorliegen).
Jedes Element in "duplicates" (nur falls echte Duplikate existieren!) hat die Felder:
- "type": "supplier" oder "product"
- "keepId": "UUID"
- "mergeId": "UUID"
- "reason": "Kurze konkrete Begründung auf Deutsch"
`
        const res = await callGeminiJson([{ text: dupPrompt }], 80_000)
        if (!res.ok) {
          return new Response(JSON.stringify({
            success: false,
            error: 'KI-Duplikatprüfung vorübergehend nicht erreichbar. Bitte kurz erneut versuchen.',
            details: res.parsedData
          }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }

        const supMap = new Map(suppliersList.map((s: any) => [s.id, s]))
        const prodMap = new Map(productsList.map((p: any) => [p.id, p]))
        const rawDups = Array.isArray(res.parsedData?.duplicates) ? res.parsedData.duplicates : []
        const seenMergeIds = new Set<string>()
        const verifiedDups: any[] = []
        const invalidReasonRegex = /keine?\s+(offensichtlichen\s+|echten\s+)?duplikat|nicht\s+zutreffend|falls\s+zutreffend|beispiel|platzhalter|kein\s+treffer/i

        for (const d of rawDups) {
          if (!d?.keepId || !d?.mergeId || d.keepId === d.mergeId) continue
          if (seenMergeIds.has(d.mergeId)) continue
          if (d.reason && invalidReasonRegex.test(String(d.reason))) continue

          if (d.type === 'supplier') {
            const keep = supMap.get(d.keepId)
            const merge = supMap.get(d.mergeId)
            // Harte Nachprüfung: Beide Lieferanten müssen tatsächlich verwandt sein (gleiche E-Mail/Domain/Markenwort)
            if (keep && merge && areSuppliersRelated(keep, merge)) {
              seenMergeIds.add(d.mergeId)
              verifiedDups.push({
                id: `sup-${d.keepId}-${d.mergeId}`,
                type: 'supplier',
                keepId: keep.id,
                keepName: keep.name,
                keepMeta: keep.email && keep.email !== 'hello@unbekannt.com' ? keep.email : '',
                mergeId: merge.id,
                mergeName: merge.name,
                mergeMeta: merge.email && merge.email !== 'hello@unbekannt.com' ? merge.email : '',
                reason: d.reason || 'Gleicher Lieferant'
              })
            }
          } else if (d.type === 'product') {
            const keep = prodMap.get(d.keepId)
            const merge = prodMap.get(d.mergeId)
            // Harte Nachprüfung: Beide Produkte müssen mindestens ein signifikantes Wort oder den Namen teilen
            if (keep && merge && areProductsRelated(keep, merge)) {
              seenMergeIds.add(d.mergeId)
              verifiedDups.push({
                id: `prod-${d.keepId}-${d.mergeId}`,
                type: 'product',
                keepId: keep.id,
                keepName: keep.name,
                keepMeta: `${keep.category || 'Ohne Kat.'} · Bestand: ${keep.stock ?? 0}`,
                mergeId: merge.id,
                mergeName: merge.name,
                mergeMeta: `${merge.category || 'Ohne Kat.'} · Bestand: ${merge.stock ?? 0}`,
                reason: d.reason || 'Gleiches Produkt'
              })
            }
          }
        }

        return new Response(JSON.stringify({
          success: true,
          duplicates: verifiedDups,
          stats: {
            totalSuppliers: suppliersList.length,
            totalProducts: productsList.length,
            candidateSuppliers: candidateSuppliers.length,
            candidateProducts: candidateProducts.length
          }
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // 4. EXECUTE MERGE: Ausgewählte Duplikate zusammenführen
      if (action === 'execute_merge') {
        const merges = Array.isArray(body?.merges) ? body.merges : []
        let mergedSuppliers = 0
        let mergedProducts = 0

        for (const m of merges) {
          if (!m?.keepId || !m?.mergeId || m.keepId === m.mergeId) continue

          if (m.type === 'supplier') {
            const { data: rows } = await supabase
              .from('suppliers')
              .select('*')
              .eq('company_id', company_id)
              .in('id', [m.keepId, m.mergeId])

            const keep = (rows || []).find((r: any) => r.id === m.keepId)
            const merge = (rows || []).find((r: any) => r.id === m.mergeId)
            if (!keep || !merge) continue

            // Produkte und Bestellungen auf den verbleibenden Lieferanten umhängen
            await supabase.from('products')
              .update({ supplier_id: keep.id })
              .eq('company_id', company_id)
              .eq('supplier_id', merge.id)

            await supabase.from('orders')
              .update({ supplier_name: keep.name })
              .eq('company_id', company_id)
              .eq('supplier_name', merge.name)

            // Fehlende Kontaktdaten übernehmen
            const patch: any = {}
            if ((!keep.email || keep.email === 'hello@unbekannt.com') && merge.email && merge.email !== 'hello@unbekannt.com') patch.email = merge.email
            if (!keep.phone && merge.phone) patch.phone = merge.phone
            if (!keep.customer_number && merge.customer_number) patch.customer_number = merge.customer_number
            if (!keep.iban && merge.iban) patch.iban = merge.iban
            if (Object.keys(patch).length > 0) {
              await supabase.from('suppliers').update(patch).eq('id', keep.id)
            }

            const { error: delErr } = await supabase.from('suppliers').delete().eq('id', merge.id).eq('company_id', company_id)
            if (!delErr) mergedSuppliers++
          } else if (m.type === 'product') {
            const { data: rows } = await supabase
              .from('products')
              .select('*')
              .eq('company_id', company_id)
              .in('id', [m.keepId, m.mergeId])

            const keep = (rows || []).find((r: any) => r.id === m.keepId)
            const merge = (rows || []).find((r: any) => r.id === m.mergeId)
            if (!keep || !merge) continue

            // Bestellungen und Preishistorie auf das verbleibende Produkt umhängen
            await supabase.from('orders')
              .update({ product_name: keep.name })
              .eq('company_id', company_id)
              .eq('product_name', merge.name)

            await supabase.from('product_price_history')
              .update({ product_id: keep.id })
              .eq('product_id', merge.id)

            // Bestand addieren & fehlende Felder ergänzen
            const patch: any = {
              stock: (Number(keep.stock) || 0) + (Number(merge.stock) || 0)
            }
            if ((!keep.price || Number(keep.price) === 0) && Number(merge.price) > 0) patch.price = merge.price
            if ((!keep.min_stock || Number(keep.min_stock) === 0) && Number(merge.min_stock) > 0) patch.min_stock = merge.min_stock
            if ((!keep.category || keep.category === 'Sonstiges' || keep.category === 'Ohne Kategorie') && merge.category && merge.category !== 'Sonstiges' && merge.category !== 'Ohne Kategorie') {
              patch.category = merge.category
            }
            if (!keep.supplier_id && merge.supplier_id) patch.supplier_id = merge.supplier_id

            await supabase.from('products').update(patch).eq('id', keep.id)

            const { error: delErr } = await supabase.from('products').delete().eq('id', merge.id).eq('company_id', company_id)
            if (!delErr) mergedProducts++
          }
        }

        return new Response(JSON.stringify({
          success: true,
          mergedSuppliers,
          mergedProducts,
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // 5. EXTRACT URL METADATA: Beim Einfügen eines Shop-Links Bild, Titel, Preis, Artikelnummer & Lieferant laden
      if (action === 'extract_url_metadata') {
        const rawUrl = String(body?.url || '').trim()
        const productNameHint = String(body?.productName || '').trim()
        const supplierNameHint = String(body?.supplierName || '').trim()
        const knownPriceHint = body?.knownPrice !== undefined ? Number(body.knownPrice) : null
        if (!rawUrl) {
          return new Response(JSON.stringify({ success: false, error: 'Keine URL angegeben' }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }

        const normalizedUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`

        // Falls es bereits ein direkter Bild-Link ist (.jpg, .png, .webp, etc.)
        if (/\.(jpg|jpeg|png|webp|gif|avif|svg)(\?.*)?$/i.test(normalizedUrl)) {
          return new Response(JSON.stringify({
            success: true,
            isDirectImage: true,
            image: normalizedUrl,
            alternatives: [normalizedUrl]
          }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }

        let extractedImage = ''
        let extractedTitle = ''
        let extractedSku = ''
        let extractedPrice: number | null = null
        const candidateImages: string[] = []

        // 1. Versuche die Shop-Seite direkt abzurufen (og:image, JSON-LD, Amazon-Bild)
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 4500)
        try {
          const resp = await fetch(normalizedUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8'
            },
            signal: controller.signal
          })
          if (resp.ok) {
            const html = await resp.text()
            const ogImgMatch =
              html.match(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["']/i) ||
              html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image)["']/i)
            if (ogImgMatch?.[1]) {
              try {
                const cand = new URL(ogImgMatch[1].replace(/&amp;/g, '&'), normalizedUrl).href
                if (!/manifest|favicon|icon[-_.]|apple-touch|logo/i.test(cand)) {
                  extractedImage = cand
                  candidateImages.push(cand)
                }
              } catch {}
            }

            // Fallback für Reinigungsberater CDN
            const rbCdnMatch = html.match(/src=["'](https:\/\/cdn\.reinigungsberater\.de\/products\/[^"']+)["']/i)
            if (rbCdnMatch?.[1]) {
              extractedImage = extractedImage || rbCdnMatch[1]
              if (!candidateImages.includes(rbCdnMatch[1])) candidateImages.push(rbCdnMatch[1])
            }

            // Amazon-spezifisches Produktbild
            const amzImgMatch =
              html.match(/"hiRes"\s*:\s*"(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+)"/i) ||
              html.match(/"large"\s*:\s*"(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+)"/i) ||
              html.match(/id=["']landingImage["'][^>]+src=["'](https:\/\/[^"']+)["']/i)
            if (amzImgMatch?.[1]) {
              extractedImage = extractedImage || amzImgMatch[1]
              if (!candidateImages.includes(amzImgMatch[1])) candidateImages.push(amzImgMatch[1])
            }

            // Titel
            const ogTitleMatch =
              html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
              html.match(/<title[^>]*>([^<]+)<\/title>/i)
            if (ogTitleMatch?.[1]) {
              extractedTitle = ogTitleMatch[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim()
            }

            // JSON-LD Product Schema
            const ldMatches = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
            for (const m of ldMatches) {
              try {
                const parsed = JSON.parse(m[1].trim())
                const nodes = Array.isArray(parsed) ? parsed : (parsed['@graph'] || [parsed])
                for (const node of nodes) {
                  if (node && (node['@type'] === 'Product' || node.sku || node.offers)) {
                    if (!extractedTitle && node.name) extractedTitle = String(node.name).trim()
                    if (!extractedSku && (node.sku || node.mpn || node.productID)) {
                      extractedSku = String(node.sku || node.mpn || node.productID).trim()
                    }
                    const imgField = Array.isArray(node.image) ? node.image[0] : (node.image?.url || node.image)
                    if (typeof imgField === 'string' && imgField) {
                      const absImg = new URL(imgField, normalizedUrl).href
                      if (!extractedImage) extractedImage = absImg
                      if (!candidateImages.includes(absImg)) candidateImages.push(absImg)
                    }
                    const offer = Array.isArray(node.offers) ? node.offers[0] : node.offers
                    const pVal = parseFloat(String(offer?.price || offer?.lowPrice || '').replace(',', '.'))
                    if (!isNaN(pVal) && pVal > 0 && !extractedPrice) extractedPrice = pVal
                  }
                }
              } catch {}
            }
            if (!extractedPrice) {
              extractedPrice = extractPriceFromHtml(html)
            }
          }
        } catch (e) {
          console.warn('Direct URL fetch blocked or timed out, falling back to search:', e)
        } finally {
          clearTimeout(timer)
        }

        // 2. Fallback / Ergänzung über Bing Image Search (funktioniert auch bei Bot-Schutz wie hygi.de oder Amazon!)
        let hostname = ''
        let slugQuery = ''
        try {
          const u = new URL(normalizedUrl)
          hostname = u.hostname.replace(/^www\./i, '').toLowerCase()
          slugQuery = u.pathname
            .replace(/\.(html?|php|aspx?)$/i, '')
            .replace(/[^a-zA-Z0-9äöüÄÖÜß]+/g, ' ')
            .trim()
        } catch {}

        const searchQuery = productNameHint
          ? `${productNameHint} ${hostname || supplierNameHint}`.trim()
          : `${hostname} ${slugQuery}`.trim()

        if (!extractedImage || candidateImages.length < 2) {
          const bingRes = await searchBingProductMeta(searchQuery, hostname)
          if (!extractedImage && bingRes.image) {
            extractedImage = bingRes.image
          }
          if (!extractedTitle && bingRes.title) {
            extractedTitle = bingRes.title
          }
          for (const alt of bingRes.alternatives) {
            if (!candidateImages.includes(alt)) candidateImages.push(alt)
          }
        }

        // 3. Passenden Lieferanten anhand der URL-Domain in der Datenbank suchen
        let matchedSupplierId: string | null = null
        let matchedSupplierName: string | null = null
        if (hostname) {
          const { data: sups } = await supabase
            .from('suppliers')
            .select('id, name, email, url, order_url')
            .eq('company_id', company_id)
          const brandPart = hostname.split('.')[0]
          for (const s of (sups || [])) {
            const sDom = resolveSupplierDomainHint(s.name, s.url || s.order_url, s.email)
            if (
              (sDom && (hostname.includes(sDom) || sDom.includes(hostname))) ||
              (brandPart.length >= 4 && (s.name || '').toLowerCase().includes(brandPart))
            ) {
              matchedSupplierId = s.id
              matchedSupplierName = s.name
              break
            }
          }
        }

        const { category, unit } = inferCategoryAndUnit(productNameHint || extractedTitle)
        const priceCheck = evaluatePricePlausibility(extractedPrice, knownPriceHint)

        const filteredCandidates = candidateImages.filter(img => img && !/manifest|favicon|icon[-_.]|apple-touch|logo/i.test(img))
        if (extractedImage && !filteredCandidates.includes(extractedImage)) {
          filteredCandidates.unshift(extractedImage)
        }

        return new Response(JSON.stringify({
          success: true,
          orderUrl: normalizedUrl,
          image: extractedImage || filteredCandidates[0] || null,
          alternatives: filteredCandidates.slice(0, 4),
          title: extractedTitle || null,
          sku: extractedSku || null,
          price: extractedPrice,
          priceCheck,
          category,
          unit,
          matchedSupplierId,
          matchedSupplierName
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // 6. GET COMPLETION STATE: Lade Liste der als "vollständig" abgehakten Produkte & Lieferanten
      if (action === 'get_completion_state') {
        const { data: comp } = await supabase
          .from('companies')
          .select('settings')
          .eq('id', company_id)
          .maybeSingle()
        const settings = comp?.settings || {}
        return new Response(JSON.stringify({
          success: true,
          completedProductIds: Array.isArray(settings.completedProductIds) ? settings.completedProductIds : [],
          completedSupplierIds: Array.isArray(settings.completedSupplierIds) ? settings.completedSupplierIds : []
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // 7. SUGGEST COMPLETION: KI- & Web-Vorschläge für unvollständige Produkte und Lieferanten berechnen
      if (action === 'suggest_completion') {
        const items = Array.isArray(body?.items) ? body.items.slice(0, 12) : []

        // Lade letzte E-Mails, vergangene Bestellungen sowie bestehende Produkte & Lieferanten
        // (damit bereits hinterlegte Links beim Lieferanten oder bei anderen Produkten desselben Lieferanten genutzt werden!)
        const [{ data: recentEmails }, { data: recentOrders }, { data: existingProducts }, { data: existingSuppliers }] = await Promise.all([
          supabase
            .from('inbound_emails')
            .select('supplier_name, extracted_data')
            .eq('company_id', company_id)
            .neq('status', 'gemini_error')
            .order('created_at', { ascending: false })
            .limit(60),
          supabase
            .from('orders')
            .select('product_name, supplier_name, quantity')
            .eq('company_id', company_id)
            .order('date', { ascending: false })
            .limit(200),
          supabase
            .from('products')
            .select('id, name, product_number, supplier_id, order_url')
            .eq('company_id', company_id),
          supabase
            .from('suppliers')
            .select('id, name, email, url, order_url')
            .eq('company_id', company_id)
        ])

        const emailMetaBySupplier = new Map<string, { email?: string; phone?: string; customer_number?: string }>()
        const skuByProductName = new Map<string, string>()
        const priceByProductName = new Map<string, number>()
        const quantitiesByProductName = new Map<string, number[]>()
        const supplierNameByProductName = new Map<string, string>()
        const shopDomainBySupplierName = new Map<string, string>()
        const existingProductOrderUrlByName = new Map<string, string>()

        const supplierById = new Map<string, any>()
        const supplierIdByLowerName = new Map<string, string>()
        for (const sup of (existingSuppliers || [])) {
          supplierById.set(sup.id, sup)
          if (sup.name) {
            supplierIdByLowerName.set(String(sup.name).trim().toLowerCase(), sup.id)
          }
          const rawUrl = sup.order_url || sup.url || ''
          if (rawUrl) {
            try {
              const host = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`).hostname.replace(/^www\./i, '').toLowerCase()
              if (host && sup.name) shopDomainBySupplierName.set(String(sup.name).trim().toLowerCase(), host)
            } catch {}
          }
        }

        const findMatchingSupplierId = (rawSupName?: string, domainHint?: string): string => {
          if (rawSupName) {
            const lower = rawSupName.trim().toLowerCase()
            if (supplierIdByLowerName.has(lower)) return supplierIdByLowerName.get(lower)!
            for (const sup of (existingSuppliers || [])) {
              const sLow = String(sup.name || '').trim().toLowerCase()
              if (sLow && (sLow.includes(lower) || lower.includes(sLow))) return sup.id
            }
          }
          if (domainHint) {
            const cleanDom = domainHint.replace(/^www\./i, '').toLowerCase()
            const brand = cleanDom.split('.')[0]
            for (const sup of (existingSuppliers || [])) {
              const sDom = resolveSupplierDomainHint(sup.name, sup.url || sup.order_url, sup.email)
              if (
                (sDom && (cleanDom.includes(sDom) || sDom.includes(cleanDom))) ||
                (brand.length >= 4 && String(sup.name || '').toLowerCase().includes(brand))
              ) {
                return sup.id
              }
            }
          }
          return ''
        }

        for (const prod of (existingProducts || [])) {
          if (prod?.order_url && String(prod.order_url).trim()) {
            const pUrl = String(prod.order_url).trim()
            if (prod.name) {
              existingProductOrderUrlByName.set(String(prod.name).trim().toLowerCase(), pUrl)
            }
            if (prod.supplier_id && supplierById.has(prod.supplier_id)) {
              const sup = supplierById.get(prod.supplier_id)
              const sNameKey = String(sup?.name || '').trim().toLowerCase()
              if (sNameKey && !shopDomainBySupplierName.has(sNameKey)) {
                try {
                  const host = new URL(pUrl.startsWith('http') ? pUrl : `https://${pUrl}`).hostname.replace(/^www\./i, '').toLowerCase()
                  if (host) shopDomainBySupplierName.set(sNameKey, host)
                } catch {}
              }
            }
          }
        }

        const recordQuantity = (rawName: string, qtyVal: any, supName?: string) => {
          const k1 = String(rawName || '').trim().toLowerCase()
          const k2 = cleanProductName(String(rawName || '')).toLowerCase()
          if (supName && String(supName).trim()) {
            for (const k of new Set([k1, k2])) {
              if (k && !supplierNameByProductName.has(k)) {
                supplierNameByProductName.set(k, String(supName).trim())
              }
            }
          }
          const q = Math.round(Number(qtyVal || 0))
          if (!rawName || q <= 0 || q > 500) return
          for (const k of new Set([k1, k2])) {
            if (!k) continue
            const arr = quantitiesByProductName.get(k) || []
            arr.push(q)
            quantitiesByProductName.set(k, arr)
          }
        }

        for (const o of (recentOrders || [])) {
          if (o?.product_name) {
            recordQuantity(o.product_name, o.quantity, o.supplier_name)
          }
        }

        for (const row of (recentEmails || [])) {
          const ed = row.extracted_data as any
          if (!ed) continue
          const sName = (ed.supplier_name || row.supplier_name || '').trim().toLowerCase()
          if (sName) {
            const prev = emailMetaBySupplier.get(sName) || {}
            if (!prev.email && ed.supplier_email && ed.supplier_email !== 'hello@unbekannt.com') prev.email = ed.supplier_email
            if (!prev.phone && ed.supplier_phone) prev.phone = ed.supplier_phone
            if (!prev.customer_number && ed.customer_number) prev.customer_number = ed.customer_number
            emailMetaBySupplier.set(sName, prev)
          }
          for (const it of (ed.items || [])) {
            if (it?.product_name) {
              const pKey = String(it.product_name).trim().toLowerCase()
              const cKey = cleanProductName(String(it.product_name)).toLowerCase()
              if (it?.sku) {
                const skuStr = String(it.sku).trim()
                if (!skuByProductName.has(pKey)) skuByProductName.set(pKey, skuStr)
                if (cKey && !skuByProductName.has(cKey)) skuByProductName.set(cKey, skuStr)
              }
              const unitP = Number(it?.unit_price || it?.price || 0)
              if (unitP > 0) {
                if (!priceByProductName.has(pKey)) priceByProductName.set(pKey, unitP)
                if (cKey && !priceByProductName.has(cKey)) priceByProductName.set(cKey, unitP)
              }
              recordQuantity(it.product_name, it.quantity, ed.supplier_name || row.supplier_name)
            }
          }
        }

        // Hilfsfunktion: Direkte Shop-Produktseite über Artikelnummer oder Shop-Suche ermitteln
        const resolveDirectShopProduct = async (
          webshopDomain: string,
          sku: string,
          productName: string
        ): Promise<{ orderUrl: string; image: string; shopPrice: number | null }> => {
          if (!webshopDomain) return { orderUrl: '', image: '', shopPrice: null }
          const normalizedName = productName.replace(/[×]/g, 'x').trim()
          const coreName = normalizedName.replace(/\b\d+\s*x\s*\d+\b.*$/i, '').trim() || normalizedName

          // 1. Böttcher AG & Reinigungsberater.de: Direkte Artikelnummer-Auflösung (/artikel-p-{SKU}) oder Shop-Suche (/suche?q=...)
          if (webshopDomain === 'reinigungsberater.de' || webshopDomain === 'bueromarkt-ag.de') {
            if (sku) {
              const ctrl = new AbortController()
              const t = setTimeout(() => ctrl.abort(), 3200)
              try {
                const directSkuUrl = `https://www.${webshopDomain}/artikel-p-${encodeURIComponent(sku)}`
                const r = await fetch(directSkuUrl, {
                  headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    'Accept-Language': 'de-DE,de;q=0.9'
                  },
                  redirect: 'follow',
                  signal: ctrl.signal
                })
                if (r.ok && r.url && /-p-[A-Za-z0-9_-]+/i.test(r.url)) {
                  const html = await r.text()
                  let ogImg = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] || ''
                  if (!ogImg || /manifest|favicon|icon[-_.]|apple-touch|logo/i.test(ogImg)) {
                    const cdnImg = html.match(/src=["'](https:\/\/cdn\.reinigungsberater\.de\/products\/[^"']+)["']/i)?.[1]
                    ogImg = cdnImg || ''
                  }
                  const sp = extractPriceFromHtml(html)
                  return { orderUrl: r.url, image: ogImg, shopPrice: sp }
                }
              } catch {} finally {
                clearTimeout(t)
              }
            }

            // Fallback über die direkte Shop-Suche von reinigungsberater.de / bueromarkt-ag.de
            const ctrl2 = new AbortController()
            const t2 = setTimeout(() => ctrl2.abort(), 3200)
            try {
              const qStr = sku ? `${sku} ${coreName}` : coreName
              const searchUrl = `https://www.${webshopDomain}/suche?q=${encodeURIComponent(qStr)}`
              const r2 = await fetch(searchUrl, {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                  'Accept-Language': 'de-DE,de;q=0.9'
                },
                redirect: 'follow',
                signal: ctrl2.signal
              })
              if (r2.ok) {
                if (r2.url && /-p-[A-Za-z0-9_-]+/i.test(r2.url)) {
                  const html = await r2.text()
                  const ogImg = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] || ''
                  return { orderUrl: r2.url, image: ogImg, shopPrice: extractPriceFromHtml(html) }
                }
                const html = await r2.text()
                const absMatches = [...html.matchAll(/href=["'](https?:\/\/www\.(?:reinigungsberater|bueromarkt-ag)\.de\/[^"'?]*-p-[A-Za-z0-9_-]+)["']/gi)].map(m => m[1])
                const relMatches = [...html.matchAll(/href=["'](\/[^"'?]*-p-[A-Za-z0-9_-]+)["']/gi)].map(m => `https://www.${webshopDomain}${m[1]}`)
                const candidates = [...new Set([...absMatches, ...relMatches])]
                const skuMatch = sku ? candidates.find(u => u.toLowerCase().includes(sku.toLowerCase())) : null
                const bestUrl = skuMatch || candidates[0] || ''
                if (bestUrl) {
                  return { orderUrl: bestUrl, image: '', shopPrice: null }
                }
              }
            } catch {} finally {
              clearTimeout(t2)
            }
          }

          // 2. Amazon ASIN Direkt-Link
          if (webshopDomain === 'amazon.de' && sku && /^B0[A-Z0-9]{8}$/i.test(sku)) {
            const amzUrl = `https://www.amazon.de/dp/${sku.toUpperCase()}`
            let amzImg = ''
            try {
              const ctrl = new AbortController()
              const t = setTimeout(() => ctrl.abort(), 2400)
              const r = await fetch(amzUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' },
                signal: ctrl.signal
              })
              clearTimeout(t)
              if (r.ok) {
                const html = await r.text()
                const m = html.match(/"hiRes"\s*:\s*"(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+)"/i) ||
                  html.match(/src=["'](https:\/\/m\.media-amazon\.com\/images\/I\/[^"']+)["']/i)
                if (m?.[1]) amzImg = m[1]
              }
            } catch {}
            return { orderUrl: amzUrl, image: amzImg, shopPrice: null }
          }

          // 3. Gezielte site:-Suche über Bing mit bereinigtem Kern-Produktnamen + Artikelnummer
          const siteQuery = `site:${webshopDomain} ${sku ? sku + ' ' : ''}${coreName}`.trim()
          const siteBing = await searchBingProductMeta(siteQuery, webshopDomain)
          if (siteBing.orderUrl) {
            return { orderUrl: siteBing.orderUrl, image: siteBing.image || '', shopPrice: null }
          }

          // 4. Falls in keiner Suchmaschine eine Einzel-Unterseite indexiert ist, aber der Webshop bekannt ist:
          // Direkten Such-Link im Webshop des Lieferanten generieren (damit man mit 1 Klick direkt beim Artikel im Shop landet!)
          const searchParam = encodeURIComponent(sku || coreName)
          if (webshopDomain === 'reinigungsberater.de' || webshopDomain === 'bueromarkt-ag.de') {
            return { orderUrl: `https://www.${webshopDomain}/suche?q=${searchParam}`, image: '', shopPrice: null }
          }
          if (webshopDomain === 'hygi.de') {
            return { orderUrl: `https://www.hygi.de/catalogsearch/result/?q=${searchParam}`, image: '', shopPrice: null }
          }
          if (webshopDomain === 'amazon.de') {
            return { orderUrl: `https://www.amazon.de/s?k=${searchParam}`, image: '', shopPrice: null }
          }
          if (webshopDomain === 'lusini.com') {
            return { orderUrl: `https://www.lusini.com/de-de/search/?q=${searchParam}`, image: '', shopPrice: null }
          }
          return { orderUrl: '', image: '', shopPrice: null }
        }

        const results = await Promise.all(items.map(async (item: any) => {
          if (item.type === 'supplier') {
            const lowerName = String(item.name || '').trim().toLowerCase()
            const fromMail = emailMetaBySupplier.get(lowerName) || {}
            let effectiveEmail = (item.email && item.email !== 'hello@unbekannt.com') ? item.email : (fromMail.email || '')
            let effectivePhone = item.phone || fromMail.phone || ''
            const domHint = resolveSupplierDomainHint(item.name, item.url, effectiveEmail) || shopDomainBySupplierName.get(lowerName) || ''
            const suggestedUrl = item.url || (domHint ? (domHint.startsWith('shop.') || domHint.startsWith('cloud.') ? `https://${domHint}` : `https://www.${domHint.replace(/^www\./, '')}`) : '')
            const isEmailOnly = isEmailOnlyWholesaler(item.name, effectiveEmail)
            const suggestedOrderMethod: 'email' | 'webshop' = isEmailOnly
              ? 'email'
              : (suggestedUrl || domHint ? 'webshop' : 'email')

            // Falls Telefon oder E-Mail noch fehlen und eine Webseite bekannt ist, kurz nach tel: / mailto: auf der Seite schauen
            if (suggestedUrl && (!effectivePhone || !effectiveEmail)) {
              const ctrl = new AbortController()
              const t = setTimeout(() => ctrl.abort(), 2400)
              try {
                const r = await fetch(suggestedUrl, {
                  headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    'Accept-Language': 'de-DE,de;q=0.9'
                  },
                  signal: ctrl.signal
                })
                if (r.ok) {
                  const html = await r.text()
                  if (!effectivePhone) {
                    const telMatch = html.match(/href=["']tel:([+0-9\s()/.-]{7,22})["']/i)
                    if (telMatch?.[1]) effectivePhone = telMatch[1].trim()
                  }
                  if (!effectiveEmail) {
                    const mailMatch = html.match(/href=["']mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})["']/i)
                    if (mailMatch?.[1]) effectiveEmail = mailMatch[1].trim()
                  }
                }
              } catch {} finally {
                clearTimeout(t)
              }
            }

            return {
              id: item.id,
              type: 'supplier',
              url: suggestedUrl,
              email: effectiveEmail,
              phone: effectivePhone,
              customerNumber: item.customerNumber || fromMail.customer_number || '',
              preferredOrderMethod: item.preferredOrderMethod || suggestedOrderMethod
            }
          } else {
            const cleanedName = cleanProductName(item.name || '')
            const lowerProdName = String(item.name || '').trim().toLowerCase()
            const lowerCleanName = cleanedName.toLowerCase()
            const mailSku = skuByProductName.get(lowerProdName) || skuByProductName.get(lowerCleanName) || ''
            const effectiveSku = String(item.productNumber || mailSku || '').trim()
            const mailPrice = priceByProductName.get(lowerProdName) || priceByProductName.get(lowerCleanName) || null
            const knownPrice = (item.price && Number(item.price) > 0) ? Number(item.price) : mailPrice

            // Punkt 3: Falls dem Produkt noch kein Lieferant zugeordnet ist, aus vergangenen Bestellungen/Mails ermitteln
            const historicalSupName = supplierNameByProductName.get(lowerProdName) || supplierNameByProductName.get(lowerCleanName) || ''
            const effectiveSupName = item.supplierName || historicalSupName
            let suggestedSupplierId = item.supplierId || (historicalSupName ? findMatchingSupplierId(historicalSupName) : '')

            const isEmailWholesaler = isEmailOnlyWholesaler(effectiveSupName, item.supplierEmail)
            const lowerSupName = String(effectiveSupName || '').trim().toLowerCase()
            const learnedSupDomain = !isEmailWholesaler && lowerSupName ? (shopDomainBySupplierName.get(lowerSupName) || '') : ''
            const webshopDomain = resolveWebshopDomain(effectiveSupName, item.supplierUrl || learnedSupDomain, item.isWebshopSupplier, item.supplierEmail) || learnedSupDomain

            // 1. Zuerst prüfen, ob genau dieses Produkt (oder die direkte Artikelnummer im Shop) schon einen Link hat
            let suggestedOrderUrl = item.orderUrl || existingProductOrderUrlByName.get(lowerProdName) || ''
            let directImage = ''
            let shopPrice: number | null = null

            // 2. Bildersuche über Bing (mit Artikelnummer + bereinigtem Namen!)
            const normalizedSearchName = (cleanedName || item.name || '').replace(/[×]/g, 'x')
            const query = `${normalizedSearchName} ${effectiveSku} ${webshopDomain}`.trim()
            const bingRes = await searchBingProductMeta(query, webshopDomain)

            if (!suggestedOrderUrl && webshopDomain && bingRes.orderUrl) {
              suggestedOrderUrl = bingRes.orderUrl
            }

            // 3. Falls über die reine Bildersuche noch kein Shop-Link auf der Lieferanten-Domain gefunden wurde,
            // direkt über Artikelnummer / Shop-Suche / site:-Suche auf der Lieferanten-Domain auflösen!
            if (!suggestedOrderUrl && webshopDomain) {
              const directRes = await resolveDirectShopProduct(webshopDomain, effectiveSku, cleanedName || item.name || '')
              if (directRes.orderUrl) {
                suggestedOrderUrl = directRes.orderUrl
              }
              if (directRes.image) {
                directImage = directRes.image
              }
              if (directRes.shopPrice) {
                shopPrice = directRes.shopPrice
              }
            }

            if (!suggestedSupplierId && (suggestedOrderUrl || webshopDomain)) {
              try {
                const dom = suggestedOrderUrl
                  ? new URL(suggestedOrderUrl.startsWith('http') ? suggestedOrderUrl : `https://${suggestedOrderUrl}`).hostname
                  : webshopDomain
                suggestedSupplierId = findMatchingSupplierId(effectiveSupName, dom)
              } catch {}
            }

            const { category, unit } = inferCategoryAndUnit(item.name, item.category, item.unit)

            // Wenn eine Shop-URL vorliegt, versuche den Preis sowie Bild & Artikelnummer direkt von der Zielseite zu laden
            if (suggestedOrderUrl) {
              const ctrl = new AbortController()
              const t = setTimeout(() => ctrl.abort(), 2800)
              try {
                const r = await fetch(suggestedOrderUrl, {
                  headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    'Accept-Language': 'de-DE,de;q=0.9'
                  },
                  signal: ctrl.signal
                })
                if (r.ok) {
                  const html = await r.text()
                  if (!shopPrice) shopPrice = extractPriceFromHtml(html)
                  if (!directImage && !item.image) {
                    let ogImg = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] || ''
                    if (ogImg && !/manifest|favicon|icon[-_.]|apple-touch|logo/i.test(ogImg)) {
                      directImage = ogImg
                    } else {
                      const cdnImg = html.match(/src=["'](https:\/\/cdn\.reinigungsberater\.de\/products\/[^"']+)["']/i)?.[1]
                      const amzImg = html.match(/"hiRes"\s*:\s*"(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+)"/i)?.[1]
                      if (cdnImg) directImage = cdnImg
                      else if (amzImg) directImage = amzImg
                    }
                  }
                  if (!effectiveSku) {
                    const skuFromUrl = suggestedOrderUrl.match(/,p-([a-zA-Z0-9_-]+)\.html/i)?.[1] ||
                      suggestedOrderUrl.match(/\/dp\/([A-Z0-9]{10})/i)?.[1]
                    if (skuFromUrl) effectiveSku = skuFromUrl
                  }
                }
              } catch {} finally {
                clearTimeout(t)
              }
            }

            const priceCheck = evaluatePricePlausibility(shopPrice, knownPrice)
            const suggestedPrice = (!item.price || Number(item.price) === 0)
              ? (shopPrice || mailPrice || 0)
              : Number(item.price)

            // Punkt 2: Typische Bestellmenge immer vorschlagen, aber Mindestbestand (minStock > 0) NUR dann vorschlagen,
            // wenn das Produkt in der Vergangenheit mindestens 2x bestellt wurde (also ein wiederkehrender Verbrauchsartikel ist!).
            // Bei Einmal-Käufen bleibt minStock = 0 (keine falschen "Niedriger Bestand"-Alarme!).
            const pastQtys = quantitiesByProductName.get(lowerProdName) || quantitiesByProductName.get(lowerCleanName) || []
            let defaultOrderQty = 1
            if (pastQtys.length > 0) {
              const sorted = [...pastQtys].sort((a, b) => a - b)
              defaultOrderQty = Math.max(1, sorted[Math.floor(sorted.length / 2)])
            } else if (unit === 'Kasten' || unit === 'Karton' || unit === 'Kanister') {
              defaultOrderQty = 2
            } else if (category === 'Getränke' || category === 'Lebensmittel') {
              defaultOrderQty = 4
            }

            const suggestedStandardOrderQuantity = (item.standardOrderQuantity && Number(item.standardOrderQuantity) > 0)
              ? Number(item.standardOrderQuantity)
              : defaultOrderQty
            const suggestedMinStock = (item.minStock && Number(item.minStock) > 0)
              ? Number(item.minStock)
              : (pastQtys.length >= 2 ? Math.max(1, Math.floor(suggestedStandardOrderQuantity / 2)) : 0)

            // Bestellweg: Webshop bei Shop-Link oder Webshop-Lieferant, E-Mail bei Großhändlern wie HEWO / Schwälbchen
            const suggestedPreferredOrderMethod: 'email' | 'webshop' | 'phone' = isEmailWholesaler
              ? 'email'
              : (suggestedOrderUrl || webshopDomain || item.isWebshopSupplier ? 'webshop' : (item.preferredOrderMethod || 'webshop'))

            const allAlternatives = [...new Set([directImage, ...(bingRes.alternatives || [])].filter(Boolean))]

            return {
              id: item.id,
              type: 'product',
              cleanName: cleanedName && cleanedName !== item.name ? cleanedName : undefined,
              supplierId: suggestedSupplierId || undefined,
              image: item.image || directImage || bingRes.image || '',
              alternatives: allAlternatives,
              orderUrl: suggestedOrderUrl,
              productNumber: effectiveSku,
              price: suggestedPrice,
              priceCheck,
              category,
              unit,
              minStock: suggestedMinStock,
              standardOrderQuantity: suggestedStandardOrderQuantity,
              preferredOrderMethod: suggestedPreferredOrderMethod
            }
          }
        }))

        return new Response(JSON.stringify({
          success: true,
          suggestions: results
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // 8. SAVE COMPLETION: Speichere vervollständigte Produkte & Lieferanten und markiere sie als erledigt
      if (action === 'save_completion') {
        const prodUpdates = Array.isArray(body?.products) ? body.products : []
        const supUpdates = Array.isArray(body?.suppliers) ? body.suppliers : []
        const unmarkProductIds = new Set<string>(Array.isArray(body?.unmarkProductIds) ? body.unmarkProductIds : [])
        const unmarkSupplierIds = new Set<string>(Array.isArray(body?.unmarkSupplierIds) ? body.unmarkSupplierIds : [])

        const { data: comp } = await supabase
          .from('companies')
          .select('settings')
          .eq('id', company_id)
          .maybeSingle()

        const currentSettings = (comp?.settings && typeof comp.settings === 'object') ? { ...comp.settings } : {}
        const completedProdSet = new Set<string>(Array.isArray(currentSettings.completedProductIds) ? currentSettings.completedProductIds : [])
        const completedSupSet = new Set<string>(Array.isArray(currentSettings.completedSupplierIds) ? currentSettings.completedSupplierIds : [])

        for (const id of unmarkProductIds) completedProdSet.delete(id)
        for (const id of unmarkSupplierIds) completedSupSet.delete(id)

        // Punkt 1: Vor dem Umbenennen die bisherigen Namen laden, damit bestehende Bestellungen (orders.product_name / orders.supplier_name)
        // automatisch mit-aktualisiert werden und die Bestell-/Preishistorie nicht abreißt!
        const prodIdsToFetch = prodUpdates.map((p: any) => p?.id).filter(Boolean)
        const oldProdNameById = new Map<string, string>()
        if (prodIdsToFetch.length > 0) {
          const { data: oldProds } = await supabase
            .from('products')
            .select('id, name')
            .eq('company_id', company_id)
            .in('id', prodIdsToFetch)
          for (const op of (oldProds || [])) {
            if (op?.id && op?.name) oldProdNameById.set(op.id, String(op.name))
          }
        }

        const supIdsToFetch = supUpdates.map((s: any) => s?.id).filter(Boolean)
        const oldSupNameById = new Map<string, string>()
        if (supIdsToFetch.length > 0) {
          const { data: oldSups } = await supabase
            .from('suppliers')
            .select('id, name')
            .eq('company_id', company_id)
            .in('id', supIdsToFetch)
          for (const os of (oldSups || [])) {
            if (os?.id && os?.name) oldSupNameById.set(os.id, String(os.name))
          }
        }

        let savedProducts = 0
        let savedSuppliers = 0

        for (const p of prodUpdates) {
          if (!p?.id) continue
          const patch: any = { is_auto_generated: false }
          if (p.name !== undefined && String(p.name).trim()) patch.name = String(p.name).trim()
          if (p.category !== undefined) patch.category = p.category
          if (p.unit !== undefined) patch.unit = p.unit
          if (p.price !== undefined && p.price !== null && p.price !== '') patch.price = Number(p.price) || 0
          if (p.min_stock !== undefined && p.min_stock !== null && p.min_stock !== '') patch.min_stock = Number(p.min_stock) || 0
          if (p.standard_order_quantity !== undefined && p.standard_order_quantity !== null && p.standard_order_quantity !== '') {
            patch.standard_order_quantity = Number(p.standard_order_quantity) || null
          }
          if (p.product_number !== undefined) patch.product_number = p.product_number || null
          if (p.supplier_id !== undefined) patch.supplier_id = p.supplier_id || null
          if (p.order_url !== undefined) {
            patch.order_url = p.order_url || null
            if (p.order_url && !p.preferred_order_method) {
              patch.preferred_order_method = 'webshop'
            }
          }
          if (p.preferred_order_method !== undefined) patch.preferred_order_method = p.preferred_order_method || null
          if (p.image !== undefined) patch.image = p.image || null

          const oldName = oldProdNameById.get(p.id)
          const { error: uErr } = await supabase
            .from('products')
            .update(patch)
            .eq('id', p.id)
            .eq('company_id', company_id)

          if (!uErr) {
            savedProducts++
            if (p.markComplete !== false) completedProdSet.add(p.id)
            // Falls der Produktname geändert/bereinigt wurde, alle Bestellungen mit dem alten Produktnamen synchronisieren!
            if (oldName && patch.name && oldName !== patch.name) {
              await supabase
                .from('orders')
                .update({ product_name: patch.name })
                .eq('company_id', company_id)
                .eq('product_name', oldName)
            }
          }
        }

        for (const s of supUpdates) {
          if (!s?.id) continue
          const patch: any = { is_auto_generated: false }
          if (s.name !== undefined && String(s.name).trim()) patch.name = String(s.name).trim()
          if (s.email !== undefined) patch.email = s.email || 'hello@unbekannt.com'
          if (s.phone !== undefined) patch.phone = s.phone || null
          if (s.url !== undefined) {
            patch.url = s.url || null
            if (s.url) patch.order_url = s.url
          }
          if (s.customer_number !== undefined) patch.customer_number = s.customer_number || null
          if (s.preferred_order_method !== undefined) patch.preferred_order_method = s.preferred_order_method || null

          const oldSupName = oldSupNameById.get(s.id)
          const { error: sErr } = await supabase
            .from('suppliers')
            .update(patch)
            .eq('id', s.id)
            .eq('company_id', company_id)

          if (!sErr) {
            savedSuppliers++
            if (s.markComplete !== false) completedSupSet.add(s.id)
            if (oldSupName && patch.name && oldSupName !== patch.name) {
              await supabase
                .from('orders')
                .update({ supplier_name: patch.name })
                .eq('company_id', company_id)
                .eq('supplier_name', oldSupName)
            }
          }
        }

        currentSettings.completedProductIds = [...completedProdSet]
        currentSettings.completedSupplierIds = [...completedSupSet]

        await supabase
          .from('companies')
          .update({ settings: currentSettings })
          .eq('id', company_id)

        return new Response(JSON.stringify({
          success: true,
          savedProducts,
          savedSuppliers,
          completedProductIds: currentSettings.completedProductIds,
          completedSupplierIds: currentSettings.completedSupplierIds
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      return new Response(JSON.stringify({ error: `Unbekannte Aktion: ${action}` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // =========================================================================
    // MODUS B: SendGrid Inbound Parse Webhook (multipart/form-data)
    // =========================================================================
    const inboundSecret = Deno.env.get('INBOUND_WEBHOOK_SECRET')
    if (inboundSecret) {
      const url = new URL(req.url)
      const querySecret = url.searchParams.get('secret')
      const authHeader = req.headers.get('Authorization')
      if (querySecret !== inboundSecret && authHeader !== `Bearer ${inboundSecret}`) {
        console.warn('[process-inbound-mail] Unauthorized webhook request blocked')
        return new Response("Unauthorized webhook", { status: 401 })
      }
    }

    const formData = await req.formData()
    const to = formData.get('to') as string || ''
    const fromAddress = formData.get('from') as string || ''
    const subject = formData.get('subject') as string || ''
    const bodyText = formData.get('text') as string || formData.get('html') as string || ''

    console.log(`Received email to: ${to}, from: ${fromAddress}, subject: ${subject}`)

    const secureMatch = to.match(/in-([a-zA-Z0-9\-]+)-([a-f0-9]{32})@/)
    if (!secureMatch) {
      console.error("Security violation: Inbound email without valid secret token rejected:", to)
      return new Response("Unauthorized - Valid security token required", { status: 401 })
    }

    const user_id = secureMatch[1]
    const providedSecret = secureMatch[2]

    const { data: userProfile } = await supabase
      .from('profiles')
      .select('id, inventory_valuation_method, company_id, inbound_email_secret')
      .eq('id', user_id)
      .maybeSingle()

    if (!userProfile) {
      console.error("User ID not found in profiles:", user_id)
      return new Response("User not found", { status: 404 })
    }

    if (!userProfile.inbound_email_secret || providedSecret !== userProfile.inbound_email_secret) {
      console.error("Invalid inbound email secret for user:", user_id)
      return new Response("Unauthorized", { status: 401 })
    }

    const valuation_method = userProfile.inventory_valuation_method || 'latest'
    const company_id = userProfile.company_id

    // Dateianhänge (PDFs, Bilder) extrahieren
    const attachmentsCountStr = formData.get('attachments') as string
    const attachmentsCount = attachmentsCountStr ? parseInt(attachmentsCountStr, 10) : 0
    console.log(`Received attachments count from Sendgrid: ${attachmentsCount}`)

    const attachmentParts: any[] = []
    let processedAttachmentsCount = 0
    const MAX_ATTACHMENTS_TO_PROCESS = 5

    for (let i = 1; i <= attachmentsCount; i++) {
      if (processedAttachmentsCount >= MAX_ATTACHMENTS_TO_PROCESS) break
      const file = formData.get(`attachment${i}`) as File | null
      if (file) {
        const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024 // 10 MB
        if (file.size > MAX_ATTACHMENT_SIZE) continue
        const mimeType = file.type || 'application/octet-stream'
        if (mimeType === 'application/pdf' || mimeType.startsWith('image/')) {
          const arrayBuffer = await file.arrayBuffer()
          const base64Data = encode(new Uint8Array(arrayBuffer))
          attachmentParts.push({
            inlineData: {
              mimeType: mimeType,
              data: base64Data
            }
          })
          processedAttachmentsCount++
        }
      }
    }

    const result = await processEmailWithAi({
      user_id,
      company_id,
      valuation_method,
      fromAddress,
      subject,
      bodyText,
      attachmentParts,
    })

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    })

  } catch (error) {
    console.error("Error in process-inbound-mail:", error)
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    })
  }
})
