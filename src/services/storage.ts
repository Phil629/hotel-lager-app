import type { Product, Order, EmailSettings, Supplier } from '../types';

const STORAGE_KEYS = {
    PRODUCTS: 'hotel_inventory_products',
    ORDERS: 'hotel_inventory_orders',
    SETTINGS: 'hotel_inventory_settings',
    SUPPLIERS: 'hotel_inventory_suppliers',
};

const INITIAL_PRODUCTS: Product[] = [
    {
        id: '1',
        name: 'Mineralwasser Still',
        category: 'Getränke',
        stock: 45,
        minStock: 20,
        unit: 'Kasten',
        orderUrl: 'https://example.com/water',
        image: 'https://images.unsplash.com/photo-1616627547584-bf28ceeec20b?auto=format&fit=crop&w=100&q=80'
    },
    {
        id: '2',
        name: 'Toilettenpapier',
        category: 'Reinigung',
        stock: 120,
        minStock: 50,
        unit: 'Rollen',
        orderUrl: 'https://example.com/paper',
        image: 'https://images.unsplash.com/photo-1584556812952-905ffd0c611d?auto=format&fit=crop&w=100&q=80'
    },
    {
        id: '3',
        name: 'Kaffee Bohnen',
        category: 'Lebensmittel',
        stock: 5,
        minStock: 10,
        unit: 'kg',
        orderUrl: 'https://example.com/coffee',
        image: 'https://images.unsplash.com/photo-1559056199-641a0ac8b55e?auto=format&fit=crop&w=100&q=80'
    },
];

const INITIAL_ORDERS: Order[] = [
    {
        id: '101',
        date: new Date(Date.now() - 86400000 * 2).toISOString(), // 2 days ago
        productName: 'Kaffee Bohnen',
        quantity: 10,
        status: 'received',
        productImage: 'https://images.unsplash.com/photo-1559056199-641a0ac8b55e?auto=format&fit=crop&w=100&q=80'
    },
    {
        id: '102',
        date: new Date().toISOString(),
        productName: 'Mineralwasser Still',
        quantity: 5,
        status: 'open',
        productImage: 'https://images.unsplash.com/photo-1616627547584-bf28ceeec20b?auto=format&fit=crop&w=100&q=80'
    },
];

export const StorageService = {
    getProducts: (): Product[] => {
        const stored = localStorage.getItem(STORAGE_KEYS.PRODUCTS);
        if (!stored) {
            localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(INITIAL_PRODUCTS));
            return INITIAL_PRODUCTS;
        }
        return JSON.parse(stored);
    },

    saveProducts: (products: Product[]) => {
        localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(products));
    },

    getOrders: (): Order[] => {
        const stored = localStorage.getItem(STORAGE_KEYS.ORDERS);
        if (!stored) {
            localStorage.setItem(STORAGE_KEYS.ORDERS, JSON.stringify(INITIAL_ORDERS));
            return INITIAL_ORDERS;
        }
        return JSON.parse(stored);
    },

    saveOrders: (orders: Order[]) => {
        localStorage.setItem(STORAGE_KEYS.ORDERS, JSON.stringify(orders));
    },

    getSettings: (): EmailSettings => {
        const stored = localStorage.getItem(STORAGE_KEYS.SETTINGS);
        return stored ? JSON.parse(stored) : { serviceId: '', templateId: '', publicKey: '' };
    },

    saveSettings: (settings: EmailSettings) => {
        localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    },

    getSuppliers: (): Supplier[] => {
        const stored = localStorage.getItem(STORAGE_KEYS.SUPPLIERS);
        if (!stored) {
            return [];
        }
        return JSON.parse(stored);
    },

    saveSuppliers: (suppliers: Supplier[]) => {
        localStorage.setItem(STORAGE_KEYS.SUPPLIERS, JSON.stringify(suppliers));
    }
};
