import type { Product, Supplier } from '../types';

export const PLACEHOLDER_UNKNOWN_EMAIL = 'hello@unbekannt.com';

export function sanitizeSupplierEmail(email?: string | null): string {
    if (!email || typeof email !== 'string') return '';
    const trimmed = email.trim();
    if (!trimmed || trimmed.toLowerCase() === PLACEHOLDER_UNKNOWN_EMAIL) return '';
    return trimmed;
}

export function isDeepProductUrl(url?: string | null): boolean {
    if (!url || typeof url !== 'string' || !url.trim()) return false;
    try {
        const u = new URL(url.startsWith('http') ? url : `https://${url}`);
        const p = u.pathname.toLowerCase();
        const cleanPath = p.replace(/^\/(de|en|de-de|de_de)?\/?$/i, '').trim();
        if (cleanPath.length <= 2) return false;
        if (/^\/(index\.(html|php|asp)|home|startseite|default\.(html|aspx?))\/?$/i.test(cleanPath)) return false;
        if (/(?:\/|^)(suche|search|catalogsearch|find|results|query|katalog|categories|kategorien)(?:\/|$)/i.test(p) || u.searchParams.has('q') || u.searchParams.has('k') || u.searchParams.has('query')) {
            return false;
        }
        if (/(?:\/|^)(warenkorb|cart|basket|checkout|kasse|login|signin|anmelden|account|mein-konto|register|auth)(?:\/|$)/i.test(p)) {
            return false;
        }
        return true;
    } catch {
        return false;
    }
}

export function isSupplierWebshop(
    sup?: Pick<Supplier, 'preferredOrderMethod' | 'orderUrl' | 'url'> | null,
    prod?: Pick<Product, 'preferredOrderMethod' | 'orderUrl'> | null
): boolean {
    if (prod?.preferredOrderMethod === 'email' || prod?.preferredOrderMethod === 'phone') return false;
    if (prod?.preferredOrderMethod === 'webshop' || prod?.preferredOrderMethod === 'link') return true;
    if (isDeepProductUrl(prod?.orderUrl)) return true;
    if (!sup) return false;
    if (sup.preferredOrderMethod === 'email' || sup.preferredOrderMethod === 'phone') return false;
    if (sup.preferredOrderMethod === 'webshop' || sup.preferredOrderMethod === 'link') return true;
    if (isDeepProductUrl(sup.orderUrl)) return true;
    return !!(sup.url && sup.url.trim());
}

export function isSupplierNaturallyComplete(
    s: Pick<Supplier, 'email' | 'url' | 'orderUrl' | 'phone' | 'preferredOrderMethod' | 'defaultCategory'>
): boolean {
    const hasValidEmail = !!sanitizeSupplierEmail(s.email);
    const hasUrl = !!((s.url && s.url.trim()) || (s.orderUrl && s.orderUrl.trim()));
    const hasPhone = !!(s.phone && s.phone.trim());
    const hasMethod = !!s.preferredOrderMethod;
    const hasDefaultCat = !!(s.defaultCategory && s.defaultCategory.trim());

    if (s.preferredOrderMethod === 'phone') return hasPhone && hasDefaultCat;
    if (s.preferredOrderMethod === 'email') return hasValidEmail && hasDefaultCat;
    if (s.preferredOrderMethod === 'webshop' || s.preferredOrderMethod === 'link') return hasUrl && hasDefaultCat;
    return hasValidEmail && hasUrl && hasMethod && hasDefaultCat;
}
