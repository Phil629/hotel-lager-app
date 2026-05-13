import React, { useState, useEffect, useMemo } from 'react';
import type { Product, Order, Supplier } from '../types';
import { DataService } from '../services/data';
import { StorageService } from '../services/storage';
import {
    TrendingUp, TrendingDown, Euro, Package, AlertTriangle, Download, X,
    Filter, PiggyBank, Plus, Trash2, Search, ChevronDown, ChevronRight,
    Users, ShoppingCart, BarChart2, Bot, Layers,
} from 'lucide-react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, LineChart, Line,
} from 'recharts';

// ── Budget model ──────────────────────────────────────────────────────────────

interface Budget {
    id: string;
    type: 'category' | 'product' | 'supplier';
    key: string;
    label: string;
    amount: number;
    period: 'weekly' | 'monthly' | 'quarterly' | 'yearly';
}
interface BudgetDraft {
    type: 'category' | 'product' | 'supplier';
    key: string;
    label: string;
    amount: string;
    period: 'weekly' | 'monthly' | 'quarterly' | 'yearly';
}

const BUDGET_KEY   = 'pricing_budgets_v2';
const DRAFT_INIT: BudgetDraft = { type: 'category', key: '', label: '', amount: '', period: 'monthly' };
const loadBudgets  = (): Budget[] => { try { return JSON.parse(localStorage.getItem(BUDGET_KEY) || '[]'); } catch { return []; } };
const saveBudgets  = (b: Budget[]) => localStorage.setItem(BUDGET_KEY, JSON.stringify(b));

const TYPE_LABEL:   Record<string, string> = { category: 'Kategorie', product: 'Produkt', supplier: 'Lieferant' };
const PERIOD_LABEL: Record<string, string> = { weekly: 'Wöchentlich', monthly: 'Monatlich', quarterly: 'Quartal', yearly: 'Jährlich' };
const PERIOD_NOW:   Record<string, string> = { weekly: 'Diese Woche', monthly: 'Dieser Monat', quarterly: 'Dieses Quartal', yearly: 'Dieses Jahr' };
const TYPE_BADGE:   Record<string, string> = { category: 'badge-primary', product: 'badge-neutral', supplier: 'badge-success' };

// ── Helpers ───────────────────────────────────────────────────────────────────

const PIE_COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#f97316', '#ec4899'];
const KI_CAT_NAMES = new Set(['importiert', 'Importiert', 'KI-Import', 'KI-Import (E-Mail)', 'ki-import']);

const fmt = (v: number, cur: string) => v.toLocaleString('de-DE', { style: 'currency', currency: cur });
const isKiCat = (c: string | null | undefined) => !!c && KI_CAT_NAMES.has(c);

const KiCatBadge = () => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', backgroundColor: 'rgba(59,130,246,0.12)', color: 'var(--color-primary)', padding: '1px 7px', borderRadius: 'var(--radius-full)', fontSize: '11px', fontWeight: 600 }}>
        <Bot size={10} /> KI-Import (E-Mail)
    </span>
);

const EmptyState = ({ icon: Icon, title, text }: { icon: React.ElementType; title: string; text: string }) => (
    <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--color-text-muted)', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-lg)' }}>
        <Icon size={36} style={{ opacity: 0.22, display: 'block', margin: '0 auto 12px' }} />
        <div style={{ fontWeight: 600, color: 'var(--color-text-main)', marginBottom: '6px' }}>{title}</div>
        <div style={{ fontSize: '13px' }}>{text}</div>
    </div>
);

const CTooltip = ({ active, payload, label, currency }: { active?: boolean; payload?: { value: number }[]; label?: string; currency: string }) => {
    if (!active || !payload?.length) return null;
    return (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '10px 14px', boxShadow: 'var(--shadow-md)' }}>
            <div style={{ fontWeight: 600, color: 'var(--color-text-main)', marginBottom: '4px' }}>{label}</div>
            <div style={{ color: 'var(--color-primary)', fontSize: '14px' }}>{fmt(payload[0].value, currency)}</div>
        </div>
    );
};

const PTooltip = ({ active, payload, currency }: { active?: boolean; payload?: { name: string; value: number }[]; currency: string }) => {
    if (!active || !payload?.length) return null;
    const name = isKiCat(payload[0].name) ? 'KI-Import (E-Mail)' : payload[0].name;
    return (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '10px 14px', boxShadow: 'var(--shadow-md)' }}>
            <div style={{ fontWeight: 600, color: 'var(--color-text-main)', marginBottom: '4px' }}>{name}</div>
            <div style={{ color: 'var(--color-primary)', fontSize: '14px' }}>{fmt(payload[0].value, currency)}</div>
        </div>
    );
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface PeriodOption { value: string; label: string; }
interface CostDriver extends Product { filteredSpend: number; filteredQty: number; }
interface PriceAlert { product: Product; firstPrice: number; lastPrice: number; change: number; }
interface ProductStat {
    product: Product;
    totalSpend: number;
    totalQty: number;
    orderCount: number;
    avgPrice: number;
    minPrice: number;
    maxPrice: number;
    priceChange: number;
    supplierName: string;
}
interface SupplierSpend { id: string; name: string; spend: number; orderCount: number; productCount: number; email: string; }
type Tab = 'overview' | 'products' | 'suppliers' | 'budgets';
type PieMode = 'category' | 'supplier';

// ── Component ─────────────────────────────────────────────────────────────────

