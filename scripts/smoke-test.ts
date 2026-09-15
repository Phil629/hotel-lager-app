/**
 * Smoke-Test für kritische Datenbankfunktionen und -konfigurationen.
 * Ausführen mit: npm run smoke-test
 *
 * Prüft ohne Seiteneffekte ob alle kritischen RPCs und Spalten vorhanden sind.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join } from 'path';

// Read .env.local manually (no dotenv dependency needed)
try {
    const envPath = join(process.cwd(), '.env.local');
    const lines = readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
        const [key, ...rest] = line.trim().split('=');
        if (key && rest.length) process.env[key] = rest.join('=');
    }
} catch {
    // .env.local not found — rely on existing env vars
}

const url = process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

type Result = { ok: boolean; name: string; detail?: string };

async function run() {
    console.log('\n🔍 Starte Smoke-Tests...\n');
    const results: Result[] = [];

    // 1. Umgebungsvariablen
    if (!url || !serviceKey) {
        console.error('❌ VITE_SUPABASE_URL oder SUPABASE_SERVICE_ROLE_KEY fehlen in .env.local');
        process.exit(1);
    }
    const supabase = createClient(url, serviceKey);

    // ── Test 1: companies.settings Spalte ──────────────────────────────────
    try {
        const { data, error } = await supabase.from('companies').select('settings').limit(1);
        results.push({
            ok: !error,
            name: 'companies.settings Spalte (JSONB)',
            detail: error?.message,
        });
    } catch (e: any) {
        results.push({ ok: false, name: 'companies.settings Spalte', detail: e.message });
    }

    // ── Test 2: error_logs Tabelle ─────────────────────────────────────────
    try {
        const { error } = await supabase.from('error_logs').select('id').limit(1);
        results.push({
            ok: !error,
            name: 'error_logs Tabelle erreichbar',
            detail: error?.message,
        });
    } catch (e: any) {
        results.push({ ok: false, name: 'error_logs Tabelle', detail: e.message });
    }

    // ── Test 3: profiles.inbound_email_secret Spalte ───────────────────────
    try {
        const { error } = await supabase.from('profiles').select('inbound_email_secret').limit(1);
        results.push({
            ok: !error,
            name: 'profiles.inbound_email_secret Spalte',
            detail: error?.message,
        });
    } catch (e: any) {
        results.push({ ok: false, name: 'profiles.inbound_email_secret', detail: e.message });
    }

    // ── Test 4: mark_order_received RPC mit UUID-Signatur ──────────────────
    try {
        // Wir rufen die RPC mit einer gefakten UUID auf — erwarten "Bestellung nicht gefunden" oder "Kein Unternehmen"
        // aber KEINEN "operator does not exist: uuid = text"-Fehler (der alte TEXT-Bug)
        const { error } = await supabase.rpc('mark_order_received', {
            p_order_id: '00000000-0000-0000-0000-000000000000',
        });
        const isBuggy = error?.message?.includes('operator does not exist');
        results.push({
            ok: !isBuggy,
            name: 'mark_order_received RPC — UUID-Parameter korrekt',
            detail: isBuggy ? error?.message : (error?.message ?? 'OK (erwarteter Fehler: Bestellung nicht gefunden)'),
        });
    } catch (e: any) {
        results.push({ ok: false, name: 'mark_order_received RPC', detail: e.message });
    }

    // ── Test 5: unmark_order_received RPC mit UUID-Signatur ────────────────
    try {
        const { error } = await supabase.rpc('unmark_order_received', {
            p_order_id: '00000000-0000-0000-0000-000000000000',
        });
        const isBuggy = error?.message?.includes('operator does not exist');
        results.push({
            ok: !isBuggy,
            name: 'unmark_order_received RPC — UUID-Parameter korrekt',
            detail: isBuggy ? error?.message : (error?.message ?? 'OK'),
        });
    } catch (e: any) {
        results.push({ ok: false, name: 'unmark_order_received RPC', detail: e.message });
    }

    // ── Test 6: update_company_settings RPC & RLS Update Policy ────────────
    try {
        // Test calling update_company_settings RPC
        const { error } = await supabase.rpc('update_company_settings', {
            p_settings: { test: true }
        });
        // We expect either OK or "Nicht autorisiert" (because service role has no auth.uid())
        // but NOT "function public.update_company_settings does not exist"
        const notFound = error?.message?.includes('does not exist');
        results.push({
            ok: !notFound,
            name: 'update_company_settings RPC existiert',
            detail: notFound ? error?.message : (error?.message ?? 'OK'),
        });
    } catch (e: any) {
        results.push({ ok: false, name: 'update_company_settings RPC existiert', detail: e.message });
    }

    // ── Ergebnis ───────────────────────────────────────────────────────────
    const passed = results.filter(r => r.ok).length;
    const failed = results.filter(r => !r.ok).length;

    for (const r of results) {
        const icon = r.ok ? '✅' : '❌';
        console.log(`${icon}  ${r.name}`);
        if (!r.ok && r.detail) console.log(`   → ${r.detail}`);
        if (r.ok && r.detail && r.detail !== 'OK') console.log(`   ℹ️  ${r.detail}`);
    }

    console.log(`\n${passed}/${results.length} Tests bestanden.`);
    if (failed > 0) {
        console.log(`\n⚠️  ${failed} Test(s) fehlgeschlagen!\n`);
        process.exit(1);
    } else {
        console.log('\n🎉 Alle Tests bestanden!\n');
    }
}

run().catch(e => {
    console.error('Unerwarteter Fehler:', e);
    process.exit(1);
});
