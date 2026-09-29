import React from 'react';
import { AlertTriangle, X } from 'lucide-react';
import type { Order, Product } from '../../types';

interface DefectModalProps {
    order: Order | null;
    orderOptions: Order[] | null;
    defectNotes: string;
    setDefectNotes: (notes: string) => void;
    modalDefectResolved: boolean;
    setModalDefectResolved: (resolved: boolean) => void;
    defectAdjustStock: boolean;
    setDefectAdjustStock: (adjust: boolean) => void;
    defectUsableQty: number | '';
    setDefectUsableQty: (qty: number | '') => void;
    onSelectOrder: (order: Order) => void;
    onClose: () => void;
    onSave: () => void;
    products: Product[];
}

export const DefectModal: React.FC<DefectModalProps> = ({
    order,
    orderOptions,
    defectNotes,
    setDefectNotes,
    modalDefectResolved,
    setModalDefectResolved,
    defectAdjustStock,
    setDefectAdjustStock,
    defectUsableQty,
    setDefectUsableQty,
    onSelectOrder,
    onClose,
    onSave,
    products,
}) => {
    if (!order) return null;

    const isAll = order.id === 'ALL';
    const product = !isAll ? products.find(p => p.name === order.productName) : null;
    const isOpen = order.status === 'open';
    const usable = defectUsableQty === '' ? order.quantity : Number(defectUsableQty);
    const stockDelta = isOpen ? usable : usable - order.quantity;
    const newStock = product ? Math.max(0, product.stock + stockDelta) : 0;
    const belowMin = product && product.minStock !== undefined && newStock < product.minStock;

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 1200
        }}>
            <div style={{
                backgroundColor: 'var(--color-surface)',
                padding: 'var(--spacing-xl)',
                borderRadius: 'var(--radius-lg)',
                width: '100%',
                maxWidth: '500px',
                boxShadow: 'var(--shadow-lg)'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-md)' }}>
                    <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
                        <AlertTriangle size={24} color="#ff9800" />
                        Mangel melden
                    </h3>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                        <X size={24} />
                    </button>
                </div>

                {orderOptions && orderOptions.length > 1 ? (
                    <div style={{ marginBottom: 'var(--spacing-md)' }}>
                        <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>
                            Produkt auswählen
                        </label>
                        <select
                            value={order.id}
                            onChange={e => {
                                if (e.target.value === 'ALL') {
                                    onSelectOrder({ id: 'ALL', productName: 'Alle Produkte der Lieferung', quantity: 0 } as any);
                                } else {
                                    const selected = orderOptions.find(o => o.id === e.target.value);
                                    if (selected) {
                                        onSelectOrder(selected);
                                    }
                                }
                            }}
                            style={{
                                width: '100%',
                                padding: 'var(--spacing-sm)',
                                borderRadius: 'var(--radius-sm)',
                                border: '1px solid var(--color-border)',
                                fontSize: 'var(--font-size-sm)'
                            }}
                        >
                            <option value="ALL">Alle Produkte der Lieferung</option>
                            {orderOptions.map(o => (
                                <option key={o.id} value={o.id}>{o.productName} ({o.quantity}x)</option>
                            ))}
                        </select>
                    </div>
                ) : (
                    <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--spacing-md)' }}>
                        Produkt: <strong>{order.productName}</strong>
                    </p>
                )}

                <div style={{ marginBottom: 'var(--spacing-md)' }}>
                    <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>
                        Mangelbeschreibung
                    </label>
                    <textarea
                        value={defectNotes}
                        onChange={e => setDefectNotes(e.target.value)}
                        placeholder="Beschreiben Sie den Mangel..."
                        rows={4}
                        style={{
                            width: '100%',
                            padding: 'var(--spacing-sm)',
                            borderRadius: 'var(--radius-sm)',
                            border: '1px solid var(--color-border)',
                            fontFamily: 'inherit',
                            fontSize: 'var(--font-size-sm)',
                            resize: 'vertical'
                        }}
                    />
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: 'var(--spacing-sm)', cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={modalDefectResolved}
                            onChange={e => setModalDefectResolved(e.target.checked)}
                            style={{ width: '16px', height: '16px' }}
                        />
                        <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>Mangel ist erledigt</span>
                    </label>
                </div>

                {/* Stock adjustment section — hidden for "ALL" grouped orders */}
                {!isAll && product && (
                    <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 'var(--spacing-md)', marginBottom: 'var(--spacing-md)' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', marginBottom: defectAdjustStock ? 'var(--spacing-md)' : 0 }}>
                            <input
                                type="checkbox"
                                checked={defectAdjustStock}
                                onChange={e => {
                                    setDefectAdjustStock(e.target.checked);
                                    if (e.target.checked && defectUsableQty === '') setDefectUsableQty(order.quantity);
                                }}
                                style={{ width: '18px', height: '18px', cursor: 'pointer', flexShrink: 0 }}
                            />
                            <div>
                                <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text-main)' }}>Lagerbestand direkt korrigieren</span>
                                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginLeft: '6px' }}>optional</span>
                            </div>
                        </label>
                        {defectAdjustStock && (
                            <div style={{ backgroundColor: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--spacing-md)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                <div style={{ display: 'flex', gap: '16px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', flexWrap: 'wrap' }}>
                                    <span>Bestellmenge: <strong style={{ color: 'var(--color-text-main)' }}>{order.quantity} {product.unit}</strong></span>
                                    <span>Aktueller Bestand: <strong style={{ color: 'var(--color-text-main)' }}>{product.stock} {product.unit}</strong></span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <label style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500, whiteSpace: 'nowrap', flexShrink: 0 }}>
                                        Tatsächlich verwendbar:
                                    </label>
                                    <input
                                        type="number"
                                        value={defectUsableQty}
                                        onChange={e => setDefectUsableQty(e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value) || 0))}
                                        min={0}
                                        style={{ width: '80px', padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontSize: 'var(--font-size-sm)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text-main)', textAlign: 'right' }}
                                    />
                                    <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>{product.unit}</span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', backgroundColor: belowMin ? 'var(--color-warning-bg)' : 'var(--color-success-bg)', border: `1px solid ${belowMin ? '#fcd34d' : 'var(--color-success)'}`, borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-sm)' }}>
                                    <span style={{ color: 'var(--color-text-muted)' }}>
                                        {isOpen
                                            ? `+${usable} ${product.unit} werden auf Lager gebucht`
                                            : stockDelta >= 0
                                                ? `+${stockDelta} ${product.unit} Korrektur`
                                                : `${stockDelta} ${product.unit} werden abgezogen`
                                        }
                                    </span>
                                    <strong style={{ color: 'var(--color-text-main)' }}>→ {newStock} {product.unit}</strong>
                                </div>
                                {isOpen && (
                                    <div style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
                                        Die Bestellung wird gleichzeitig als erhalten markiert.
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                <div style={{ display: 'flex', gap: 'var(--spacing-sm)', justifyContent: 'flex-end' }}>
                    <button
                        onClick={onClose}
                        style={{
                            padding: 'var(--spacing-sm) var(--spacing-md)',
                            borderRadius: 'var(--radius-md)',
                            border: '1px solid var(--color-border)',
                            backgroundColor: 'var(--color-surface)',
                            color: 'var(--color-text-main)',
                            cursor: 'pointer'
                        }}
                    >
                        Abbrechen
                    </button>
                    <button
                        onClick={onSave}
                        disabled={!defectNotes.trim()}
                        style={{
                            padding: 'var(--spacing-sm) var(--spacing-md)',
                            borderRadius: 'var(--radius-md)',
                            border: 'none',
                            backgroundColor: defectNotes.trim() ? '#ff9800' : '#ccc',
                            color: 'white',
                            cursor: defectNotes.trim() ? 'pointer' : 'not-allowed'
                        }}
                    >
                        {defectAdjustStock ? 'Mangel & Bestand speichern' : 'Mangel speichern'}
                    </button>
                </div>
            </div>
        </div>
    );
};
