import React, { useState, useEffect, useRef } from 'react';
import { DataService } from '../services/data';
import type { Product } from '../types';
import { Plus, Minus, CheckCircle2, Circle, Search, ArrowDownToLine } from 'lucide-react';
import { Notification, type NotificationType } from '../components/Notification';

export const Inventory: React.FC = () => {
    const [products, setProducts] = useState<Product[]>([]);
    const [checkedMap, setCheckedMap] = useState<Record<string, boolean>>({});
    const [searchTerm, setSearchTerm] = useState('');
    const [notification, setNotification] = useState<{ message: string, type: NotificationType } | null>(null);
    
    const pendingSavesRef = useRef<Record<string, Product>>({});
    const saveTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

    useEffect(() => {
        loadProducts();
        
        return () => {
            // Flush any pending saves immediately when navigating away
            Object.values(pendingSavesRef.current).forEach(p => {
                DataService.saveProduct(p).catch(console.error);
            });
        };
    }, []);

    const loadProducts = async () => {
        try {
            const data = await DataService.getProducts();
            setProducts(data);
        } catch (e) {
            console.error('Fehler beim Laden', e);
        }
    };

    const handleUpdateStock = (product: Product, newStock: number) => {
        if (newStock < 0) newStock = 0;
        
        // Optimistic UI Update immediately
        const updatedProduct = { ...product, stock: newStock };
        setProducts(prev => prev.map(p => p.id === product.id ? updatedProduct : p));
        setCheckedMap(prev => ({ ...prev, [product.id]: true }));

        // Store for unmount flushing
        pendingSavesRef.current[product.id] = updatedProduct;

        // Clear existing timeout for this product and set new one (Debounce)
        if (saveTimeoutsRef.current[product.id]) {
            clearTimeout(saveTimeoutsRef.current[product.id]);
        }
        
        saveTimeoutsRef.current[product.id] = setTimeout(async () => {
            try {
                await DataService.saveProduct(updatedProduct);
                delete pendingSavesRef.current[product.id]; // Remove from pending queue
                setNotification({ message: 'Erfolgreich gespeichert: ' + updatedProduct.stock, type: 'success' });
            } catch (e) {
                console.error('Save failed', e);
                setNotification({ message: 'Speichern fehlgeschlagen', type: 'error' });
            }
        }, 600); // 600ms latency to allow fast typing before saving
    };

    const handleToggleChecked = (id: string) => {
        setCheckedMap(prev => ({ ...prev, [id]: !prev[id] }));
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
                <h2 style={{ fontSize: 'var(--font-size-2xl)', margin: 0, display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--color-text-main)' }}>
                    <ArrowDownToLine size={28} color="var(--color-primary)" />
                    Inventur-Zählung
                </h2>
                <p style={{ color: 'var(--color-text-muted)', margin: 0, fontSize: '15px' }}>
                    Tippe direkt auf die Zahlen, um sie zu überschreiben. Jeder Tipp wird <b>sofort live gespeichert</b>, sodass bei einem Tablet-Absturz keine Zahlen verloren gehen!
                </p>

                {/* Progress Bar */}
                <div style={{ backgroundColor: 'white', padding: '16px', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', border: '1px solid var(--color-border)', marginTop: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '14px', fontWeight: 600 }}>
                        <span>Fortschritt</span>
                        <span>{totalCounted} von {products.length} Produkten gezählt ({progress}%)</span>
                    </div>
                    <div style={{ height: '8px', backgroundColor: '#e2e8f0', borderRadius: '4px', overflow: 'hidden' }}>
                        <div style={{ width: `${progress}%`, height: '100%', backgroundColor: progress === 100 ? '#10b981' : 'var(--color-primary)', transition: 'width 0.3s ease' }}></div>
                    </div>
                </div>
            </div>

            <div style={{ position: 'relative', marginBottom: 'var(--spacing-xl)' }}>
                <Search size={22} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                <input
                    type="text"
                    placeholder="Suchen nach Namen oder Kategorien..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    style={{
                        width: '100%', padding: '16px 16px 16px 50px', borderRadius: 'var(--radius-lg)',
                        border: '1px solid var(--color-border)', fontSize: '16px', backgroundColor: 'white',
                        boxShadow: 'var(--shadow-sm)', outline: 'none'
                    }}
                />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
                {categories.map(category => {
                    const categoryProducts = filteredProducts.filter(p => (p.category || 'Sonstiges') === category);
                    if (categoryProducts.length === 0) return null;

                    return (
                        <div key={category}>
                            <h3 style={{ 
                                fontSize: '18px', margin: '0 0 12px 0', padding: '4px 8px', color: '#475569', 
                                borderBottom: '2px solid #e2e8f0', display: 'flex', justifyContent: 'space-between'
                            }}>
                                {category}
                                <span style={{ fontSize: '14px', fontWeight: 'normal', color: '#94a3b8' }}>
                                    {categoryProducts.filter(p => checkedMap[p.id]).length} / {categoryProducts.length}
                                </span>
                            </h3>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {categoryProducts.map(product => {
                                    const isChecked = checkedMap[product.id];
                                    return (
                                        <div key={product.id} style={{ 
                                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                            padding: '12px 16px', backgroundColor: isChecked ? '#f0fdf4' : 'white',
                                            borderRadius: 'var(--radius-lg)', boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                                            border: `1px solid ${isChecked ? '#bbf7d0' : 'var(--color-border)'}`,
                                            transition: 'all 0.2s ease', gap: '16px', flexWrap: 'wrap'
                                        }}>
                                            
                                            {/* Left: Info */}
                                            <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 200px' }}>
                                                <span style={{ fontSize: '16px', fontWeight: 600, color: 'var(--color-text-main)', lineHeight: 1.2 }}>{product.name}</span>
                                                {product.productNumber && (
                                                    <span style={{ fontSize: '12px', color: '#94a3b8' }}>Art: {product.productNumber}</span>
                                                )}
                                                <span style={{ fontSize: '13px', color: '#64748b', marginTop: '4px' }}>Einheit: {product.unit}</span>
                                            </div>

                                            {/* Right: Controls & Checkmark */}
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'nowrap' }}>
                                                
                                                {/* Quantity Controls */}
                                                <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #cbd5e1', borderRadius: '8px', overflow: 'hidden', backgroundColor: 'white' }}>
                                                    <button 
                                                        type="button"
                                                        onClick={() => handleUpdateStock(product, product.stock - 1)}
                                                        style={{ width: '44px', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', backgroundColor: '#f1f5f9', cursor: 'pointer', borderRight: '1px solid #cbd5e1', color: '#1e293b' }}
                                                    >
                                                        <Minus size={22} color="#1e293b" />
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
                                                        style={{ width: '44px', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', backgroundColor: '#f1f5f9', cursor: 'pointer', borderLeft: '1px solid #cbd5e1', color: '#1e293b' }}
                                                    >
                                                        <Plus size={22} color="#1e293b" />
                                                    </button>
                                                </div>

                                                <div style={{ width: '1px', height: '30px', backgroundColor: '#e2e8f0', margin: '0 8px' }}></div>

                                                {/* Checkmark Button */}
                                                <button 
                                                    type="button"
                                                    onClick={() => handleToggleChecked(product.id)}
                                                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex', color: isChecked ? '#22c55e' : '#94a3b8' }}
                                                >
                                                    {isChecked ? <CheckCircle2 size={32} /> : <Circle size={32} />}
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}

                {filteredProducts.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '40px 20px', color: '#64748b' }}>
                        Keine Produkte für die Zählung gefunden.
                    </div>
                )}
            </div>
        </div>
    );
};
