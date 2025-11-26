import { StorageService } from './storage';
import { getSupabaseClient } from './supabase';
import type { Product, Order } from '../types';

// Helper to map App Model (camelCase) -> DB Model (snake_case)
const toSupabaseProduct = (p: Product) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    stock: p.stock,
    min_stock: p.minStock,
    unit: p.unit,
    image: p.image,
    auto_order: p.autoOrder,
    email_order_address: p.emailOrderAddress,
    email_order_subject: p.emailOrderSubject,
    email_order_body: p.emailOrderBody,
    order_url: p.orderUrl,
    supplier_phone: p.supplierPhone
});

// Helper to map DB Model (snake_case) -> App Model (camelCase)
const fromSupabaseProduct = (p: any): Product => ({
    id: p.id,
    name: p.name,
    category: p.category,
    stock: p.stock,
    minStock: p.min_stock,
    unit: p.unit,
    image: p.image,
    autoOrder: p.auto_order,
    emailOrderAddress: p.email_order_address,
    emailOrderSubject: p.email_order_subject,
    emailOrderBody: p.email_order_body,
    orderUrl: p.order_url,
    supplierPhone: p.supplier_phone
});

const toSupabaseOrder = (o: Order) => {
    const base: any = {
        id: o.id,
        product_name: o.productName,
        quantity: o.quantity,
        status: o.status,
        date: o.date
    };

    // Only add optional fields if they exist
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
    receivedAt: o.received_at
});

export const DataService = {
    // Export helpers for migration tool
    toSupabaseProduct,
    toSupabaseOrder,

    async getProducts(): Promise<Product[]> {
        const supabase = getSupabaseClient();
        if (supabase) {
            const { data, error } = await supabase
                .from('products')
                .select('*')
                .order('name');

            if (error) {
                console.error('Supabase error:', error);
                return StorageService.getProducts();
            }
            return (data || []).map(fromSupabaseProduct);
        }
        return StorageService.getProducts();
    },

    async saveProduct(product: Product): Promise<void> {
        const supabase = getSupabaseClient();
        if (supabase) {
            const dbProduct = toSupabaseProduct(product);
            const { error } = await supabase.from('products').upsert(dbProduct);
            if (error) throw error;
        } else {
            const products = StorageService.getProducts();
            const index = products.findIndex(p => p.id === product.id);
            let updated;
            if (index >= 0) {
                updated = products.map(p => p.id === product.id ? product : p);
            } else {
                updated = [...products, product];
            }
            StorageService.saveProducts(updated);
        }
    },

    async deleteProduct(id: string): Promise<void> {
        const supabase = getSupabaseClient();
        if (supabase) {
            const { error } = await supabase.from('products').delete().eq('id', id);
            if (error) throw error;
        } else {
            const products = StorageService.getProducts().filter(p => p.id !== id);
            StorageService.saveProducts(products);
        }
    },

    async getOrders(): Promise<Order[]> {
        const supabase = getSupabaseClient();
        if (supabase) {
            const { data, error } = await supabase
                .from('orders')
                .select('*')
                .order('date', { ascending: false });

            if (error) {
                console.error('Supabase error:', error);
                return StorageService.getOrders();
            }
            return (data || []).map(fromSupabaseOrder);
        }
        return StorageService.getOrders();
    },

    async saveOrder(order: Order): Promise<void> {
        const supabase = getSupabaseClient();
        if (supabase) {
            const dbOrder = toSupabaseOrder(order);
            const { error } = await supabase.from('orders').insert(dbOrder);
            if (error) throw error;
        } else {
            const orders = StorageService.getOrders();
            StorageService.saveOrders([...orders, order]);
        }
    },

    async updateOrder(order: Order): Promise<void> {
        const supabase = getSupabaseClient();
        if (supabase) {
            const dbOrder = toSupabaseOrder(order);
            const { error } = await supabase.from('orders').upsert(dbOrder);
            if (error) throw error;
        } else {
            const orders = StorageService.getOrders();
            const updated = orders.map(o => o.id === order.id ? order : o);
            StorageService.saveOrders(updated);
        }
    }
};
