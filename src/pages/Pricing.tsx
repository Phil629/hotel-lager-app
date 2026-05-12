import React, { useState, useEffect, useMemo } from 'react';
import type { Product, Order } from '../types';
import { DataService } from '../services/data';
import { StorageService } from '../services/storage';
import { TrendingUp, TrendingDown, Euro, Package, AlertTriangle } from 'lucide-react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

const fmt = (value: number, currency: string) =>
    value.toLocaleString('de-DE', { style: 'currency', currency });

const EmptyState = ({
    icon: Icon,
    title,
    text,
}: {
    icon: React.ElementType;
    title: string;
    text: string;
}) => (
    <div style={{
        padding: '48px 24px',
        textAlign: 'center',
        color: 'var(--color-text-muted)',
        border: '1px dashed var(--color-border)',
        borderRadius: 'var(--radius-lg)',
    }}>
        <Icon size={36} style={{ opacity: 0.25, marginBottom: '12px', display: 'block', margin: '0 auto 12px' }} />
        <div style={{ fontWeight: 600, color: 'var(--color-text-main)', marginBottom: '6px' }}>{title}</div>
        <div style={{ fontSize: '13px' }}>{text}</div>
    </div>
);

// Custom tooltip to adapt to dark mode CSS vars
const ChartTooltip = ({ active, payload, label, currency }: any) => {
    if (!active || !payload?.length) return null;
    return (
        <div style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            padding: '10px 14px',
            boxShadow: 'var(--shadow-md)',
        }}>
            <div style={{ fontWeight: 600, color: 'var(--color-text-main)', marginBottom: '4px' }}>{label}</div>
            <div style={{ color: 'var(--color-primary)', fontSize: '14px' }}>
                {fmt(payload[0].value, currency)}
            </div>
        </div>
    );
};

