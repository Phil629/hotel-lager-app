import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
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
    if (match && match[1]) {
       // Search profiles for user where id starts with match[1]
       const { data: profiles } = await supabase.from('profiles').select('id').ilike('id', `${match[1]}%`).limit(1)
       if (profiles && profiles.length > 0) {
           user_id = profiles[0].id
       }
    }

    if (!user_id) {
       console.error("No valid user mapping found for address:", to)
       return new Response("User not found", { status: 400 })
    }

    // Call Gemini API (via REST, da es das leichtesten in Deno ist)
    const prompt = `Analysiere diese Bestellbestätigung oder Lieferschein:
Betreff: ${subject}
Text: ${bodyText}

Extrahiere die folgenden Informationen und antworte AUSSCHLIESSLICH im JSON-Format ohne Markdown-Block drumherum. Keine Erklärungen:
{
  "supplier_name": "Name des Lieferanten",
  "items": [
     {
       "product_name": "Name des Produkts",
       "quantity": 10,
       "price": 12.99
     }
  ],
  "total_price": 129.90,
  "order_date": "YYYY-MM-DD"
}
`
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${GEMINI_API_KEY}`
    
    const geminiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    })

    const geminiData = await geminiRes.json()
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
    const { data: inboundLog } = await supabase.from('inbound_emails').insert({
        user_id: user_id,
        supplier_name: fromAddress,
        subject: subject,
        body_text: bodyText,
        extracted_data: parsedData,
        status: 'processed'
    }).select('id').single()

    // Lege Supplier an
    let supplier_id = null;
    const supName = parsedData.supplier_name || 'Unbekannter Lieferant (KI)';
    const { data: existingSuppliers } = await supabase.from('suppliers')
         .select('id').eq('user_id', user_id).ilike('name', supName).limit(1)
    
    if (existingSuppliers && existingSuppliers.length > 0) {
        supplier_id = existingSuppliers[0].id
    } else {
        const { data: newSupp } = await supabase.from('suppliers').insert({
            user_id: user_id,
            name: supName,
            email: fromAddress,
            is_auto_generated: true
        }).select('id').single()
        if (newSupp) supplier_id = newSupp.id
    }

    // Aktualisiere oder Lege Produkte an
    const items = parsedData.items || []
    for (const item of items) {
        // Create order record for this item
        await supabase.from('orders').insert({
             user_id: user_id,
             productName: item.product_name,
             quantity: item.quantity || 1,
             price: item.price,
             date: parsedData.order_date || new Date().toISOString(),
             status: 'received',
             supplierName: supName,
             supplierId: supplier_id,
             is_auto_generated: true,
             notes: `KI-Generiert aus Email-Betreff: ${subject}`
        })
        
        // Versuche das Produkt zu updaten (Preis) oder neu anzulegen
        const { data: existingProds } = await supabase.from('products')
            .select('id, price').eq('user_id', user_id).ilike('name', item.product_name).limit(1)
        
        if (existingProds && existingProds.length > 0) {
             const ep = existingProds[0]
             if (item.price && ep.price !== item.price) {
                  await supabase.from('products').update({ price: item.price }).eq('id', ep.id)
             }
        } else {
             // Produkt komplett neu generieren
             await supabase.from('products').insert({
                  user_id: user_id,
                  name: item.product_name,
                  category: 'Importiert',
                  price: item.price || 0,
                  supplierId: supplier_id,
                  is_auto_generated: true
             })
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
