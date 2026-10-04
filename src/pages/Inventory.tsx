import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { DataService } from '../services/data';
import { inventorySync, type SyncStatus } from '../services/inventorySync';
import type { Product } from '../types';
import { Plus, Minus, CheckCircle2, Circle, Search, ArrowDownToLine, Cloud, CloudOff, RefreshCw, AlertTriangle, RotateCcw } from 'lucide-react';
import { Notification, type NotificationType } from '../components/Notification';

type SortMode = 'category' | 'date_asc' | 'alpha';

const SNAPSHOT_KEY = 'inventory_products_snapshot_v1';
const CHECKED_KEY = 'inventory_checked_v1';

const readJson = <T,>(key: string, fallback: T): T => {
    try {
        const raw = localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
        return fallback;
    }
};
const writeJson = (key: string, value: unknown) => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full */ }
};

/** Applies locally queued (not yet synced) counts on top of server/snapshot data. */
const overlayPending = (list: Product[]): Product[] => {
    const pending = inventorySync.getPending();
    return list.map(p => pending[p.id] ? { ...p, stock: pending[p.id].stock, lastCountedAt: pending[p.id].lastCountedAt } : p);
};

const timeLabel = (iso: string | null) =>
    iso ? new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '';

// ── Sync status pill ─────────────────────────────────────────────────────────

const SyncIndicator: React.FC<{ status: SyncStatus }> = ({ status }) => {
    const cfg = {
        idle:    { icon: Cloud,         bg: 'var(--color-success-bg)', fg: 'var(--color-success)', text: status.lastSyncedAt ? `Alles gespeichert · ${timeLabel(status.lastSyncedAt)} Uhr` : 'Alles gespeichert' },
        pending: { icon: RefreshCw,     bg: 'var(--color-surface-elevated)', fg: 'var(--color-text-muted)', text: `${status.pendingCount} Änderung${status.pendingCount === 1 ? '' : 'en'} wird gespeichert…` },
        syncing: { icon: RefreshCw,     bg: 'var(--color-surface-elevated)', fg: 'var(--color-primary)', text: 'Synchronisiere…' },
        offline: { icon: CloudOff,      bg: 'var(--color-warning-bg)', fg: '#c2410c', text: status.pendingCount > 0 ? `Offline – ${status.pendingCount} Zählung${status.pendingCount === 1 ? '' : 'en'} lokal gesichert, Sync folgt automatisch` : 'Offline – Zählungen werden lokal gesichert' },
        error:   { icon: AlertTriangle, bg: 'var(--color-danger-bg, #fef2f2)', fg: 'var(--color-danger)', text: `${status.failed.length} Zählung${status.failed.length === 1 ? '' : 'en'} konnte${status.failed.length === 1 ? '' : 'n'} nicht gespeichert werden` },
    }[status.state];
    const Icon = cfg.icon;

    return (
        <div role="status" aria-live="polite" style={{
            display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap',
            padding: '10px 14px', borderRadius: 'var(--radius-lg)', backgroundColor: cfg.bg, color: cfg.fg,
            fontSize: '13px', fontWeight: 600, border: '1px solid var(--color-border)',
        }}>
            <Icon size={16} style={{ flexShrink: 0, animation: status.state === 'syncing' ? 'spin 1s linear infinite' : undefined }} />
            <span style={{ flex: 1 }}>{cfg.text}</span>
            {status.state === 'error' && (
                <>
                    <span style={{ fontWeight: 400, fontSize: '12px', width: '100%', order: 3 }}>
                        {status.failed.map(f => f.productName).join(', ')} – {status.failed[0]?.lastError}
                    </span>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => inventorySync.retryFailed()}>Erneut versuchen</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => inventorySync.discardFailed()}>Verwerfen</button>
                </>
            )}
        </div>
    );
};

// ── Page ─────────────────────────────────────────────────────────────────────

