import React, { useState, useEffect, useMemo } from 'react';
import type { Product, Order } from '../types';
import { DataService } from '../services/data';
import { Activity, Bot, CheckCircle2, X, AlertTriangle, Zap, ChevronDown, ChevronRight, RotateCcw, Save, Pencil } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProductStat {
    product: Product;
    suggestedWeekly: number;
    actualWeeklyRate: number;
}

interface Anomaly {
    product: Product;
    autoWeekly: number;
    actualWeekly: number;
    ratio: number;
}

interface MonthlyBarData {
    date: string;
    menge: number;
}

interface InlineEdit {
    amount: number | '';
    period: 'day' | 'week';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const EmptyState = ({ icon: Icon, title, text }: {
    icon: React.ElementType; title: string; text: string;
}) => (
    <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--color-text-muted)', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-lg)' }}>
        <Icon size={32} style={{ opacity: 0.25, display: 'block', margin: '0 auto 10px' }} />
        <div style={{ fontWeight: 600, color: 'var(--color-text-main)', marginBottom: '4px' }}>{title}</div>
        <div style={{ fontSize: '13px' }}>{text}</div>
    </div>
);

const ChartTooltip = ({ active, payload, label, unit }: {
    active?: boolean; payload?: { value: number }[]; label?: string; unit: string;
}) => {
    if (!active || !payload?.length) return null;
    return (
        <div style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', boxShadow: 'var(--shadow-md)' }}>
            <div style={{ fontWeight: 600, color: 'var(--color-text-main)', marginBottom: '2px', fontSize: '13px' }}>{label}</div>
            <div style={{ color: 'var(--color-primary)', fontSize: '13px' }}>{payload[0].value} {unit}</div>
        </div>
    );
};

const periodLabel = (p: Product) => p.consumptionPeriod === 'day' ? 'pro Tag' : 'pro Woche';

const getRunwayDays = (p: Product): number | null => {
    const amount = p.consumptionAmount ?? 0;
    if (!amount || !p.consumptionPeriod) return null;
    const dailyRate = p.consumptionPeriod === 'day' ? amount : amount / 7;
    if (dailyRate <= 0) return null;
    return Math.floor(p.stock / dailyRate);
};

const RunwayBadge: React.FC<{ product: Product }> = ({ product }) => {
    const days = getRunwayDays(product);
    if (days === null) return null;
    const [cls, label] =
        days <= 0  ? ['badge-danger',   'Leer']
        : days <= 3  ? ['badge-danger',   `${days}d`]
        : days <= 7  ? ['badge-warning',  `${days}d`]
        : ['badge-neutral', `${days}d`];
    return <span className={`badge ${cls}`} title={`Bestand reicht noch ca. ${days} Tage`}>{label}</span>;
};

// ── Mini Chart (last 8 months of orders for one product) ─────────────────────

const ProductMiniChart: React.FC<{ productName: string; unit: string; orders: Order[] }> = ({ productName, unit, orders }) => {
    const data = useMemo((): MonthlyBarData[] => {
        return Array.from({ length: 8 }, (_, i) => {
            const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - (7 - i));
            const mo = d.getMonth(), yr = d.getFullYear();
            const label = d.toLocaleDateString('de-DE', { month: 'short', year: '2-digit' });
            const menge = orders
                .filter(o => {
                    const od = new Date(o.date);
                    return o.productName === productName && od.getMonth() === mo && od.getFullYear() === yr;
                })
                .reduce((s, o) => s + o.quantity, 0);
            return { date: label, menge };
        });
    }, [productName, orders]);

    const hasData = data.some(d => d.menge > 0);
    if (!hasData) return (
        <div style={{ textAlign: 'center', color: 'var(--color-text-faint)', fontSize: '13px', padding: '16px 0' }}>
            Noch keine Bestellhistorie für dieses Produkt vorhanden.
        </div>
    );

    return (
        <div style={{ height: '160px' }}>
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: -8 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                    <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }} dy={6} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }} width={28} />
                    <Tooltip content={<ChartTooltip unit={unit} />} cursor={{ fill: 'rgba(37,99,235,0.06)' }} />
                    <Bar dataKey="menge" fill="var(--color-primary)" radius={[3, 3, 0, 0]} />
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
};

// ── Component ─────────────────────────────────────────────────────────────────

