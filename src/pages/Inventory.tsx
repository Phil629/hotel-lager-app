import React, { useState, useEffect } from 'react';
import { DataService } from '../services/data';
import type { Product } from '../types';
import { Plus, Minus, CheckCircle2, Circle, Search, ArrowDownToLine } from 'lucide-react';
import { Notification, type NotificationType } from '../components/Notification';

export const Inventory: React.FC = () => {
    const [products, setProducts] = useState<Product[]>([]);
    const [checkedMap, setCheckedMap] = useState<Record<string, boolean>>({});
    const [searchTerm, setSearchTerm] = useState('');
    const [sortBy, setSortBy] = useState<'category' | 'date_asc' | 'alpha'>('category');
    const [notification, setNotification] = useState<{ message: string, type: NotificationType } | null>(null);
    
    useEffect(() => {
        loadProducts();
    }, []);

    const loadProducts = async () => {
        try {
            const data = await DataService.getProducts();
            setProducts(data);
        } catch (e) {
            console.error('Fehler beim Laden', e);
        }
    };

    const handleUpdateStock = async (product: Product, newStock: number) => {
        if (newStock < 0) newStock = 0;
        
        // Optimistic UI Update immediately
        const updatedProduct = { ...product, stock: newStock, lastCountedAt: new Date().toISOString() };
        setProducts(prev => prev.map(p => p.id === product.id ? updatedProduct : p));
        setCheckedMap(prev => ({ ...prev, [product.id]: true }));

        try {
            await DataService.saveProduct(updatedProduct);
            setNotification({ message: 'Gespeichert: ' + updatedProduct.stock, type: 'success' });
        } catch (e) {
            console.error('Save failed', e);
            setNotification({ message: 'Speichern fehlgeschlagen', type: 'error' });
        }
    };

    const handleToggleChecked = async (id: string) => {
        const product = products.find(p => p.id === id);
        if (!product) return;
        
        const isCurrentlyChecked = checkedMap[id];
        
        if (!isCurrentlyChecked) {
            const updatedProduct = { ...product, lastCountedAt: new Date().toISOString() };
            setProducts(prev => prev.map(p => p.id === id ? updatedProduct : p));
            setCheckedMap(prev => ({ ...prev, [id]: true }));
            try {
                await DataService.saveProduct(updatedProduct);
            } catch (e) {
                console.error('Failed to save timestamp on check', e);
            }
        } else {
            setCheckedMap(prev => ({ ...prev, [id]: false }));
        }
    };

    // Derived data
    const filteredProducts = products.filter(p => 
        p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
        (p.category || '').toLowerCase().includes(searchTerm.toLowerCase())
    );

    const categories = Array.from(new Set(filteredProducts.map(p => p.category || 'Sonstiges'))).sort();
    const totalCounted = Object.values(checkedMap).filter(Boolean).length;
    const progress = products.length === 0 ? 0 : Math.round((totalCounted / products.length) * 100);

    return (
        <div style={{ maxWidth: '1000px', margin: '0 auto', paddingBottom: '100px' }}>
            {notification && (
                <Notification message={notification.message} type={notification.type} onClose={() => setNotification(null)} />
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)', marginBottom: 'var(--spacing-2xl)' }}>
                <h2 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <ArrowDownToLine size={26} color="var(--color-primary)" />
                    Inventur-Zählung
                </h2>
                <p style={{ color: 'var(--color-text-muted)', margin: 0, fontSize: '15px' }}>
                    Tippe direkt auf die Zahlen, um sie zu überschreiben. Jeder Tipp wird <b>sofort live gespeichert</b>, sodass bei einem Tablet-Absturz keine Zahlen verloren gehen!
                </p>

                {/* Progress Bar */}
                <div className="card" style={{ padding: '16px', marginTop: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>
                        <span>Fortschritt</span>
                        <span style={{ color: 'var(--color-text-muted)' }}>{totalCounted} von {products.length} Produkten gezählt ({progress}%)</span>
                    </div>
                    <div style={{ height: '8px', backgroundColor: 'var(--color-border)', borderRadius: 'var(--radius-full)', overflow: 'hidden' }}>
                        <div style={{ width: `${progress}%`, height: '100%', backgroundColor: progress === 100 ? 'var(--color-success)' : 'var(--color-primary)', transition: 'width 0.3s ease' }}></div>
                    </div>
                </div>
            </div>

            <div style={{ display: 'flex', gap: 'var(--spacing-md)', marginBottom: 'var(--spacing-xl)', flexWrap: 'wrap' }}>
                <div style={{ position: 'relative', flex: '1 1 300px' }}>
                    <Search size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-faint)', pointerEvents: 'none' }} />
                    <input
                        type="text"
                        placeholder="Suchen nach Namen oder Kategorien..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="input-field"
                        style={{ paddingLeft: '42px', fontSize: '15px' }}
                    />
                </div>
                <select
                    value={sortBy}
                    onChange={e => setSortBy(e.target.value as any)}
                    className="input-field"
                    style={{ flex: '0 0 auto' }}
                >
                    <option value="category">Nach Kategorie gruppiert</option>
                    <option value="date_asc">Am längsten nicht gezählt</option>
                    <option value="alpha">Alphabetisch (A-Z)</option>
                </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
                {(() => {
                    const renderProduct = (product: Product) => {
                        const isChecked = checkedMap[product.id];
                        return (
                            <div key={product.id} style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                padding: '12px 16px',
                                backgroundColor: isChecked ? 'var(--color-success-bg)' : 'var(--color-surface)',
                                borderRadius: 'var(--radius-lg)',
                                boxShadow: 'var(--shadow-xs)',
                                border: `1px solid ${isChecked ? '#bbf7d0' : 'var(--color-border)'}`,
                                transition: 'all 0.2s ease', gap: '16px', flexWrap: 'wrap'
                            }}>
                                {/* Left: Info */}
                                <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 200px' }}>
                                    <span style={{ fontSize: 'var(--font-size-base)', fontWeight: 600, color: 'var(--color-text-main)', lineHeight: 1.2 }}>{product.name}</span>
                                    {product.productNumber && (
                                        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-faint)' }}>Art: {product.productNumber}</span>
                                    )}
                                    <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginTop: '4px' }}>Einheit: {product.unit}</span>
                                    {product.lastCountedAt && (
                                        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-faint)', marginTop: '4px' }}>
                                            Gezählt: {new Date(product.lastCountedAt).toLocaleDateString('de-DE')} um {new Date(product.lastCountedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr
                                        </span>
                                    )}
                                </div>

                                {/* Right: Controls & Checkmark */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'nowrap' }}>
                                    {/* Quantity Controls */}
                                    <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--color-border-strong)', borderRadius: 'var(--radius-md)', overflow: 'hidden', backgroundColor: 'var(--color-surface)' }}>
                                        <button
                                            type="button"
                                            onClick={() => handleUpdateStock(product, product.stock - 1)}
                                            style={{ width: '44px', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', backgroundColor: 'var(--color-surface-elevated)', cursor: 'pointer', borderRight: '1px solid var(--color-border-strong)', color: 'var(--color-text-secondary)' }}
                                        >
                                            <Minus size={20} />
                                        </button>
                                        <input
                                            type="number"
                                            value={product.stock}
                                            onChange={(e) => {
                                                const val = e.target.value === '' ? 0 : parseFloat(e.target.value);
                                                handleUpdateStock(product, val);
                                            }}
                                            style={{
                                                width: '60px', height: '44px', textAlign: 'center', fontSize: '18px', fontWeight: 700,
                                                border: 'none', backgroundColor: 'transparent', outline: 'none', color: 'var(--color-text-main)',
                                                appearance: 'none', MozAppearance: 'textfield'
                                            }}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => handleUpdateStock(product, product.stock + 1)}
                                            style={{ width: '44px', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', backgroundColor: 'var(--color-surface-elevated)', cursor: 'pointer', borderLeft: '1px solid var(--color-border-strong)', color: 'var(--color-text-secondary)' }}
                                        >
                                            <Plus size={20} />
                                        </button>
                                    </div>

                                    <div style={{ width: '1px', height: '30px', backgroundColor: 'var(--color-border)', margin: '0 4px' }}></div>

                                    {/* Checkmark Button */}
                                    <button
                                        type="button"
                                        onClick={() => handleToggleChecked(product.id)}
                                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex', color: isChecked ? 'var(--color-success)' : 'var(--color-text-faint)' }}
                                    >
                                        {isChecked ? <CheckCircle2 size={32} /> : <Circle size={32} />}
                                    </button>
                                </div>
                            </div>
                        );
                    };

                    if (sortBy === 'category') {
                        return categories.map(category => {
                            const categoryProducts = filteredProducts.filter(p => (p.category || 'Sonstiges') === category);
                            if (categoryProducts.length === 0) return null;

                            return (
                                <div key={category}>
                                    <h3 style={{
                                        fontSize: 'var(--font-size-base)', margin: '0 0 12px 0', padding: '4px 0',
                                        color: 'var(--color-text-secondary)', fontWeight: 700,
                                        borderBottom: '2px solid var(--color-border)', display: 'flex', justifyContent: 'space-between',
                                        textTransform: 'uppercase', letterSpacing: '0.05em'
                                    }}>
                                        {category}
                                        <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'normal', color: 'var(--color-text-faint)' }}>
                                            {categoryProducts.filter(p => checkedMap[p.id]).length} / {categoryProducts.length}
                                        </span>
                                    </h3>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        {categoryProducts.map(renderProduct)}
                                    </div>
                                </div>
                            );
                        });
                    }

                    // For 'date_asc' or 'alpha', we just map a sorted list
                    const sorted = [...filteredProducts].sort((a, b) => {
                        if (sortBy === 'alpha') {
                            return a.name.localeCompare(b.name);
                        } else {
                            // date_asc (Oldest first)
                            const timeA = a.lastCountedAt ? new Date(a.lastCountedAt).getTime() : 0;
                            const timeB = b.lastCountedAt ? new Date(b.lastCountedAt).getTime() : 0;
                            return timeA - timeB;
                        }
                    });

                    return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {sorted.map(renderProduct)}
                        </div>
                    );

                })()}

                {filteredProducts.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--color-text-muted)' }}>
                        Keine Produkte für die Zählung gefunden.
                    </div>
                )}
            </div>
        </div>
    );
};
