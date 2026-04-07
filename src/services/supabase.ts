import { createClient } from '@supabase/supabase-js';

// SaaS Supabase Client (Zentralisiert)
// Die URL und der Key müssen nun zentral über Environment Variables (z.B. in Netlify oder .env) geladen werden!
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Singleton-Instanz für die Cloud-Datenbank
export const supabase = (supabaseUrl && supabaseKey) 
    ? createClient(supabaseUrl, supabaseKey) 
    : null;

// Helper für Rückwärtskompatibilität, falls Dateien getSupabaseClient() nutzen
export const getSupabaseClient = () => supabase;
