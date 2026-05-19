import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const envFile = fs.readFileSync('.env', 'utf8');
const env = {};
envFile.split('\n').forEach(line => {
    const [key, ...value] = line.split('=');
    if (key && value.length) env[key.trim()] = value.join('=').trim().replace(/['"]/g, '');
});

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

async function test() {
    console.log('Testing update...');
    // We try to update a non-existent row just to see if the schema constraint rejects 'webshop' or 'link'
    let res = await supabase.from('suppliers').update({ preferred_order_method: 'webshop' }).eq('id', '12345');
    console.log('Update "webshop" Error:', res.error);

    let res2 = await supabase.from('suppliers').update({ preferred_order_method: 'link' }).eq('id', '12345');
    console.log('Update "link" Error:', res2.error);
    
    let res3 = await supabase.from('suppliers').update({ preferred_order_method: 'phone' }).eq('id', '12345');
    console.log('Update "phone" Error:', res3.error);
}
test();
