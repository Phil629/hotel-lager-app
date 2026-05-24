import { generateId } from "../utils";
import { getSupabaseClient } from './supabase';
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
        default_category: s.defaultCategory?.trim() || null
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
    defaultCategory: s.default_category
});

const toSupabaseProduct = (p: Product) => ({
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
    email_order_address: p.emailOrderAddress,
    email_order_subject: p.emailOrderSubject,
    email_order_body: p.emailOrderBody,
    order_url: p.orderUrl,
    supplier_phone: p.supplierPhone,
    notes: p.notes ? JSON.stringify(p.notes) : null,
    preferred_order_method: p.preferredOrderMethod || null,
    consumption_amount: p.consumptionAmount,
    consumption_period: p.consumptionPeriod,
    last_consumption_date: p.lastConsumptionDate,
    last_counted_at: p.lastCountedAt
});

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

export const DataService = {
    toSupabaseProduct,
    toSupabaseOrder,
    toSupabaseSupplier,

    async getProducts(): Promise<Product[]> {
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
    },

    async saveProduct(product: Product): Promise<void> {
        const supabase = getSupabaseClient();
        if (!supabase) return;
        const dbProduct = toSupabaseProduct(product);
        const { error } = await supabase.from('products').upsert(dbProduct);
        if (error) throw new Error(error.message || JSON.stringify(error));
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
    },

    async getOrders(): Promise<Order[]> {
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

        const orders = (data || []).map(fromSupabaseOrder);

        // Only fetch profiles when there are orders that reference users
        const userIds = [...new Set([
            ...orders.map(o => o.user_id).filter(Boolean),
            ...orders.map(o => o.updated_by).filter(Boolean),
        ])] as string[];

        if (userIds.length > 0) {
            const { data: profilesData } = await supabase
                .from('profiles')
                .select('id,email')
                .in('id', userIds);
            const profilesMap = new Map((profilesData || []).map(p => [p.id, p.email]));
            for (const o of orders) {
                if (o.user_id) o.creatorEmail = profilesMap.get(o.user_id);
                if (o.updated_by) o.updaterEmail = profilesMap.get(o.updated_by);
            }
        }

        return orders;
    },

    async saveOrder(order: Order): Promise<void> {
        const supabase = getSupabaseClient();
        if (!supabase) return;
        const dbOrder = toSupabaseOrder(order);
        const { error } = await supabase.from('orders').insert(dbOrder);
        if (error) throw new Error(error.message || JSON.stringify(error));
    },

    async updateOrder(order: Order): Promise<void> {
        const supabase = getSupabaseClient();
        if (!supabase) return;
        const dbOrder = toSupabaseOrder(order);
        const { error } = await supabase.from('orders').upsert(dbOrder);
        if (error) throw error;
    },

    async deleteOrder(id: string): Promise<void> {
        const supabase = getSupabaseClient();
        if (!supabase) return;
        const { error } = await supabase.from('orders').delete().eq('id', id);
        if (error) throw error;
    },

    async getSuppliers(): Promise<Supplier[]> {
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
    },

    async saveSupplier(supplier: Supplier): Promise<void> {
        const supabase = getSupabaseClient();
        if (!supabase) return;
        const dbSupplier = toSupabaseSupplier(supplier);
        const { error } = await supabase.from('suppliers').upsert(dbSupplier);
        if (error) throw error;
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
    },

    async markOrderReceived(orderId: string): Promise<void> {
        const supabase = getSupabaseClient();
        if (!supabase) return;
        const { data, error } = await supabase.rpc('mark_order_received', { p_order_id: orderId });
        if (error) throw new Error(error.message || JSON.stringify(error));
        if (data && data.success === false) throw new Error(data.message || 'Unbekannter Fehler im RPC');
    },

    async unmarkOrderReceived(orderId: string): Promise<void> {
        const supabase = getSupabaseClient();
        if (!supabase) return;
        const { data, error } = await supabase.rpc('unmark_order_received', { p_order_id: orderId });
        if (error) throw new Error(error.message || JSON.stringify(error));
        if (data && data.success === false) throw new Error(data.message || 'Unbekannter Fehler im RPC');
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

    getCompanySettings: async () => {
        try {
            const supabase = getSupabaseClient();
            if (!supabase) return null;
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return null;
            const { data: profile } = await supabase.from('profiles').select('company_id').eq('id', user.id).single();
            if (!profile?.company_id) return null;
            const { data: company } = await supabase.from('companies').select('settings').eq('id', profile.company_id).single();
            return company?.settings || { staffCanSeePrices: false, staffCanManageSuppliers: false, staffCanSeePasswords: false };
        } catch (e) { return null; }
    },

    updateCompanySettings: async (settings: any) => {
        try {
            const supabase = getSupabaseClient();
            if (!supabase) return false;
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return false;
            const { data: profile } = await supabase.from('profiles').select('company_id').eq('id', user.id).single();
            if (!profile?.company_id) return false;
            await supabase.from('companies').update({ settings }).eq('id', profile.company_id);
            return true;
        } catch (e) { return false; }
    },

    updateCompanyName: async (name: string) => {
        try {
            const supabase = getSupabaseClient();
            if (!supabase) return false;
            
            // Try updating via RPC (security definer bypasses RLS)
            const { error: rpcError } = await supabase.rpc('update_company_name', { new_name: name });
            if (!rpcError) return true;

            // Fallback: try direct update
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return false;
            const { data: profile } = await supabase.from('profiles').select('company_id').eq('id', user.id).single();
            if (!profile?.company_id) return false;
            await supabase.from('companies').update({ name }).eq('id', profile.company_id);
            return true;
        } catch (e) { return false; }
    }
};