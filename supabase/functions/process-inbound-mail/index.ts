import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { encode } from "https://deno.land/std@0.168.0/encoding/base64.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

    // Finde den Nutzer anhand der 'to' Adresse: in-[USERID-START]@...
    const match = to.match(/in-([a-zA-Z0-9\-]+)@/)
    let user_id = null;
    let valuation_method = 'latest';
    
    console.log("Extracted TO address:", to);
    
    if (match && match[1]) {
       user_id = match[1]; // Nehme die UserID direkt aus der Mail-Adresse!
       
       // Optional: Versuche die Methode aus dem Profil zu laden, scheitert aber nicht, wenn Profil leer ist.
       const { data: profiles, error } = await supabase.from('profiles').select('inventory_valuation_method').eq('id', match[1]).limit(1)
       if (profiles && profiles.length > 0) {
           valuation_method = profiles[0].inventory_valuation_method || 'latest';
       }
    }

    if (!user_id) {
       console.error("Critical fail: Regex failed to extract user ID from email 'to' address:", to)
       return new Response("User not found", { status: 400 })
    }

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
6. Nimm bei order_date das Rechnungs-/Bestell-/Belegdatum, niemals ein zukünftiges Lieferdatum oder Zahlungsziel.
7. In items dürfen KEINE Versandkosten, Pfand, Rabatte, Steuerzeilen, Leergut, Paletten oder Gebühren auftauchen.
8. Wenn zu wenig Sicherheit besteht, document_type = "unknown".

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
  "invoice_number": "string | null",
  "order_reference": "string | null",
  "items": [
    {
      "product_name": "string",
      "quantity": 1,
      "price": 0
    }
  ],
  "total_price": 0,
  "order_date": "YYYY-MM-DD | null",
  "confidence": 0.0
}
`
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`
    
    // Baue die Payload für Gemini zusammen
    const geminiParts: any[] = [{ text: prompt }];

    // Betrachte Dateianhänge (z.B. PDFs, Bilder)
    const attachmentsCountStr = formData.get('attachments') as string;
    const attachmentsCount = attachmentsCountStr ? parseInt(attachmentsCountStr, 10) : 0;
    
    console.log(`Received attachments count from Sendgrid: ${attachmentsCount}`);
    
    for (let i = 1; i <= attachmentsCount; i++) {
        const file = formData.get(`attachment${i}`) as File | null;
        if (file) {
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
    
    let extractedJsonText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '{}'
    
    // Kleiner Fix falls Gemini doch Markdown schickt
    extractedJsonText = extractedJsonText.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim()
    
    let parsedData: any = {}
    try {
        parsedData = JSON.parse(extractedJsonText)
    } catch(e) {
        console.error("Error parsing JSON from Gemini:", e)
    }

    // Schreibe Log in inbound_emails
    console.log("Attempting to insert into inbound_emails...");
    const { data: inboundLog, error: logErr } = await supabase.from('inbound_emails').insert({
        user_id: user_id,
        supplier_name: fromAddress || '',
        subject: subject,
        body_text: bodyText || '',
        extracted_data: parsedData,
        status: 'processed'
    }).select('id').single()
    
    if (logErr) {
        console.error("CRITICAL ERROR inserting into inbound_emails:", logErr);
    } else {
        console.log("Successfully inserted inbound_emails row:", inboundLog);
    }

    // Lege Supplier an
    console.log("Processing supplier...");
    let supplier_id = null;
    const supName = parsedData.supplier_name || 'Unbekannter Lieferant (KI)';
    
    // Normalisiere Suchbegriff etwas (GmbH, KG, etc entfernen) für robusteren iLike-Match
    const cleanSupName = supName.replace(/gmbh|mbh|kg|ag|&|co\./gi, '').trim() || supName;
    const { data: existingSuppliers, error: supErr } = await supabase.from('suppliers')
         .select('id').eq('user_id', user_id).ilike('name', `%${cleanSupName}%`).limit(1)
    
    if (supErr) console.error("Error querying supplier:", supErr);

    if (existingSuppliers && existingSuppliers.length > 0) {
        supplier_id = existingSuppliers[0].id
        console.log("Found existing supplier:", supplier_id);
        
        // Update die Email, wenn die KI eine bessere gefunden hat
        if (parsedData.supplier_email && parsedData.supplier_email.trim() !== '' && parsedData.supplier_email !== 'hello@unbekannt.com') {
            const { error: updSupErr } = await supabase
              .from('suppliers')
              .update({ email: parsedData.supplier_email })
              .eq('id', supplier_id);

            if (updSupErr) console.error("Error updating supplier email:", updSupErr);
            else console.log("Updated supplier email to:", parsedData.supplier_email);
        }
    } else {
        const { data: newSupp, error: newSupErr } = await supabase.from('suppliers').insert({
            id: crypto.randomUUID(),
            user_id: user_id,
            name: supName,
            email: parsedData.supplier_email || 'hello@unbekannt.com',
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

    // Aktualisiere oder Lege Produkte an
    const items = parsedData.items || []
    console.log(`Found ${items.length} items to process.`);
    for (const item of items) {
        if (!item?.product_name || item.product_name.toLowerCase().includes('versand') || item.product_name.toLowerCase().includes('pfand')) continue;
        console.log("Processing item:", item.product_name);
        
        let orderStatus = null;
        if (docType === 'order_confirmation') orderStatus = 'ordered';
        if (docType === 'delivery_note') orderStatus = 'received';

        if (shouldCreateOrder && orderStatus) {
            const { error: orderErr } = await supabase.from('orders').insert({
                 id: crypto.randomUUID(),
                 user_id: user_id,
                 product_name: item.product_name,
                 quantity: Math.round(Number(item.quantity)) || 1,
                 price: Number(item.price) || 0,
                 date: parsedData.order_date || new Date().toISOString().slice(0, 10),
                 status: orderStatus,
                 supplier_name: supName,
                 notes: `KI-Import (${docType}) aus Betreff: ${subject}. Referenz: ${parsedData.order_reference || parsedData.invoice_number || 'Keine'}`
            })
            if (orderErr) {
                 console.error("Error creating order:", JSON.stringify(orderErr, null, 2));
            } else {
                 console.log(`Created order for ${item.product_name} with status ${orderStatus}`);
            }
        }
        
        // Versuche das Produkt zu updaten (Preis) oder neu anzulegen
        const { data: existingProds, error: prodErr } = await supabase.from('products')
            .select('id, price, stock').eq('user_id', user_id).ilike('name', item.product_name).limit(1)
        
        if (prodErr) console.error("Error querying product:", prodErr);
        
        if (existingProds && existingProds.length > 0) {
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
        } else {
             // Produkt komplett neu generieren
             const { error: newProdErr } = await supabase.from('products').insert({
                  id: crypto.randomUUID(),
                  user_id: user_id,
                  name: item.product_name,
                  category: 'Importiert',
                  price: item.price || 0,
                  supplier_id: supplier_id, // ACHTUNG hier muss valid supplierId sein
                  is_auto_generated: true,
                  stock: 0,
                  unit: 'Stk'
             })
             if (newProdErr) console.error("Error creating new product:", newProdErr);
             else console.log("Created new product:", item.product_name);
        }
    }

    return new Response(JSON.stringify({ success: true, message: 'Processed successfully' }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    })

  } catch (error) {
    console.error(error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { "Content-Type": "application/json" },
      status: 500,
    })
  }
})
