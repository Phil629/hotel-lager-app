import React, { useState, useEffect, useMemo } from 'react';
import type { Product, Order, Supplier } from '../types';
import { DataService } from '../services/data';
import { StorageService } from '../services/storage';
import { TrendingUp, TrendingDown, Euro, Package, AlertTriangle, Download, X, Filter } from 'lucide-react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

// ── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (value: number, currency: string) =>
    value.toLocaleString('de-DE', { style: 'currency', currency });

const EmptyState = ({ icon: Icon, title, text }: {
    icon: React.ElementType; title: string; text: string;
}) => (
    <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--color-text-muted)', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-lg)' }}>
        <Icon size={36} style={{ opacity: 0.25, marginBottom: '12px', display: 'block', margin: '0 auto 12px' }} />
        <div style={{ fontWeight: 600, color: 'var(--color-text-main)', marginBottom: '6px' }}>{title}</div>
        <div style={{ fontSize: '13px' }}>{text}</div>
    </div>
);

const ChartTooltip = ({ active, payload, label, currency }: {
    active?: boolean; payload?: { value: number }[]; label?: string; currency: string;
}) => {
    if (!active || !payload?.length) return null;
    return (
        <div style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '10px 14px', boxShadow: 'var(--shadow-md)' }}>
            <div style={{ fontWeight: 600, color: 'var(--color-text-main)', marginBottom: '4px' }}>{label}</div>
            <div style={{ color: 'var(--color-primary)', fontSize: '14px' }}>{fmt(payload[0].value, currency)}</div>
        </div>
    );
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface PeriodOption { value: string; label: string; }
interface CostDriver extends Product { filteredSpend: number; filteredQty: number; }
interface PriceAlert { product: Product; firstPrice: number; lastPrice: number; change: number; }

// ── Component ─────────────────────────────────────────────────────────────────