export const Inventory: React.FC = () => {
    const [products, setProducts] = useState<Product[]>([]);
    const [checkedMap, setCheckedMap] = useState<Record<string, boolean>>(() => readJson(CHECKED_KEY, {}));
    const [searchTerm, setSearchTerm] = useState('');
    const [sortBy, setSortBy] = useState<SortMode>('category');
    const [notification, setNotification] = useState<{ message: string, type: NotificationType } | null>(null);
    const [syncStatus, setSyncStatus] = useState<SyncStatus>(inventorySync.getStatus());
    const [usingSnapshot, setUsingSnapshot] = useState(false);

    const loadProducts = useCallback(async () => {
        try {
            const data = await DataService.getProducts(true);
            writeJson(SNAPSHOT_KEY, data);
            setProducts(overlayPending(data));
            setUsingSnapshot(false);
        } catch (e) {
            console.error('Fehler beim Laden – nutze lokalen Stand', e);
            const snapshot = readJson<Product[]>(SNAPSHOT_KEY, []);
            setProducts(overlayPending(snapshot));
            setUsingSnapshot(true);
            if (snapshot.length === 0) {
                setNotification({ message: 'Keine Verbindung und kein lokaler Stand vorhanden. Bitte einmal online öffnen.', type: 'error' });
            }
        }
    }, []);

    useEffect(() => {
        inventorySync.start();
        const unsubscribe = inventorySync.subscribe(setSyncStatus);
        loadProducts();
        const onOnline = () => loadProducts();
        window.addEventListener('online', onOnline);
        return () => {
            unsubscribe();
            window.removeEventListener('online', onOnline);
            // The queue keeps running app-wide (started in Layout); push pending counts now.
            void inventorySync.flush();
        };
    }, [loadProducts]);

    // Persist counting progress so a reload / crash doesn't lose the checkmarks
    useEffect(() => { writeJson(CHECKED_KEY, checkedMap); }, [checkedMap]);

    // Keep the offline snapshot current with local edits
    useEffect(() => { if (products.length > 0) writeJson(SNAPSHOT_KEY, products); }, [products]);

    const handleUpdateStock = (product: Product, newStock: number) => {
        const stock = Number.isFinite(newStock) ? Math.max(0, newStock) : 0;
        const lastCountedAt = new Date().toISOString();
        // Optimistic UI – the sync queue persists + debounces the write
        setProducts(prev => prev.map(p => p.id === product.id ? { ...p, stock, lastCountedAt } : p));
        setCheckedMap(prev => ({ ...prev, [product.id]: true }));
        inventorySync.enqueue({ productId: product.id, productName: product.name, stock, lastCountedAt });
    };

    const handleToggleChecked = (id: string) => {
        const product = products.find(p => p.id === id);
        if (!product) return;
        if (!checkedMap[id]) {
            // Confirming the current value counts as a count → timestamp it
            handleUpdateStock(product, product.stock);
        } else {
            setCheckedMap(prev => ({ ...prev, [id]: false }));
        }
    };

    const handleResetSession = () => {
        if (!window.confirm('Zählfortschritt (Häkchen) zurücksetzen? Die gezählten Bestände bleiben gespeichert.')) return;
        setCheckedMap({});
    };

    // Derived data
    const filteredProducts = useMemo(() => {
        const term = searchTerm.toLowerCase();
        return products.filter(p =>
            p.name.toLowerCase().includes(term) ||
            (p.category || '').toLowerCase().includes(term)
        );
    }, [products, searchTerm]);

    const categories = useMemo(
        () => Array.from(new Set(filteredProducts.map(p => p.category || 'Sonstiges'))).sort(),
        [filteredProducts]
    );
    const totalCounted = products.filter(p => checkedMap[p.id]).length;
    const progress = products.length === 0 ? 0 : Math.round((totalCounted / products.length) * 100);

    const renderProduct = (product: Product) => {
        const isChecked = checkedMap[product.id];
        const isPending = !!inventorySync.getPending()[product.id];
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
                        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-faint)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            Gezählt: {new Date(product.lastCountedAt).toLocaleDateString('de-DE')} um {timeLabel(product.lastCountedAt)} Uhr
                            {isPending && (
                                <span title="Noch nicht mit dem Server synchronisiert" style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', color: '#c2410c', fontWeight: 600 }}>
                                    <CloudOff size={12} /> lokal
                                </span>
                            )}
                        </span>
                    )}
                </div>

                {/* Right: Controls & Checkmark */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'nowrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--color-border-strong)', borderRadius: 'var(--radius-md)', overflow: 'hidden', backgroundColor: 'var(--color-surface)' }}>
                        <button
                            type="button"
                            aria-label={`${product.name} verringern`}
                            onClick={() => handleUpdateStock(product, product.stock - 1)}
                            style={{ width: '44px', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', backgroundColor: 'var(--color-surface-elevated)', cursor: 'pointer', borderRight: '1px solid var(--color-border-strong)', color: 'var(--color-text-secondary)' }}
                        >
                            <Minus size={20} />
                        </button>
                        <input
                            type="number"
                            inputMode="decimal"
                            min={0}
                            aria-label={`Bestand ${product.name}`}
                            value={product.stock}
                            onFocus={(e) => e.target.select()}
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
                            aria-label={`${product.name} erhöhen`}
                            onClick={() => handleUpdateStock(product, product.stock + 1)}
                            style={{ width: '44px', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', backgroundColor: 'var(--color-surface-elevated)', cursor: 'pointer', borderLeft: '1px solid var(--color-border-strong)', color: 'var(--color-text-secondary)' }}
                        >
                            <Plus size={20} />
                        </button>
                    </div>

                    <div style={{ width: '1px', height: '30px', backgroundColor: 'var(--color-border)', margin: '0 4px' }}></div>

                    <button
                        type="button"
                        aria-label={isChecked ? 'Als ungezählt markieren' : 'Als gezählt markieren'}
                        onClick={() => handleToggleChecked(product.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex', color: isChecked ? 'var(--color-success)' : 'var(--color-text-faint)' }}
                    >
                        {isChecked ? <CheckCircle2 size={32} /> : <Circle size={32} />}
                    </button>
                </div>
            </div>
        );
    };

    const sortedProducts = useMemo(() => [...filteredProducts].sort((a, b) => {
        if (sortBy === 'alpha') return a.name.localeCompare(b.name);
        const timeA = a.lastCountedAt ? new Date(a.lastCountedAt).getTime() : 0;
        const timeB = b.lastCountedAt ? new Date(b.lastCountedAt).getTime() : 0;
        return timeA - timeB;
    }), [filteredProducts, sortBy]);

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
                    Tippe direkt auf die Zahlen, um sie zu überschreiben. Jede Zählung wird <b>sofort auf dem Gerät gesichert</b> und automatisch synchronisiert – auch wenn im Keller oder Kühlraum kurz kein Netz ist.
                </p>

                <SyncIndicator status={syncStatus} />

                {usingSnapshot && (
                    <div style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>
                        Angezeigt wird der zuletzt geladene Stand dieses Geräts. Neue Produkte erscheinen, sobald wieder eine Verbindung besteht.
                    </div>
                )}

                {/* Progress Bar */}
                <div className="card" style={{ padding: '16px', marginTop: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', fontSize: 'var(--font-size-sm)', fontWeight: 600, gap: '8px', flexWrap: 'wrap' }}>
                        <span>Fortschritt</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <span style={{ color: 'var(--color-text-muted)' }}>{totalCounted} von {products.length} Produkten gezählt ({progress}%)</span>
                            {totalCounted > 0 && (
                                <button type="button" className="btn btn-ghost btn-sm" onClick={handleResetSession} title="Häkchen für eine neue Inventur zurücksetzen">
                                    <RotateCcw size={13} /> Neue Zählung
                                </button>
                            )}
                        </span>
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
                    onChange={e => setSortBy(e.target.value as SortMode)}
                    className="input-field"
                    style={{ flex: '0 0 auto' }}
                >
                    <option value="category">Nach Kategorie gruppiert</option>
                    <option value="date_asc">Am längsten nicht gezählt</option>
                    <option value="alpha">Alphabetisch (A-Z)</option>
                </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
                {sortBy === 'category'
                    ? categories.map(category => {
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
                    })
                    : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {sortedProducts.map(renderProduct)}
                        </div>
                    )}

                {filteredProducts.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--color-text-muted)' }}>
                        Keine Produkte für die Zählung gefunden.
                    </div>
                )}
            </div>
        </div>
    );
};
