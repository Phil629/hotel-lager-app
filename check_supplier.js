import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || ''; // need to extract this
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || ''; // need to extract this

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkSupplier() {
    console.log("Checking supplier 275f668d-6433-4d79-9470-b14e21cf989c");
}
