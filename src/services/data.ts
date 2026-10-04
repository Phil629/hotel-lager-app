import { generateId } from "../utils";
import { getSupabaseClient } from './supabase';
import { logError } from './errors';
import type { Product, Order, Supplier, Note } from '../types';

const parseLegacyNotes = (notesStr: string | null | undefined, showNoteOnOrder: boolean | undefined): Note[] => {
    if (!notesStr) return [];
    try {
        const parsed = JSON.parse(notesStr);
        if (Array.isArray(parsed)) return parsed;
    } catch (e) { console.error("Ignored error:", e); }
    return [{
        id: generateId(),
        text: notesStr,
        showOnOrderCreation: !!showNoteOnOrder,
        showOnOpenOrders: !!showNoteOnOrder
    }];
};

const toSupabaseSupplier = (s: Supplier) => {
    const payload: any = {
        id: s.id,
        name: s.name?.trim() || 'Unbenannt',
        contact_name: s.contactName?.trim() || null,
        email: s.email?.trim() || null,
        phone: s.phone?.trim() || null,
        url: s.url?.trim() || null,
        notes: s.notes ? JSON.stringify(s.notes) : null,
        login_url: s.loginUrl?.trim() || null,
        login_username: s.loginUsername?.trim() || null,
        // login_password intentionally omitted — stored encrypted via upsert_supplier_credentials RPC
        preferred_order_method: s.preferredOrderMethod?.trim() || null,
        order_email: s.orderEmail?.trim() || null,
        order_phone: s.orderPhone?.trim() || null,
        order_url: s.orderUrl?.trim() || null,
        ignore_order_proposals: s.ignoreOrderProposals,
        customer_number: s.customerNumber?.trim() || null,
        payment_method: s.paymentMethod?.trim() || null,
        default_category: s.defaultCategory?.trim() || null,
        email_subject_template: s.emailSubjectTemplate?.trim() || null,
        email_body_template: s.emailBodyTemplate?.trim() || null,
        selectors: s.selectors || {}
    };
    if (s.company_id !== undefined) payload.company_id = s.company_id;
    if (s.user_id !== undefined) payload.user_id = s.user_id;
    if (s.is_auto_generated !== undefined) payload.is_auto_generated = s.is_auto_generated;
    return payload;
};

const fromSupabaseSupplier = (s: any): Supplier => ({
    id: s.id,
    name: s.name,
    company_id: s.company_id,
    user_id: s.user_id,
    contactName: s.contact_name,
    email: s.email,
    phone: s.phone,
    url: s.url,
    notes: parseLegacyNotes(s.notes, s.show_note_on_order),
    emailSubjectTemplate: s.email_subject_template,
    emailBodyTemplate: s.email_body_template,
    loginUrl: s.login_url,
    loginUsername: s.login_username,
    loginPassword: s.login_password,
    documents: s.documents ? (typeof s.documents === 'string' ? JSON.parse(s.documents) : s.documents) : [],
    preferredOrderMethod: s.preferred_order_method,
    orderEmail: s.order_email,
    orderPhone: s.order_phone,
    orderUrl: s.order_url,
    ignoreOrderProposals: s.ignore_order_proposals,
    customerNumber: s.customer_number,
    paymentMethod: s.payment_method,
    defaultCategory: s.default_category,
    selectors: s.selectors || {}
});

const toSupabaseProduct = (p: Product) => {
    const payload: any = {
        id: p.id,
        name: p.name,
        category: p.category,
        stock: p.stock,
        min_stock: p.minStock,
        price: p.price,
        product_number: p.productNumber,
        standard_order_quantity: p.standardOrderQuantity,
        ignore_order_proposals: p.ignoreOrderProposals,
        unit: p.unit,
        image: p.image,
        auto_order: p.autoOrder,
        supplier_id: p.supplierId,
        email_order_address: p.emailOrderAddress || null,
        email_order_subject: p.emailOrderSubject || null,
        email_order_body: p.emailOrderBody || null,
        order_url: p.orderUrl,
        supplier_phone: p.supplierPhone,
        notes: p.notes ? JSON.stringify(p.notes) : null,
        preferred_order_method: p.preferredOrderMethod || null,
        consumption_amount: p.consumptionAmount,
        consumption_period: p.consumptionPeriod,
        last_consumption_date: p.lastConsumptionDate,
        last_counted_at: p.lastCountedAt
    };
    if (p.company_id !== undefined) payload.company_id = p.company_id;
    if (p.user_id !== undefined) payload.user_id = p.user_id;
    return payload;
};

