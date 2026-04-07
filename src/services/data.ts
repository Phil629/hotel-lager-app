import { generateId } from "../utils";
import { getSupabaseClient } from './supabase';
import type { Product, Order, Supplier, Note } from '../types';

const parseLegacyNotes = (notesStr: string | null | undefined, showNoteOnOrder: boolean | undefined): Note[] => {
    if (!notesStr) return [];
    try {
        const parsed = JSON.parse(notesStr);
        if (Array.isArray(parsed)) return parsed;
    } catch (e) {
    }
    return [{
        id: generateId(),
        text: notesStr,
        showOnOrderCreation: !!showNoteOnOrder,
        showOnOpenOrders: !!showNoteOnOrder
    }];
};

const toSupabaseSupplier = (s: Supplier) => ({
    id: s.id,
    name: s.name,
    contact_name: s.contactName,
    email: s.email,
    phone: s.phone,
    url: s.url,
    notes: s.notes ? JSON.stringify(s.notes) : null,
    login_url: s.loginUrl,
    login_username: s.loginUsername,
    login_password: s.loginPassword
});

const fromSupabaseSupplier = (s: any): Supplier => ({
    id: s.id,
    name: s.name,
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
    documents: s.documents ? (typeof s.documents === 'string' ? JSON.parse(s.documents) : s.documents) : []
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
    preferred_order_method: p.preferredOrderMethod,
    consumption_amount: p.consumptionAmount,
    consumption_period: p.consumptionPeriod,
    last_consumption_date: p.lastConsumptionDate,
    last_counted_at: p.lastCountedAt
});

const fromSupabaseProduct = (p: any): Product => ({
    id: p.id,
    name: p.name,
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
    notes: o.notes
});

export const DataService = {
    toSupabaseProduct,
    toSupabaseOrder,
    toSupabaseSupplier,

    async getProducts(): Promise<Product[]> {
        const supabase = getSupabaseClient();
        if (!supabase) return [];
        const { data, error } = await supabase.from('products').select('*').order('name');
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
        if (error) throw error;
    },

    async updateProduct(product: Product): Promise<void> {
        return this.saveProduct(product);
    },

    async deleteProduct(id: string): Promise<void> {
        const supabase = getSupabaseClient();
        if (!supabase) return;
        const { error } = await supabase.from('products').delete().eq('id', id);
        if (error) throw error;
    },

    async getOrders(): Promise<Order[]> {
        const supabase = getSupabaseClient();
        if (!supabase) return [];
        const { data, error } = await supabase.from('orders').select('*').order('date', { ascending: false });
        if (error) {
            console.error('Supabase error:', error);
            throw error;
        }
        return (data || []).map(fromSupabaseOrder);
    },

    async saveOrder(order: Order): Promise<void> {
        const supabase = getSupabaseClient();
        if (!supabase) return;
        const dbOrder = toSupabaseOrder(order);
        const { error } = await supabase.from('orders').insert(dbOrder);
        if (error) throw error;
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
        const { data, error } = await supabase.from('suppliers').select('*').order('name');
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
        const { error } = await supabase.from('suppliers').delete().eq('id', id);
        if (error) throw error;
    }
};