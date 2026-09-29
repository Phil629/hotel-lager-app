import React from 'react';
import { Calendar, X } from 'lucide-react';
import type { Order } from '../../types';

interface DeliveryDateModalProps {
    order: Order | null;
    orders: Order[] | null;
    deliveryDate: string;
    setDeliveryDate: (date: string) => void;
    deliveryTrackingLink: string;
    setDeliveryTrackingLink: (link: string) => void;
    onClose: () => void;
    onSave: () => void;
}

export const DeliveryDateModal: React.FC<DeliveryDateModalProps> = ({
    order,
    orders,
    deliveryDate,
    setDeliveryDate,
    deliveryTrackingLink,
    setDeliveryTrackingLink,
    onClose,
    onSave,
}) => {
    if (!order) return null;

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
            zIndex: 1000
        }}>
            <div style={{
                backgroundColor: 'var(--color-surface)',
                padding: 'var(--spacing-xl)',
                borderRadius: 'var(--radius-lg)',
                width: '100%',
                maxWidth: '400px',
                boxShadow: 'var(--shadow-lg)'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-md)' }}>
                    <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
                        <Calendar size={24} />
                        Liefertermin setzen
                    </h3>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                        <X size={24} />
                    </button>
                </div>
                <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--spacing-md)' }}>
                    {orders && orders.length > 1 ? (
                        <>Lieferant: <strong>{order.supplierName || 'Lieferung'}</strong> ({orders.length} Produkte)</>
                    ) : (
                        <>Produkt: <strong>{order.productName}</strong></>
                    )}
                </p>
                <div style={{ marginBottom: 'var(--spacing-md)' }}>
                    <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>
                        Erwartetes Lieferdatum
                    </label>
                    <input
                        type="date"
                        value={deliveryDate}
                        onChange={e => setDeliveryDate(e.target.value)}
                        style={{
                            width: '100%',
                            padding: 'var(--spacing-sm)',
                            borderRadius: 'var(--radius-sm)',
                            border: '1px solid var(--color-border)',
                            fontSize: 'var(--font-size-sm)'
                        }}
                    />
                    <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--spacing-xs)' }}>
                        Leer lassen, um Liefertermin zu entfernen
                    </p>
                </div>
                <div style={{ marginBottom: 'var(--spacing-md)' }}>
                    <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>
                        Tracking Link / Sendungsverfolgung
                    </label>
                    <input
                        type="url"
                        value={deliveryTrackingLink}
                        onChange={e => setDeliveryTrackingLink(e.target.value)}
                        onBlur={e => {
                            const val = e.target.value;
                            if (val && !/^https?:\/\//i.test(val)) {
                                setDeliveryTrackingLink(`https://${val}`);
                            }
                        }}
                        placeholder="https://..."
                        style={{
                            width: '100%',
                            padding: 'var(--spacing-sm)',
                            borderRadius: 'var(--radius-sm)',
                            border: '1px solid var(--color-border)',
                            fontSize: 'var(--font-size-sm)'
                        }}
                    />
                </div>
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
                        style={{
                            padding: 'var(--spacing-sm) var(--spacing-md)',
                            borderRadius: 'var(--radius-md)',
                            border: 'none',
                            backgroundColor: 'var(--color-primary)',
                            color: 'white',
                            cursor: 'pointer'
                        }}
                    >
                        Speichern
                    </button>
                </div>
            </div>
        </div>
    );
};
