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
    order_url: p.orderUrl
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
    orderUrl: p.order_url
});

const toSupabaseOrder = (o: Order) => ({
    id: o.id,
    product_name: o.productName,
    quantity: o.quantity,
    status: o.status,
    date: o.date,
    product_image: o.productImage
});

const fromSupabaseOrder = (o: any): Order => ({
    id: o.id,
    productName: o.product_name,
    quantity: o.quantity,
    status: o.status,
    date: o.date,
    productImage: o.product_image
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
            // Remove ID if it's a new product to let DB handle it, 
            // BUT we want to support client-generated IDs for migration/offline-first feel.
            // So we just upsert everything.
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