const fromSupabaseProduct = (p: any): Product => ({
    id: p.id,
    name: p.name,
    company_id: p.company_id,
    user_id: p.user_id,
    category: p.category,
    stock: p.stock,
    minStock: p.min_stock,
    price: p.price,
    productNumber: p.product_number,
    standardOrderQuantity: p.standard_order_quantity,
    ignoreOrderProposals: p.ignore_order_proposals,
    unit: p.unit,
    image: p.image,
    autoOrder: p.auto_order,
    supplierId: p.supplier_id,
    emailOrderAddress: p.email_order_address,
    emailOrderSubject: p.email_order_subject,
    emailOrderBody: p.email_order_body,
    orderUrl: p.order_url,
    supplierPhone: p.supplier_phone,
    notes: parseLegacyNotes(p.notes, p.show_note_on_order),
    preferredOrderMethod: p.preferred_order_method,
    consumptionAmount: p.consumption_amount,
    consumptionPeriod: p.consumption_period,
    lastConsumptionDate: p.last_consumption_date,
    lastCountedAt: p.last_counted_at
});

const toSupabaseOrder = (o: Order) => {
    const base: any = {
        id: o.id,
        product_name: o.productName,
        quantity: o.quantity,
        status: o.status,
        date: o.date
    };

    if (o.productImage) base.product_image = o.productImage;
    if (o.hasDefect !== undefined) base.has_defect = o.hasDefect;
    if (o.defectNotes) base.defect_notes = o.defectNotes;
    if (o.defectReportedAt) base.defect_reported_at = o.defectReportedAt;
    if (o.defectResolved !== undefined) base.defect_resolved = o.defectResolved;
    if (o.expectedDeliveryDate) base.expected_delivery_date = o.expectedDeliveryDate;
    if (o.supplierName) base.supplier_name = o.supplierName;
    if (o.orderNumber) base.order_number = o.orderNumber;
    if (o.price) base.price = o.price;
    if (o.supplierEmail) base.supplier_email = o.supplierEmail;
    if (o.supplierPhone) base.supplier_phone = o.supplierPhone;
    if (o.receivedAt) base.received_at = o.receivedAt;
    if (o.notes) base.notes = o.notes;
    if (o.aiRevisions !== undefined) base.ai_revisions = o.aiRevisions;

    return base;
};

const fromSupabaseOrder = (o: any): Order => ({
    id: o.id,
    productName: o.product_name,
    quantity: o.quantity,
    status: o.status,
    date: o.date,
    productImage: o.product_image,
    hasDefect: o.has_defect,
    defectNotes: o.defect_notes,
    defectReportedAt: o.defect_reported_at,
    defectResolved: o.defect_resolved,
    expectedDeliveryDate: o.expected_delivery_date,
    supplierName: o.supplier_name,
    orderNumber: o.order_number,
    price: o.price,
    supplierEmail: o.supplier_email,
    supplierPhone: o.supplier_phone,
    receivedAt: o.received_at,
    notes: o.notes,
    aiRevisions: o.ai_revisions,
    user_id: o.user_id,
    updated_by: o.updated_by
});

interface CacheEntry<T> {
    data: T;
    timestamp: number;
}

const CACHE_TTL_MS = 30_000; // 30 Sekunden TTL für reaktives In-Memory Caching

/** Window event fired whenever locally cached data is invalidated (detail = cache key). */
export const DATA_CHANGED_EVENT = 'stockapp:data-changed';

/** Default page size for the received-orders history in the Orders view. */
export const RECEIVED_ORDERS_PAGE_SIZE = 25;

/**
 * Removes characters that have special meaning inside PostgREST filter strings
 * (`,` `(` `)` `*` `%` `\` quotes) so user input can safely be used in `.or()` / `.ilike()`.
 */
