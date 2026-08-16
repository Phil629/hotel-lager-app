import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { encode } from "https://deno.land/std@0.168.0/encoding/base64.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

// Initialisiere Supabase Client
const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!

serve(async (req) => {
  try {
    // SendGrid sendet multipart/form-data
    const formData = await req.formData()
    const to = formData.get('to') as string || ''
    const fromAddress = formData.get('from') as string || ''
    const subject = formData.get('subject') as string || ''
    const bodyText = formData.get('text') as string || formData.get('html') as string || ''

    console.log(`Received email to: ${to}, from: ${fromAddress}, subject: ${subject}`)

    // Secure email routing: address format is in-[USER_ID]-[SECRET]@...
    // The secret prevents spoofed emails from injecting data into arbitrary accounts.
    // Legacy format in-[USER_ID]@ is still accepted but logged as a warning.
    const secureMatch = to.match(/in-([a-zA-Z0-9\-]+)-([a-f0-9]{32})@/)
    const legacyMatch = !secureMatch ? to.match(/in-([a-zA-Z0-9\-]+)@/) : null;

    let user_id: string | null = null;
    let providedSecret: string | null = null;
    let valuation_method = 'latest';

    console.log("Extracted TO address:", to);

    if (secureMatch) {
      user_id = secureMatch[1];
      providedSecret = secureMatch[2];
    } else if (legacyMatch) {
      user_id = legacyMatch[1];
      console.warn("Legacy email format (no secret token) — consider updating inbound address:", to);
    }

    if (!user_id) {
      console.error("Critical fail: Regex failed to extract user ID from email 'to' address:", to)
      return new Response("User not found", { status: 400 })
    }

    // Validate user exists, fetch valuation method, and verify secret token
    const { data: userProfile } = await supabase
        .from('profiles')
        .select('id, inventory_valuation_method, company_id, inbound_email_secret')
        .eq('id', user_id)
        .maybeSingle();

    if (!userProfile) {
        console.error("User ID not found in profiles:", user_id);
        return new Response("User not found", { status: 404 });
    }

    // Enforce secret validation when the token was provided (secure format)
    // or when the user has a secret stored (they should be using the secure format)
    if (providedSecret !== null) {
        if (userProfile.inbound_email_secret && providedSecret !== userProfile.inbound_email_secret) {
            console.error("Invalid inbound email secret for user:", user_id);
            return new Response("Unauthorized", { status: 401 });
        }
    } else if (userProfile.inbound_email_secret) {
        // User has a secret but email was sent to old format — reject to prevent spoofing
        console.error("User has inbound_email_secret but email arrived without token — rejected:", user_id);
        return new Response("Unauthorized — please use the secure email address from your settings", { status: 401 });
    }
    valuation_method = userProfile.inventory_valuation_method || 'latest';
    const company_id = userProfile.company_id;

    // Vorhandene Kategorien dieser Firma laden (für smarte Kategorie-Zuweisung)
    const { data: catRows } = await supabase
        .from('products')
        .select('category')
        .eq('company_id', company_id)
        .not('category', 'is', null);
    const existingCategories = [...new Set(
        (catRows || []).map((r: any) => r.category as string).filter(Boolean)
    )].filter(c => c !== 'KI-Import (E-Mail)' && c !== 'Importiert');

    const categoryHint = existingCategories.length > 0
        ? existingCategories.join(', ')
        : '(keine vorhanden — du MUSST zwingend selbst eine passende kurze Kategorie auf Deutsch erfinden)';

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
1. supplier_email darf NIEMALS die E-Mail des Hotels/Käufers sein.
2. Bevorzuge als supplier_email:
   a) Absenderadresse des Lieferanten
   b) Kontakt-/Rechnungsmail in Mail-Signatur
   c) Kontakt-/Rechnungsmail in PDF-Kopf/Fußzeile
3. Falls nicht eindeutig: supplier_email = null
4. Erzeuge should_create_order = true NUR bei:
   - order_confirmation
   - delivery_note
