import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.6'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        const { data, error } = await supabaseClient
            .from('user_supplier_credentials')
            .select('id, company_id, login_username, encrypted_password')

        if (error) throw error

        const results = await Promise.all(data.map(async (row) => {
            if (!row.encrypted_password) return { ...row, decrypted: 'NULL' }
            const { data: decrypted, error: decErr } = await supabaseClient.rpc('debug_test_decrypt', {
                p_encrypted: row.encrypted_password,
                p_company_id: row.company_id
            })
            return {
                id: row.id,
                username: row.login_username,
                encrypted: row.encrypted_password,
                decrypted: decErr ? 'RPC_ERR: ' + decErr.message : decrypted
            }
        }))

        return new Response(
            JSON.stringify(results),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400,
        })
    }
})
