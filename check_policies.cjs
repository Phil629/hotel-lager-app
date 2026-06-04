const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data, error } = await supabase.rpc('execute_sql', { sql: "SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check FROM pg_policies WHERE tablename = 'suppliers';" });
  if (error) {
    console.error('Error executing SQL (trying direct fetch):', error.message);
    // fallback: just try to get the user's company id to see if it matches the one in payload
    const res = await supabase.auth.signInWithPassword({ email: 'info@cent-online.de', password: '...' });
    console.log(res);
  } else {
    console.log(data);
  }
}
run();
