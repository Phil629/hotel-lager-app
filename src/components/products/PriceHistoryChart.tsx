import React, { useState, useEffect, useMemo } from 'react';
import { DataService } from '../../services/data';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp, TrendingDown, Minus, Download, History } from 'lucide-react';

interface PriceHistoryChartProps {
    productName: string;
}

interface ChartItem {
    date: string;
    rawDate: string;
    price: number;
    supplier: string;
    quantity: number;
}

export const PriceHistoryChart: React.FC<PriceHistoryChartProps> = ({ productName }) => {
    const [data, setData] = useState<ChartItem[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!productName) return;
        setLoading(true);

        Promise.all([
            DataService.getOrderPriceHistory(productName),
            DataService.getProducts()
        ]).then(([history, products]) => {
            const prod = products.find(p => p.name === productName);
            const fallbackPrice = prod?.price ?? 0;

            const mapped: ChartItem[] = (history || [])
                .filter(p => (p.price ?? fallbackPrice) > 0)
                .map(p => ({
                    date: new Date(p.date).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }),
                    rawDate: p.date,
                    price: p.price ?? fallbackPrice,
                    supplier: p.supplierName || 'Unbekannt',
                    quantity: p.quantity || 1,
                }));

            setData(mapped);
        }).catch(err => {
            console.error('Failed to load price history:', err);
        }).finally(() => {
            setLoading(false);
        });
    }, [productName]);

    // Trend calculations
    const stats = useMemo(() => {
        if (data.length === 0) return null;

        const latest = data[data.length - 1];
        const previous = data.length >= 2 ? data[data.length - 2] : null;
        const oldest = data[0];

        const diffPrev = previous ? latest.price - previous.price : 0;
        const pctPrev = previous && previous.price > 0 ? ((diffPrev) / previous.price) * 100 : 0;

        const diffOldest = latest.price - oldest.price;
        const pctOldest = oldest.price > 0 ? ((diffOldest) / oldest.price) * 100 : 0;

        const prices = data.map(d => d.price);
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;

        return {
            latest,
            previous,
            oldest,
            diffPrev,
            pctPrev,
            diffOldest,
            pctOldest,
            minPrice,
            maxPrice,
            avgPrice,
            orderCount: data.length,
        };
    }, [data]);

    const handleExportCsv = () => {
        if (data.length === 0) return;
        const header = ['Datum', 'Lieferant', 'Menge', 'Einzelpreis (EUR)'];
        const rows = data.map(d => [d.date, d.supplier, d.quantity, d.price.toFixed(2)]);
        const csvContent = '\uFEFF' + [header, ...rows].map(r => r.map(c => `"${c}"`).join(';')).join('\r\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `Preishistorie_${productName.replace(/[^a-zA-Z0-9_-]/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        URL.revokeObjectURL(url);
    };

    if (loading) {
        return (
            <div style={{ padding: '40px 10px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '14px' }}>
                Preishistorie wird geladen…
            </div>
        );
    }

    if (data.length === 0) {
        return (
            <div style={{ padding: '36px 16px', textAlign: 'center', color: 'var(--color-text-muted)', backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', border: '1px dashed var(--color-border)' }}>
                <History size={32} style={{ opacity: 0.3, display: 'block', margin: '0 auto 10px' }} />
                <div style={{ fontWeight: 600, color: 'var(--color-text-main)', marginBottom: '4px' }}>Keine Preisdaten</div>
                <div style={{ fontSize: '13px' }}>Für dieses Produkt wurden noch keine Bestellungen mit Preis hinterlegt.</div>
            </div>
        );
    }

    if (data.length === 1 && stats) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '12px' }}>
                <div style={{ padding: '24px 16px', textAlign: 'center', backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
                    <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)', fontWeight: 600, marginBottom: '4px' }}>
                        Aktueller Einkaufspreis
                    </div>
                    <div style={{ fontSize: '26px', fontWeight: 800, color: 'var(--color-primary)', marginBottom: '6px' }}>
                        {stats.latest.price.toFixed(2)} €
                    </div>
                    <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>
                        1 Bestellung am {stats.latest.date} (Lieferant: {stats.latest.supplier})
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--color-text-faint)', marginTop: '8px' }}>
                        Ein Preistrend und Verlaufschart werden ab der 2. Bestellung automatisch berechnet.
                    </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button type="button" onClick={handleExportCsv} className="btn btn-ghost btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <Download size={14} /> Als CSV exportieren
                    </button>
                </div>
            </div>
        );
    }

    if (!stats) return null;

    const isCheaper = stats.pctPrev < -0.01;
    const isMoreExpensive = stats.pctPrev > 0.01;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '12px' }}>
            {/* KPI Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px' }}>
                {/* Current Price & Trend */}
                <div style={{
                    padding: '12px 14px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                }}>
                    <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)', fontWeight: 600, marginBottom: '2px' }}>
                        Letzter Preis
                    </div>
                    <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--color-text-main)' }}>
                        {stats.latest.price.toFixed(2)} €
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px', fontSize: '12px', fontWeight: 700 }}>
                        {isCheaper ? (
                            <span style={{ color: 'var(--color-success, #16a34a)', display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                                <TrendingDown size={14} /> {stats.pctPrev.toFixed(1)}%
                            </span>
                        ) : isMoreExpensive ? (
                            <span style={{ color: 'var(--color-danger, #ef4444)', display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                                <TrendingUp size={14} /> +{stats.pctPrev.toFixed(1)}%
                            </span>
                        ) : (
                            <span style={{ color: 'var(--color-text-muted)', display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                                <Minus size={14} /> 0.0%
                            </span>
                        )}
                        <span style={{ fontSize: '11px', color: 'var(--color-text-faint)', fontWeight: 400 }}>vs. Vorkauf</span>
                    </div>
                </div>

                {/* Average Price */}
                <div style={{
                    padding: '12px 14px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                }}>
                    <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)', fontWeight: 600, marginBottom: '2px' }}>
                        Ø Einkaufspreis
                    </div>
                    <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--color-text-main)' }}>
                        {stats.avgPrice.toFixed(2)} €
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--color-text-faint)', marginTop: '4px' }}>
                        über {stats.orderCount} Bestellungen
                    </div>
                </div>

                {/* Min / Max Price */}
                <div style={{
                    padding: '12px 14px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                }}>
                    <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)', fontWeight: 600, marginBottom: '2px' }}>
                        Preisspanne
                    </div>
                    <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--color-text-main)' }}>
                        {stats.minPrice.toFixed(2)} € – {stats.maxPrice.toFixed(2)} €
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--color-text-faint)', marginTop: '4px' }}>
                        Min / Max erfasst
                    </div>
                </div>

                {/* Total change since inception */}
                <div style={{
                    padding: '12px 14px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                }}>
                    <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)', fontWeight: 600, marginBottom: '2px' }}>
                        Trend Gesamt
                    </div>
                    <div style={{
                        fontSize: '18px',
                        fontWeight: 800,
                        color: stats.pctOldest > 0 ? 'var(--color-danger, #ef4444)' : stats.pctOldest < 0 ? 'var(--color-success, #16a34a)' : 'var(--color-text-main)',
                    }}>
                        {stats.pctOldest > 0 ? '+' : ''}{stats.pctOldest.toFixed(1)}%
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--color-text-faint)', marginTop: '4px' }}>
                        seit {stats.oldest.date}
                    </div>
                </div>
            </div>

            {/* Chart */}
            <div style={{ width: '100%', height: 260, backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', padding: '16px 12px 8px 0', border: '1px solid var(--color-border)' }}>
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data} margin={{ top: 10, right: 20, bottom: 5, left: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                        <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} tickMargin={8} axisLine={false} tickLine={false} />
                        <YAxis
                            dataKey="price"
                            tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
                            tickFormatter={val => Number(val).toFixed(2) + '€'}
                            axisLine={false}
                            tickLine={false}
                            width={65}
                            domain={[dataMin => +(Math.max(0, dataMin * 0.85)).toFixed(2), dataMax => +(dataMax * 1.15).toFixed(2)]}
                        />
                        <Tooltip
                            contentStyle={{ borderRadius: '8px', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', boxShadow: 'var(--shadow-md)' }}
                            formatter={(value: any, _name: any, props: any) => [
                                `${Number(value).toFixed(2)} € (Menge: ${props.payload.quantity}, Lieferant: ${props.payload.supplier})`,
                                'Einkaufspreis'
                            ]}
                            labelFormatter={(label: any) => `Kaufdatum: ${label}`}
                        />
                        <Line
                            type="stepAfter"
                            dataKey="price"
                            stroke="var(--color-primary, #0ea5e9)"
                            strokeWidth={3}
                            dot={{ r: 4, fill: 'var(--color-primary, #0284c7)', strokeWidth: 0 }}
                            activeDot={{ r: 6 }}
                            animationDuration={800}
                        />
                    </LineChart>
                </ResponsiveContainer>
            </div>

            {/* Actions & Details Footer */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                <span>
                    {stats.previous ? (
                        <>Vorletzter Einkauf: <strong>{stats.previous.price.toFixed(2)} €</strong> ({stats.previous.supplier}, {stats.previous.date})</>
                    ) : (
                        <>Erstkauf erfasst am {stats.latest.date}</>
                    )}
                </span>
                <button
                    type="button"
                    onClick={handleExportCsv}
                    className="btn btn-ghost btn-sm"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                >
                    <Download size={14} /> CSV-Export ({stats.orderCount} Einträge)
                </button>
            </div>
        </div>
    );
};