const sanitizeSearchTerm = (term: string): string =>
    term.replace(/[,()*%\\"'`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);

/** Adds creator/updater e-mail addresses to orders (one batched profiles lookup). */
const attachProfileEmails = async (supabase: NonNullable<ReturnType<typeof getSupabaseClient>>, orders: Order[]): Promise<Order[]> => {
    const userIds = [...new Set([
        ...orders.map(o => o.user_id).filter(Boolean),
        ...orders.map(o => o.updated_by).filter(Boolean),
    ])] as string[];
    if (userIds.length === 0) return orders;

    const { data: profilesData } = await supabase
        .from('profiles')
        .select('id,email')
        .in('id', userIds);
    const profilesMap = new Map((profilesData || []).map(p => [p.id, p.email]));
    for (const o of orders) {
        if (o.user_id) o.creatorEmail = profilesMap.get(o.user_id);
        if (o.updated_by) o.updaterEmail = profilesMap.get(o.updated_by);
    }
    return orders;
};

export interface ReceivedOrdersPage {
    /** Received orders for the requested page (plus all unresolved-defect orders, always included). */
    orders: Order[];
    /** Total number of received orders matching the search (for "x remaining"). */
    total: number;
}

export interface PricePoint {
    date: string;
    price: number;
    supplierName?: string;
    quantity: number;
}

class DataCache {
    private cache = new Map<string, CacheEntry<any>>();
    private inFlight = new Map<string, Promise<any>>();

    get<T>(key: string): T | null {
        const entry = this.cache.get(key);
        if (!entry) return null;
        if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
            this.cache.delete(key);
            return null;
        }
        return entry.data;
    }

    set<T>(key: string, data: T): void {
        this.cache.set(key, { data, timestamp: Date.now() });
    }

    invalidate(keyPattern?: string): void {
        if (!keyPattern || keyPattern === 'all') {
            this.cache.clear();
        } else {
            for (const key of this.cache.keys()) {
                if (key === keyPattern || key.startsWith(`${keyPattern}_`)) {
                    this.cache.delete(key);
                }
            }
        }
        // Notify lightweight listeners (e.g. nav badges) that data changed locally.
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT, { detail: keyPattern || 'all' }));
        }
    }

    async fetchWithCache<T>(
        key: string,
        fetcher: () => Promise<T>,
        forceRefresh: boolean = false
    ): Promise<T> {
        if (!forceRefresh) {
            const cached = this.get<T>(key);
            if (cached !== null) {
                return cached;
            }
            const existingPromise = this.inFlight.get(key);
            if (existingPromise) {
                return existingPromise;
            }
        }

        const promise = (async () => {
            try {
                const data = await fetcher();
                this.set(key, data);
                return data;
            } finally {
                this.inFlight.delete(key);
            }
        })();

        this.inFlight.set(key, promise);
        return promise;
    }
}

export const dataCache = new DataCache();