export const Pricing: React.FC = () => {
    const [products, setProducts]   = useState<Product[]>([]);
    const [orders, setOrders]       = useState<Order[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [loading, setLoading]     = useState(true);

    const [periodFilter,   setPeriodFilter]   = useState('');
    const [categoryFilter, setCategoryFilter] = useState('');
    const [supplierFilter, setSupplierFilter] = useState('');

    const [budgets, setBudgets]           = useState<Budget[]>(loadBudgets);
    const [showBudgetModal, setShowBudgetModal] = useState(false);
    const [draft, setDraft]               = useState<BudgetDraft>(DRAFT_INIT);

    const [activeTab,         setActiveTab]         = useState<Tab>('overview');
    const [pieMode,           setPieMode]           = useState<PieMode>('category');
    const [productSearch,     setProductSearch]     = useState('');
    const [expandedProductId, setExpandedProductId] = useState<string | null>(null);

    const currency = StorageService.getSettings().currency || 'EUR';
    const tick     = currency === 'CHF' ? 'CHF ' : '€';

    useEffect(() => {
        Promise.all([DataService.getProducts(), DataService.getOrders(), DataService.getSuppliers()])
            .then(([p, o, s]) => { setProducts(p); setOrders(o); setSuppliers(s); setLoading(false); });
    }, []);

    // ── Filter options ────────────────────────────────────────────────────────

    const periodOptions = useMemo((): PeriodOption[] => {
        const months = new Set<string>();
        orders.forEach(o => { const d = new Date(o.date); months.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); });
        return Array.from(months).sort((a, b) => b.localeCompare(a)).slice(0, 12).map(m => {
            const [y, mo] = m.split('-').map(Number);
            return { value: m, label: new Date(y, mo - 1, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }) };
        });
    }, [orders]);

    const categories = useMemo(() => [...new Set(products.map(p => p.category).filter(Boolean) as string[])].sort(), [products]);
    const activeFilterCount = [periodFilter, categoryFilter, supplierFilter].filter(Boolean).length;

    // ── Filtered orders ───────────────────────────────────────────────────────

    const filteredOrders = useMemo(() => orders.filter(o => {
        if (periodFilter === '30') {
            const cut = new Date(); cut.setDate(cut.getDate() - 30);
            if (new Date(o.date) < cut) return false;
        } else if (periodFilter) {
            const [y, m] = periodFilter.split('-').map(Number);
            const d = new Date(o.date);
            if (d.getFullYear() !== y || d.getMonth() !== m - 1) return false;
        }
        if (categoryFilter || supplierFilter) {
            const p = products.find(p => p.name === o.productName);
            if (categoryFilter && p?.category !== categoryFilter) return false;
            if (supplierFilter && p?.supplierId !== supplierFilter) return false;
        }
        return true;
    }), [orders, products, periodFilter, categoryFilter, supplierFilter]);

    // ── KPIs ─────────────────────────────────────────────────────────────────

    const kpis = useMemo(() => {
        const spend = (os: Order[]) => os.reduce((s, o) => { const p = products.find(p => p.name === o.productName); return s + o.quantity * (o.price ?? p?.price ?? 0); }, 0);
        const totalSpend = spend(filteredOrders);

        let spendPrev = 0;
        if (!periodFilter) {
            const now = new Date(), lm = now.getMonth() === 0 ? 11 : now.getMonth() - 1, ly = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
            orders.forEach(o => {
                const p = products.find(p => p.name === o.productName);
                if (categoryFilter && p?.category !== categoryFilter) return;
                if (supplierFilter && p?.supplierId !== supplierFilter) return;
                const d = new Date(o.date);
                if (d.getMonth() === lm && d.getFullYear() === ly) spendPrev += o.quantity * (o.price ?? p?.price ?? 0);
            });
        }

        const filteredProducts = products.filter(p => (!categoryFilter || p.category === categoryFilter) && (!supplierFilter || p.supplierId === supplierFilter));
        const inventoryValue   = filteredProducts.reduce((s, p) => s + p.stock * (p.price ?? 0), 0);
        const orderCount       = filteredOrders.length;

        const now = new Date(), curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const thisMonthSpend = spend(orders.filter(o => { const d = new Date(o.date); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}` === curMonth; }));

        return {
            totalSpend, spendPrev,
            spendDiff: spendPrev > 0 ? ((totalSpend - spendPrev) / spendPrev) * 100 : 0,
            inventoryValue,
            productCount: filteredProducts.filter(p => (p.price ?? 0) > 0).length,
            orderCount,
            avgOrderValue: orderCount > 0 ? totalSpend / orderCount : 0,
            coverageMonths: thisMonthSpend > 0 ? inventoryValue / thisMonthSpend : null,
        };
    }, [filteredOrders, orders, products, periodFilter, categoryFilter, supplierFilter]);

    // ── Bar chart ─────────────────────────────────────────────────────────────

    const chartData = useMemo(() => {
        const spend = (os: Order[]) => Math.round(os.reduce((s, o) => { const p = products.find(p => p.name === o.productName); return s + o.quantity * (o.price ?? p?.price ?? 0); }, 0) * 100) / 100;
        if (periodFilter === '30') {
            return Array.from({ length: 5 }, (_, i) => {
                const end = new Date(); end.setDate(end.getDate() - i * 6);
                const start = new Date(end); start.setDate(start.getDate() - 5);
                return { date: start.toLocaleDateString('de-DE', { day: '2-digit', month: 'short' }), ausgaben: spend(filteredOrders.filter(o => { const d = new Date(o.date); return d >= start && d <= end; })) };
            }).reverse();
        }
        if (periodFilter?.includes('-')) {
            const [y, m] = periodFilter.split('-').map(Number);
            const dim = new Date(y, m, 0).getDate();
            return Array.from({ length: 4 }, (_, i) => {
                const s = i * 7 + 1, e = Math.min(s + 6, dim);
                return { date: `${s}.–${e}.`, ausgaben: spend(filteredOrders.filter(o => { const d = new Date(o.date); return d.getDate() >= s && d.getDate() <= e; })) };
            });
        }
        return Array.from({ length: 12 }, (_, i) => {
            const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - (11 - i));
            const mo = d.getMonth(), yr = d.getFullYear();
            return { date: d.toLocaleDateString('de-DE', { month: 'short', year: '2-digit' }), ausgaben: spend(filteredOrders.filter(o => { const od = new Date(o.date); return od.getMonth() === mo && od.getFullYear() === yr; })) };
        });
    }, [filteredOrders, products, periodFilter]);

    // ── Pie data ──────────────────────────────────────────────────────────────

    const pieDataCategory = useMemo(() => {
        const map: Record<string, number> = {};
        filteredOrders.forEach(o => {
            const p = products.find(pr => pr.name === o.productName);
            const cat = isKiCat(p?.category) ? 'KI-Import (E-Mail)' : (p?.category || 'Ohne Kategorie');
            map[cat] = (map[cat] || 0) + o.quantity * (o.price ?? p?.price ?? 0);
        });
        const entries = Object.entries(map).map(([name, v]) => ({ name, value: Math.round(v * 100) / 100 })).sort((a, b) => b.value - a.value);
        if (entries.length > 8) { const rest = entries.slice(7).reduce((s, e) => s + e.value, 0); return [...entries.slice(0, 7), { name: 'Sonstiges', value: Math.round(rest * 100) / 100 }]; }
        return entries;
    }, [filteredOrders, products]);

    const pieDataSupplier = useMemo(() => {
        const map: Record<string, { name: string; value: number }> = {};
        filteredOrders.forEach(o => {
            const p = products.find(pr => pr.name === o.productName);
            const sid = p?.supplierId || 'none';
            if (!map[sid]) map[sid] = { name: suppliers.find(s => s.id === sid)?.name || 'Kein Lieferant', value: 0 };
            map[sid].value += o.quantity * (o.price ?? p?.price ?? 0);
        });
        const entries = Object.values(map).map(e => ({ name: e.name, value: Math.round(e.value * 100) / 100 })).sort((a, b) => b.value - a.value);
        if (entries.length > 8) { const rest = entries.slice(7).reduce((s, e) => s + e.value, 0); return [...entries.slice(0, 7), { name: 'Sonstiges', value: Math.round(rest * 100) / 100 }]; }
        return entries;
    }, [filteredOrders, products, suppliers]);

    const pieData      = pieMode === 'category' ? pieDataCategory : pieDataSupplier;
    const pieTotalVal  = pieData.reduce((s, e) => s + e.value, 0);

    // ── Top cost drivers ──────────────────────────────────────────────────────

    const topCostDrivers = useMemo((): CostDriver[] =>
        products.map(p => {
            const po = filteredOrders.filter(o => o.productName === p.name);
            return { ...p, filteredSpend: po.reduce((s, o) => s + o.quantity * (o.price ?? p.price ?? 0), 0), filteredQty: po.reduce((s, o) => s + o.quantity, 0) };
        }).filter(p => p.filteredSpend > 0).sort((a, b) => b.filteredSpend - a.filteredSpend).slice(0, 8),
    [filteredOrders, products]);

    // ── Price alerts ──────────────────────────────────────────────────────────

    const priceAlerts = useMemo((): PriceAlert[] =>
        products.map(p => {
            if (supplierFilter && p.supplierId !== supplierFilter) return null;
            if (categoryFilter && p.category !== categoryFilter) return null;
            const priced = orders.filter(o => o.productName === p.name && (o.price ?? 0) > 0).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
            if (priced.length < 2) return null;
            const fp = priced[0].price!, lp = priced[priced.length - 1].price!;
            const change = ((lp - fp) / fp) * 100;
            if (Math.abs(change) < 3) return null;
            return { product: p, firstPrice: fp, lastPrice: lp, change };
        }).filter((d): d is PriceAlert => d !== null).sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 8),
    [orders, products, categoryFilter, supplierFilter]);

    const avgInflation = useMemo(() => priceAlerts.length ? priceAlerts.reduce((s, d) => s + d.change, 0) / priceAlerts.length : 0, [priceAlerts]);

    // ── Product stats ─────────────────────────────────────────────────────────

    const productStats = useMemo((): ProductStat[] =>
        products.map(p => {
            const po = filteredOrders.filter(o => o.productName === p.name);
            const priced = po.filter(o => (o.price ?? 0) > 0).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
            const prices = priced.map(o => o.price!);
            const totalSpend = po.reduce((s, o) => s + o.quantity * (o.price ?? p.price ?? 0), 0);
            const totalQty   = po.reduce((s, o) => s + o.quantity, 0);
            const avgPrice   = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : (p.price ?? 0);
            return {
                product: p, totalSpend, totalQty,
                orderCount: po.length,
                avgPrice,
                minPrice:    prices.length ? Math.min(...prices) : (p.price ?? 0),
                maxPrice:    prices.length ? Math.max(...prices) : (p.price ?? 0),
                priceChange: prices.length >= 2 ? ((prices[prices.length - 1] - prices[0]) / prices[0]) * 100 : 0,
                supplierName: suppliers.find(s => s.id === p.supplierId)?.name || '—',
            };
        }).filter(s => s.totalSpend > 0).sort((a, b) => b.totalSpend - a.totalSpend),
    [filteredOrders, products, suppliers]);

    const filteredProductStats = useMemo(() => {
        const q = productSearch.trim().toLowerCase();
        return q ? productStats.filter(s => s.product.name.toLowerCase().includes(q) || s.supplierName.toLowerCase().includes(q) || (s.product.category || '').toLowerCase().includes(q)) : productStats;
    }, [productStats, productSearch]);

    // ── Supplier spends ───────────────────────────────────────────────────────

    const supplierSpends = useMemo((): SupplierSpend[] => {
        const map: Record<string, { spend: number; orderCount: number; products: Set<string> }> = {};
        filteredOrders.forEach(o => {
            const p = products.find(pr => pr.name === o.productName);
            const sid = p?.supplierId || 'none';
            if (!map[sid]) map[sid] = { spend: 0, orderCount: 0, products: new Set() };
            map[sid].spend += o.quantity * (o.price ?? p?.price ?? 0);
            map[sid].orderCount++;
            if (p) map[sid].products.add(p.id);
        });
        return Object.entries(map).map(([id, d]) => {
            const sup = suppliers.find(s => s.id === id);
            return { id, name: sup?.name || 'Kein Lieferant', email: sup?.email || '', spend: Math.round(d.spend * 100) / 100, orderCount: d.orderCount, productCount: d.products.size };
        }).sort((a, b) => b.spend - a.spend);
    }, [filteredOrders, products, suppliers]);

    // ── Budget spends ─────────────────────────────────────────────────────────

    const budgetSpends = useMemo(() => {
        const res: Record<string, number> = {};
        budgets.forEach(b => {
            const now = new Date(); let start: Date;
            switch (b.period) {
                case 'weekly': { const day = now.getDay() || 7; start = new Date(now); start.setDate(now.getDate() - day + 1); start.setHours(0, 0, 0, 0); break; }
                case 'monthly': start = new Date(now.getFullYear(), now.getMonth(), 1); break;
                case 'quarterly': start = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1); break;
                default: start = new Date(now.getFullYear(), 0, 1);
            }
            res[b.id] = orders.filter(o => new Date(o.date) >= start).reduce((sum, o) => {
                const p = products.find(pr => pr.name === o.productName);
                const hit = b.type === 'category' ? p?.category === b.key : b.type === 'product' ? o.productName === b.key : p?.supplierId === b.key;
                return hit ? sum + o.quantity * (o.price ?? p?.price ?? 0) : sum;
            }, 0);
        });
        return res;
    }, [budgets, orders, products]);

    // ── Per-product helpers ───────────────────────────────────────────────────

    const getPriceHistory = (name: string) =>
        orders.filter(o => o.productName === name && (o.price ?? 0) > 0)
              .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
              .map(o => ({ date: new Date(o.date).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: '2-digit' }), Preis: o.price! }));

    const getMonthlySpend = (name: string) =>
        Array.from({ length: 6 }, (_, i) => {
            const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - (5 - i));
            const mo = d.getMonth(), yr = d.getFullYear();
            const ausgaben = Math.round(orders.filter(o => o.productName === name).filter(o => { const od = new Date(o.date); return od.getMonth() === mo && od.getFullYear() === yr; }).reduce((s, o) => { const p = products.find(pr => pr.name === name); return s + o.quantity * (o.price ?? p?.price ?? 0); }, 0) * 100) / 100;
            return { date: d.toLocaleDateString('de-DE', { month: 'short', year: '2-digit' }), ausgaben };
        });

    // ── Handlers ─────────────────────────────────────────────────────────────

    const handleSaveBudget = () => {
        const val = parseFloat(draft.amount.replace(',', '.'));
        if (!draft.key || isNaN(val) || val <= 0) return;
        const updated = [...budgets, { id: String(Date.now()), type: draft.type, key: draft.key, label: draft.label || draft.key, amount: val, period: draft.period }];
        setBudgets(updated); saveBudgets(updated); setShowBudgetModal(false);
    };
    const handleDeleteBudget = (id: string) => { const u = budgets.filter(b => b.id !== id); setBudgets(u); saveBudgets(u); };

    const handleCsvExport = () => {
        const rows: (string | number)[][] = [['Rang', 'Produkt', 'Kategorie', 'Lieferant', 'Menge', 'Einheit', 'Kosten'], ...topCostDrivers.map((p, i) => [i + 1, p.name, p.category || '', suppliers.find(s => s.id === p.supplierId)?.name || '', p.filteredQty, p.unit, p.filteredSpend.toFixed(2).replace('.', ',')])];
        const csv = '﻿' + rows.map(r => r.map(v => `"${v}"`).join(';')).join('\r\n');
        const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' })), download: `kostentreiber_${new Date().toISOString().slice(0, 10)}.csv` });
        a.click(); URL.revokeObjectURL(a.href);
    };

    if (loading) return <div style={{ padding: '60px', textAlign: 'center', color: 'var(--color-text-muted)' }}>Lade Finanzdaten…</div>;

    const inflColor   = avgInflation > 10 ? 'var(--color-danger)' : avgInflation < -3 ? 'var(--color-success)' : 'var(--color-text-main)';
    const kpiLabel    = periodFilter === '30' ? 'Ausgaben (30 Tage)' : periodFilter ? 'Ausgaben (Zeitraum)' : 'Ausgaben diesen Monat';
    const chartTitle  = periodFilter === '30' ? 'Ausgaben — letzte 30 Tage' : periodFilter ? `Ausgaben — ${periodOptions.find(o => o.value === periodFilter)?.label ?? ''}` : 'Monatliche Ausgaben — letzte 12 Monate';
    const maxSupSpend = supplierSpends[0]?.spend || 1;

    const isDuplicate = !!draft.key && budgets.some(b => b.type === draft.type && b.key === draft.key && b.period === draft.period);
    const draftVal    = parseFloat(draft.amount.replace(',', '.'));
    const canSave     = !!draft.key && !isNaN(draftVal) && draftVal > 0 && !isDuplicate;

    const tabBtn = (t: Tab, label: string, Icon: React.ElementType) => (
        <button onClick={() => setActiveTab(t)} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '13px', backgroundColor: activeTab === t ? 'var(--color-primary)' : 'transparent', color: activeTab === t ? '#fff' : 'var(--color-text-secondary)', transition: 'all 0.15s' }}>
            <Icon size={14} /> {label}
        </button>
    );

    // ── Shared card header ────────────────────────────────────────────────────

    const CardHdr = ({ icon: Icon, title, iconColor, right }: { icon: React.ElementType; title: string; iconColor?: string; right?: React.ReactNode }) => (
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0, fontSize: '15px', color: 'var(--color-text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Icon size={16} color={iconColor || 'var(--color-primary)'} /> {title}
            </h3>
            {right}
        </div>
    );

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-xl)', paddingBottom: '40px' }}>

            {/* ── Header ─────────────────────────────────────────────────── */}
            <div className="page-header">
                <div>
                    <h2 className="page-title">Finanz-Dashboard</h2>
                    <p style={{ color: 'var(--color-text-muted)', marginTop: '4px' }}>Ausgaben, Einkaufsstatistiken und Preisentwicklung auf einen Blick.</p>
                </div>
                <button className="btn btn-ghost" onClick={handleCsvExport} disabled={!topCostDrivers.length}>
                    <Download size={16} /> CSV Export
                </button>
            </div>

            {/* ── Filter bar ─────────────────────────────────────────────── */}
            <div className="card" style={{ padding: '12px 16px', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                <Filter size={15} color="var(--color-text-muted)" style={{ flexShrink: 0 }} />
                <select value={periodFilter} onChange={e => setPeriodFilter(e.target.value)} className="input-field" style={{ flex: '1 1 170px', padding: '7px 10px' }}>
                    <option value="">Zeitraum: Alle</option>
                    <option value="30">Letzte 30 Tage</option>
                    {periodOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className="input-field" style={{ flex: '1 1 150px', padding: '7px 10px' }}>
                    <option value="">Alle Kategorien</option>
                    {categories.map(c => <option key={c} value={c}>{isKiCat(c) ? '🤖 KI-Import (E-Mail)' : c}</option>)}
                </select>
                <select value={supplierFilter} onChange={e => setSupplierFilter(e.target.value)} className="input-field" style={{ flex: '1 1 150px', padding: '7px 10px' }}>
                    <option value="">Alle Lieferanten</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                {activeFilterCount > 0 && (
                    <button className="btn btn-ghost btn-sm" onClick={() => { setPeriodFilter(''); setCategoryFilter(''); setSupplierFilter(''); }}>
                        <X size={13} /> Zurücksetzen <span className="badge badge-primary" style={{ marginLeft: '4px' }}>{activeFilterCount}</span>
                    </button>
                )}
            </div>

            {/* ── Tab bar ────────────────────────────────────────────────── */}
            <div style={{ display: 'flex', gap: '2px', backgroundColor: 'var(--color-surface-elevated)', borderRadius: 'var(--radius-lg)', padding: '4px', border: '1px solid var(--color-border)', width: 'fit-content' }}>
                {tabBtn('overview',   'Übersicht',   BarChart2)}
                {tabBtn('products',   'Produkte',    Package)}
                {tabBtn('suppliers',  'Lieferanten', Users)}
                {tabBtn('budgets',    'Budgets',     PiggyBank)}
            </div>

            {/* ══════════════ OVERVIEW ══════════════════════════════════════ */}
            {activeTab === 'overview' && (<>

                {/* KPI cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(185px, 1fr))', gap: 'var(--spacing-md)' }}>
                    {[
                        { icon: Package,      label: 'Lagerwert',          main: fmt(kpis.inventoryValue, currency),  sub: `${kpis.productCount} Produkte mit Preis` },
                        { icon: Euro,         label: kpiLabel,              main: fmt(kpis.totalSpend, currency),      sub: !periodFilter && kpis.spendPrev > 0 ? `${kpis.spendDiff > 0 ? '+' : ''}${kpis.spendDiff.toFixed(1)}% ggü. Vormonat` : undefined, subColor: !periodFilter && kpis.spendPrev > 0 ? (kpis.spendDiff > 0 ? 'var(--color-danger)' : 'var(--color-success)') : undefined },
                        { icon: ShoppingCart, label: 'Bestellungen',       main: String(kpis.orderCount),             sub: `Ø ${fmt(kpis.avgOrderValue, currency)} / Bestellung` },
                        { icon: TrendingUp,   label: 'Ø Preisinflation',   main: `${avgInflation >= 0 ? '+' : ''}${avgInflation.toFixed(1)}%`, mainColor: inflColor, sub: `${priceAlerts.length} Produkte mit Preishistorie` },
                        { icon: Layers,       label: 'Lager-Reichweite',   main: kpis.coverageMonths != null ? `${kpis.coverageMonths.toFixed(1)} Mon.` : '—', sub: 'Lagerwert ÷ Verbrauch/Monat' },
                    ].map(k => (
                        <div key={k.label} className="stat-card">
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--color-text-muted)', marginBottom: '10px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                <k.icon size={12} /> {k.label}
                            </div>
                            <div style={{ fontSize: '24px', fontWeight: 700, color: k.mainColor || 'var(--color-text-main)' }}>{k.main}</div>
                            {k.sub && <div style={{ fontSize: '12px', color: k.subColor || 'var(--color-text-faint)', marginTop: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                {k.subColor && (k.subColor.includes('danger') ? <TrendingUp size={11} /> : <TrendingDown size={11} />)}{k.sub}
                            </div>}
                        </div>
                    ))}
                </div>

                {/* Charts row: bar + donut */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr minmax(300px, 370px)', gap: 'var(--spacing-xl)', alignItems: 'start' }}>

                    {/* Bar chart */}
                    <div className="card" style={{ padding: 'var(--spacing-xl)' }}>
                        <h3 style={{ margin: '0 0 var(--spacing-lg) 0', fontSize: '15px', color: 'var(--color-text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Euro size={16} color="var(--color-primary)" /> {chartTitle}
                        </h3>
                        {orders.length > 0 ? (
                            <div style={{ height: '240px' }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={chartData} margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                                        <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }} dy={8} />
                                        <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }} tickFormatter={v => `${tick}${v}`} width={60} />
                                        <Tooltip content={<CTooltip currency={currency} />} cursor={{ fill: 'rgba(37,99,235,0.06)' }} />
                                        <Bar dataKey="ausgaben" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        ) : <EmptyState icon={Euro} title="Keine Bestelldaten" text="Erfasse Bestellungen mit Preisen, um den Ausgaben-Verlauf zu sehen." />}
                    </div>

                    {/* Donut */}
                    <div className="card" style={{ padding: 'var(--spacing-xl)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--spacing-md)' }}>
                            <h3 style={{ margin: 0, fontSize: '15px', color: 'var(--color-text-main)' }}>Kostenverteilung</h3>
                            <div style={{ display: 'flex', gap: '4px' }}>
                                {(['category', 'supplier'] as PieMode[]).map(m => (
                                    <button key={m} onClick={() => setPieMode(m)} className={pieMode === m ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'} style={{ fontSize: '11px', padding: '3px 9px' }}>
                                        {m === 'category' ? 'Kategorie' : 'Lieferant'}
                                    </button>
                                ))}
                            </div>
                        </div>
                        {pieData.length > 0 ? (<>
                            <div style={{ height: '180px' }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={78} paddingAngle={2} dataKey="value">
                                            {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                                        </Pie>
                                        <Tooltip content={<PTooltip currency={currency} />} />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginTop: '10px' }}>
                                {pieData.map((entry, i) => (
                                    <div key={entry.name} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                                        <div style={{ width: '9px', height: '9px', borderRadius: '2px', backgroundColor: PIE_COLORS[i % PIE_COLORS.length], flexShrink: 0 }} />
                                        <span style={{ flex: 1, color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {isKiCat(entry.name) ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}><Bot size={10} color="var(--color-primary)" />KI-Import (E-Mail)</span> : entry.name}
                                        </span>
                                        <span style={{ color: 'var(--color-text-muted)', fontWeight: 600, minWidth: '36px', textAlign: 'right' }}>{pieTotalVal > 0 ? (entry.value / pieTotalVal * 100).toFixed(0) : 0}%</span>
                                        <span style={{ color: 'var(--color-text-faint)', minWidth: '72px', textAlign: 'right' }}>{fmt(entry.value, currency)}</span>
                                    </div>
                                ))}
                            </div>
                        </>) : <EmptyState icon={BarChart2} title="Keine Daten" text="Keine Bestellungen im gewählten Zeitraum." />}
                    </div>
                </div>

                {/* Category horizontal bars */}
                {pieDataCategory.length > 0 && (
                    <div className="card" style={{ padding: 'var(--spacing-xl)' }}>
                        <h3 style={{ margin: '0 0 var(--spacing-lg) 0', fontSize: '15px', color: 'var(--color-text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Layers size={16} color="var(--color-primary)" /> Ausgaben nach Kategorie
                        </h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {pieDataCategory.map((cat, i) => {
                                const pct = pieTotalVal > 0 ? cat.value / pieTotalVal * 100 : 0;
                                return (
                                    <div key={cat.name} style={{ display: 'grid', gridTemplateColumns: '190px 1fr 110px', alignItems: 'center', gap: '12px' }}>
                                        <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {isKiCat(cat.name) ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Bot size={11} color="var(--color-primary)" />KI-Import (E-Mail)</span> : cat.name}
                                        </div>
                                        <div style={{ position: 'relative', height: '8px', backgroundColor: 'var(--color-border)', borderRadius: '4px', overflow: 'hidden' }}>
                                            <div style={{ position: 'absolute', inset: 0, width: `${pct}%`, backgroundColor: PIE_COLORS[i % PIE_COLORS.length], borderRadius: '4px', transition: 'width 0.4s ease' }} />
                                        </div>
                                        <div style={{ textAlign: 'right', fontSize: '13px', fontWeight: 700, color: 'var(--color-text-main)' }}>{fmt(cat.value, currency)}</div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Bottom: Cost drivers + Price alerts */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 'var(--spacing-xl)', alignItems: 'start' }}>

                    <div className="card" style={{ overflow: 'hidden' }}>
                        <CardHdr icon={TrendingUp} title={`Top Kostentreiber${activeFilterCount > 0 ? ' (gefiltert)' : ' — dieser Monat'}`} iconColor="var(--color-danger)"
                            right={topCostDrivers.length > 0 ? <button className="btn btn-ghost btn-sm" onClick={handleCsvExport} title="CSV"><Download size={13} /></button> : undefined} />
                        {topCostDrivers.length > 0 ? (
                            <table className="products-table">
                                <thead><tr><th>#</th><th>Produkt</th><th style={{ textAlign: 'right' }}>Menge</th><th style={{ textAlign: 'right' }}>Kosten</th></tr></thead>
                                <tbody>
                                    {topCostDrivers.map((p, i) => (
                                        <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => { setActiveTab('products'); setExpandedProductId(p.id); }}>
                                            <td style={{ width: '36px' }}>
                                                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '22px', height: '22px', borderRadius: '50%', backgroundColor: i === 0 ? 'var(--color-danger-bg)' : 'var(--color-surface-elevated)', fontSize: '11px', fontWeight: 700, color: i === 0 ? 'var(--color-danger)' : 'var(--color-text-faint)' }}>{i + 1}</span>
                                            </td>
                                            <td>
                                                <div style={{ fontWeight: 500 }}>{p.name}</div>
                                                {p.category && <div style={{ fontSize: '11px', color: 'var(--color-text-faint)' }}>{isKiCat(p.category) ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}><Bot size={9} color="var(--color-primary)" />KI-Import</span> : p.category}</div>}
                                            </td>
                                            <td style={{ textAlign: 'right', color: 'var(--color-text-muted)', fontSize: '13px' }}>{p.filteredQty} {p.unit}</td>
                                            <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(p.filteredSpend, currency)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        ) : <div style={{ padding: 'var(--spacing-xl)' }}><EmptyState icon={TrendingUp} title="Keine Daten" text="Keine Bestellungen mit Preisen für den aktiven Filter." /></div>}
                    </div>

                    <div className="card" style={{ overflow: 'hidden' }}>
                        <CardHdr icon={AlertTriangle} title="Preis-Alarm — Volatilität" iconColor="var(--color-warning)"
                            right={priceAlerts.length > 0 ? <span className="badge badge-warning">{priceAlerts.length}</span> : undefined} />
                        {priceAlerts.length > 0 ? priceAlerts.map(({ product: p, firstPrice, lastPrice, change }) => (
                            <div key={p.id} style={{ padding: '12px 20px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', cursor: 'pointer' }}
                                onClick={() => { setActiveTab('products'); setExpandedProductId(p.id); }}>
                                <div style={{ minWidth: 0 }}>
                                    <div style={{ fontWeight: 500, fontSize: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                                    <div style={{ fontSize: '12px', color: 'var(--color-text-faint)', marginTop: '2px' }}>{fmt(firstPrice, currency)} → {fmt(lastPrice, currency)} / {p.unit}</div>
                                </div>
                                <span className={change > 0 ? 'badge badge-danger' : 'badge badge-success'} style={{ flexShrink: 0 }}>{change > 0 ? '+' : ''}{change.toFixed(1)}%</span>
                            </div>
                        )) : <div style={{ padding: 'var(--spacing-xl)' }}><EmptyState icon={AlertTriangle} title="Keine Preisänderungen" text="Sobald Produkte mit unterschiedlichen Preisen bestellt werden, erscheinen sie hier." /></div>}
                    </div>
                </div>
            </>)}

            {/* ══════════════ PRODUCTS TAB ══════════════════════════════════ */}
            {activeTab === 'products' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-lg)' }}>
                    <div style={{ position: 'relative' }}>
                        <Search size={15} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', pointerEvents: 'none' }} />
                        <input type="text" placeholder="Produkt, Kategorie oder Lieferant suchen…" value={productSearch} onChange={e => setProductSearch(e.target.value)} className="input-field" style={{ width: '100%', padding: '10px 12px 10px 36px', boxSizing: 'border-box' }} />
                    </div>

                    <div className="card" style={{ overflow: 'hidden' }}>
                        {filteredProductStats.length > 0 ? (
                            <table className="products-table">
                                <thead>
                                    <tr>
                                        <th>Produkt</th><th>Kategorie</th><th>Lieferant</th>
                                        <th style={{ textAlign: 'right' }}>Ø Preis</th>
                                        <th style={{ textAlign: 'right' }}>Preisänderung</th>
                                        <th style={{ textAlign: 'right' }}>Ausgaben gesamt</th>
                                        <th style={{ width: '32px' }} />
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredProductStats.map(stat => {
                                        const exp = expandedProductId === stat.product.id;
                                        const history      = exp ? getPriceHistory(stat.product.name) : [];
                                        const monthly      = exp ? getMonthlySpend(stat.product.name) : [];
                                        const recentOrders = exp ? orders.filter(o => o.productName === stat.product.name).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 10) : [];
                                        return (
                                            <React.Fragment key={stat.product.id}>
                                                <tr onClick={() => setExpandedProductId(exp ? null : stat.product.id)} style={{ cursor: 'pointer', backgroundColor: exp ? 'var(--color-surface-elevated)' : undefined }}>
                                                    <td>
                                                        <div style={{ fontWeight: 600 }}>{stat.product.name}</div>
                                                        <div style={{ fontSize: '11px', color: 'var(--color-text-faint)' }}>{stat.orderCount} Bestellung{stat.orderCount !== 1 ? 'en' : ''} · {stat.totalQty} {stat.product.unit}</div>
                                                    </td>
                                                    <td>
                                                        {stat.product.category
                                                            ? (isKiCat(stat.product.category) ? <KiCatBadge /> : <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>{stat.product.category}</span>)
                                                            : <span style={{ color: 'var(--color-text-faint)', fontSize: '12px' }}>—</span>}
                                                    </td>
                                                    <td style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>{stat.supplierName}</td>
                                                    <td style={{ textAlign: 'right', fontSize: '13px', fontWeight: 500 }}>{fmt(stat.avgPrice, currency)}</td>
                                                    <td style={{ textAlign: 'right' }}>
                                                        {stat.priceChange !== 0
                                                            ? <span style={{ fontSize: '12px', fontWeight: 600, color: stat.priceChange > 0 ? 'var(--color-danger)' : 'var(--color-success)' }}>{stat.priceChange > 0 ? '+' : ''}{stat.priceChange.toFixed(1)}%</span>
                                                            : <span style={{ color: 'var(--color-text-faint)', fontSize: '12px' }}>—</span>}
                                                    </td>
                                                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(stat.totalSpend, currency)}</td>
                                                    <td>{exp ? <ChevronDown size={15} color="var(--color-text-muted)" /> : <ChevronRight size={15} color="var(--color-text-muted)" />}</td>
                                                </tr>

                                                {exp && (
                                                    <tr>
                                                        <td colSpan={7} style={{ padding: 0, backgroundColor: 'var(--color-background)' }}>
                                                            <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

                                                                {/* Mini KPIs */}
                                                                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                                                                    {[
                                                                        ['Min. Preis',       fmt(stat.minPrice, currency)],
                                                                        ['Max. Preis',       fmt(stat.maxPrice, currency)],
                                                                        ['Ø Preis',          fmt(stat.avgPrice, currency)],
                                                                        ['Bestellungen',     String(stat.orderCount)],
                                                                        ['Menge gesamt',     `${stat.totalQty} ${stat.product.unit}`],
                                                                        ['Ausgaben gesamt',  fmt(stat.totalSpend, currency)],
                                                                    ].map(([lbl, val]) => (
                                                                        <div key={lbl} style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '10px 14px', minWidth: '110px' }}>
                                                                            <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-muted)', marginBottom: '4px' }}>{lbl}</div>
                                                                            <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--color-text-main)' }}>{val}</div>
                                                                        </div>
                                                                    ))}
                                                                </div>

                                                                {/* Charts */}
                                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                                                    <div>
                                                                        <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '10px' }}>Preisverlauf</div>
                                                                        {history.length >= 2 ? (
                                                                            <div style={{ height: '160px' }}>
                                                                                <ResponsiveContainer width="100%" height="100%">
                                                                                    <LineChart data={history} margin={{ top: 4, right: 12, bottom: 4, left: 4 }}>
                                                                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                                                                                        <XAxis dataKey="date" tick={{ fill: 'var(--color-text-muted)', fontSize: 10 }} axisLine={false} tickLine={false} />
                                                                                        <YAxis tick={{ fill: 'var(--color-text-muted)', fontSize: 10 }} tickFormatter={v => `${tick}${v}`} axisLine={false} tickLine={false} width={52} />
                                                                                        <Tooltip content={<CTooltip currency={currency} />} />
                                                                                        <Line type="monotone" dataKey="Preis" stroke="var(--color-primary)" strokeWidth={2} dot={{ fill: 'var(--color-primary)', r: 3 }} />
                                                                                    </LineChart>
                                                                                </ResponsiveContainer>
                                                                            </div>
                                                                        ) : (
                                                                            <div style={{ height: '160px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', color: 'var(--color-text-faint)', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-md)' }}>
                                                                                Mindestens 2 Bestellungen mit Preis nötig
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                    <div>
                                                                        <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '10px' }}>Ausgaben letzte 6 Monate</div>
                                                                        <div style={{ height: '160px' }}>
                                                                            <ResponsiveContainer width="100%" height="100%">
                                                                                <BarChart data={monthly} margin={{ top: 4, right: 12, bottom: 4, left: 4 }}>
                                                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                                                                                    <XAxis dataKey="date" tick={{ fill: 'var(--color-text-muted)', fontSize: 10 }} axisLine={false} tickLine={false} />
                                                                                    <YAxis tick={{ fill: 'var(--color-text-muted)', fontSize: 10 }} tickFormatter={v => `${tick}${v}`} axisLine={false} tickLine={false} width={52} />
                                                                                    <Tooltip content={<CTooltip currency={currency} />} />
                                                                                    <Bar dataKey="ausgaben" fill="var(--color-primary)" radius={[3, 3, 0, 0]} />
                                                                                </BarChart>
                                                                            </ResponsiveContainer>
                                                                        </div>
                                                                    </div>
                                                                </div>

                                                                {/* Order history */}
                                                                {recentOrders.length > 0 && (
                                                                    <div>
                                                                        <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '8px' }}>Letzte Bestellungen</div>
                                                                        <table className="products-table" style={{ fontSize: '12px' }}>
                                                                            <thead><tr><th>Datum</th><th style={{ textAlign: 'right' }}>Menge</th><th style={{ textAlign: 'right' }}>Preis / Einheit</th><th style={{ textAlign: 'right' }}>Gesamt</th></tr></thead>
                                                                            <tbody>
                                                                                {recentOrders.map(o => {
                                                                                    const price = o.price ?? stat.product.price ?? 0;
                                                                                    return (
                                                                                        <tr key={o.id}>
                                                                                            <td>{new Date(o.date).toLocaleDateString('de-DE')}</td>
                                                                                            <td style={{ textAlign: 'right' }}>{o.quantity} {stat.product.unit}</td>
                                                                                            <td style={{ textAlign: 'right' }}>{price > 0 ? fmt(price, currency) : '—'}</td>
                                                                                            <td style={{ textAlign: 'right', fontWeight: 600 }}>{price > 0 ? fmt(o.quantity * price, currency) : '—'}</td>
                                                                                        </tr>
                                                                                    );
                                                                                })}
                                                                            </tbody>
                                                                        </table>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )}
                                            </React.Fragment>
                                        );
                                    })}
                                </tbody>
                            </table>
                        ) : (
                            <div style={{ padding: 'var(--spacing-xl)' }}>
                                <EmptyState icon={Package} title="Keine Produkte" text={productSearch ? 'Kein Produkt passt zum Suchbegriff.' : 'Keine Bestellungen mit Preisen im gewählten Zeitraum.'} />
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ══════════════ SUPPLIERS TAB ═════════════════════════════════ */}
            {activeTab === 'suppliers' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-xl)' }}>
                    {supplierSpends.length > 0 ? (<>

                        {/* Horizontal bars */}
                        <div className="card" style={{ padding: 'var(--spacing-xl)' }}>
                            <h3 style={{ margin: '0 0 var(--spacing-lg) 0', fontSize: '15px', color: 'var(--color-text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Users size={16} color="var(--color-primary)" /> Ausgaben nach Lieferant
                            </h3>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                {supplierSpends.map((s, i) => {
                                    const pct = (s.spend / maxSupSpend) * 100;
                                    return (
                                        <div key={s.id} style={{ display: 'grid', gridTemplateColumns: '200px 1fr 120px', alignItems: 'center', gap: '12px' }}>
                                            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>
                                            <div style={{ position: 'relative', height: '10px', backgroundColor: 'var(--color-border)', borderRadius: '5px', overflow: 'hidden' }}>
                                                <div style={{ position: 'absolute', inset: 0, width: `${pct}%`, backgroundColor: PIE_COLORS[i % PIE_COLORS.length], borderRadius: '5px', transition: 'width 0.4s ease' }} />
                                            </div>
                                            <div style={{ textAlign: 'right', fontSize: '13px', fontWeight: 700 }}>{fmt(s.spend, currency)}</div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Supplier cards */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 'var(--spacing-md)' }}>
                            {supplierSpends.map((s, i) => (
                                <div key={s.id} className="card" style={{ padding: '18px 20px' }}>
                                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '14px' }}>
                                        <div>
                                            <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--color-text-main)', marginBottom: '3px' }}>{s.name}</div>
                                            {s.email && <div style={{ fontSize: '12px', color: 'var(--color-text-faint)' }}>{s.email}</div>}
                                        </div>
                                        <div style={{ width: '36px', height: '36px', borderRadius: '50%', backgroundColor: PIE_COLORS[i % PIE_COLORS.length] + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                            <Users size={16} color={PIE_COLORS[i % PIE_COLORS.length]} />
                                        </div>
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', textAlign: 'center' }}>
                                        {[['Ausgaben', fmt(s.spend, currency)], ['Bestellungen', String(s.orderCount)], ['Produkte', String(s.productCount)]].map(([lbl, val]) => (
                                            <div key={lbl}>
                                                <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--color-text-main)' }}>{val}</div>
                                                <div style={{ fontSize: '10px', color: 'var(--color-text-faint)', marginTop: '2px' }}>{lbl}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </>) : (
                        <div className="card" style={{ padding: 'var(--spacing-xl)' }}>
                            <EmptyState icon={Users} title="Keine Lieferantendaten" text="Keine Bestellungen mit Lieferantenzuordnung im gewählten Zeitraum." />
                        </div>
                    )}
                </div>
            )}

            {/* ══════════════ BUDGETS TAB ═══════════════════════════════════ */}
            {activeTab === 'budgets' && (
                <div className="card" style={{ padding: 'var(--spacing-xl)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: budgets.length > 0 ? 'var(--spacing-lg)' : 0 }}>
                        <h3 style={{ margin: 0, fontSize: '16px', color: 'var(--color-text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <PiggyBank size={18} color="var(--color-primary)" /> Budget-Tracking
                        </h3>
                        <button className="btn btn-primary btn-sm" onClick={() => { setDraft(DRAFT_INIT); setShowBudgetModal(true); }}>
                            <Plus size={14} /> Budget erstellen
                        </button>
                    </div>
                    {budgets.length > 0 ? (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 'var(--spacing-md)' }}>
                            {budgets.map(b => {
                                const spend = budgetSpends[b.id] ?? 0;
                                const pct   = b.amount > 0 ? Math.min((spend / b.amount) * 100, 100) : 0;
                                const over  = spend > b.amount;
                                const bar   = pct > 90 ? 'var(--color-danger)' : pct > 70 ? 'var(--color-warning)' : 'var(--color-success)';
                                return (
                                    <div key={b.id} style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '14px 16px', backgroundColor: 'var(--color-surface-elevated)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                                            <div>
                                                <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '5px' }}>{b.label}</div>
                                                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                                    <span className={`badge ${TYPE_BADGE[b.type]}`}>{TYPE_LABEL[b.type]}</span>
                                                    <span className="badge badge-neutral">{PERIOD_LABEL[b.period]}</span>
                                                    {over && <span className="badge badge-danger">Überschritten</span>}
                                                </div>
                                            </div>
                                            <button className="btn btn-ghost btn-sm" style={{ padding: '4px 6px', flexShrink: 0 }} onClick={() => handleDeleteBudget(b.id)}><Trash2 size={13} color="var(--color-text-muted)" /></button>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                                            <span style={{ fontSize: '22px', fontWeight: 700, color: over ? 'var(--color-danger)' : 'var(--color-text-main)' }}>{fmt(spend, currency)}</span>
                                            <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>/ {fmt(b.amount, currency)}</span>
                                        </div>
                                        <div style={{ height: '6px', backgroundColor: 'var(--color-border)', borderRadius: '3px', overflow: 'hidden' }}>
                                            <div style={{ height: '100%', width: `${pct}%`, backgroundColor: bar, borderRadius: '3px', transition: 'width 0.4s ease' }} />
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <span style={{ fontSize: '11px', color: 'var(--color-text-faint)' }}>{PERIOD_NOW[b.period]} · {pct.toFixed(0)}%</span>
                                            {over ? <span style={{ fontSize: '11px', color: 'var(--color-danger)', fontWeight: 600 }}>+{fmt(spend - b.amount, currency)} über Budget</span>
                                                  : <span style={{ fontSize: '11px', color: 'var(--color-text-faint)' }}>{fmt(b.amount - spend, currency)} verbleibend</span>}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div style={{ paddingTop: 'var(--spacing-lg)' }}>
                            <EmptyState icon={PiggyBank} title="Noch kein Budget definiert" text="Klicke auf 'Budget erstellen', um ein Budget für eine Kategorie, ein Produkt oder einen Lieferanten festzulegen." />
                        </div>
                    )}
                </div>
            )}

            {/* ── Budget Modal ────────────────────────────────────────────── */}
            {showBudgetModal && (
                <div className="modal-overlay" onClick={() => setShowBudgetModal(false)}>
                    <div className="modal-box" style={{ maxWidth: '480px' }} onClick={e => e.stopPropagation()}>
                        <div className="modal-header"><PiggyBank size={18} color="var(--color-primary)" /><h3>Budget erstellen</h3></div>
                        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '8px' }}>Budget-Typ</label>
                                <div style={{ display: 'flex', gap: '6px' }}>
                                    {(['category', 'product', 'supplier'] as const).map(t => (
                                        <button key={t} className={draft.type === t ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'} onClick={() => setDraft(p => ({ ...p, type: t, key: '', label: '' }))}>{TYPE_LABEL[t]}</button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '6px' }}>{TYPE_LABEL[draft.type]} auswählen</label>
                                <select value={draft.key} onChange={e => { const v = e.target.value; const l = draft.type === 'supplier' ? (suppliers.find(s => s.id === v)?.name ?? v) : v; setDraft(p => ({ ...p, key: v, label: l })); }} className="input-field" style={{ width: '100%', padding: '8px 12px' }}>
                                    <option value="">— bitte wählen —</option>
                                    {draft.type === 'category' && categories.map(c => <option key={c} value={c}>{isKiCat(c) ? '🤖 KI-Import (E-Mail)' : c}</option>)}
                                    {draft.type === 'product'  && products.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                                    {draft.type === 'supplier' && suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '6px' }}>Zeitraum</label>
                                <select value={draft.period} onChange={e => setDraft(p => ({ ...p, period: e.target.value as BudgetDraft['period'] }))} className="input-field" style={{ width: '100%', padding: '8px 12px' }}>
                                    <option value="weekly">Wöchentlich</option><option value="monthly">Monatlich</option><option value="quarterly">Quartalsmäßig</option><option value="yearly">Jährlich</option>
                                </select>
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '6px' }}>Budget-Betrag ({currency})</label>
                                <input type="number" min="0" step="100" placeholder="z.B. 1000" value={draft.amount} onChange={e => setDraft(p => ({ ...p, amount: e.target.value }))} className="input-field" style={{ width: '100%', padding: '8px 12px' }} autoFocus />
                            </div>
                            {isDuplicate && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--color-warning)', backgroundColor: 'var(--color-warning-bg)', padding: '8px 12px', borderRadius: 'var(--radius-sm)' }}>
                                    <AlertTriangle size={14} style={{ flexShrink: 0 }} /> Für diese {TYPE_LABEL[draft.type]} existiert bereits ein Budget für diesen Zeitraum.
                                </div>
                            )}
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-ghost" onClick={() => setShowBudgetModal(false)}>Abbrechen</button>
                            <button className="btn btn-primary" onClick={handleSaveBudget} disabled={!canSave}><PiggyBank size={14} /> Budget speichern</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
