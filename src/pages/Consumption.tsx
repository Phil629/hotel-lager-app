import React, { useState, useEffect, useMemo } from 'react';
import type { Product, Order } from '../types';
import { DataService } from '../services/data';
import { Activity, Bot, CheckCircle2, X, AlertTriangle, Zap } from 'lucide-react';

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
        padding: '40px 24px',
        textAlign: 'center',
        color: 'var(--color-text-muted)',
        border: '1px dashed var(--color-border)',
        borderRadius: 'var(--radius-lg)',
    }}>
        <Icon size={32} style={{ opacity: 0.25, marginBottom: '10px', display: 'block', margin: '0 auto 10px' }} />
        <div style={{ fontWeight: 600, color: 'var(--color-text-main)', marginBottom: '4px' }}>{title}</div>
        <div style={{ fontSize: '13px' }}>{text}</div>
    </div>
);

const periodLabel = (p: Product) =>
    p.consumptionPeriod === 'day' ? 'pro Tag' : 'pro Woche';

export const Consumption: React.FC = () => {
    const [products, setProducts] = useState<Product[]>([]);
    const [orders, setOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState<string | null>(null);

    const loadData = async () => {
        const [p, o] = await Promise.all([DataService.getProducts(), DataService.getOrders()]);
        setProducts(p);
        setOrders(o);
        setLoading(false);
    };

    useEffect(() => { loadData(); }, []);

    // ── Per-product consumption stats ────────────────────────────────────────
    const productStats = useMemo((): ProductStat[] => {
        return products.map(product => {
            const productOrders = orders
                .filter(o => o.productName === product.name)
                .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

            if (productOrders.length < 2) {
                return { product, suggestedWeekly: 0, actualWeeklyRate: 0 };
            }

            const first = new Date(productOrders[0].date);
            const last = new Date(productOrders[productOrders.length - 1].date);
            const diffDays = Math.max(1, Math.floor((last.getTime() - first.getTime()) / 86_400_000));
            const diffWeeks = diffDays / 7;

            // suggestedWeekly: rate from all orders except the last (= what was consumed between orders)
            const consumed = productOrders.slice(0, -1).reduce((s, o) => s + o.quantity, 0);
            const suggestedWeekly = Number((consumed / diffDays * 7).toFixed(1));

            // actualWeeklyRate: total ordered across the whole span
            const totalOrdered = productOrders.reduce((s, o) => s + o.quantity, 0);
            const actualWeeklyRate = Number((totalOrdered / diffWeeks).toFixed(1));

            return { product, suggestedWeekly, actualWeeklyRate };
        });
    }, [products, orders]);

    // ── Derived lists ────────────────────────────────────────────────────────
    const activePilots = useMemo(
        () => products.filter(p => (p.consumptionAmount ?? 0) > 0 && p.consumptionPeriod),
        [products],
    );

    const suggestions = useMemo(
        () => productStats.filter(
            s => s.suggestedWeekly > 0 && !(s.product.consumptionAmount ?? 0) && !s.product.ignoreOrderProposals,
        ),
        [productStats],
    );

    const anomalies = useMemo((): Anomaly[] => {
        return activePilots.map(p => {
            const autoWeekly = p.consumptionPeriod === 'day'
                ? (p.consumptionAmount ?? 0) * 7
                : (p.consumptionAmount ?? 0);
            const stat = productStats.find(s => s.product.id === p.id);
            const actualWeekly = stat?.actualWeeklyRate ?? 0;
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
            await DataService.saveProduct({
                ...stat.product,
                consumptionAmount: stat.suggestedWeekly,
                consumptionPeriod: 'week',
                lastConsumptionDate: new Date().toISOString(),
            });
            await loadData();
        } finally {
            setSaving(null);
        }
    };

    const handleIgnore = async (product: Product) => {
        setSaving(product.id);
        try {
            await DataService.saveProduct({ ...product, ignoreOrderProposals: true });
            await loadData();
        } finally {
            setSaving(null);
        }
    };

    if (loading) {
        return (
            <div style={{ padding: '60px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                Lade Autopilot-Daten…
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2xl)', paddingBottom: '40px' }}>

            {/* ── Header ── */}
            <div className="page-header">
                <div>
                    <h2 className="page-title">Autopilot & Verbrauchssteuerung</h2>
                    <p style={{ color: 'var(--color-text-muted)', marginTop: '4px' }}>
                        KI-Vorschläge bestätigen und automatischen Verbrauch in einer Übersicht steuern.
                    </p>
                </div>
            </div>

            {/* ── KPI Cards ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--spacing-md)' }}>
                <div className="stat-card">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px', color: 'var(--color-text-muted)', marginBottom: '10px', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        <Zap size={14} /> Aktive Autopiloten
                    </div>
                    <div style={{ fontSize: '36px', fontWeight: 700, color: 'var(--color-primary)' }}>
                        {activePilots.length}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--color-text-faint)', marginTop: '6px' }}>
                        von {products.length} Produkten
                    </div>
                </div>

                <div className="stat-card">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px', color: 'var(--color-text-muted)', marginBottom: '10px', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        <Bot size={14} /> Offene KI-Vorschläge
                    </div>
                    <div style={{ fontSize: '36px', fontWeight: 700, color: suggestions.length > 0 ? 'var(--color-warning)' : 'var(--color-text-main)' }}>
                        {suggestions.length}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--color-text-faint)', marginTop: '6px' }}>
                        warten auf Bestätigung
                    </div>
                </div>

                <div className="stat-card">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px', color: 'var(--color-text-muted)', marginBottom: '10px', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        <AlertTriangle size={14} /> Anomalien
                    </div>
                    <div style={{ fontSize: '36px', fontWeight: 700, color: anomalies.length > 0 ? 'var(--color-danger)' : 'var(--color-text-main)' }}>
                        {anomalies.length}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--color-text-faint)', marginTop: '6px' }}>
                        Abweichung &gt; 50%
                    </div>
                </div>
            </div>

            {/* ── KI Suggestions ── */}
            <div className="card" style={{ overflow: 'hidden' }}>
                <div style={{
                    padding: '14px var(--spacing-xl)',
                    borderBottom: '1px solid var(--color-border)',
                    backgroundColor: 'var(--color-surface-elevated)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                }}>
                    <h3 style={{ margin: 0, fontSize: '15px', color: 'var(--color-text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Bot size={16} color="var(--color-primary)" />
                        Aktionsbedarf: KI-Vorschläge
                    </h3>
                    {suggestions.length > 0 && (
                        <span className="badge badge-warning">{suggestions.length} offen</span>
                    )}
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
                            {suggestions.map(stat => (
                                <tr key={stat.product.id}>
                                    <td>
                                        <div style={{ fontWeight: 500 }}>{stat.product.name}</div>
                                        <div style={{ fontSize: '12px', color: 'var(--color-text-faint)' }}>
                                            {stat.product.category || '–'}
                                        </div>
                                    </td>
                                    <td>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <span className="badge badge-primary">
                                                {stat.suggestedWeekly} {stat.product.unit} / Woche
                                            </span>
                                            <span style={{ fontSize: '12px', color: 'var(--color-text-faint)' }}>
                                                aus Bestellhistorie berechnet
                                            </span>
                                        </div>
                                    </td>
                                    <td style={{ textAlign: 'right' }}>
                                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                                            <button
                                                className="btn btn-ghost btn-sm"
                                                onClick={() => handleIgnore(stat.product)}
                                                disabled={saving === stat.product.id}
                                                title="Diesen Vorschlag dauerhaft ignorieren"
                                            >
                                                <X size={14} /> Ignorieren
                                            </button>
                                            <button
                                                className="btn btn-success btn-sm"
                                                onClick={() => handleAdopt(stat)}
                                                disabled={saving === stat.product.id}
                                            >
                                                <CheckCircle2 size={14} /> Übernehmen
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ) : (
                    <div style={{ padding: 'var(--spacing-xl)' }}>
                        <EmptyState
                            icon={Bot}
                            title="Keine offenen Vorschläge"
                            text="Sobald ausreichend Bestellhistorie vorliegt, berechnet das System automatisch Verbrauchsvorschläge."
                        />
                    </div>
                )}
            </div>

            {/* ── Active Autopilots ── */}
            <div className="card" style={{ overflow: 'hidden' }}>
                <div style={{
                    padding: '14px var(--spacing-xl)',
                    borderBottom: '1px solid var(--color-border)',
                    backgroundColor: 'var(--color-surface-elevated)',
                }}>
                    <h3 style={{ margin: 0, fontSize: '15px', color: 'var(--color-text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Zap size={16} color="var(--color-success)" />
                        Aktive Autopiloten
                    </h3>
                </div>

                {activePilots.length > 0 ? (
                    <table className="products-table">
                        <thead>
                            <tr>
                                <th>Produkt</th>
                                <th>Eingestellter Verbrauch</th>
                                <th>Letzter Abruf</th>
                                <th style={{ textAlign: 'center' }}>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {activePilots.map(p => {
                                const anomaly = anomalies.find(a => a.product.id === p.id);
                                return (
                                    <tr key={p.id}>
                                        <td>
                                            <div style={{ fontWeight: 500 }}>{p.name}</div>
                                            <div style={{ fontSize: '12px', color: 'var(--color-text-faint)' }}>
                                                {p.category || '–'}
                                            </div>
                                        </td>
                                        <td>
                                            <span className="badge badge-success">
                                                {p.consumptionAmount} {p.unit} {periodLabel(p)}
                                            </span>
                                        </td>
                                        <td style={{ color: 'var(--color-text-muted)', fontSize: '13px' }}>
                                            {p.lastConsumptionDate
                                                ? new Date(p.lastConsumptionDate).toLocaleDateString('de-DE')
                                                : '–'}
                                        </td>
                                        <td style={{ textAlign: 'center' }}>
                                            {anomaly ? (
                                                <span
                                                    className="badge badge-warning"
                                                    title={`Autopilot: ${anomaly.autoWeekly} ${p.unit}/Wo — Bestellhistorie: ${anomaly.actualWeekly} ${p.unit}/Wo`}
                                                >
                                                    Abweichung
                                                </span>
                                            ) : (
                                                <span className="badge badge-neutral">Normal</span>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                ) : (
                    <div style={{ padding: 'var(--spacing-xl)' }}>
                        <EmptyState
                            icon={Zap}
                            title="Noch kein Autopilot aktiv"
                            text="Übernimm einen KI-Vorschlag oben oder stelle den Verbrauch direkt auf der Produktseite ein."
                        />
                    </div>
                )}
            </div>

            {/* ── Anomalies (only shown when present) ── */}
            {anomalies.length > 0 && (
                <div className="card" style={{ overflow: 'hidden' }}>
                    <div style={{
                        padding: '14px var(--spacing-xl)',
                        borderBottom: '1px solid var(--color-border)',
                        backgroundColor: 'var(--color-warning-bg)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                    }}>
                        <AlertTriangle size={16} color="var(--color-warning)" />
                        <h3 style={{ margin: 0, fontSize: '15px', color: 'var(--color-text-main)' }}>
                            Auffälligkeiten / Anomalien
                        </h3>
                        <span className="badge badge-warning" style={{ marginLeft: 'auto' }}>
                            {anomalies.length}
                        </span>
                    </div>

                    <div>
                        {anomalies.map(({ product: p, autoWeekly, actualWeekly, ratio }) => (
                            <div
                                key={p.id}
                                style={{
                                    padding: '16px var(--spacing-xl)',
                                    borderBottom: '1px solid var(--color-border)',
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    gap: 'var(--spacing-md)',
                                }}
                            >
                                <AlertTriangle
                                    size={18}
                                    color="var(--color-warning)"
                                    style={{ flexShrink: 0, marginTop: '2px' }}
                                />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: 600, color: 'var(--color-text-main)', marginBottom: '4px' }}>
                                        {p.name}
                                    </div>
                                    <div style={{ fontSize: '13px', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                                        {ratio > 1 ? (
                                            <>
                                                Du bestellst <strong>{actualWeekly} {p.unit}/Woche</strong>, aber der Autopilot
                                                zieht nur <strong>{autoWeekly} {p.unit}/Woche</strong> ab — der Lagerbestand wird
                                                dadurch höher ausgewiesen als er tatsächlich ist.
                                            </>
                                        ) : (
                                            <>
                                                Du bestellst nur <strong>{actualWeekly} {p.unit}/Woche</strong>, aber der Autopilot
                                                zieht <strong>{autoWeekly} {p.unit}/Woche</strong> ab — der Bestand könnte
                                                rechnerisch unter 0 fallen.
                                            </>
                                        )}
                                    </div>
                                </div>
                                <span
                                    className={ratio > 1 ? 'badge badge-warning' : 'badge badge-danger'}
                                    style={{ flexShrink: 0 }}
                                >
                                    {ratio > 1 ? '+' : ''}{((ratio - 1) * 100).toFixed(0)}%
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Hint when no autopilots and no suggestions */}
            {activePilots.length === 0 && suggestions.length === 0 && (
                <div style={{
                    padding: 'var(--spacing-2xl)',
                    backgroundColor: 'var(--color-surface-elevated)',
                    borderRadius: 'var(--radius-lg)',
                    border: '1px dashed var(--color-border)',
                    textAlign: 'center',
                }}>
                    <Activity size={40} style={{ opacity: 0.2, marginBottom: '16px', display: 'block', margin: '0 auto 16px' }} />
                    <div style={{ fontWeight: 600, color: 'var(--color-text-main)', marginBottom: '8px' }}>
                        Noch keine Daten für Autopilot-Vorschläge
                    </div>
                    <div style={{ fontSize: '13px', color: 'var(--color-text-muted)', maxWidth: '400px', margin: '0 auto', lineHeight: 1.6 }}>
                        Erfasse mindestens zwei Bestellungen pro Produkt. Das System berechnet dann automatisch
                        einen wöchentlichen Verbrauchswert aus der Bestellhistorie.
                    </div>
                </div>
            )}
        </div>
    );
};