export const Pricing: React.FC = () => {
    const [products, setProducts] = useState<Product[]>([]);
    const [orders, setOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);
    const currency = StorageService.getSettings().currency || 'EUR';

    useEffect(() => {
        Promise.all([DataService.getProducts(), DataService.getOrders()]).then(([p, o]) => {
            setProducts(p);
            setOrders(o);
            setLoading(false);
        });
    }, []);

    // ── KPIs ────────────────────────────────────────────────────────────────
    const kpis = useMemo(() => {
        const now = new Date();
        const cm = now.getMonth(), cy = now.getFullYear();
        const lm = cm === 0 ? 11 : cm - 1;
        const ly = cm === 0 ? cy - 1 : cy;

        let spendThisMonth = 0;
        let spendLastMonth = 0;

        orders.forEach(o => {
            const d = new Date(o.date);
            const product = products.find(p => p.name === o.productName);
            const price = o.price ?? product?.price ?? 0;
            const spend = o.quantity * price;
            if (d.getMonth() === cm && d.getFullYear() === cy) spendThisMonth += spend;
            else if (d.getMonth() === lm && d.getFullYear() === ly) spendLastMonth += spend;
        });

        const spendDiff = spendLastMonth > 0
            ? ((spendThisMonth - spendLastMonth) / spendLastMonth) * 100
            : 0;

        const inventoryValue = products.reduce(
            (sum, p) => sum + p.stock * (p.price ?? 0),
            0,
        );

        return { spendThisMonth, spendLastMonth, spendDiff, inventoryValue };
    }, [orders, products]);

    // ── Monthly Chart (last 12 months) ──────────────────────────────────────
    const monthlyChartData = useMemo(() => {
        return Array.from({ length: 12 }, (_, i) => {
            const d = new Date();
            d.setDate(1);
            d.setMonth(d.getMonth() - (11 - i));
            const m = d.getMonth(), y = d.getFullYear();
            const label = d.toLocaleDateString('de-DE', { month: 'short', year: '2-digit' });
            const ausgaben = orders
                .filter(o => {
                    const od = new Date(o.date);
                    return od.getMonth() === m && od.getFullYear() === y;
                })
                .reduce((sum, o) => {
                    const product = products.find(p => p.name === o.productName);
                    return sum + o.quantity * (o.price ?? product?.price ?? 0);
                }, 0);
            return { date: label, ausgaben: Math.round(ausgaben * 100) / 100 };
        });
    }, [orders, products]);

    // ── Top Kostentreiber (current month) ───────────────────────────────────
    const topCostDrivers = useMemo(() => {
        const now = new Date();
        return products
            .map(p => {
                const pOrders = orders.filter(o => {
                    const d = new Date(o.date);
                    return (
                        o.productName === p.name &&
                        d.getMonth() === now.getMonth() &&
                        d.getFullYear() === now.getFullYear()
                    );
                });
                const monthlySpend = pOrders.reduce(
                    (sum, o) => sum + o.quantity * (o.price ?? p.price ?? 0),
                    0,
                );
                const monthlyQty = pOrders.reduce((sum, o) => sum + o.quantity, 0);
                return { ...p, monthlySpend, monthlyQty };
            })
            .filter(p => p.monthlySpend > 0)
            .sort((a, b) => b.monthlySpend - a.monthlySpend)
            .slice(0, 8);
    }, [orders, products]);

    // ── Price Alarm (Volatility) ─────────────────────────────────────────────
    const priceAlerts = useMemo(() => {
        return products
            .map(p => {
                const priced = orders
                    .filter(o => o.productName === p.name && (o.price ?? 0) > 0)
                    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
                if (priced.length < 2) return null;
                const firstPrice = priced[0].price!;
                const lastPrice = priced[priced.length - 1].price!;
                const change = ((lastPrice - firstPrice) / firstPrice) * 100;
                if (Math.abs(change) < 3) return null;
                return { product: p, firstPrice, lastPrice, change };
            })
            .filter((d): d is NonNullable<typeof d> => d !== null)
            .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
            .slice(0, 8);
    }, [orders, products]);

    const avgInflation = useMemo(() => {
        if (priceAlerts.length === 0) return 0;
        return priceAlerts.reduce((sum, d) => sum + d.change, 0) / priceAlerts.length;
    }, [priceAlerts]);

    if (loading) {
        return (
            <div style={{ padding: '60px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                Lade Finanzdaten…
            </div>
        );
    }

    const inflationColor =
        avgInflation > 10 ? 'var(--color-danger)'
        : avgInflation < -3 ? 'var(--color-success)'
        : 'var(--color-text-main)';

    const currencyTick = currency === 'CHF' ? 'CHF ' : '€';

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2xl)', paddingBottom: '40px' }}>

            {/* ── Header ── */}
            <div className="page-header">
                <div>
                    <h2 className="page-title">Finanz-Dashboard</h2>
                    <p style={{ color: 'var(--color-text-muted)', marginTop: '4px' }}>
                        Warenwert, Ausgaben und Preisentwicklung auf einen Blick.
                    </p>
                </div>
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
                        {products.filter(p => (p.price ?? 0) > 0).length} Produkte mit Preis erfasst
                    </div>
                </div>

                <div className="stat-card">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px', color: 'var(--color-text-muted)', marginBottom: '10px', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        <Euro size={14} /> Ausgaben diesen Monat
                    </div>
                    <div style={{ fontSize: '28px', fontWeight: 700, color: 'var(--color-text-main)' }}>
                        {fmt(kpis.spendThisMonth, currency)}
                    </div>
                    {kpis.spendLastMonth > 0 && (
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

            {/* ── Monthly Spend Chart ── */}
            <div className="card" style={{ padding: 'var(--spacing-xl)' }}>
                <h3 style={{ margin: '0 0 var(--spacing-lg) 0', fontSize: '16px', color: 'var(--color-text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Euro size={18} color="var(--color-primary)" />
                    Monatliche Ausgaben — letzte 12 Monate
                </h3>
                {orders.length > 0 ? (
                    <div style={{ height: '280px' }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={monthlyChartData} margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                                <XAxis
                                    dataKey="date"
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fill: 'var(--color-text-muted)', fontSize: 12 }}
                                    dy={8}
                                />
                                <YAxis
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fill: 'var(--color-text-muted)', fontSize: 12 }}
                                    tickFormatter={v => `${currencyTick}${v}`}
                                    width={60}
                                />
                                <Tooltip content={<ChartTooltip currency={currency} />} cursor={{ fill: 'rgba(37,99,235,0.06)' }} />
                                <Bar dataKey="ausgaben" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                ) : (
                    <EmptyState
                        icon={Euro}
                        title="Keine Bestelldaten"
                        text="Erfasse Bestellungen mit Preisen, um den Ausgaben-Verlauf zu sehen."
                    />
                )}
            </div>

            {/* ── Bottom Row: Top Kostentreiber + Preis-Alarm ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 'var(--spacing-xl)', alignItems: 'start' }}>

                {/* Top Cost Drivers */}
                <div className="card" style={{ overflow: 'hidden' }}>
                    <div style={{ padding: '14px var(--spacing-xl)', borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <h3 style={{ margin: 0, fontSize: '15px', color: 'var(--color-text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <TrendingUp size={16} color="var(--color-danger)" />
                            Top Kostentreiber — dieser Monat
                        </h3>
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
                                        <td style={{ width: '32px' }}>
                                            <span style={{
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                width: '22px',
                                                height: '22px',
                                                borderRadius: '50%',
                                                backgroundColor: i === 0 ? 'var(--color-danger-bg)' : 'var(--color-surface-elevated)',
                                                fontSize: '11px',
                                                fontWeight: 700,
                                                color: i === 0 ? 'var(--color-danger)' : 'var(--color-text-faint)',
                                            }}>
                                                {i + 1}
                                            </span>
                                        </td>
                                        <td style={{ fontWeight: 500 }}>{p.name}</td>
                                        <td style={{ textAlign: 'right', color: 'var(--color-text-muted)', fontSize: '13px' }}>
                                            {p.monthlyQty} {p.unit}
                                        </td>
                                        <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--color-text-main)' }}>
                                            {fmt(p.monthlySpend, currency)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : (
                        <div style={{ padding: 'var(--spacing-xl)' }}>
                            <EmptyState
                                icon={TrendingUp}
                                title="Keine Daten diesen Monat"
                                text="Es wurden noch keine Bestellungen mit Preisen diesen Monat erfasst."
                            />
                        </div>
                    )}
                </div>

                {/* Price Alarm */}
                <div className="card" style={{ overflow: 'hidden' }}>
                    <div style={{ padding: '14px var(--spacing-xl)', borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <h3 style={{ margin: 0, fontSize: '15px', color: 'var(--color-text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <AlertTriangle size={16} color="var(--color-warning)" />
                            Preis-Alarm — Volatilität
                        </h3>
                        {priceAlerts.length > 0 && (
                            <span className="badge badge-warning">{priceAlerts.length}</span>
                        )}
                    </div>

                    {priceAlerts.length > 0 ? (
                        <div>
                            {priceAlerts.map(({ product: p, firstPrice, lastPrice, change }) => (
                                <div
                                    key={p.id}
                                    style={{
                                        padding: '13px var(--spacing-xl)',
                                        borderBottom: '1px solid var(--color-border)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        gap: '12px',
                                    }}
                                >
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ fontWeight: 500, fontSize: '14px', color: 'var(--color-text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {p.name}
                                        </div>
                                        <div style={{ fontSize: '12px', color: 'var(--color-text-faint)', marginTop: '2px' }}>
                                            {fmt(firstPrice, currency)} → {fmt(lastPrice, currency)} / {p.unit}
                                        </div>
                                    </div>
                                    <span
                                        className={change > 0 ? 'badge badge-danger' : 'badge badge-success'}
                                        style={{ flexShrink: 0 }}
                                    >
                                        {change > 0 ? '+' : ''}{change.toFixed(1)}%
                                    </span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div style={{ padding: 'var(--spacing-xl)' }}>
                            <EmptyState
                                icon={AlertTriangle}
                                title="Keine Preisänderungen erkannt"
                                text="Sobald Produkte mit unterschiedlichen Einkaufspreisen bestellt werden, erscheinen sie hier."
                            />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
