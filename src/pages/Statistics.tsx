import React, { useState, useEffect, useMemo } from 'react';
import type { Product, Order } from '../types';
import { DataService } from '../services/data';
import { BarChart3, TrendingDown, Package, LayoutGrid, Info } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export const Statistics: React.FC = () => {
    const [products, setProducts] = useState<Product[]>([]);
    const [orders, setOrders] = useState<Order[]>([]);
    const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    const loadData = async () => {
        const [p, o] = await Promise.all([
            DataService.getProducts(),
            DataService.getOrders()
        ]);
        setProducts(p);
        setOrders(o);
    };

    useEffect(() => {
        loadData();
    }, []);

    // Aggragate stats per product
    const productStats = useMemo(() => {
        return products.map(product => {
            const productOrders = orders.filter(o => o.productName === product.name).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
            
            let totalOrdered = 0;
            let firstOrderDate: Date | null = null;
            let lastOrderDate: Date | null = null;

            if (productOrders.length > 0) {
                totalOrdered = productOrders.reduce((sum, o) => sum + o.quantity, 0);
                firstOrderDate = new Date(productOrders[0].date);
                lastOrderDate = new Date(productOrders[productOrders.length - 1].date);
            }

            // Calculate suggested consumption
            let suggestedWeekly = 0;
            let consumptionBaseDays = 0;
            let consumptionBaseQuantity = 0;

            if (firstOrderDate && lastOrderDate && productOrders.length > 1) {
                const diffTime = Math.abs(lastOrderDate.getTime() - firstOrderDate.getTime());
                const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                
                if (diffDays >= 1) {
                    let consumedQuantity = 0;
                    for (let i = 0; i < productOrders.length - 1; i++) {
                        consumedQuantity += productOrders[i].quantity;
                    }

                    const daily = consumedQuantity / diffDays;
                    suggestedWeekly = Number((daily * 7).toFixed(1));
                    
                    consumptionBaseDays = diffDays;
                    consumptionBaseQuantity = consumedQuantity;
                }
            }

            // Chart data
            const chartData = productOrders.reduce((acc: any[], order) => {
                const dateMonth = new Date(order.date).toLocaleDateString('de-DE', { month: 'short', year: '2-digit' });
                const existing = acc.find(item => item.date === dateMonth);
                if (existing) {
                    existing.menge += order.quantity;
                } else {
                    acc.push({ date: dateMonth, menge: order.quantity, vollesDatum: new Date(order.date).toLocaleDateString('de-DE') });
                }
                return acc;
            }, []);

            return {
                ...product,
                orderCount: productOrders.length,
                totalOrdered,
                suggestedWeekly,
                consumptionBaseDays,
                consumptionBaseQuantity,
                chartData,
                productOrders
            };
        }).sort((a, b) => b.totalOrdered - a.totalOrdered);
    }, [products, orders]);

    const selectedProductData = selectedProductId ? productStats.find(p => p.id === selectedProductId) : null;

    // Local state for editable fields in "Aktuell eingestellter Auto-Verbrauch"
    const [editConsumptionAmount, setEditConsumptionAmount] = useState<number | ''>('');
    const [editConsumptionPeriod, setEditConsumptionPeriod] = useState<'day' | 'week' | ''>('');

    // Update local state when a new product is selected
    useEffect(() => {
        if (selectedProductData) {
            setEditConsumptionAmount(selectedProductData.consumptionAmount ?? '');
            setEditConsumptionPeriod(selectedProductData.consumptionPeriod ?? '');
        }
    }, [selectedProductData?.id]);

    const handleAdoptSuggestion = async (product: Product, suggestedWeekly: number) => {
        setIsSaving(true);
        try {
            const updatedProduct = {
                ...product,
                consumptionAmount: suggestedWeekly,
                consumptionPeriod: 'week' as const,
                lastConsumptionDate: new Date().toISOString()
            };
            await DataService.saveProduct(updatedProduct);
            await loadData();
        } finally {
            setIsSaving(false);
        }
    };

    const handleSaveManualConsumption = async () => {
        if (!selectedProductData) return;
        setIsSaving(true);
        try {
            const updatedProduct = {
                ...selectedProductData,
                consumptionAmount: editConsumptionAmount === '' ? undefined : editConsumptionAmount,
                consumptionPeriod: editConsumptionPeriod === '' ? undefined : editConsumptionPeriod,
                lastConsumptionDate: new Date().toISOString()
            };
            await DataService.saveProduct(updatedProduct);
            await loadData();
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)', marginBottom: 'var(--spacing-xl)' }}>
                <div style={{ backgroundColor: 'var(--color-primary)', color: 'white', padding: '12px', borderRadius: 'var(--radius-md)' }}>
                    <BarChart3 size={28} />
                </div>
                <div>
                    <h2 style={{ fontSize: 'var(--font-size-2xl)', margin: 0 }}>Statistiken & Verbrauch</h2>
                    <p style={{ color: 'var(--color-text-muted)', margin: '4px 0 0 0' }}>Historische Bestelldaten und Verbrauchsvorschläge</p>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1fr) 2fr', gap: 'var(--spacing-xl)', alignItems: 'start' }}>
                
                {/* Product List Sidebar */}
                <div style={{ backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-md)', overflow: 'hidden' }}>
                    <div style={{ padding: 'var(--spacing-md)', borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-background)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <LayoutGrid size={20} />
                        <h3 style={{ margin: 0, fontSize: 'var(--font-size-lg)' }}>Produkte ({productStats.length})</h3>
                    </div>
                    <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
                        {productStats.map(stat => (
                            <div 
                                key={stat.id}
                                onClick={() => setSelectedProductId(stat.id)}
                                style={{
                                    padding: 'var(--spacing-md)',
                                    borderBottom: '1px solid var(--color-border)',
                                    cursor: 'pointer',
                                    backgroundColor: selectedProductId === stat.id ? 'rgba(37, 99, 235, 0.05)' : 'transparent',
                                    borderLeft: selectedProductId === stat.id ? '4px solid var(--color-primary)' : '4px solid transparent',
                                    transition: 'all 0.2s'
                                }}
                            >
                                <div style={{ fontWeight: 600 }}>{stat.name}</div>
                                <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
                                    <span>{stat.totalOrdered} {stat.unit} bestellt</span>
                                    {stat.suggestedWeekly > 0 && stat.orderCount >= 2 && <span style={{ color: 'var(--color-primary)' }}>Ø {stat.suggestedWeekly} / Woche</span>}
                                </div>
                            </div>
                        ))}
                        {productStats.length === 0 && (
                            <div style={{ padding: 'var(--spacing-xl)', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                                Keine Daten vorhanden.
                            </div>
                        )}
                    </div>
                </div>

                {/* Detail View */}
                {selectedProductData ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-xl)' }}>
                        <div style={{ backgroundColor: 'var(--color-surface)', padding: 'var(--spacing-xl)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-md)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--spacing-lg)' }}>
                                <div>
                                    <h3 style={{ margin: '0 0 8px 0', fontSize: 'var(--font-size-xl)' }}>{selectedProductData.name}</h3>
                                    <div style={{ display: 'flex', gap: 'var(--spacing-md)', color: 'var(--color-text-muted)' }}>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Package size={16} /> Aktueller Bestand: {selectedProductData.stock} {selectedProductData.unit}</span>
                                    </div>
                                </div>
                                
                                {selectedProductData.suggestedWeekly > 0 && selectedProductData.orderCount >= 2 ? (
                                    <div style={{ backgroundColor: 'rgba(37, 99, 235, 0.1)', color: 'var(--color-primary)', padding: '12px var(--spacing-md)', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', gap: '12px' }}>
                                        <TrendingDown size={24} style={{ flexShrink: 0 }} />
                                        <div>
                                            <div style={{ fontSize: 'var(--font-size-xs)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em' }}>Erwarteter Vorratsschwund</div>
                                            <div style={{ fontSize: 'var(--font-size-lg)', fontWeight: 700 }}>~ {selectedProductData.suggestedWeekly} {selectedProductData.unit} / Woche</div>
                                            <div style={{ marginTop: '4px', fontSize: '11px', opacity: 0.8, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                <Info size={12} />
                                                Basis: {selectedProductData.consumptionBaseQuantity} {selectedProductData.unit} verbraucht über {selectedProductData.consumptionBaseDays} Tage
                                            </div>
                                            <button 
                                                onClick={() => handleAdoptSuggestion(selectedProductData, selectedProductData.suggestedWeekly)}
                                                disabled={isSaving}
                                                style={{ 
                                                    marginTop: '8px',
                                                    padding: '4px 12px',
                                                    fontSize: 'var(--font-size-sm)',
                                                    fontWeight: 600,
                                                    color: 'white',
                                                    backgroundColor: 'var(--color-primary)',
                                                    border: 'none',
                                                    borderRadius: 'var(--radius-sm)',
                                                    cursor: isSaving ? 'not-allowed' : 'pointer',
                                                    opacity: isSaving ? 0.7 : 1
                                                }}
                                            >
                                                {isSaving ? 'Speichert...' : 'Einstellung übernehmen'}
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div style={{ backgroundColor: 'var(--color-surface)', border: '1px dashed var(--color-border)', color: 'var(--color-text-muted)', padding: '12px var(--spacing-md)', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--font-size-sm)' }}>
                                        <TrendingDown size={18} />
                                        <span>Erwarteter Verbrauch: <br/>(möglich ab 2 Bestellungen)</span>
                                    </div>
                                )}
                            </div>

                            <div style={{ height: '300px', width: '100%', marginTop: 'var(--spacing-xl)' }}>
                                {selectedProductData.chartData.length > 0 ? (
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={selectedProductData.chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                                            <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#6b7280', fontSize: 12 }} dy={10} />
                                            <YAxis axisLine={false} tickLine={false} tick={{ fill: '#6b7280', fontSize: 12 }} />
                                            <Tooltip 
                                                cursor={{ fill: 'rgba(229, 231, 235, 0.4)' }}
                                                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
                                            />
                                            <Bar dataKey="menge" name="Bestellmenge" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                ) : (
                                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-md)' }}>
                                        Nicht genügend Bestelldaten für einen Chart vorhanden.
                                    </div>
                                )}
                            </div>
                        </div>

                        <div style={{ backgroundColor: 'var(--color-surface)', padding: 'var(--spacing-lg)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', borderLeft: '4px solid var(--color-success)' }}>
                            <h4 style={{ margin: '0 0 16px 0' }}>Aktuell eingestellter Auto-Verbrauch</h4>
                            
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--spacing-md)' }}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ display: 'block', marginBottom: '4px', fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Menge einstellen</label>
                                    <input
                                        type="number"
                                        step="1"
                                        min="0"
                                        value={editConsumptionAmount}
                                        onChange={e => setEditConsumptionAmount(parseFloat(e.target.value) || '')}
                                        placeholder="Menge (z.B. 1)"
                                        style={{ width: '100%', padding: 'var(--spacing-sm)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}
                                    />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={{ display: 'block', marginBottom: '4px', fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Zeitraum einstellen</label>
                                    <select
                                        value={editConsumptionPeriod}
                                        onChange={e => setEditConsumptionPeriod(e.target.value as 'day' | 'week' | '')}
                                        style={{ width: '100%', padding: 'var(--spacing-sm)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}
                                    >
                                        <option value="">-- Keiner --</option>
                                        <option value="day">pro Tag</option>
                                        <option value="week">pro Woche</option>
                                    </select>
                                </div>
                            </div>
                            
                            <div style={{ marginTop: 'var(--spacing-md)', display: 'flex', justifyContent: 'flex-end', gap: 'var(--spacing-md)' }}>
                                <button
                                    onClick={handleSaveManualConsumption}
                                    disabled={isSaving || (editConsumptionAmount !== '' && editConsumptionPeriod === '') || (editConsumptionAmount === '' && editConsumptionPeriod !== '')}
                                    style={{
                                        padding: 'var(--spacing-sm) var(--spacing-md)',
                                        borderRadius: 'var(--radius-md)',
                                        border: 'none',
                                        backgroundColor: 'var(--color-success)',
                                        color: 'white',
                                        fontWeight: 600,
                                        cursor: isSaving ? 'not-allowed' : 'pointer',
                                        opacity: (isSaving || (editConsumptionAmount !== '' && editConsumptionPeriod === '') || (editConsumptionAmount === '' && editConsumptionPeriod !== '')) ? 0.6 : 1
                                    }}
                                >
                                    {isSaving ? 'Speichert...' : 'Einstellungen speichern & anwenden'}
                                </button>
                            </div>
                            
                            <p style={{ margin: 'margin-top: var(--spacing-sm)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
                                {editConsumptionAmount && editConsumptionPeriod ? (
                                    <>Dieses Produkt reduziert seinen Bestand automatisch um <strong>{editConsumptionAmount} {selectedProductData.unit}</strong> pro <strong>{editConsumptionPeriod === 'day' ? 'Tag' : 'Woche'}</strong>.</>
                                ) : (
                                    <>Momentan ist kein automatischer Verbrauch für dieses Produkt aktiv.</>
                                )}
                            </p>
                        </div> 
                        
                    </div>
                ) : (
                    <div style={{ backgroundColor: 'var(--color-surface)', padding: 'var(--spacing-2xl)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', textAlign: 'center', color: 'var(--color-text-muted)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '400px' }}>
                        <BarChart3 size={48} style={{ opacity: 0.2, marginBottom: 'var(--spacing-md)' }} />
                        <h3 style={{ margin: '0 0 var(--spacing-sm) 0', color: 'var(--color-text-main)' }}>Kein Produkt ausgewählt</h3>
                        <p style={{ margin: 0 }}>Wählen Sie ein Produkt aus der Liste links, um dessen Bestellhistorie und Verbrauchsvorschläge zu sehen.</p>
                    </div>
                )}
            </div>
        </div>
    );
};
