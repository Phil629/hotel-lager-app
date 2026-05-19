import React, { useState } from 'react';
import { X, Phone, Copy, Check, AlertTriangle, Package, User } from 'lucide-react';
import type { Supplier, Order, Product } from '../types';

function CopyField({ label, value }: { label: string; value: string }) {
    const [copied, setCopied] = useState(false);
    return (
        <div>
            <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>
                {label}
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch' }}>
                <div style={{ flex: 1, padding: '10px 16px', backgroundColor: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: '20px', fontWeight: 700, color: 'var(--color-text-main)', letterSpacing: '0.03em', userSelect: 'all' as const }}>
                    {value}
                </div>
                <button
                    onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                    title="In Zwischenablage kopieren"
                    style={{ padding: '0 16px', border: `1px solid ${copied ? 'var(--color-success)' : 'var(--color-border)'}`, borderRadius: 'var(--radius-md)', backgroundColor: copied ? 'var(--color-success-bg)' : 'var(--color-surface)', color: copied ? '#16a34a' : 'var(--color-text-muted)', cursor: 'pointer', transition: 'all 0.2s', flexShrink: 0, display: 'flex', alignItems: 'center' }}
                >
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                </button>
            </div>
        </div>
    );
}

interface PhoneCallPanelProps {
    mode: 'order' | 'defect';
    supplier: Supplier | null;
    supplierPhone?: string;
    supplierName?: string;
    order?: Order;
    lowStockProducts?: { product: Product; suggestedQty: number }[];
    onClose: () => void;
}

export const PhoneCallPanel: React.FC<PhoneCallPanelProps> = ({
    mode,
    supplier,
    supplierPhone,
    supplierName,
    order,
    lowStockProducts = [],
    onClose,
}) => {
    const [callNote, setCallNote] = useState('');

    const phone = supplier?.orderPhone || supplier?.phone || supplierPhone || '';
    const name = supplier?.name || supplierName || '—';
    const customerNumber = supplier?.customerNumber || '';
    const contactName = supplier?.contactName || '';
    const relevantNotes = mode === 'order'
        ? (supplier?.notes || []).filter(n => n.showOnOrderCreation)
        : (supplier?.notes || []).filter(n => n.showOnOpenOrders);

    return (
        <div className="modal-overlay">
            <div className="modal-box" style={{ maxWidth: '500px' }}>
                <div className="modal-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: '#dcfce7', color: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <Phone size={19} />
                        </div>
                        <div>
                            <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                {mode === 'order' ? 'Telefonbestellung' : 'Mängelrüge per Telefon'}
                            </div>
                            <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: 'var(--color-text-main)' }}>{name}</h2>
                        </div>
                    </div>
                    <button onClick={onClose} className="btn btn-ghost btn-icon"><X size={20} /></button>
                </div>

                <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

                    {/* Phone number */}
                    {phone ? (
                        <CopyField label="Rufnummer" value={phone} />
                    ) : (
                        <div style={{ padding: '12px 14px', backgroundColor: 'var(--color-warning-bg)', border: '1px solid #fcd34d', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-sm)', color: '#92400e' }}>
                            Keine Telefonnummer hinterlegt. Bitte in den Lieferanten-Stammdaten ergänzen.
                        </div>
                    )}

                    {/* Customer number */}
                    {customerNumber && <CopyField label="Kundennummer" value={customerNumber} />}

                    {/* Contact person */}
                    {contactName && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', backgroundColor: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
                            <User size={15} color="var(--color-text-muted)" style={{ flexShrink: 0 }} />
                            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>Ansprechpartner:</span>
                            <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text-main)' }}>{contactName}</span>
                        </div>
                    )}

                    {/* Defect order details */}
                    {mode === 'defect' && order && (
                        <div>
                            <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <AlertTriangle size={12} color="#f59e0b" /> Betroffene Bestellung
                            </div>
                            <div style={{ padding: '14px', backgroundColor: 'var(--color-warning-bg)', border: '1px solid #fcd34d', borderRadius: 'var(--radius-md)' }}>
                                <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--color-text-main)', marginBottom: '8px' }}>{order.productName}</div>
                                <div style={{ display: 'flex', gap: '20px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', flexWrap: 'wrap' }}>
                                    <span>Menge: <strong style={{ color: 'var(--color-text-main)' }}>{order.quantity}</strong></span>
                                    <span>Bestellt: <strong style={{ color: 'var(--color-text-main)' }}>{new Date(order.date).toLocaleDateString('de-DE')}</strong></span>
                                    {order.orderNumber && (
                                        <span>Bestellnr.: <strong style={{ color: 'var(--color-text-main)' }}>{order.orderNumber}</strong></span>
                                    )}
                                </div>
                                {order.defectNotes && (
                                    <div style={{ marginTop: '10px', padding: '8px 10px', backgroundColor: 'rgba(249,115,22,0.1)', border: '1px solid rgba(249,115,22,0.3)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-sm)', color: '#c2410c' }}>
                                        <strong>Mangelbeschreibung:</strong> {order.defectNotes}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Low-stock products (order mode) */}
                    {mode === 'order' && (
                        <div>
                            <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Package size={12} /> Zu bestellende Artikel
                            </div>
                            {lowStockProducts.length === 0 ? (
                                <div style={{ padding: '12px 14px', backgroundColor: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', textAlign: 'center' }}>
                                    Alle Bestände über dem Meldebestand.
                                </div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                    {lowStockProducts.map(({ product, suggestedQty }) => (
                                        <div key={product.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', backgroundColor: product.stock <= 0 ? 'var(--color-danger-bg)' : 'var(--color-warning-bg)', border: `1px solid ${product.stock <= 0 ? '#fca5a5' : '#fcd34d'}`, borderRadius: 'var(--radius-md)' }}>
                                            <div>
                                                <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text-main)' }}>{product.name}</div>
                                                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                                                    Bestand: <span style={{ color: product.stock <= 0 ? 'var(--color-danger)' : 'var(--color-warning)', fontWeight: 600 }}>{product.stock} {product.unit}</span>
                                                    {product.minStock !== undefined && ` · Min: ${product.minStock}`}
                                                </div>
                                            </div>
                                            <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: '16px' }}>
                                                <div style={{ fontSize: '22px', fontWeight: 700, color: 'var(--color-primary)', lineHeight: 1 }}>{suggestedQty}</div>
                                                <div style={{ fontSize: '10px', color: 'var(--color-text-muted)', marginTop: '2px' }}>{product.unit} bestellen</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Supplier notes */}
                    {relevantNotes.length > 0 && (
                        <div>
                            <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>Hinweise</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                {relevantNotes.map(note => (
                                    <div key={note.id} style={{ padding: '10px 12px', backgroundColor: '#fef9c3', border: '1px solid #fde047', borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-sm)', color: '#713f12' }}>
                                        {note.text}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Ephemeral call note */}
                    <div>
                        <label style={{ fontSize: 'var(--font-size-xs)', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: '6px' }}>
                            Gesprächsnotiz
                        </label>
                        <textarea
                            value={callNote}
                            onChange={e => setCallNote(e.target.value)}
                            placeholder="Notizen während des Gesprächs..."
                            rows={3}
                            style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text-main)', fontSize: 'var(--font-size-sm)', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }}
                        />
                    </div>

                </div>

                <div className="modal-footer">
                    <button onClick={onClose} className="btn btn-secondary">Schließen</button>
                </div>
            </div>
        </div>
    );
};
