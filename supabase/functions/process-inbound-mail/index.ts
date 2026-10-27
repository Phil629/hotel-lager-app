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

async function processEmailWithAi(params: {
  user_id: string;
  company_id: string;
  valuation_method: string;
  fromAddress: string;
  subject: string;
  bodyText: string;
  attachmentParts?: any[];
  existingLogId?: string;
}) {
  const { user_id, company_id, valuation_method, fromAddress, subject, bodyText, attachmentParts = [], existingLogId } = params

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

  // Lieferant bestimmen oder anlegen
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
    supName = matchedSupplier.name
    parsedData.supplier_name = matchedSupplier.name
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

    if (Object.keys(updatePayload).length > 0) {
      await supabase.from('suppliers').update(updatePayload).eq('id', supplier_id)
    }
  } else if (supName !== 'Unbekannter Lieferant (KI)') {
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

  const shouldCreateOrder = parsedData.should_create_order === true
  const docType = parsedData.document_type || 'unknown'
  console.log(`Document type: ${docType}. Should create order? ${shouldCreateOrder}`)

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

  for (const item of items) {
    if (!item?.product_name) continue

    const lowerName = item.product_name.toLowerCase()
    if (lowerName.includes('versand') || lowerName.includes('pfand') || lowerName.includes('porto') || lowerName.includes('gebühr') || lowerName.includes('logistik') || lowerName.includes('shipping') || lowerName.includes('insurance') || lowerName.includes('discount') || lowerName.includes('protection') || lowerName.includes('rabatt')) {
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

    const canonicalProductName = matchedProd ? matchedProd.name : item.product_name.trim()
    item.product_name = canonicalProductName

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
        const aiDate = parsedData.order_date || new Date().toISOString().slice(0, 10)

        const updatePayload: any = {
          supplier_name: supName
        }

        // Nur bei noch offenen Bestellungen Menge/Datum/Revisions anpassen (bereits erhaltene Bestellungen nicht verändern)
        if (existingOrder.status === 'open') {
          const ai_revisions: any = {}
          let hasRevisions = false

          if (existingOrder.quantity !== aiQuantity) {
            ai_revisions.quantity = { original: existingOrder.quantity, suggested: aiQuantity, reverted: false }
            hasRevisions = true
          }
          if (existingOrder.price !== aiPrice && aiPrice > 0) {
            ai_revisions.price = { original: existingOrder.price || 0, suggested: aiPrice, reverted: false }
            hasRevisions = true
          }
          if (existingOrder.date !== aiDate) {
            ai_revisions.date = { original: existingOrder.date, suggested: aiDate, reverted: false }
            hasRevisions = true
          }

          updatePayload.quantity = aiQuantity
          updatePayload.price = aiPrice > 0 ? aiPrice : existingOrder.price
          updatePayload.date = aiDate
          if (hasRevisions) updatePayload.ai_revisions = ai_revisions
        }

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
          product_name: canonicalProductName,
          quantity: Math.round(Number(item.quantity)) || 1,
          price: Number(item.price) || 0,
          date: parsedData.order_date || new Date().toISOString().slice(0, 10),
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

    // Produkt aktualisieren oder neu anlegen (auf Firmen-Ebene!)
    if (matchedProd) {
      if (item.price && Number(item.price) > 0) {
        let newPrice = Number(item.price)
        if (valuation_method === 'average' && matchedProd.stock > 0 && matchedProd.price > 0) {
          newPrice = ((matchedProd.stock * matchedProd.price) + ((item.quantity || 1) * newPrice)) / (matchedProd.stock + (item.quantity || 1))
        }
        const prodUpdate: any = { price: newPrice }
        if (!matchedProd.supplier_id && supplier_id) prodUpdate.supplier_id = supplier_id
        await supabase.from('products').update(prodUpdate).eq('id', matchedProd.id)
      }
    } else if (supplier_id) {
      const newProd = {
        id: crypto.randomUUID(),
        user_id: user_id,
        company_id: company_id,
        name: canonicalProductName,
        category: item.category || 'Sonstiges',
        price: Number(item.price) || 0,
        supplier_id: supplier_id,
        is_auto_generated: true,
        stock: 0,
        unit: 'Stk'
      }
      const { error: newProdErr } = await supabase.from('products').insert(newProd)
      if (!newProdErr) {
        allProducts.push(newProd)
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

        // Vorfilter: Nur Produkte an die KI schicken, die mindestens ein signifikantes Wort (>= 4 Zeichen)
        // mit einem anderen Produkt teilen. Das reduziert 130+ Produkte auf ~35 Kandidaten -> Antwort in 3-5 Sek.!
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

        const candidateProducts = productsList.filter((p: any) => {
          const nName = (p.name || '').trim().toLowerCase()
          if ((normNameFreq.get(nName) || 0) > 1) return true
          const tokens = prodTokens.get(p.id) || []
          return tokens.some(t => (tokenFreq.get(t) || 0) > 1)
        })

        const dupPrompt = `
Du prüfst die Datenbank eines Hotel-Bestellsystems auf doppelte Lieferanten und doppelte Produkte.

REGELN FÜR LIEFERANTEN-DUPLIKATE:
1. Zwei Lieferanten sind Duplikate, wenn sie dieselbe Firma meinen (z.B. gleiche E-Mail-Adresse/Domain wie "Reinigungsberater" und "Kruse Reinigungstechnik und Hygienebedarf GmbH" mit kontakt@reinigungsberater.de, oder Kurzname vs. GmbH-Name).
2. 'keepId' soll bevorzugt der manuell gepflegte (auto=false) oder kürzere, sauberere Name sein. 'mergeId' ist das Duplikat, das in 'keepId' überführt und danach gelöscht wird.

REGELN FÜR PRODUKT-DUPLIKATE:
1. Zwei Produkte sind Duplikate, wenn sie offensichtlich denselben Artikel bezeichnen, z.B.:
   - Exakt gleicher Name ("Kosmetiktücher" & "Kosmetiktücher", "Milch- & Sahnereiniger" & "Milch- & Sahnereiniger")
   - Kurzname vs. langer Shop-/Rechnungsname desselben Artikels ("Rothaus Pils Zäpfle 24x0,33L" & "Rothaus Tannenzäpfle Pils 24x0,33L", "Teavelope® English Breakfast" & "Teavelope® English Breakfast Schwarzer Tee", "MILIZID Kalklöser" & "DR.SCHNELL MILIZID Sanitärreiniger..." & "Sanitärreiniger Dr. Schnell Milizid Konzentrat 1 L", "Schlemmerrührei 1 kg Tetra Eifix" & "Schlemmerrührei aus Bodenhaltung 1 kg Tetra Eifix", "Samsung Galaxy A16 4GB+128GB (Gray)" & "Samsung Galaxy A16 4GB+128GB [Internationale Version] (Gray)", "Pattex Montagekleber...", "Essigreiniger" & "Essigreiniger Reinex Henkelflasche 1 L", "Toilettenpapier 3 lagig" & "Toilettenpapier 3 lagig Zellstoff...").
2. STRENG VERBOTEN zusammenzuführen sind verschiedene Geschmacksrichtungen, Größen oder Varianten!
   - "Coca Cola 24x0,33l", "Coca Cola light 24x0,33l" und "Coca Cola ZERO 24x0,33L" sind KEINE Duplikate!
   - "Elisabethen PUR 12x0,75L Glas", "Elisabethen PUR 20x0,25L Gastro" und "Elisabethen SPRUDEL 12x0,75L Glas" sind KEINE Duplikate!
   - "Bionade Holunder" und "Bionade Ingwer Orange" sind KEINE Duplikate!
3. Wenn es 3 Einträge für dasselbe Produkt gibt (A, B, C), erstelle zwei Merge-Einträge mit demselben 'keepId' (z.B. B -> A und C -> A).
4. Bevorzuge als 'keepId' den Eintrag mit Bestand (stock > 0), manuell gepflegt (auto=false) oder mit dem klareren Namen.

LIEFERANTEN (${suppliersList.length}):
${suppliersList.map((s: any) => `${s.id} | ${s.name} | ${s.email || ''} | auto=${!!s.is_auto_generated}`).join('\n')}

PRODUKT-KANDIDATEN (${candidateProducts.length} von ${productsList.length}):
${candidateProducts.map((p: any) => `${p.id} | ${p.name} | Kat:${p.category || '-'} | Bestand:${p.stock ?? 0} | Lief:${supNameById.get(p.supplier_id) || '-'} | auto=${!!p.is_auto_generated}`).join('\n')}

Antworte ausschließlich als JSON:
{
  "duplicates": [
    {
      "type": "supplier",
      "keepId": "UUID des Eintrags, der behalten wird",
      "mergeId": "UUID des Duplikats, das zusammengeführt und gelöscht wird",
      "reason": "Kurze Begründung auf Deutsch (z.B. 'Gleiche E-Mail kontakt@reinigungsberater.de')"
    }
  ]
}
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

        for (const d of rawDups) {
          if (!d?.keepId || !d?.mergeId || d.keepId === d.mergeId) continue
          if (seenMergeIds.has(d.mergeId)) continue

          if (d.type === 'supplier') {
            const keep = supMap.get(d.keepId)
            const merge = supMap.get(d.mergeId)
            if (keep && merge) {
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
            if (keep && merge) {
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
