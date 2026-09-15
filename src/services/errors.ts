import { getSupabaseClient } from './supabase';

/**
 * Schreibt einen Fehler in die error_logs-Tabelle.
 * Fire-and-forget: blockiert nie, auch wenn Supabase nicht erreichbar ist.
 */
export function logError(
    message: string,
    context?: Record<string, unknown>
): void {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    // Async ohne await — Fehler beim Loggen selbst nie nach oben werfen
    supabase.auth.getSession().then(({ data }) => {
        const userId = data?.session?.user?.id ?? null;
        return supabase.from('profiles').select('company_id').eq('id', userId ?? '').maybeSingle().then(({ data: profile }) => {
            const companyId = profile?.company_id ?? null;
            return supabase.from('error_logs').insert({
                company_id: companyId,
                user_id: userId,
                message: String(message).slice(0, 2000),
                context: context ?? {},
            });
        });
    }).catch(() => {
        // Logging-Fehler still verwerfen
    });
}