export const DataService = {
    toSupabaseProduct,
    toSupabaseOrder,
    toSupabaseSupplier,

    invalidateCache(key?: 'products' | 'orders' | 'suppliers' | 'companySettings' | 'all'): void {
        dataCache.invalidate(key);
    },

    async getProducts(forceRefresh = false): Promise<Product[]> {
        return dataCache.fetchWithCache('products', async () => {
            const supabase = getSupabaseClient();
            if (!supabase) return [];
            const { data, error } = await supabase
                .from('products')
                .select('*')
                .order('name');
            if (error) {
                console.error('Supabase error:', error);
                throw error;
            }
            return (data || []).map(fromSupabaseProduct);
        }, forceRefresh);
    },

    async saveProduct(product: Product): Promise<void> {
        const supabase = getSupabaseClient();
        if (!supabase) return;
        const dbProduct = toSupabaseProduct(product);
        const { error } = await supabase.from('products').upsert(dbProduct);
        if (error) throw new Error(error.message || JSON.stringify(error));
        dataCache.invalidate('products');
    },

    async updateProduct(product: Product): Promise<void> {
        return this.saveProduct(product);
    },

    async deleteProduct(id: string): Promise<void> {
        const supabase = getSupabaseClient();
        if (!supabase) return;
        const { error, count } = await supabase.from('products').delete({ count: 'exact' }).eq('id', id);
        if (error) throw error;
        if (count === 0) {
            throw new Error("Fehlende Berechtigung oder Produkt nicht gefunden (RLS blockiert).");
        }
        dataCache.invalidate('products');
    },

    /**
     * Updates only the stock count (and count timestamp) of a product.
     * Used by the inventory counter / offline sync queue.
     */
    async updateProductStock(id: string, stock: number, lastCountedAt: string): Promise<void> {
        const supabase = getSupabaseClient();
        if (!supabase) throw new Error('Keine Datenbankverbindung');
        const { error, count } = await supabase
            .from('products')
            .update({ stock, last_counted_at: lastCountedAt }, { count: 'exact' })
            .eq('id', id);
        if (error) throw new Error(error.message || JSON.stringify(error));
        if (count === 0) throw new Error('Produkt nicht gefunden oder keine Berechtigung (RLS).');
        dataCache.invalidate('products');
    },

    /**
     * Full order history. Used by analytics views (Finanzen, Verbrauch, Produkte).
     * The Orders view uses the lighter `getOpenOrders` + `getReceivedOrdersPage` instead.
     */
    async getOrders(forceRefresh = false): Promise<Order[]> {
        return dataCache.fetchWithCache('orders', async () => {
            const supabase = getSupabaseClient();
            if (!supabase) return [];
            const { data, error } = await supabase
                .from('orders')
                .select('*')
                .order('date', { ascending: false });
            if (error) {
                console.error('Supabase error:', error);
                throw error;
            }
            return attachProfileEmails(supabase, (data || []).map(fromSupabaseOrder));
        }, forceRefresh);
    },

    /** All open (not yet received) orders. Always small, so loaded completely. */
    async getOpenOrders(forceRefresh = false): Promise<Order[]> {
        return dataCache.fetchWithCache('orders_open', async () => {
            const supabase = getSupabaseClient();
            if (!supabase) return [];
            const { data, error } = await supabase
                .from('orders')
                .select('*')
                .eq('status', 'open')
                .order('date', { ascending: false });
            if (error) {
                console.error('Supabase error:', error);
                throw error;
            }
            return attachProfileEmails(supabase, (data || []).map(fromSupabaseOrder));
        }, forceRefresh);
    },

    /**
     * One page of received orders, newest first, optionally filtered server-side.
     * Received orders with an unresolved defect are always included so they never
     * disappear behind the "load more" button.
     */
    async getReceivedOrdersPage(
        { limit = RECEIVED_ORDERS_PAGE_SIZE, search = '' }: { limit?: number; search?: string } = {},
        forceRefresh = false
    ): Promise<ReceivedOrdersPage> {
        const term = sanitizeSearchTerm(search);
        const cacheKey = `orders_received_${limit}_${term.toLowerCase()}`;
        return dataCache.fetchWithCache(cacheKey, async () => {
            const supabase = getSupabaseClient();
            if (!supabase) return { orders: [], total: 0 };

            let pageQuery = supabase
                .from('orders')
                .select('*', { count: 'exact' })
                .eq('status', 'received')
                .order('received_at', { ascending: false, nullsFirst: false })
                .order('date', { ascending: false })
                .range(0, Math.max(0, limit - 1));
            if (term) {
                pageQuery = pageQuery.or(
                    `product_name.ilike.%${term}%,supplier_name.ilike.%${term}%,notes.ilike.%${term}%,order_number.ilike.%${term}%`
                );
            }

            const defectQuery = supabase
                .from('orders')
                .select('*')
                .eq('status', 'received')
                .eq('has_defect', true)
                .or('defect_resolved.is.null,defect_resolved.eq.false');

            const [pageRes, defectRes] = await Promise.all([pageQuery, term ? Promise.resolve({ data: [], error: null }) : defectQuery]);
            if (pageRes.error) {
                console.error('Supabase error:', pageRes.error);
                throw pageRes.error;
            }
            if (defectRes.error) console.error('Supabase error (defects):', defectRes.error);

            const byId = new Map<string, Order>();
            for (const row of [...(defectRes.data || []), ...(pageRes.data || [])]) {
                byId.set(row.id, fromSupabaseOrder(row));
            }
            const orders = await attachProfileEmails(supabase, [...byId.values()]);
            return { orders, total: pageRes.count ?? orders.length };
        }, forceRefresh);
    },

    /** Price history of a single product (only the columns needed for charts/trends). */
    async getOrderPriceHistory(productName: string, forceRefresh = false): Promise<PricePoint[]> {
        return dataCache.fetchWithCache(`orders_price_${productName}`, async () => {
            const supabase = getSupabaseClient();
            if (!supabase || !productName) return [];
            const { data, error } = await supabase
                .from('orders')
                .select('date, price, supplier_name, quantity')
                .eq('product_name', productName)
                .order('date', { ascending: true });
            if (error) {
                console.error('Supabase error:', error);
                throw error;
            }
            return (data || []).map(r => ({
                date: r.date,
                price: Number(r.price ?? 0),
                supplierName: r.supplier_name ?? undefined,
                quantity: Number(r.quantity ?? 0),
            }));
        }, forceRefresh);
    },

    async saveOrder(order: Order): Promise<void> {
        const supabase = getSupabaseClient();
        if (!supabase) return;
        const dbOrder = toSupabaseOrder(order);
        const { error } = await supabase.from('orders').insert(dbOrder);
        if (error) throw new Error(error.message || JSON.stringify(error));
        dataCache.invalidate('orders');
    },

    async updateOrder(order: Order): Promise<void> {
        const supabase = getSupabaseClient();
        if (!supabase) return;
        const dbOrder = toSupabaseOrder(order);
        const { error } = await supabase.from('orders').upsert(dbOrder);
        if (error) throw error;
        dataCache.invalidate('orders');
    },

    async deleteOrder(id: string): Promise<void> {
        const supabase = getSupabaseClient();
        if (!supabase) return;
        const { error } = await supabase.from('orders').delete().eq('id', id);
        if (error) throw error;
        dataCache.invalidate('orders');
    },

    async getSuppliers(forceRefresh = false): Promise<Supplier[]> {
        return dataCache.fetchWithCache('suppliers', async () => {
            const supabase = getSupabaseClient();
            if (!supabase) return [];
            // suppliers_safe view excludes login_password — credentials fetched separately via RPC
            const { data, error } = await supabase
                .from('suppliers_safe')
                .select('*')
                .order('name');
            if (error) {
                console.error('Supabase error:', error);
                throw error;
            }
            return (data || []).map(fromSupabaseSupplier);
        }, forceRefresh);
    },

    async saveSupplier(supplier: Supplier): Promise<void> {
        const supabase = getSupabaseClient();
        if (!supabase) return;
        const dbSupplier = toSupabaseSupplier(supplier);
        const { error } = await supabase.from('suppliers').upsert(dbSupplier);
        if (error) throw error;
        dataCache.invalidate('suppliers');
    },

    async deleteSupplier(id: string): Promise<void> {
        const supabase = getSupabaseClient();
        if (!supabase) return;
        // Unlink products first to avoid FK constraint violation
        const { error: unlinkError } = await supabase
            .from('products')
            .update({ supplier_id: null })
            .eq('supplier_id', id);
        if (unlinkError) throw unlinkError;
        const { error } = await supabase.from('suppliers').delete().eq('id', id);
        if (error) throw error;
        dataCache.invalidate('suppliers');
        dataCache.invalidate('products');
    },

    async markOrderReceived(orderId: string): Promise<void> {
        const supabase = getSupabaseClient();
        if (!supabase) return;
        const { data, error } = await supabase.rpc('mark_order_received', { p_order_id: orderId });
        if (error) {
            logError(`markOrderReceived fehlgeschlagen: ${error.message}`, { orderId, code: error.code });
            throw new Error(error.message || JSON.stringify(error));
        }
        if (data && data.success === false) {
            logError(`markOrderReceived: ${data.message}`, { orderId });
            throw new Error(data.message || 'Unbekannter Fehler im RPC');
        }
        dataCache.invalidate('orders');
        dataCache.invalidate('products');
    },

    async unmarkOrderReceived(orderId: string): Promise<void> {
        const supabase = getSupabaseClient();
        if (!supabase) return;
        const { data, error } = await supabase.rpc('unmark_order_received', { p_order_id: orderId });
        if (error) {
            logError(`unmarkOrderReceived fehlgeschlagen: ${error.message}`, { orderId, code: error.code });
            throw new Error(error.message || JSON.stringify(error));
        }
        if (data && data.success === false) {
            logError(`unmarkOrderReceived: ${data.message}`, { orderId });
            throw new Error(data.message || 'Unbekannter Fehler im RPC');
        }
        dataCache.invalidate('orders');
        dataCache.invalidate('products');
    },

    async getSupplierCredentials(supplierId: string): Promise<{ loginUrl?: string; loginUsername?: string; loginPassword?: string } | null> {
        const supabase = getSupabaseClient();
        if (!supabase) return null;
        const { data, error } = await supabase.rpc('get_supplier_credentials', { p_supplier_id: supplierId });
        if (error) throw error;
        if (!data) return null;
        return {
            loginUrl: data.login_url,
            loginUsername: data.login_username,
            loginPassword: data.login_password,
        };
    },

    async triggerAutomatedCheckout(supplierId: string, items: { product_id?: string; product_name: string; quantity: number; unit?: string; price_expected?: number }[]) {
        const supabase = getSupabaseClient();
        if (!supabase) throw new Error("Supabase client not found");
        
        const { data, error } = await supabase.functions.invoke('trigger-checkout', {
            body: {
                supplier_id: supplierId,
                items: items
            }
        });
        
        if (error) throw error;
        return data;
    },

    async saveSupplierCredentials(supplierId: string, credentials: { loginUrl?: string; loginUsername?: string; loginPassword?: string }): Promise<void> {
        const supabase = getSupabaseClient();
        if (!supabase) return;
        const { error } = await supabase.rpc('upsert_supplier_credentials', {
            p_supplier_id: supplierId,
            p_login_url: credentials.loginUrl || null,
            p_username: credentials.loginUsername || null,
            p_password: credentials.loginPassword || null,
        });
        if (error) throw error;
    },

    async logError(message: string, context?: any): Promise<void> {
        try {
            const supabase = getSupabaseClient();
            if (!supabase) return;
            const { data: { user } } = await supabase.auth.getUser();
            let companyId = null;
            if (user) {
                const { data: profile } = await supabase.from('profiles').select('company_id').eq('id', user.id).single();
                companyId = profile?.company_id;
            }
            supabase.from('error_logs').insert({
                message,
                context: context || {},
                user_id: user?.id || null,
                company_id: companyId
            }).then(); // fire and forget
        } catch (e) {
            console.error('Failed to log error:', e);
        }
    },

    getCompanySettings: async (forceRefresh = false) => {
        return dataCache.fetchWithCache('companySettings', async () => {
            try {
                const supabase = getSupabaseClient();
                if (!supabase) return null;
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) return null;
                const { data: profile } = await supabase.from('profiles').select('company_id').eq('id', user.id).single();
                if (!profile?.company_id) return null;
                const { data: company, error } = await supabase.from('companies').select('name, settings').eq('id', profile.company_id).single();
                if (error) {
                    console.error('Error fetching company settings:', error);
                    return null;
                }
                const defaults = {
                    staffCanSeePrices: false,
                    staffCanManageSuppliers: false,
                    staffCanSeePasswords: false,
                    enableAiCart: true,
                    overwriteStockOnReceipt: false,
                };
                return {
                    ...defaults,
                    ...(company?.settings || {}),
                    _companyName: company?.name || ''
                };
            } catch (e) {
                console.error('getCompanySettings exception:', e);
                return null;
            }
        }, forceRefresh);
    },

    updateCompanySettings: async (settings: any) => {
        try {
            const supabase = getSupabaseClient();
            if (!supabase) throw new Error("Keine Datenbankverbindung");
            
            // 1. First try RPC (security definer, atomic merge)
            const { error: rpcError } = await supabase.rpc('update_company_settings', { p_settings: settings });
            if (!rpcError) {
                dataCache.invalidate('companySettings');
                return true;
            }

            console.warn("RPC update_company_settings failed, trying direct update:", rpcError);

            // 2. Fallback: direct update via RLS policy
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error("Nicht eingeloggt");
            const { data: profile } = await supabase.from('profiles').select('company_id').eq('id', user.id).single();
            if (!profile?.company_id) throw new Error("Kein Unternehmen zugeordnet");

            const { error: directError } = await supabase
                .from('companies')
                .update({ settings })
                .eq('id', profile.company_id);

            if (directError) throw directError;
            dataCache.invalidate('companySettings');
            return true;
        } catch (e: any) {
            console.error("updateCompanySettings failed:", e);
            logError(`updateCompanySettings failed: ${e?.message || String(e)}`, { settings });
            throw e;
        }
    },

    updateCompanyName: async (name: string) => {
        try {
            const supabase = getSupabaseClient();
            if (!supabase) return false;
            
            // Try updating via RPC (security definer bypasses RLS)
            const { error: rpcError } = await supabase.rpc('update_company_name', { new_name: name });
            if (!rpcError) {
                dataCache.invalidate('companySettings');
                return true;
            }

            // Fallback: try direct update
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return false;
            const { data: profile } = await supabase.from('profiles').select('company_id').eq('id', user.id).single();
            if (!profile?.company_id) return false;
            const { error: directError } = await supabase.from('companies').update({ name }).eq('id', profile.company_id);
            if (directError) throw directError;
            dataCache.invalidate('companySettings');
            return true;
        } catch (e) { 
            console.error('Failed to update company name:', e);
            logError(`updateCompanyName failed: ${e instanceof Error ? e.message : String(e)}`);
            return false; 
        }
    },

    updateUserRole: async (targetUserId: string, newRole: string) => {
        try {
            const supabase = getSupabaseClient();
            if (!supabase) return false;
            const { error } = await supabase.rpc('update_user_role', { target_user_id: targetUserId, new_role: newRole });
            if(error) console.error("RPC ERROR:", error); return !error;
        } catch (e) { return false; }
    }
};