export const Pricing: React.FC = () => {
    const [products, setProducts]   = useState<Product[]>([]);
    const [orders, setOrders]       = useState<Order[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [loading, setLoading]     = useState(true);

    // Filter state
    const [periodFilter,   setPeriodFilter]   = useState<string>('');
    const [categoryFilter, setCategoryFilter] = useState<string>('');
    const [supplierFilter, setSupplierFilter] = useState<string>('');

    const currency = StorageService.getSettings().currency || 'EUR';

    useEffect(() => {
        Promise.all([DataService.getProducts(), DataService.getOrders(), DataService.getSuppliers()])
            .then(([p, o, s]) => { setProducts(p); setOrders(o); setSuppliers(s); setLoading(false); });
    }, []);

    // ── Filter options ───────────────────────────────────────────────────────

    const periodOptions = useMemo((): PeriodOption[] => {
        const months = new Set<string>();
        orders.forEach(o => {
            const d = new Date(o.date);
            months.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
        });
        return Array.from(months)
            .sort((a, b) => b.localeCompare(a))
            .slice(0, 12)
            .map(m => {
                const [y, mo] = m.split('-').map(Number);
                const label = new Date(y, mo - 1, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
                return { value: m, label };
            });
    }, [orders]);

    const categories = useMemo(
        () => [...new Set(products.map(p => p.category).filter(Boolean) as string[])].sort(),
        [products],
    );

    const activeFilterCount = [periodFilter, categoryFilter, supplierFilter].filter(Boolean).length;

    // ── Filtered orders ──────────────────────────────────────────────────────

    const filteredOrders = useMemo(() => {
        return orders.filter(o => {
            if (periodFilter === '30') {
                const cutoff = new Date();
                cutoff.setDate(cutoff.getDate() - 30);
                if (new Date(o.date) < cutoff) return false;
            } else if (periodFilter) {
                const [y, m] = periodFilter.split('-').map(Number);
                const d = new Date(o.date);
                if (d.getFullYear() !== y || d.getMonth() !== m - 1) return false;
            }
            if (categoryFilter || supplierFilter) {
                const product = products.find(p => p.name === o.productName);
                if (categoryFilter && product?.category !== categoryFilter) return false;
                if (supplierFilter && product?.supplierId !== supplierFilter) return false;
            }
            return true;
        });
    }, [orders, products, periodFilter, categoryFilter, supplierFilter]);

    // ── KPIs ────────────────────────────────────────────────────────────────

    const kpis = useMemo(() => {
        const totalSpend = filteredOrders.reduce((sum, o) => {
            const product = products.find(p => p.name === o.productName);
            return sum + o.quantity * (o.price ?? product?.price ?? 0);
        }, 0);

        // Previous-period spend (only for "no period filter" = current-month comparison)
        let spendPrev = 0;
        if (!periodFilter) {
            const now = new Date();
            const lm = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
            const ly = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
            orders.forEach(o => {
                if (categoryFilter || supplierFilter) {
                    const product = products.find(p => p.name === o.productName);
                    if (categoryFilter && product?.category !== categoryFilter) return;
                    if (supplierFilter && product?.supplierId !== supplierFilter) return;
                }
                const d = new Date(o.date);
                if (d.getMonth() === lm && d.getFullYear() === ly) {
                    const product = products.find(p => p.name === o.productName);
                    spendPrev += o.quantity * (o.price ?? product?.price ?? 0);
                }
            });
        }

        const spendDiff = spendPrev > 0 ? ((totalSpend - spendPrev) / spendPrev) * 100 : 0;

        const filteredProducts = products
            .filter(p => !categoryFilter || p.category === categoryFilter)
            .filter(p => !supplierFilter || p.supplierId === supplierFilter);
        const inventoryValue = filteredProducts.reduce((sum, p) => sum + p.stock * (p.price ?? 0), 0);

        return { totalSpend, spendPrev, spendDiff, inventoryValue, filteredProductCount: filteredProducts.filter(p => (p.price ?? 0) > 0).length };
    }, [filteredOrders, orders, products, periodFilter, categoryFilter, supplierFilter]);

    // ── Chart data (adapts to selected period) ───────────────────────────────

    const chartData = useMemo(() => {
        const spend = (subset: Order[]) =>
            subset.reduce((sum, o) => {
                const product = products.find(p => p.name === o.productName);
                return sum + o.quantity * (o.price ?? product?.price ?? 0);
            }, 0);

        if (periodFilter === '30') {
            // Last 30 days grouped into 5 six-day buckets
            return Array.from({ length: 5 }, (_, i) => {
                const end = new Date(); end.setDate(end.getDate() - i * 6);
                const start = new Date(end); start.setDate(start.getDate() - 5);
                const label = `${start.toLocaleDateString('de-DE', { day: '2-digit', month: 'short' })}`;
                const subset = filteredOrders.filter(o => { const d = new Date(o.date); return d >= start && d <= end; });
                return { date: label, ausgaben: Math.round(spend(subset) * 100) / 100 };
            }).reverse();
        }

        if (periodFilter && periodFilter.includes('-')) {
            const [y, m] = periodFilter.split('-').map(Number);
            const daysInMonth = new Date(y, m, 0).getDate();
            return Array.from({ length: 4 }, (_, i) => {
                const dayStart = i * 7 + 1;
                const dayEnd = Math.min(dayStart + 6, daysInMonth);
                const subset = filteredOrders.filter(o => {
                    const d = new Date(o.date);
                    return d.getDate() >= dayStart && d.getDate() <= dayEnd;
                });
                return { date: `${dayStart}.–${dayEnd}.`, ausgaben: Math.round(spend(subset) * 100) / 100 };
            });
        }

        // Default: last 12 months
        return Array.from({ length: 12 }, (_, i) => {
            const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - (11 - i));
            const mo = d.getMonth(), yr = d.getFullYear();
            const label = d.toLocaleDateString('de-DE', { month: 'short', year: '2-digit' });
            const subset = filteredOrders.filter(o => { const od = new Date(o.date); return od.getMonth() === mo && od.getFullYear() === yr; });
            return { date: label, ausgaben: Math.round(spend(subset) * 100) / 100 };
        });
    }, [filteredOrders, products, periodFilter]);

    // ── Top cost drivers ─────────────────────────────────────────────────────

    const topCostDrivers = useMemo((): CostDriver[] => {
        return products
            .map(p => {
                const pOrders = filteredOrders.filter(o => o.productName === p.name);
                const filteredSpend = pOrders.reduce((sum, o) => sum + o.quantity * (o.price ?? p.price ?? 0), 0);
                const filteredQty   = pOrders.reduce((sum, o) => sum + o.quantity, 0);
                return { ...p, filteredSpend, filteredQty };
            })
            .filter(p => p.filteredSpend > 0)
            .sort((a, b) => b.filteredSpend - a.filteredSpend)
            .slice(0, 8);
    }, [filteredOrders, products]);

    // ── Price alerts (always from full history — not period-filtered) ─────────

    const priceAlerts = useMemo((): PriceAlert[] => {
        return products
            .map(p => {
                if (supplierFilter && p.supplierId !== supplierFilter) return null;
                if (categoryFilter && p.category !== categoryFilter) return null;
                const priced = orders
                    .filter(o => o.productName === p.name && (o.price ?? 0) > 0)
                    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
                if (priced.length < 2) return null;
                const firstPrice = priced[0].price!;
                const lastPrice  = priced[priced.length - 1].price!;
                const change = ((lastPrice - firstPrice) / firstPrice) * 100;
                if (Math.abs(change) < 3) return null;
                return { product: p, firstPrice, lastPrice, change };
            })
            .filter((d): d is PriceAlert => d !== null)
            .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
            .slice(0, 8);
    }, [orders, products, categoryFilter, supplierFilter]);

    const avgInflation = useMemo(() => {
        if (!priceAlerts.length) return 0;
        return priceAlerts.reduce((s, d) => s + d.change, 0) / priceAlerts.length;
    }, [priceAlerts]);

    // ── CSV Export ───────────────────────────────────────────────────────────

    const handleCsvExport = () => {
        const rows: (string | number)[][] = [
            ['Rang', 'Produkt', 'Kategorie', 'Lieferant', 'Menge', 'Einheit', 'Kosten'],
            ...topCostDrivers.map((p, i) => {
                const supplier = suppliers.find(s => s.id === p.supplierId);
                return [i + 1, p.name, p.category || '', supplier?.name || '', p.filteredQty, p.unit, p.filteredSpend.toFixed(2).replace('.', ',')];
            }),
        ];
        const csv = '﻿' + rows.map(r => r.map(v => `"${v}"`).join(';')).join('\r\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url  = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `kostentreiber_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    if (loading) return (
        <div style={{ padding: '60px', textAlign: 'center', color: 'var(--color-text-muted)' }}>Lade Finanzdaten…</div>
    );

    const inflationColor = avgInflation > 10 ? 'var(--color-danger)' : avgInflation < -3 ? 'var(--color-success)' : 'var(--color-text-main)';
    const currencyTick   = currency === 'CHF' ? 'CHF ' : '€';
    const kpiLabel       = periodFilter === '30' ? 'Ausgaben (30 Tage)' : periodFilter ? 'Ausgaben (Zeitraum)' : 'Ausgaben diesen Monat';
    const chartTitle     = periodFilter === '30' ? 'Ausgaben — letzte 30 Tage' : periodFilter ? `Ausgaben — ${periodOptions.find(o => o.value === periodFilter)?.label ?? periodFilter}` : 'Monatliche Ausgaben — letzte 12 Monate';

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2xl)', paddingBottom: '40px' }}>

            {/* ── Header ── */}
            <div className="page-header">
                <div>
                    <h2 className="page-title">Finanz-Dashboard</h2>
                    <p style={{ color: 'var(--color-text-muted)', marginTop: '4px' }}>Warenwert, Ausgaben und Preisentwicklung auf einen Blick.</p>
                </div>
                <button className="btn btn-ghost" onClick={handleCsvExport} disabled={topCostDrivers.length === 0} title="Gefilterte Kostentreiber als CSV exportieren">
                    <Download size={16} /> CSV Export
                </button>
            </div>

            {/* ── Filter bar ── */}
            <div className="card" style={{ padding: 'var(--spacing-md)', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                <Filter size={15} color="var(--color-text-muted)" style={{ flexShrink: 0 }} />

                <select
                    value={periodFilter}
                    onChange={e => setPeriodFilter(e.target.value)}
                    className="input-field"
                    style={{ flex: '1 1 180px', minWidth: '160px', padding: '8px 12px' }}
                >
                    <option value="">Zeitraum: Alle</option>
                    <option value="30">Letzte 30 Tage</option>
                    {periodOptions.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                </select>

                <select
                    value={categoryFilter}
                    onChange={e => setCategoryFilter(e.target.value)}
                    className="input-field"
                    style={{ flex: '1 1 160px', minWidth: '140px', padding: '8px 12px' }}
                >
                    <option value="">Alle Kategorien</option>
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>

                <select
                    value={supplierFilter}
                    onChange={e => setSupplierFilter(e.target.value)}
                    className="input-field"
                    style={{ flex: '1 1 160px', minWidth: '140px', padding: '8px 12px' }}
                >
                    <option value="">Alle Lieferanten</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>

                {activeFilterCount > 0 && (
                    <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => { setPeriodFilter(''); setCategoryFilter(''); setSupplierFilter(''); }}
                    >
                        <X size={13} /> Filter zurücksetzen
                        <span className="badge badge-primary" style={{ marginLeft: '4px' }}>{activeFilterCount}</span>
                    </button>
                )}
            </div>

            {/* ── KPI Cards ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--spacing-md)' }}>
                <div className="stat-card">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px', color: 'var(--color-text-muted)', marginBottom: '10px', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        <Package size={14} /> Lagerwert gesamt
                    </div>
                    <div style={{ fontSize: '28px', fontWeight: 700, color: 'var(--color-text-main)' }}>
                        {fmt(kpis.inventoryValue, currency)}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--color-text-faint)', marginTop: '6px' }}>
                        {kpis.filteredProductCount} Produkte mit Preis erfasst
                    </div>
                </div>

                <div className="stat-card">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px', color: 'var(--color-text-muted)', marginBottom: '10px', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        <Euro size={14} /> {kpiLabel}
                    </div>
                    <div style={{ fontSize: '28px', fontWeight: 700, color: 'var(--color-text-main)' }}>
                        {fmt(kpis.totalSpend, currency)}
                    </div>
                    {!periodFilter && kpis.spendPrev > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '8px', fontSize: '13px', fontWeight: 500, color: kpis.spendDiff > 0 ? 'var(--color-danger)' : 'var(--color-success)' }}>
                            {kpis.spendDiff > 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                            {Math.abs(kpis.spendDiff).toFixed(1)}% ggü. Vormonat
                        </div>
                    )}
                </div>

                <div className="stat-card">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px', color: 'var(--color-text-muted)', marginBottom: '10px', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        <TrendingUp size={14} /> Ø Preisinflation
                    </div>
                    <div style={{ fontSize: '28px', fontWeight: 700, color: inflationColor }}>
                        {avgInflation >= 0 ? '+' : ''}{avgInflation.toFixed(1)}%
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--color-text-faint)', marginTop: '6px' }}>
                        Ø über {priceAlerts.length} Produkte mit Preishistorie
                    </div>
                </div>
            </div>

            {/* ── Chart ── */}
            <div className="card" style={{ padding: 'var(--spacing-xl)' }}>
                <h3 style={{ margin: '0 0 var(--spacing-lg) 0', fontSize: '16px', color: 'var(--color-text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Euro size={18} color="var(--color-primary)" /> {chartTitle}
                </h3>
                {orders.length > 0 ? (
                    <div style={{ height: '280px' }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={chartData} margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: 'var(--color-text-muted)', fontSize: 12 }} dy={8} />
                                <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--color-text-muted)', fontSize: 12 }} tickFormatter={v => `${currencyTick}${v}`} width={64} />
                                <Tooltip content={<ChartTooltip currency={currency} />} cursor={{ fill: 'rgba(37,99,235,0.06)' }} />
                                <Bar dataKey="ausgaben" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                ) : (
                    <EmptyState icon={Euro} title="Keine Bestelldaten" text="Erfasse Bestellungen mit Preisen, um den Ausgaben-Verlauf zu sehen." />
                )}
            </div>

            {/* ── Bottom row ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 'var(--spacing-xl)', alignItems: 'start' }}>

                {/* Top Cost Drivers */}
                <div className="card" style={{ overflow: 'hidden' }}>
                    <div style={{ padding: '14px var(--spacing-xl)', borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <h3 style={{ margin: 0, fontSize: '15px', color: 'var(--color-text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <TrendingUp size={16} color="var(--color-danger)" />
                            Top Kostentreiber{activeFilterCount > 0 ? ' (gefiltert)' : ' — dieser Monat'}
                        </h3>
                        {topCostDrivers.length > 0 && (
                            <button className="btn btn-ghost btn-sm" onClick={handleCsvExport} title="Als CSV exportieren">
                                <Download size={13} />
                            </button>
                        )}
                    </div>
                    {topCostDrivers.length > 0 ? (
                        <table className="products-table">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Produkt</th>
                                    <th style={{ textAlign: 'right' }}>Menge</th>
                                    <th style={{ textAlign: 'right' }}>Kosten</th>
                                </tr>
                            </thead>
                            <tbody>
                                {topCostDrivers.map((p, i) => (
                                    <tr key={p.id}>
                                        <td style={{ width: '36px' }}>
                                            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '22px', height: '22px', borderRadius: '50%', backgroundColor: i === 0 ? 'var(--color-danger-bg)' : 'var(--color-surface-elevated)', fontSize: '11px', fontWeight: 700, color: i === 0 ? 'var(--color-danger)' : 'var(--color-text-faint)' }}>
                                                {i + 1}
                                            </span>
                                        </td>
                                        <td>
                                            <div style={{ fontWeight: 500 }}>{p.name}</div>
                                            {p.category && <div style={{ fontSize: '11px', color: 'var(--color-text-faint)' }}>{p.category}</div>}
                                        </td>
                                        <td style={{ textAlign: 'right', color: 'var(--color-text-muted)', fontSize: '13px' }}>
                                            {p.filteredQty} {p.unit}
                                        </td>
                                        <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--color-text-main)' }}>
                                            {fmt(p.filteredSpend, currency)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : (
                        <div style={{ padding: 'var(--spacing-xl)' }}>
                            <EmptyState icon={TrendingUp} title="Keine Daten im gewählten Zeitraum" text="Keine Bestellungen mit Preisen für den aktiven Filter gefunden." />
                        </div>
                    )}
                </div>

                {/* Price Alarm */}
                <div className="card" style={{ overflow: 'hidden' }}>
                    <div style={{ padding: '14px var(--spacing-xl)', borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <h3 style={{ margin: 0, fontSize: '15px', color: 'var(--color-text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <AlertTriangle size={16} color="var(--color-warning)" /> Preis-Alarm — Volatilität
                        </h3>
                        {priceAlerts.length > 0 && <span className="badge badge-warning">{priceAlerts.length}</span>}
                    </div>
                    {priceAlerts.length > 0 ? (
                        <div>
                            {priceAlerts.map(({ product: p, firstPrice, lastPrice, change }) => (
                                <div key={p.id} style={{ padding: '13px var(--spacing-xl)', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ fontWeight: 500, fontSize: '14px', color: 'var(--color-text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                                        <div style={{ fontSize: '12px', color: 'var(--color-text-faint)', marginTop: '2px' }}>
                                            {fmt(firstPrice, currency)} → {fmt(lastPrice, currency)} / {p.unit}
                                        </div>
                                    </div>
                                    <span className={change > 0 ? 'badge badge-danger' : 'badge badge-success'} style={{ flexShrink: 0 }}>
                                        {change > 0 ? '+' : ''}{change.toFixed(1)}%
                                    </span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div style={{ padding: 'var(--spacing-xl)' }}>
                            <EmptyState icon={AlertTriangle} title="Keine Preisänderungen erkannt" text="Sobald Produkte mit unterschiedlichen Einkaufspreisen bestellt werden, erscheinen sie hier." />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