export const Consumption: React.FC = () => {
    const [products, setProducts] = useState<Product[]>([]);
    const [orders, setOrders]     = useState<Order[]>([]);
    const [loading, setLoading]   = useState(true);
    const [saving, setSaving]     = useState<string | null>(null);
    const [batchSaving, setBatchSaving] = useState(false);
    const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
    const [inlineEdits, setInlineEdits] = useState<Record<string, InlineEdit>>({});
    const [showManualSection, setShowManualSection] = useState(false);
    const [activeTab, setActiveTab] = useState<'setup' | 'active' | 'ignored'>('setup');

    const loadData = async () => {
        const [p, o] = await Promise.all([DataService.getProducts(), DataService.getOrders()]);
        setProducts(p); setOrders(o); setLoading(false);
    };

    useEffect(() => { loadData(); }, []);



    const handleToggleSuggestionExpand = (stat: ProductStat) => {
        const id = stat.product.id;
        setExpandedRows(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
                // pre-fill with AI suggestion on first open (don't overwrite if user already edited)
                setInlineEdits(edits => ({
                    ...edits,
                    [id]: edits[id] ?? { amount: stat.suggestedWeekly, period: 'week' },
                }));
            }
            return next;
        });
    };

    const handleTogglePilotExpand = (p: Product) => {
        const key = `pilot-${p.id}`;
        setExpandedRows(prev => {
            const next = new Set(prev);
            if (next.has(key)) {
                next.delete(key);
            } else {
                next.add(key);
                // initialize inline edit state on first open
                setInlineEdits(edits => ({
                    ...edits,
                    [p.id]: { amount: p.consumptionAmount ?? '', period: p.consumptionPeriod ?? 'week' },
                }));
            }
            return next;
        });
    };

    // ── Per-product stats ────────────────────────────────────────────────────

    const productStats = useMemo((): ProductStat[] => {
        return products.map(product => {
            const productOrders = orders
                .filter(o => o.productName === product.name)
                .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

            if (productOrders.length < 2) return { product, suggestedWeekly: 0, actualWeeklyRate: 0 };

            const first    = new Date(productOrders[0].date);
            const last     = new Date(productOrders[productOrders.length - 1].date);
            const diffDays  = Math.max(1, Math.floor((last.getTime() - first.getTime()) / 86_400_000));
            const diffWeeks = diffDays / 7;
            const consumed  = productOrders.slice(0, -1).reduce((s, o) => s + o.quantity, 0);
            const totalOrdered = productOrders.reduce((s, o) => s + o.quantity, 0);

            return {
                product,
                suggestedWeekly: Number((consumed / diffDays * 7).toFixed(1)),
                actualWeeklyRate: Number((totalOrdered / diffWeeks).toFixed(1)),
            };
        });
    }, [products, orders]);

    // ── Derived lists ────────────────────────────────────────────────────────

    const activePilots = useMemo(
        () => products.filter(p => (p.consumptionAmount ?? 0) > 0 && p.consumptionPeriod),
        [products],
    );

    const suggestions = useMemo(
        () => productStats.filter(s => s.suggestedWeekly > 0 && !(s.product.consumptionAmount ?? 0) && !s.product.ignoreOrderProposals),
        [productStats],
    );

    const ignoredProducts = useMemo(
        () => products.filter(p => p.ignoreOrderProposals),
        [products],
    );

    const manualProducts = useMemo(
        () => products.filter(p =>
            !(p.consumptionAmount ?? 0) &&
            !productStats.find(s => s.product.id === p.id && s.suggestedWeekly > 0) &&
            !p.ignoreOrderProposals
        ),
        [products, productStats],
    );

    const anomalies = useMemo((): Anomaly[] => {
        return activePilots.map(p => {
            const autoWeekly   = p.consumptionPeriod === 'day' ? (p.consumptionAmount ?? 0) * 7 : (p.consumptionAmount ?? 0);
            const actualWeekly = productStats.find(s => s.product.id === p.id)?.actualWeeklyRate ?? 0;
            if (autoWeekly === 0 || actualWeekly === 0) return null;
            const ratio = actualWeekly / autoWeekly;
            if (ratio >= 0.5 && ratio <= 1.5) return null;
            return { product: p, autoWeekly, actualWeekly, ratio };
        }).filter((d): d is Anomaly => d !== null);
    }, [activePilots, productStats]);

    // ── Actions ──────────────────────────────────────────────────────────────

    const handleAdopt = async (stat: ProductStat) => {
        setSaving(stat.product.id);
        try {
            await DataService.saveProduct({ ...stat.product, consumptionAmount: stat.suggestedWeekly, consumptionPeriod: 'week', lastConsumptionDate: new Date().toISOString() });
            await loadData();
        } finally { setSaving(null); }
    };

    const handleAdoptAll = async () => {
        setBatchSaving(true);
        try {
            await Promise.all(suggestions.map(stat =>
                DataService.saveProduct({ ...stat.product, consumptionAmount: stat.suggestedWeekly, consumptionPeriod: 'week', lastConsumptionDate: new Date().toISOString() })
            ));
            await loadData();
        } finally { setBatchSaving(false); }
    };

    const handleIgnore = async (product: Product) => {
        setSaving(product.id);
        try {
            await DataService.saveProduct({ ...product, ignoreOrderProposals: true });
            await loadData();
        } finally { setSaving(null); }
    };

    const handleRestore = async (product: Product) => {
        setSaving(product.id);
        try {
            await DataService.saveProduct({ ...product, ignoreOrderProposals: false });
            await loadData();
        } finally { setSaving(null); }
    };

    const handleSaveInline = async (product: Product) => {
        const edit = inlineEdits[product.id];
        if (!edit || edit.amount === '') return;
        setSaving(`inline-${product.id}`);
        try {
            await DataService.saveProduct({
                ...product,
                consumptionAmount: Number(edit.amount),
                consumptionPeriod: edit.period,
                lastConsumptionDate: new Date().toISOString(),
            });
            await loadData();
        } finally { setSaving(null); }
    };

    if (loading) return (
        <div style={{ padding: '60px', textAlign: 'center', color: 'var(--color-text-muted)' }}>Lade Autopilot-Daten…</div>
    );

    // ── Suggestion expand panel (chart + editable form) ──────────────────────

    const suggestionExpandPanel = (stat: ProductStat) => {
        const { product: p } = stat;
        const edit = inlineEdits[p.id] ?? { amount: stat.suggestedWeekly, period: 'week' as const };
        const isSavingThis = saving === `inline-${p.id}`;
        const canSave = edit.amount !== '' && Number(edit.amount) > 0;
        return (
            <tr>
                <td colSpan={3} style={{ padding: '0 var(--spacing-xl) var(--spacing-md) var(--spacing-xl)', backgroundColor: 'var(--color-surface-elevated)', borderBottom: '1px solid var(--color-border)' }}>
                    <div style={{ paddingTop: 'var(--spacing-sm)', display: 'grid', gridTemplateColumns: '1fr auto', gap: 'var(--spacing-xl)', alignItems: 'start' }}>
                        {/* Chart */}
                        <div>
                            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
                                Bestellhistorie (letzte 8 Monate) — {p.name}
                            </div>
                            <ProductMiniChart productName={p.name} unit={p.unit} orders={orders} />
                        </div>
                        {/* Editable form */}
                        <div style={{ minWidth: '200px', backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                Verbrauch anpassen
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                <label style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>Menge ({p.unit})</label>
                                <input
                                    type="number"
                                    min={0}
                                    step="0.1"
                                    value={edit.amount}
                                    onChange={e => setInlineEdits(prev => ({ ...prev, [p.id]: { ...edit, amount: e.target.value === '' ? '' : Number(e.target.value) } }))}
                                    onClick={e => e.stopPropagation()}
                                    style={{ width: '100%', padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface-elevated)', color: 'var(--color-text-main)', fontSize: '14px', fontWeight: 500 }}
                                />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                <label style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>Zeitraum</label>
                                <select
                                    value={edit.period}
                                    onChange={e => setInlineEdits(prev => ({ ...prev, [p.id]: { ...edit, period: e.target.value as 'day' | 'week' } }))}
                                    onClick={e => e.stopPropagation()}
                                    style={{ width: '100%', padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface-elevated)', color: 'var(--color-text-main)', fontSize: '14px' }}
                                >
                                    <option value="week">pro Woche</option>
                                    <option value="day">pro Tag</option>
                                </select>
                            </div>
                            <button
                                className="btn btn-success btn-sm"
                                disabled={!canSave || isSavingThis}
                                onClick={e => { e.stopPropagation(); handleSaveInline(p); }}
                                style={{ width: '100%', justifyContent: 'center' }}
                            >
                                <CheckCircle2 size={13} /> {isSavingThis ? 'Wird übernommen…' : 'Übernehmen'}
                            </button>
                        </div>
                    </div>
                </td>
            </tr>
        );
    };

    // ── Pilot expand panel with inline edit ───────────────────────────────────

    const pilotExpandPanel = (p: Product) => {
        const edit = inlineEdits[p.id] ?? { amount: p.consumptionAmount ?? '', period: p.consumptionPeriod ?? 'week' };
        const isDirty = edit.amount !== (p.consumptionAmount ?? '') || edit.period !== (p.consumptionPeriod ?? 'week');
        const isSavingThis = saving === `inline-${p.id}`;
        return (
            <tr>
                <td colSpan={4} style={{ padding: '0 var(--spacing-xl) var(--spacing-md) var(--spacing-xl)', backgroundColor: 'var(--color-surface-elevated)', borderBottom: '1px solid var(--color-border)' }}>
                    <div style={{ paddingTop: 'var(--spacing-sm)', display: 'grid', gridTemplateColumns: '1fr auto', gap: 'var(--spacing-xl)', alignItems: 'start' }}>
                        {/* Chart */}
                        <div>
                            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
                                Bestellhistorie (letzte 8 Monate) — {p.name}
                            </div>
                            <ProductMiniChart productName={p.name} unit={p.unit} orders={orders} />
                        </div>
                        {/* Inline edit */}
                        <div style={{ minWidth: '200px', backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                Autopilot anpassen
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                <label style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>Menge</label>
                                <input
                                    type="number"
                                    min={0}
                                    step="0.1"
                                    value={edit.amount}
                                    onChange={e => setInlineEdits(prev => ({ ...prev, [p.id]: { ...edit, amount: e.target.value === '' ? '' : Number(e.target.value) } }))}
                                    onClick={e => e.stopPropagation()}
                                    style={{ width: '100%', padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface-elevated)', color: 'var(--color-text-main)', fontSize: '14px', fontWeight: 500 }}
                                />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                <label style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>Zeitraum</label>
                                <select
                                    value={edit.period}
                                    onChange={e => setInlineEdits(prev => ({ ...prev, [p.id]: { ...edit, period: e.target.value as 'day' | 'week' } }))}
                                    onClick={e => e.stopPropagation()}
                                    style={{ width: '100%', padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface-elevated)', color: 'var(--color-text-main)', fontSize: '14px' }}
                                >
                                    <option value="week">pro Woche</option>
                                    <option value="day">pro Tag</option>
                                </select>
                            </div>
                            <button
                                className="btn btn-primary btn-sm"
                                disabled={!isDirty || edit.amount === '' || isSavingThis}
                                onClick={e => { e.stopPropagation(); handleSaveInline(p); }}
                                style={{ width: '100%', justifyContent: 'center' }}
                            >
                                <Save size={13} /> {isSavingThis ? 'Speichern…' : 'Speichern'}
                            </button>
                        </div>
                    </div>
                </td>
            </tr>
        );
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2xl)', paddingBottom: '40px' }}>

            {/* ── Header ── */}
            <div className="page-header">
                <div>
                    <h2 className="page-title">Verbrauch & Autopilot</h2>
                    <p style={{ color: 'var(--color-text-muted)', marginTop: '4px' }}>
                        KI-Vorschläge bestätigen und automatischen Verbrauch in einer Übersicht steuern.
                    </p>
                </div>
            </div>

            {/* ── KPI Cards ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 'var(--spacing-md)' }}>
                <div className="stat-card">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px', color: 'var(--color-text-muted)', marginBottom: '10px', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        <Zap size={14} /> Aktive Autopiloten
                    </div>
                    <div style={{ fontSize: '36px', fontWeight: 700, color: 'var(--color-primary)' }}>{activePilots.length}</div>
                    <div style={{ fontSize: '12px', color: 'var(--color-text-faint)', marginTop: '6px' }}>von {products.length} Produkten</div>
                </div>

                <div className="stat-card">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px', color: 'var(--color-text-muted)', marginBottom: '10px', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        <Bot size={14} /> Offene KI-Vorschläge
                    </div>
                    <div style={{ fontSize: '36px', fontWeight: 700, color: suggestions.length > 0 ? 'var(--color-warning)' : 'var(--color-text-main)' }}>{suggestions.length}</div>
                    <div style={{ fontSize: '12px', color: 'var(--color-text-faint)', marginTop: '6px' }}>warten auf Bestätigung</div>
                </div>

                <div className="stat-card">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px', color: 'var(--color-text-muted)', marginBottom: '10px', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        <AlertTriangle size={14} /> Anomalien
                    </div>
                    <div style={{ fontSize: '36px', fontWeight: 700, color: anomalies.length > 0 ? 'var(--color-danger)' : 'var(--color-text-main)' }}>{anomalies.length}</div>
                    <div style={{ fontSize: '12px', color: 'var(--color-text-faint)', marginTop: '6px' }}>Abweichung &gt; 50%</div>
                </div>

                {ignoredProducts.length > 0 && (
                    <div className="stat-card">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '7px', color: 'var(--color-text-muted)', marginBottom: '10px', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                            <X size={14} /> Ignoriert
                        </div>
                        <div style={{ fontSize: '36px', fontWeight: 700, color: 'var(--color-text-secondary)' }}>{ignoredProducts.length}</div>
                        <div style={{ fontSize: '12px', color: 'var(--color-text-faint)', marginTop: '6px' }}>Vorschläge ausgeblendet</div>
                    </div>
                )}
            </div>

            {/* ── Tabs Navigation ── */}
            <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--color-border)', paddingBottom: '0', marginBottom: 'var(--spacing-md)' }}>
                <button
                    className={`btn btn-ghost ${activeTab === 'setup' ? 'btn-active' : ''}`}
                    style={{ borderRadius: '0', borderBottom: activeTab === 'setup' ? '2px solid var(--color-primary)' : '2px solid transparent', padding: '10px 16px', fontWeight: activeTab === 'setup' ? 600 : 500, color: activeTab === 'setup' ? 'var(--color-primary)' : 'var(--color-text-muted)' }}
                    onClick={() => setActiveTab('setup')}
                >
                    <Bot size={16} /> Einrichten
                    {(suggestions.length > 0 || manualProducts.length > 0) && (
                        <span className="badge badge-neutral" style={{ marginLeft: '6px' }}>{suggestions.length + manualProducts.length}</span>
                    )}
                </button>
                <button
                    className={`btn btn-ghost ${activeTab === 'active' ? 'btn-active' : ''}`}
                    style={{ borderRadius: '0', borderBottom: activeTab === 'active' ? '2px solid var(--color-primary)' : '2px solid transparent', padding: '10px 16px', fontWeight: activeTab === 'active' ? 600 : 500, color: activeTab === 'active' ? 'var(--color-primary)' : 'var(--color-text-muted)' }}
                    onClick={() => setActiveTab('active')}
                >
                    <Zap size={16} /> Laufend
                    {activePilots.length > 0 && (
                        <span className="badge badge-neutral" style={{ marginLeft: '6px' }}>{activePilots.length}</span>
                    )}
                </button>
                <button
                    className={`btn btn-ghost ${activeTab === 'ignored' ? 'btn-active' : ''}`}
                    style={{ borderRadius: '0', borderBottom: activeTab === 'ignored' ? '2px solid var(--color-primary)' : '2px solid transparent', padding: '10px 16px', fontWeight: activeTab === 'ignored' ? 600 : 500, color: activeTab === 'ignored' ? 'var(--color-primary)' : 'var(--color-text-muted)' }}
                    onClick={() => setActiveTab('ignored')}
                >
                    <X size={16} /> Archiviert
                    {ignoredProducts.length > 0 && (
                        <span className="badge badge-neutral" style={{ marginLeft: '6px' }}>{ignoredProducts.length}</span>
                    )}
                </button>
            </div>

            {/* ── ACTIVE TAB CONTENT ── */}
            {activeTab === 'active' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2xl)' }}>
                    {/* ── Anomalies ── */}
            {anomalies.length > 0 && (
                <div className="card" style={{ overflow: 'hidden' }}>
                    <div style={{ padding: '14px var(--spacing-xl)', borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-warning-bg)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <AlertTriangle size={16} color="var(--color-warning)" />
                        <h3 style={{ margin: 0, fontSize: '15px', color: 'var(--color-text-main)' }}>Auffälligkeiten / Anomalien</h3>
                        <span className="badge badge-warning" style={{ marginLeft: 'auto' }}>{anomalies.length}</span>
                    </div>
                    <div>
                        {anomalies.map(({ product: p, autoWeekly, actualWeekly, ratio }) => (
                            <div key={p.id} style={{ padding: '16px var(--spacing-xl)', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'flex-start', gap: 'var(--spacing-md)' }}>
                                <AlertTriangle size={18} color="var(--color-warning)" style={{ flexShrink: 0, marginTop: '2px' }} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: 600, color: 'var(--color-text-main)', marginBottom: '4px' }}>{p.name}</div>
                                    <div style={{ fontSize: '13px', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                                        {ratio > 1
                                            ? <>Du bestellst <strong>{actualWeekly} {p.unit}/Woche</strong>, aber der Autopilot zieht nur <strong>{autoWeekly} {p.unit}/Woche</strong> ab — der Lagerbestand wird dadurch höher ausgewiesen als er tatsächlich ist.</>
                                            : <>Du bestellst nur <strong>{actualWeekly} {p.unit}/Woche</strong>, aber der Autopilot zieht <strong>{autoWeekly} {p.unit}/Woche</strong> ab — der Bestand könnte rechnerisch unter 0 fallen.</>}
                                    </div>
                                </div>
                                <span className={ratio > 1 ? 'badge badge-warning' : 'badge badge-danger'} style={{ flexShrink: 0 }}>
                                    {ratio > 1 ? '+' : ''}{((ratio - 1) * 100).toFixed(0)}%
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

                    {/* ── Active Autopilots (expandable, with runway + inline edit) ── */}
                    <div className="card" style={{ overflow: 'hidden' }}>
                        <div style={{ padding: '14px var(--spacing-xl)', borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface-elevated)' }}>
                            <h3 style={{ margin: 0, fontSize: '15px', color: 'var(--color-text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Zap size={16} color="var(--color-success)" /> Aktive Autopiloten
                            </h3>
                        </div>

                        {activePilots.length > 0 ? (
                            <table className="products-table">
                                <thead>
                                    <tr>
                                        <th>Produkt</th>
                                        <th>Eingestellter Verbrauch</th>
                                        <th style={{ textAlign: 'center' }}>Reicht noch</th>
                                        <th style={{ textAlign: 'center' }}>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {activePilots.map(p => {
                                        const isOpen  = expandedRows.has(`pilot-${p.id}`);
                                        const anomaly = anomalies.find(a => a.product.id === p.id);
                                        return (
                                            <React.Fragment key={p.id}>
                                                <tr
                                                    onClick={() => handleTogglePilotExpand(p)}
                                                    style={{ cursor: 'pointer', backgroundColor: isOpen ? 'var(--color-surface-elevated)' : undefined }}
                                                >
                                                    <td>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                            {isOpen
                                                                ? <ChevronDown size={14} color="var(--color-text-muted)" style={{ flexShrink: 0 }} />
                                                                : <ChevronRight size={14} color="var(--color-text-muted)" style={{ flexShrink: 0 }} />}
                                                            <div>
                                                                <div style={{ fontWeight: 500 }}>{p.name}</div>
                                                                <div style={{ fontSize: '11px', color: 'var(--color-text-faint)' }}>
                                                                    {p.lastConsumptionDate ? `Letzter Abruf: ${new Date(p.lastConsumptionDate).toLocaleDateString('de-DE')}` : '–'}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <span className="badge badge-success">
                                                            {p.consumptionAmount} {p.unit} {periodLabel(p)}
                                                        </span>
                                                    </td>
                                                    <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                                                        <RunwayBadge product={p} />
                                                    </td>
                                                    <td style={{ textAlign: 'center' }}>
                                                        {anomaly ? (
                                                            <span className="badge badge-warning" title={`Autopilot: ${anomaly.autoWeekly} ${p.unit}/Wo — Bestellhistorie: ${anomaly.actualWeekly} ${p.unit}/Wo`}>
                                                                Abweichung
                                                            </span>
                                                        ) : (
                                                            <span className="badge badge-neutral">Normal</span>
                                                        )}
                                                    </td>
                                                </tr>
                                                {isOpen && pilotExpandPanel(p)}
                                            </React.Fragment>
                                        );
                                    })}
                                </tbody>
                            </table>
                        ) : (
                            <div style={{ padding: 'var(--spacing-xl)' }}>
                                <EmptyState icon={Zap} title="Noch kein Autopilot aktiv" text="Wechsle zum Reiter 'Einrichten' und übernimm KI-Vorschläge." />
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ── SETUP TAB CONTENT ── */}
            {activeTab === 'setup' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2xl)' }}>
                    {/* ── KI Suggestions (expandable) ── */}
            <div className="card" style={{ overflow: 'hidden' }}>
                <div style={{ padding: '14px var(--spacing-xl)', borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <h3 style={{ margin: 0, fontSize: '15px', color: 'var(--color-text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Bot size={16} color="var(--color-primary)" /> Aktionsbedarf: KI-Vorschläge
                    </h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {suggestions.length > 0 && (
                            <>
                                <span className="badge badge-warning">{suggestions.length} offen</span>
                                <button
                                    className="btn btn-success btn-sm"
                                    onClick={handleAdoptAll}
                                    disabled={batchSaving}
                                >
                                    <CheckCircle2 size={13} />
                                    {batchSaving ? 'Wird übernommen…' : `Alle übernehmen (${suggestions.length})`}
                                </button>
                            </>
                        )}
                    </div>
                </div>

                {suggestions.length > 0 ? (
                    <table className="products-table">
                        <thead>
                            <tr>
                                <th>Produkt</th>
                                <th>KI-Vorschlag</th>
                                <th style={{ textAlign: 'right' }}>Aktionen</th>
                            </tr>
                        </thead>
                        <tbody>
                            {suggestions.map(stat => {
                                const isOpen = expandedRows.has(stat.product.id);
                                return (
                                    <React.Fragment key={stat.product.id}>
                                        <tr
                                            onClick={() => handleToggleSuggestionExpand(stat)}
                                            style={{ cursor: 'pointer', backgroundColor: isOpen ? 'var(--color-surface-elevated)' : undefined }}
                                        >
                                            <td>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                    {isOpen
                                                        ? <ChevronDown size={14} color="var(--color-text-muted)" style={{ flexShrink: 0 }} />
                                                        : <ChevronRight size={14} color="var(--color-text-muted)" style={{ flexShrink: 0 }} />}
                                                    <div>
                                                        <div style={{ fontWeight: 500 }}>{stat.product.name}</div>
                                                        <div style={{ fontSize: '11px', color: 'var(--color-text-faint)' }}>{stat.product.category || '–'}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td onClick={e => e.stopPropagation()}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <span className="badge badge-primary">
                                                        {stat.suggestedWeekly} {stat.product.unit} / Woche
                                                    </span>
                                                    <span style={{ fontSize: '12px', color: 'var(--color-text-faint)' }}>aus Bestellhistorie</span>
                                                </div>
                                            </td>
                                            <td onClick={e => e.stopPropagation()} style={{ textAlign: 'right' }}>
                                                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                                                    <button className="btn btn-ghost btn-sm" onClick={() => handleIgnore(stat.product)} disabled={saving === stat.product.id || batchSaving} title="Dauerhaft ignorieren">
                                                        <X size={13} /> Ignorieren
                                                    </button>
                                                    <button className="btn btn-success btn-sm" onClick={() => handleAdopt(stat)} disabled={saving === stat.product.id || batchSaving}>
                                                        <CheckCircle2 size={13} /> Übernehmen
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                        {isOpen && suggestionExpandPanel(stat)}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                ) : (
                    <div style={{ padding: 'var(--spacing-xl)' }}>
                        <EmptyState icon={Bot} title="Keine offenen Vorschläge" text="Sobald ausreichend Bestellhistorie vorliegt, berechnet das System automatisch Verbrauchsvorschläge." />
                    </div>
                )}
            </div>

            {/* ── Manuell konfigurieren ── */}
            {manualProducts.length > 0 && (
                <div className="card" style={{ overflow: 'hidden' }}>
                    <div
                        style={{ padding: '14px var(--spacing-xl)', borderBottom: showManualSection ? '1px solid var(--color-border)' : undefined, backgroundColor: 'var(--color-surface-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
                        onClick={() => setShowManualSection(v => !v)}
                    >
                        <h3 style={{ margin: 0, fontSize: '15px', color: 'var(--color-text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Pencil size={15} color="var(--color-text-muted)" /> Manuell konfigurieren
                        </h3>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span className="badge badge-neutral">{manualProducts.length} Produkte</span>
                            {showManualSection
                                ? <ChevronDown size={16} color="var(--color-text-muted)" />
                                : <ChevronRight size={16} color="var(--color-text-muted)" />}
                        </div>
                    </div>

                    {showManualSection && (
                        <table className="products-table">
                            <thead>
                                <tr>
                                    <th>Produkt</th>
                                    <th style={{ width: '130px' }}>Menge</th>
                                    <th style={{ width: '140px' }}>Zeitraum</th>
                                    <th style={{ width: '120px', textAlign: 'right' }}>Aktion</th>
                                </tr>
                            </thead>
                            <tbody>
                                {manualProducts.map(p => {
                                    const edit = inlineEdits[p.id] ?? { amount: '', period: 'week' as const };
                                    const isSavingThis = saving === `inline-${p.id}`;
                                    const canSave = edit.amount !== '' && Number(edit.amount) > 0;
                                    return (
                                        <tr key={p.id}>
                                            <td>
                                                <div style={{ fontWeight: 500 }}>{p.name}</div>
                                                {p.category && <div style={{ fontSize: '11px', color: 'var(--color-text-faint)' }}>{p.category}</div>}
                                            </td>
                                            <td>
                                                <input
                                                    type="number"
                                                    min={0}
                                                    step="0.1"
                                                    placeholder={p.unit}
                                                    value={edit.amount}
                                                    onChange={e => setInlineEdits(prev => ({ ...prev, [p.id]: { ...edit, amount: e.target.value === '' ? '' : Number(e.target.value) } }))}
                                                    style={{ width: '100%', padding: '5px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface-elevated)', color: 'var(--color-text-main)', fontSize: '13px' }}
                                                />
                                            </td>
                                            <td>
                                                <select
                                                    value={edit.period}
                                                    onChange={e => setInlineEdits(prev => ({ ...prev, [p.id]: { ...edit, period: e.target.value as 'day' | 'week' } }))}
                                                    style={{ width: '100%', padding: '5px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface-elevated)', color: 'var(--color-text-main)', fontSize: '13px' }}
                                                >
                                                    <option value="week">pro Woche</option>
                                                    <option value="day">pro Tag</option>
                                                </select>
                                            </td>
                                            <td style={{ textAlign: 'right' }}>
                                                <button
                                                    className="btn btn-primary btn-sm"
                                                    disabled={!canSave || isSavingThis}
                                                    onClick={() => handleSaveInline(p)}
                                                >
                                                    <Save size={13} /> {isSavingThis ? 'Wird gespeichert…' : 'Speichern'}
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
            )}
                </div>
            )}

            {/* ── IGNORED TAB CONTENT ── */}
            {activeTab === 'ignored' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2xl)' }}>
                    {/* ── Ignored Products ── */}
                    {ignoredProducts.length > 0 ? (
                        <div>
                            {ignoredProducts.map(p => (
                                <div key={p.id} style={{ padding: '12px var(--spacing-xl)', borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                                    <div>
                                        <div style={{ fontSize: '14px', color: 'var(--color-text-muted)', fontWeight: 500 }}>{p.name}</div>
                                        {p.category && <div style={{ fontSize: '12px', color: 'var(--color-text-faint)' }}>{p.category}</div>}
                                    </div>
                                    <button
                                        className="btn btn-ghost btn-sm"
                                        onClick={() => handleRestore(p)}
                                        disabled={saving === p.id}
                                        title="Vorschlag wieder aktivieren"
                                    >
                                        <RotateCcw size={13} /> Wiederherstellen
                                    </button>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div style={{ padding: 'var(--spacing-xl)' }}>
                            <EmptyState icon={X} title="Keine ignorierten Vorschläge" text="Hier findest du zukünftig Produkte, bei denen du den KI-Vorschlag abgelehnt hast." />
                        </div>
                    )}
                </div>
            )}

            {/* ── Full empty state ── */}
            {activePilots.length === 0 && suggestions.length === 0 && ignoredProducts.length === 0 && manualProducts.length === 0 && (
                <div style={{ padding: 'var(--spacing-2xl)', backgroundColor: 'var(--color-surface-elevated)', borderRadius: 'var(--radius-lg)', border: '1px dashed var(--color-border)', textAlign: 'center' }}>
                    <Activity size={40} style={{ opacity: 0.2, display: 'block', margin: '0 auto 16px' }} />
                    <div style={{ fontWeight: 600, color: 'var(--color-text-main)', marginBottom: '8px' }}>Noch keine Daten für Autopilot-Vorschläge</div>
                    <div style={{ fontSize: '13px', color: 'var(--color-text-muted)', maxWidth: '400px', margin: '0 auto', lineHeight: 1.6 }}>
                        Erfasse mindestens zwei Bestellungen pro Produkt. Das System berechnet dann automatisch einen wöchentlichen Verbrauchswert aus der Bestellhistorie.
                    </div>
                </div>
            )}
        </div>
    );
};
