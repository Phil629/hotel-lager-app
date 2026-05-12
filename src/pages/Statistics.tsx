import React, { useState, useEffect, useMemo } from 'react';
import type { Product, Order, Supplier } from '../types';
import { DataService } from '../services/data';
import { BarChart3, TrendingDown, Package, LayoutGrid, Building2, ChevronDown, ChevronRight, Euro, TrendingUp, Wallet, Calendar, AlertCircle } from 'lucide-react';
import { BarChart, LineChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export const Statistics: React.FC = () => {
    const [products, setProducts] = useState<Product[]>([]);
    const [orders, setOrders] = useState<Order[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'consumption' | 'price'>('consumption');
    const [isSaving, setIsSaving] = useState(false);
    const [expandedSuppliers, setExpandedSuppliers] = useState<Record<string, boolean>>({});

    const loadData = async () => {
        const [p, o, s] = await Promise.all([
            DataService.getProducts(),
            DataService.getOrders(),
            DataService.getSuppliers()
        ]);
        setProducts(p);
        setOrders(o);
        setSuppliers(s);
    };

    useEffect(() => {
        loadData();
    }, []);

    // Global Stats
    const globalStats = useMemo(() => {
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();
        const lastMonth = currentMonth === 0 ? 11 : currentMonth - 1;
        const lastMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear;

        let totalSpentThisMonth = 0;
        let totalSpentLastMonth = 0;
        let totalOrdersThisMonth = 0;

        orders.forEach(order => {
            const orderDate = new Date(order.date);
            const product = products.find(p => p.name === order.productName);
            const unitPrice = order.price ?? product?.price ?? 0;
            const spend = order.quantity * unitPrice;

            if (orderDate.getMonth() === currentMonth && orderDate.getFullYear() === currentYear) {
                totalSpentThisMonth += spend;
                totalOrdersThisMonth++;
            } else if (orderDate.getMonth() === lastMonth && orderDate.getFullYear() === lastMonthYear) {
                totalSpentLastMonth += spend;
            }
        });

        const spendDifference = totalSpentLastMonth > 0 
            ? ((totalSpentThisMonth - totalSpentLastMonth) / totalSpentLastMonth) * 100 
            : 0;

        return {
            totalSpentThisMonth,
            totalSpentLastMonth,
            spendDifference,
            totalOrdersThisMonth
        };
    }, [orders, products]);

    // Aggregate stats per product
    const productStats = useMemo(() => {
        return products.map(product => {
            const productOrders = orders.filter(o => o.productName === product.name).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
            
            let totalOrdered = 0;
            let totalSpent = 0;
            let firstOrderDate: Date | null = null;
            let lastOrderDate: Date | null = null;
            let minPrice = Infinity;
            let maxPrice = 0;
            let lastPrice = 0;

            if (productOrders.length > 0) {
                totalOrdered = productOrders.reduce((sum, o) => sum + o.quantity, 0);
                firstOrderDate = new Date(productOrders[0].date);
                lastOrderDate = new Date(productOrders[productOrders.length - 1].date);
                
                productOrders.forEach(o => {
                    const unitPrice = o.price ?? product.price ?? 0;
                    totalSpent += o.quantity * unitPrice;
                    if (unitPrice > 0) {
                        if (unitPrice < minPrice) minPrice = unitPrice;
                        if (unitPrice > maxPrice) maxPrice = unitPrice;
                        lastPrice = unitPrice;
                    }
                });
                if (minPrice === Infinity) minPrice = 0;
            }

            const averagePrice = totalOrdered > 0 ? totalSpent / totalOrdered : 0;
            const isVolatile = minPrice > 0 && maxPrice > 0 && (maxPrice / minPrice > 1.15); // >15% fluctuation

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

            // Consumption Chart data (Monthly Grouping)
            const consumptionChartData = productOrders.reduce((acc: any[], order) => {
                const dateMonth = new Date(order.date).toLocaleDateString('de-DE', { month: 'short', year: '2-digit' });
                const existing = acc.find(item => item.date === dateMonth);
                if (existing) {
                    existing.menge += order.quantity;
                } else {
                    acc.push({ date: dateMonth, menge: order.quantity, vollesDatum: new Date(order.date).toLocaleDateString('de-DE') });
                }
                return acc;
            }, []);

            // Price Chart data (Chronological)
            const priceChartData = productOrders.map((order, idx) => ({
                index: idx + 1,
                date: new Date(order.date).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: '2-digit' }),
                preis: order.price ?? product.price ?? 0,
                menge: order.quantity
            })).filter(d => d.preis > 0);

            return {
                ...product,
                orderCount: productOrders.length,
                totalOrdered,
                totalSpent,
                averagePrice,
                minPrice,
                maxPrice,
                lastPrice,
                isVolatile,
                suggestedWeekly,
                consumptionBaseDays,
                consumptionBaseQuantity,
                consumptionChartData,
                priceChartData,
                productOrders
            };
        }).sort((a, b) => b.totalSpent - a.totalSpent); // Sort by highest spend by default
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
            // Optional: Auto-switch to consumption tab if no price data? Or keep user preference.
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2xl)', paddingBottom: '40px' }}>
            
            {/* Global Dashboard Header */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)' }}>
                    <div style={{ backgroundColor: 'var(--color-primary)', color: 'white', padding: '12px', borderRadius: 'var(--radius-md)' }}>
                        <BarChart3 size={28} />
                    </div>
                    <div>
                        <h2 className="page-title">Statistiken & Analysen</h2>
                        <p style={{ color: 'var(--color-text-muted)', margin: '4px 0 0 0' }}>Kostenkontrolle und Verbrauchsübersicht</p>
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--spacing-md)', marginTop: 'var(--spacing-md)' }}>
                    <div className="stat-card">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-text-muted)', marginBottom: '8px', fontSize: '13px', fontWeight: 600, textTransform: 'uppercase' }}>
                            <Euro size={16} /> Ausgaben diesen Monat
                        </div>
                        <div style={{ fontSize: '28px', fontWeight: 700, color: 'var(--color-text-main)' }}>
                            {globalStats.totalSpentThisMonth.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '8px', fontSize: '13px', color: globalStats.spendDifference > 0 ? 'var(--color-danger)' : 'var(--color-success)', fontWeight: 500 }}>
                            {globalStats.spendDifference > 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                            {Math.abs(globalStats.spendDifference).toFixed(1)}% im Vergleich zum Vormonat
                        </div>
                    </div>

                    <div className="stat-card">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-text-muted)', marginBottom: '8px', fontSize: '13px', fontWeight: 600, textTransform: 'uppercase' }}>
                            <Calendar size={16} /> Bestellungen diesen Monat
                        </div>
                        <div style={{ fontSize: '28px', fontWeight: 700, color: 'var(--color-text-main)' }}>
                            {globalStats.totalOrdersThisMonth}
                        </div>
                    </div>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1fr) 2.5fr', gap: 'var(--spacing-xl)', alignItems: 'start' }}>
                
                {/* Product List Sidebar */}
                <div className="card" style={{ overflow: 'hidden' }}>
                    <div style={{ padding: 'var(--spacing-md)', borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface-elevated)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <LayoutGrid size={20} color="var(--color-primary)" />
                        <h3 style={{ margin: 0, fontSize: 'var(--font-size-lg)', color: 'var(--color-text-main)' }}>Ausgaben nach Produkt</h3>
                    </div>
                    <div style={{ maxHeight: '700px', overflowY: 'auto' }}>
                        {(() => {
                            const supplierIds = Array.from(new Set(productStats.map(p => p.supplierId || 'none'))).sort();
                            return supplierIds.map(supplierId => {
                                const supplierProds = productStats.filter(p => (p.supplierId || 'none') === supplierId);
                                const supplier = supplierId === 'none' ? undefined : suppliers.find(s => s.id === supplierId);
                                const isExpanded = !!expandedSuppliers[supplierId];
                                
                                return (
                                    <div key={supplierId}>
                                        <div
                                            onClick={() => setExpandedSuppliers(prev => ({...prev, [supplierId]: !prev[supplierId]}))}
                                            style={{
                                                padding: '12px 16px',
                                                backgroundColor: 'var(--color-background)',
                                                borderBottom: '1px solid var(--color-border)',
                                                borderTop: '1px solid var(--color-surface)',
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                                fontWeight: 600,
                                                color: 'var(--color-text-secondary)'
                                            }}
                                        >
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <Building2 size={16} color="var(--color-text-muted)" />
                                                {supplier?.name || 'Ohne Lieferant'}
                                                <span style={{ fontSize: '11px', color: 'var(--color-text-faint)', fontWeight: 'normal' }}>({supplierProds.length})</span>
                                            </div>
                                            {isExpanded ? <ChevronDown size={16} color="var(--color-text-muted)" /> : <ChevronRight size={16} color="var(--color-text-muted)" />}
                                        </div>
                                        
                                        {isExpanded && (
                                            <div>
                                                {supplierProds.map(stat => (
                                                    <div 
                                                        key={stat.id}
                                                        onClick={() => setSelectedProductId(stat.id)}
                                                        style={{
                                                            padding: '12px 16px',
                                                            paddingLeft: '24px',
                                                            borderBottom: '1px solid var(--color-border)',
                                                            cursor: 'pointer',
                                                            backgroundColor: selectedProductId === stat.id ? '#eff6ff' : 'var(--color-surface)',
                                                            borderLeft: selectedProductId === stat.id ? '4px solid var(--color-primary)' : '4px solid transparent',
                                                            transition: 'all 0.15s ease'
                                                        }}
                                                    >
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                            <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--color-text-main)' }}>{stat.name}</div>
                                                            {stat.isVolatile && (
                                                                <div title="Starke Preisschwankungen erkannt" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '20px', height: '20px', borderRadius: '50%', backgroundColor: 'var(--color-danger-bg)', color: 'var(--color-danger)' }}>
                                                                    <AlertCircle size={12} />
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div style={{ fontSize: '13px', color: 'var(--color-text-muted)', display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
                                                            <span>{stat.totalSpent.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</span>
                                                            <span>{stat.totalOrdered} {stat.unit}</span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                );
                            });
                        })()}
                        {productStats.length === 0 && (
                            <div style={{ padding: 'var(--spacing-xl)', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                                Keine Daten vorhanden.
                            </div>
                        )}
                    </div>
                </div>
                
                {/* Detail View */}
                {selectedProductData ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-lg)' }}>
                        {/* Header */}
                        <div style={{ backgroundColor: 'var(--color-surface)', padding: 'var(--spacing-xl)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-md)', border: '1px solid var(--color-border)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                <div>
                                    <h3 style={{ margin: '0 0 8px 0', fontSize: '24px', color: 'var(--color-text-main)' }}>{selectedProductData.name}</h3>
                                    <div style={{ display: 'flex', gap: '16px', color: 'var(--color-text-muted)', fontSize: '14px' }}>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Package size={16} /> Aktueller Bestand: <strong>{selectedProductData.stock} {selectedProductData.unit}</strong></span>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Wallet size={16} /> Gesamtausgaben: <strong>{selectedProductData.totalSpent.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</strong></span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Tabs */}
                        <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--color-border)', paddingBottom: '0' }}>
                            <button
                                onClick={() => setActiveTab('consumption')}
                                style={{
                                    padding: '12px 24px',
                                    border: 'none',
                                    background: 'none',
                                    fontSize: '15px',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    color: activeTab === 'consumption' ? 'var(--color-primary)' : 'var(--color-text-muted)',
                                    borderBottom: activeTab === 'consumption' ? '3px solid var(--color-primary)' : '3px solid transparent',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    transition: 'all 0.2s'
                                }}
                            >
                                <Package size={18} /> Verbrauch & Bestand
                            </button>
                            <button
                                onClick={() => setActiveTab('price')}
                                style={{
                                    padding: '12px 24px',
                                    border: 'none',
                                    background: 'none',
                                    fontSize: '15px',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    color: activeTab === 'price' ? 'var(--color-success)' : 'var(--color-text-muted)',
                                    borderBottom: activeTab === 'price' ? '3px solid var(--color-success)' : '3px solid transparent',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    transition: 'all 0.2s'
                                }}
                            >
                                <Euro size={18} /> Preisanalyse
                            </button>
                        </div>

                        {/* Tab Content: Verbrauch */}
                        {activeTab === 'consumption' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-lg)' }}>
                                <div style={{ backgroundColor: 'var(--color-surface)', padding: 'var(--spacing-xl)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', border: '1px solid var(--color-border)' }}>
                                    
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                                        <h4 style={{ margin: 0, fontSize: '18px', color: 'var(--color-text-main)' }}>Bestellmengen Historie</h4>
                                        {selectedProductData.suggestedWeekly > 0 && selectedProductData.orderCount >= 2 && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: '#eff6ff', padding: '8px 16px', borderRadius: '999px', border: '1px solid #bfdbfe' }}>
                                                <TrendingDown size={18} color="var(--color-primary)" />
                                                <span style={{ fontSize: '14px', color: '#1e3a8a', fontWeight: 500 }}>
                                                    Ø Verbrauch: <strong>{selectedProductData.suggestedWeekly} {selectedProductData.unit} / Woche</strong>
                                                </span>
                                                <button
                                                    onClick={() => handleAdoptSuggestion(selectedProductData, selectedProductData.suggestedWeekly)}
                                                    disabled={isSaving}
                                                    title="Als automatischen Verbrauch übernehmen"
                                                    className="btn btn-primary btn-sm"
                                                >
                                                    Übernehmen
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    <div style={{ height: '300px', width: '100%' }}>
                                        {selectedProductData.consumptionChartData.length > 0 ? (
                                            <ResponsiveContainer width="100%" height="100%">
                                                <BarChart data={selectedProductData.consumptionChartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                                                    <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#6b7280', fontSize: 12 }} dy={10} />
                                                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#6b7280', fontSize: 12 }} />
                                                    <Tooltip 
                                                        cursor={{ fill: 'rgba(229, 231, 235, 0.4)' }}
                                                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
                                                        formatter={(value: any) => [`${value} ${selectedProductData.unit}`, 'Bestellmenge']}
                                                    />
                                                    <Bar dataKey="menge" name="Bestellmenge" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
                                                </BarChart>
                                            </ResponsiveContainer>
                                        ) : (
                                            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-md)' }}>
                                                Nicht genügend Bestelldaten für einen Mengen-Chart vorhanden.
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div style={{ backgroundColor: 'var(--color-surface)', padding: 'var(--spacing-lg)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', borderLeft: '4px solid var(--color-success)', borderTop: '1px solid var(--color-border)', borderRight: '1px solid var(--color-border)', borderBottom: '1px solid var(--color-border)' }}>
                                    <h4 style={{ margin: '0 0 16px 0', fontSize: '16px', color: 'var(--color-text-main)' }}>Aktuell eingestellter Auto-Verbrauch</h4>
                                    
                                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--spacing-md)' }}>
                                        <div className="form-group" style={{ flex: 1 }}>
                                            <label className="form-label">Menge einstellen</label>
                                            <input
                                                type="number"
                                                step="0.1"
                                                min="0"
                                                value={editConsumptionAmount}
                                                onChange={e => setEditConsumptionAmount(parseFloat(e.target.value) || '')}
                                                placeholder="Menge (z.B. 1)"
                                                className="input-field"
                                            />
                                        </div>
                                        <div className="form-group" style={{ flex: 1 }}>
                                            <label className="form-label">Zeitraum einstellen</label>
                                            <select
                                                value={editConsumptionPeriod}
                                                onChange={e => setEditConsumptionPeriod(e.target.value as 'day' | 'week' | '')}
                                                className="input-field"
                                            >
                                                <option value="">-- Keiner --</option>
                                                <option value="day">pro Tag</option>
                                                <option value="week">pro Woche</option>
                                            </select>
                                        </div>
                                        <div style={{ alignSelf: 'flex-end' }}>
                                            <button
                                                onClick={handleSaveManualConsumption}
                                                disabled={isSaving || (editConsumptionAmount !== '' && editConsumptionPeriod === '') || (editConsumptionAmount === '' && editConsumptionPeriod !== '')}
                                                className="btn btn-success"
                                            >
                                                {isSaving ? 'Speichert...' : 'Speichern'}
                                            </button>
                                        </div>
                                    </div>
                                    
                                    <p style={{ margin: '16px 0 0 0', fontSize: '14px', color: 'var(--color-text-muted)' }}>
                                        {editConsumptionAmount && editConsumptionPeriod ? (
                                            <>Dieses Produkt reduziert seinen Bestand automatisch um <strong>{editConsumptionAmount} {selectedProductData.unit}</strong> pro <strong>{editConsumptionPeriod === 'day' ? 'Tag' : 'Woche'}</strong>.</>
                                        ) : (
                                            <>Momentan ist kein automatischer Verbrauch für dieses Produkt aktiv.</>
                                        )}
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* Tab Content: Preise */}
                        {activeTab === 'price' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-lg)' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
                                    <div style={{ backgroundColor: 'var(--color-surface)', padding: '16px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                                        <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: '8px' }}>Durchschnittspreis</div>
                                        <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--color-text-main)' }}>{selectedProductData.averagePrice.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</div>
                                        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-faint)', marginTop: '4px' }}>pro {selectedProductData.unit}</div>
                                    </div>
                                    <div style={{ backgroundColor: 'var(--color-surface)', padding: '16px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                                        <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: '8px' }}>Letzter Preis</div>
                                        <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--color-text-main)' }}>{selectedProductData.lastPrice.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</div>
                                    </div>
                                    <div style={{ backgroundColor: 'var(--color-surface)', padding: '16px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                                        <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: '8px' }}>Niedrigster Preis</div>
                                        <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--color-success)' }}>{selectedProductData.minPrice.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</div>
                                    </div>
                                    <div style={{ backgroundColor: 'var(--color-surface)', padding: '16px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                                        <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: '8px' }}>Höchster Preis</div>
                                        <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--color-danger)' }}>{selectedProductData.maxPrice.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</div>
                                    </div>
                                </div>

                                <div style={{ backgroundColor: 'var(--color-surface)', padding: 'var(--spacing-xl)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', border: '1px solid var(--color-border)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                                        <h4 style={{ margin: 0, fontSize: '18px', color: 'var(--color-text-main)' }}>Preisentwicklung (pro {selectedProductData.unit})</h4>
                                        {selectedProductData.isVolatile && (
                                            <span className="badge badge-danger">
                                                <AlertCircle size={14} /> Hohe Preisschwankung
                                            </span>
                                        )}
                                    </div>

                                    <div style={{ height: '350px', width: '100%' }}>
                                        {selectedProductData.priceChartData.length > 0 ? (
                                            <ResponsiveContainer width="100%" height="100%">
                                                <LineChart data={selectedProductData.priceChartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                                                    <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#6b7280', fontSize: 12 }} dy={10} />
                                                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#6b7280', fontSize: 12 }} tickFormatter={(val) => `€${val}`} domain={['auto', 'auto']} />
                                                    <Tooltip 
                                                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
                                                        formatter={(value: any) => [Number(value).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }), 'Preis']}
                                                        labelFormatter={(label) => `Bestelldatum: ${label}`}
                                                    />
                                                    <Line type="monotone" dataKey="preis" name="Preis" stroke="#10b981" strokeWidth={3} dot={{ r: 4, fill: '#10b981', strokeWidth: 2, stroke: 'white' }} activeDot={{ r: 6 }} />
                                                </LineChart>
                                            </ResponsiveContainer>
                                        ) : (
                                            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-md)' }}>
                                                Nicht genügend Preisdaten für einen Chart vorhanden.
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
                        
                    </div>
                ) : (
                    <div style={{ backgroundColor: 'var(--color-surface)', padding: 'var(--spacing-2xl)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', textAlign: 'center', color: 'var(--color-text-muted)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '500px', border: '1px dashed var(--color-border)' }}>
                        <BarChart3 size={48} style={{ opacity: 0.2, marginBottom: 'var(--spacing-md)' }} />
                        <h3 style={{ margin: '0 0 var(--spacing-sm) 0', color: 'var(--color-text-main)' }}>Kein Produkt ausgewählt</h3>
                        <p style={{ margin: 0, maxWidth: '300px', lineHeight: 1.5 }}>Wähle ein Produkt aus der linken Liste, um dessen Bestellhistorie, Preisentwicklung und Verbrauchsdaten zu analysieren.</p>
                    </div>
                )}
            </div>
        </div>
    );
};