5. Bei invoice: should_create_order = false
6. Nimm bei order_date bevorzugt das Haupt-Belegdatum/Druckdatum oben im Kopf (z.B. "Datum: 07.04."). Nimm zur Not das Bestelldatum, aber NIEMALS ein zukünftiges Lieferdatum oder Zahlungsziel.
7. In items dürfen KEINE Versandkosten, Pfand, Rabatte, Steuerzeilen, Leergut, Paletten oder Gebühren auftauchen.
8. Wenn zu wenig Sicherheit besteht, document_type = "unknown".
9. Extrahiere die Kundennummer des Hotels (customer_number) bei diesem Lieferanten, falls sie auf dem Beleg steht (oft als "Kd-Nr.", "Kunden-Nr." oder "Customer No.").
10. WICHTIG zu 'product_name': Filtere alle Artikelnummern, EANs, SKUs und kryptischen Codes aus dem Produktnamen heraus! 'product_name' darf NUR den menschenlesbaren Namen enthalten (z.B. 'Aqua Senses 300ml Shampoo' statt 'AQS300SMAIO-26 Aqua Senses...'). Packe die Artikelnummer stattdessen in das Feld 'sku'.
11. KATEGORIE: Weise jedem Artikel ZWINGEND eine logische Warengruppe/Kategorie auf Deutsch zu (z.B. "Getränke", "Reinigung", "Lebensmittel", "Hygiene", "Bürobedarf"). Nutze bevorzugt EXAKT eine der unten gelisteten vorhandenen Kategorien. Falls die Liste leer ist oder nichts passt, MUSST du eine sinnvolle neue erfinden. Verwende NIEMALS generische Begriffe wie "Importiert" oder "KI-Import".
12. TELEFON: Falls eine Telefonnummer des Lieferanten auf dem Beleg steht, trage sie unter supplier_phone ein (bevorzugt internationales Format, z.B. +49 89 123456).
13. IBAN: Falls eine IBAN des Lieferanten auf dem Beleg steht, trage sie unter supplier_iban ein.
14. LIEFERTERMIN: Extrahiere den voraussichtlichen oder tatsächlichen Liefertermin als 'delivery_date' (Format YYYY-MM-DD). Wenn das Jahr fehlt (z.B. 'Montag, den 17.08.'), ergänze das aktuelle Jahr.
15. TRACKING: Extrahiere einen eventuellen Tracking-Link ODER eine einfache Tracking-Nummer / Sendungsnummer (z.B. '00340434526445045357') als 'tracking_link'.
16. STATUS-NOTIZEN: Fasse wichtige Versand- und Statusinformationen (z.B. 'Sendung wurde bearbeitet', 'hat unser Logistikzentrum verlassen') in 'order_notes' zusammen.

Vorhandene Kategorien (bevorzugt verwenden): ${categoryHint}

Metadaten:
Betreff: ${subject}
Absender: ${fromAddress}
Text: ${bodyText}

Antworte ausschließlich als JSON:
{
  "document_type": "invoice",
  "should_create_order": false,
  "supplier_name": "string | null",
  "supplier_email": "string | null",
  "supplier_phone": "string | null",
  "supplier_iban": "string | null",
  "customer_number": "string | null",
  "invoice_number": "string | null",
  "order_reference": "string | null",
  "items": [
    {
      "product_name": "string (nur lesbarer Name)",
      "sku": "string | null",
      "category": "string (passende Kategorie auf Deutsch, bevorzugt aus vorhandenen)",
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
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent?key=${GEMINI_API_KEY}`
    
    // Baue die Payload für Gemini zusammen
    const geminiParts: any[] = [{ text: prompt }];

    // Betrachte Dateianhänge (z.B. PDFs, Bilder)
    const attachmentsCountStr = formData.get('attachments') as string;
    const attachmentsCount = attachmentsCountStr ? parseInt(attachmentsCountStr, 10) : 0;
    
    console.log(`Received attachments count from Sendgrid: ${attachmentsCount}`);
    let processedAttachmentsCount = 0;
    const MAX_ATTACHMENTS_TO_PROCESS = 5;

    for (let i = 1; i <= attachmentsCount; i++) {
        if (processedAttachmentsCount >= MAX_ATTACHMENTS_TO_PROCESS) {
            console.log(`Max attachments limit (${MAX_ATTACHMENTS_TO_PROCESS}) reached. Skipping remaining files.`);
            break;
        }

        const file = formData.get(`attachment${i}`) as File | null;
        if (file) {
            const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10 MB
            if (file.size > MAX_ATTACHMENT_SIZE) {
                console.warn(`Attachment ${i} too large (${file.size} bytes), skipping`);
                continue;
            }

            const mimeType = file.type || 'application/octet-stream';
            console.log(`Attachment ${i} found: name=${file.name}, mimeType=${mimeType}, size=${file.size}`);
            // Wir erlauben PDFs und alle gängigen Bilder (Scans von Rechnungen)
            if (mimeType === 'application/pdf' || mimeType.startsWith('image/')) {
                const arrayBuffer = await file.arrayBuffer();
                const base64Data = encode(new Uint8Array(arrayBuffer));
                
                geminiParts.push({
                    inlineData: {
                        mimeType: mimeType,
                        data: base64Data
                    }
                });
                processedAttachmentsCount++;
            }
        }
    }

    const geminiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: geminiParts }],
        generationConfig: {
            temperature: 0.2, // Hohe Determiniertheit für Datenextraktion 
            responseMimeType: "application/json"
        }
      })
    })

    const geminiData = await geminiRes.json()
    console.log("Raw Gemini API response snippet:", JSON.stringify(geminiData).substring(0, 500));

    let geminiError = false;
    let apiErrorData: any = null;

    // HTTP-Fehler oder leere Candidates (Rate-Limit, ungültiger Key etc.)
    if (!geminiRes.ok || !geminiData?.candidates?.length) {
        console.error("Gemini API error or empty candidates:", JSON.stringify(geminiData).substring(0, 300));
        geminiError = true;
        apiErrorData = geminiData;
    }

    let extractedJsonText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '{}'

    // Kleiner Fix falls Gemini doch Markdown schickt
    extractedJsonText = extractedJsonText.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim()

    let parsedData: any = {}
    try {
        parsedData = JSON.parse(extractedJsonText)
    } catch(e) {
        console.error("Error parsing JSON from Gemini:", e)
        geminiError = true;
        parsedData = { 
            parse_error: String(e),
            raw_text: extractedJsonText 
        };
    }

    if (apiErrorData) {
        parsedData = {
            parse_error: "Gemini API HTTP Error",
            raw_text: JSON.stringify(apiErrorData)
        }
    }

    // Schreibe Log in inbound_emails
    console.log("Attempting to insert into inbound_emails...");
    const { data: inboundLog, error: logErr } = await supabase.from('inbound_emails').insert({
        user_id: user_id,
        company_id: company_id,
        supplier_name: fromAddress || '',
        subject: subject,
        body_text: bodyText || '',
        extracted_data: parsedData,
        status: geminiError ? 'gemini_error' : 'processed'
    }).select('id').single()
    
    if (logErr) {
        console.error("CRITICAL ERROR inserting into inbound_emails:", logErr);
    } else {
        console.log("Successfully inserted inbound_emails row:", inboundLog);
    }

    // Bei Gemini-Fehler abbrechen — E-Mail ist geloggt, aber keine Daten importieren.
    // SendGrid braucht 2xx, sonst wiederholt es die Mail.
    if (geminiError) {
        return new Response(
            JSON.stringify({ success: false, message: 'Gemini error — email logged, no data imported' }),
            { headers: { 'Content-Type': 'application/json' }, status: 200 }
        );
    }

    // Lege Supplier an
    console.log("Processing supplier...");
    let supplier_id = null;
    const supName = parsedData.supplier_name || 'Unbekannter Lieferant (KI)';
    
    let existingSuppliers: any[] = [];
    
    // 1. Try matching by email first, as it's the most precise unique identifier
    const emailToMatch = parsedData.supplier_email?.trim();
    if (emailToMatch && emailToMatch !== 'hello@unbekannt.com') {
        const { data: emailMatch, error: emailErr } = await supabase.from('suppliers')
             .select('id, email, customer_number, phone, iban').eq('company_id', company_id).ilike('email', emailToMatch).limit(1);
        if (emailErr) console.error("Error querying supplier by email:", emailErr);
        if (emailMatch && emailMatch.length > 0) {
            existingSuppliers = emailMatch;
            console.log("Matched supplier by email:", emailToMatch);
        }
    }

    // 2. Fallback: try matching by name
    if (existingSuppliers.length === 0) {
        // Normalisiere Suchbegriff etwas (GmbH, KG, etc entfernen)
        const cleanSupName = supName.replace(/gmbh|mbh|kg|ag|&|co\./gi, '').trim() || supName;
        // Benutze auch das erste signifikante Wort als Fallback, da "Hewo" nicht "%HEWO Getränke-Vertrieb...%" matcht (Target ist kürzer!)
        const firstWord = cleanSupName.split(/[\s-]/)[0];
        let orQuery = `name.ilike.%${cleanSupName}%`;
        // Nur wenn das erste Wort lang genug ist, um random matches zu verhindern
        if (firstWord && firstWord.length >= 3) {
            orQuery += `,name.ilike.%${firstWord}%`;
        }

        const { data: nameMatch, error: supErr } = await supabase.from('suppliers')
            .select('id, email, customer_number').eq('company_id', company_id).or(orQuery).limit(1);
        
        if (supErr) console.error("Error querying supplier by name:", supErr);
        if (nameMatch && nameMatch.length > 0) {
             existingSuppliers = nameMatch;
             console.log("Matched supplier by name:", supName);
        }
    }

    if (existingSuppliers && existingSuppliers.length > 0) {
        const existingSupplier = existingSuppliers[0];
        supplier_id = existingSupplier.id;
        console.log("Found existing supplier:", supplier_id);
        
        const updatePayload: any = {};
        if (parsedData.supplier_email && parsedData.supplier_email.trim() !== '' && parsedData.supplier_email !== 'hello@unbekannt.com') {
            updatePayload.email = parsedData.supplier_email;
        }
        if (parsedData.customer_number && parsedData.customer_number.trim() !== '' && !existingSupplier.customer_number) {
            updatePayload.customer_number = parsedData.customer_number;
        }
        if (parsedData.supplier_phone && parsedData.supplier_phone.trim() !== '' && !existingSupplier.phone) {
            updatePayload.phone = parsedData.supplier_phone.trim();
        }
        if (parsedData.supplier_iban && parsedData.supplier_iban.trim() !== '' && !existingSupplier.iban) {
            updatePayload.iban = parsedData.supplier_iban.trim();
        }

        if (Object.keys(updatePayload).length > 0) {
            const { error: updSupErr } = await supabase
              .from('suppliers')
              .update(updatePayload)
              .eq('id', supplier_id);

            if (updSupErr) console.error("Error updating supplier:", updSupErr);
            else console.log("Updated supplier with:", updatePayload);
        }
    } else {
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
            console.error("Error creating new supplier:", JSON.stringify(newSupErr, null, 2));
        } else if (newSupp) {
            supplier_id = newSupp.id
            console.log("Successfully created new supplier:", supplier_id);
        }
    }

    const shouldCreateOrder = parsedData.should_create_order === true;
    const docType = parsedData.document_type || 'unknown';
    console.log(`Document type: ${docType}. Should create order? ${shouldCreateOrder}`);

    let createdOrdersCount = 0;
    let updatedOrdersCount = 0;

    // Bereinige Referenznummern (z.B. "#23654" -> "23654")
    const cleanRef = (ref: string | null) => ref ? ref.replace(/^[#\s]+/, '').trim() : null;
    if (parsedData.order_reference) parsedData.order_reference = cleanRef(parsedData.order_reference);
    if (parsedData.invoice_number) parsedData.invoice_number = cleanRef(parsedData.invoice_number);

    // Globale Metadaten-Aktualisierung (z.B. für Versandbestätigungen ohne Artikel-Liste)
    const globalOrderRef = parsedData.order_reference || parsedData.invoice_number || null;
    if (parsedData.tracking_link || parsedData.order_notes || parsedData.delivery_date) {
        let matchedOrders: any[] | null = null;
        
        if (globalOrderRef) {
            console.log(`Checking for open orders to update metadata globally for reference: ${globalOrderRef}`);
            const { data } = await supabase.from('orders')
                .select('id, notes')
                .eq('user_id', user_id)
                .eq('status', 'open')
                .eq('order_number', globalOrderRef);
            matchedOrders = data;
        } else if (supName && supName !== 'Unbekannter Lieferant (KI)' && (docType === 'delivery_note' || docType === 'order_confirmation')) {
            console.log(`No order reference found. Checking for all open orders for supplier: ${supName}`);
            // Fallback: Wenn keine Bestellnummer vorliegt, aber es eine Versandbenachrichtigung ist, 
            // hänge die Tracking-Daten an ALLE noch offenen Bestellungen dieses Lieferanten an.
            // (Da Lieferanten offene Posten meist zusammen verschicken)
            const { data } = await supabase.from('orders')
                .select('id, notes')
                .eq('user_id', user_id)
                .eq('status', 'open')
                .eq('supplier_name', supName);
            matchedOrders = data;
        }
            
        if (matchedOrders && matchedOrders.length > 0) {
            console.log(`Found ${matchedOrders.length} orders to update. Applying global metadata...`);
            for (const o of matchedOrders) {
                const updatePayload: any = {};
                if (parsedData.delivery_date) updatePayload.expected_delivery_date = parsedData.delivery_date;
                if (parsedData.tracking_link) updatePayload.trackingLink = parsedData.tracking_link;
                if (parsedData.order_notes) {
                    const baseNotes = o.notes ? `${o.notes}\n\n` : '';
                    updatePayload.notes = `${baseNotes}Update (System): ${parsedData.order_notes}`;
                }
                
                await supabase.from('orders').update(updatePayload).eq('id', o.id);
            }
            updatedOrdersCount += matchedOrders.length;
        }
    }

    // Aktualisiere oder Lege Produkte an
    const items = parsedData.items || []
    console.log(`Found ${items.length} items to process.`);
    for (const item of items) {
        if (!item?.product_name) continue;
        
        const lowerName = item.product_name.toLowerCase();
        if (lowerName.includes('versand') || lowerName.includes('pfand') || lowerName.includes('porto') || lowerName.includes('gebühr') || lowerName.includes('logistik') || lowerName.includes('palette') || lowerName.includes('shipping') || lowerName.includes('insurance') || lowerName.includes('discount') || lowerName.includes('protection')) {
             console.log("Skipping non-product item:", item.product_name);
             continue;
        }
        console.log("Processing item:", item.product_name);
        
        let orderStatus = null;
        if (docType === 'order_confirmation' || docType === 'delivery_note') {
             orderStatus = 'open'; // Der Nutzer markiert Bestellungen strikt manuell als erhalten!
        }

        if (shouldCreateOrder && orderStatus) {
            const orderRef = parsedData.order_reference || parsedData.invoice_number || null;
            
            // Stufe 1: Deduplication Check (Exakter Treffer mit Belegnummer)
            let existingOrder = null;
            if (orderRef) {
                const { data: existingOrders, error: eoErr } = await supabase.from('orders')
                    .select('id, quantity, price, date, notes').eq('user_id', user_id).eq('order_number', orderRef).ilike('product_name', item.product_name).limit(1);
                if (existingOrders && existingOrders.length > 0) existingOrder = existingOrders[0];
            }
            
            // Stufe 2: Fangnetz für rein manuell angelegte Bestellungen (die noch keine Bestellnummer haben!)
            if (!existingOrder) {
                const { data: openOrders } = await supabase.from('orders')
                    .select('id, quantity, price, date, notes').eq('user_id', user_id).eq('status', 'open').eq('supplier_name', supName).ilike('product_name', item.product_name).is('order_number', null).limit(1);
                if (openOrders && openOrders.length > 0) {
                     existingOrder = openOrders[0];
                }
            }
            
            if (existingOrder) {
                 updatedOrdersCount++;
                 console.log(`Open order for ${item.product_name} already exists. Updating it...`);
                 
                 const aiQuantity = Math.round(Number(item.quantity)) || 1;
                 const aiPrice = Number(item.price) || 0;
                 const aiDate = parsedData.order_date || new Date().toISOString().slice(0, 10);
                 
                 const ai_revisions: any = {};
                 let hasRevisions = false;
                 
                 if (existingOrder.quantity !== aiQuantity) {
                     ai_revisions.quantity = { original: existingOrder.quantity, suggested: aiQuantity, reverted: false };
                     hasRevisions = true;
                 }
                 if (existingOrder.price !== aiPrice && aiPrice > 0) {
                     ai_revisions.price = { original: existingOrder.price || 0, suggested: aiPrice, reverted: false };
                     hasRevisions = true;
                 }
                 if (existingOrder.date !== aiDate) {
                     ai_revisions.date = { original: existingOrder.date, suggested: aiDate, reverted: false };
                     hasRevisions = true;
                 }
                 
                 const updatePayload: any = {
                      quantity: aiQuantity,
                      price: aiPrice,
                      date: aiDate
                 };
                 if (hasRevisions) {
                      updatePayload.ai_revisions = ai_revisions;
                 }
                 if (orderRef) updatePayload.order_number = orderRef;
                 if (parsedData.delivery_date) updatePayload.expected_delivery_date = parsedData.delivery_date;
                 if (parsedData.tracking_link) updatePayload.trackingLink = parsedData.tracking_link;
                 if (parsedData.order_notes) {
                     updatePayload.notes = existingOrder.notes 
                         ? `${existingOrder.notes}\n\nUpdate (System): ${parsedData.order_notes}` 
                         : `Update (System): ${parsedData.order_notes}`;
                 }
                 
                 const { error: updErr } = await supabase.from('orders').update(updatePayload).eq('id', existingOrder.id);
                 if (updErr) console.error("Error updating order:", JSON.stringify(updErr, null, 2));
                 else console.log("Order updated with AI revisions");
                 
            } else {
                 createdOrdersCount++;
                // Keine passende manuelle Bestellung gefunden -> Komplett neu anlegen
                const baseNotes = `KI-Import (${docType}) aus Betreff: ${subject}. Referenz: ${orderRef || 'Keine'}`;
                const finalNotes = parsedData.order_notes ? `${baseNotes}\n\nNotiz: ${parsedData.order_notes}` : baseNotes;

                const { error: orderErr } = await supabase.from('orders').insert({
                     id: crypto.randomUUID(),
                     user_id: user_id,
                     company_id: company_id,
                     product_name: item.product_name,
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
                if (orderErr) {
                     console.error("Error creating order:", JSON.stringify(orderErr, null, 2));
                } else {
                     console.log(`Created new order for ${item.product_name} with status ${orderStatus}`);
                }
            }
        }
        
        // Versuche das Produkt zu updaten (Preis) oder neu anzulegen
        const { data: existingProds, error: prodErr } = await supabase.from('products')
            .select('id, price, stock').eq('user_id', user_id).ilike('name', item.product_name).limit(1)

        if (prodErr) console.error("Error querying product:", prodErr);

        if (existingProds && existingProds.length > 0) {
            // Preis-Update bestehender Produkte — supplier_id nicht nötig
            const ep = existingProds[0]
            if (item.price) {
                let newPrice = item.price;
                if (valuation_method === 'average' && ep.stock > 0 && ep.price > 0) {
                    newPrice = ((ep.stock * ep.price) + ((item.quantity || 1) * item.price)) / (ep.stock + (item.quantity || 1));
                }
                const { error: updateErr } = await supabase.from('products').update({ price: newPrice }).eq('id', ep.id)
                if (updateErr) console.error("Error updating price:", updateErr);
                else console.log("Updated existing product price:", ep.id);
            }
        } else if (supplier_id) {
            // Neues Produkt anlegen — nur wenn Lieferant bekannt
            const { error: newProdErr } = await supabase.from('products').insert({
                id: crypto.randomUUID(),
                user_id: user_id,
                company_id: company_id,
                name: item.product_name,
                category: item.category || 'Sonstiges',
                price: item.price || 0,
                supplier_id: supplier_id,
                is_auto_generated: true,
                stock: 0,
                unit: 'Stk'
            })
            if (newProdErr) console.error("Error creating new product:", newProdErr);
            else console.log("Created new product:", item.product_name);
        } else {
            console.warn(`Skipping new product creation for "${item.product_name}": no valid supplier_id`);
        }
    }

    if (shouldCreateOrder && createdOrdersCount === 0 && updatedOrdersCount > 0 && inboundLog?.id) {
        await supabase.from('inbound_emails').update({ status: 'processed_duplicate' }).eq('id', inboundLog.id);
    }

    return new Response(JSON.stringify({ success: true, message: 'Processed successfully' }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    })

  } catch (error) {
    console.error(error)
    const msg = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: msg }), {
      headers: { "Content-Type": "application/json" },
      status: 500,
    })
  }
})
