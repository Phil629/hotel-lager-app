import React from 'react';
import type { Product } from '../../types';

interface StockUpdateModalProps {
    isOpen?: boolean;
    product: Product | null;
    value: number;
    setValue: React.Dispatch<React.SetStateAction<number>>;
    onClose: () => void;
    onSave: (product: Product, newValue: number) => void;
}

export const StockUpdateModal: React.FC<StockUpdateModalProps> = ({
    isOpen = true,
    product,
    value,
    setValue,
    onClose,
    onSave,
}) => {
    if (!isOpen || !product) return null;

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
                maxWidth: '400px',
                boxShadow: 'var(--shadow-lg)'
            }}>
                <h3 style={{ marginTop: 0, marginBottom: 'var(--spacing-md)' }}>Bestand aktualisieren</h3>
                <p style={{ marginBottom: 'var(--spacing-lg)' }}>
                    Produkt: <strong>{product.name}</strong>
                </p>

                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)', marginBottom: 'var(--spacing-xl)' }}>
                    <button
                        onClick={() => setValue(prev => Math.max(0, prev - 1))}
                        style={{
                            width: '40px',
                            height: '40px',
                            borderRadius: 'var(--radius-md)',
                            border: '1px solid var(--color-border)',
                            background: 'var(--color-background)',
                            fontSize: '1.2rem',
                            cursor: 'pointer'
                        }}
                    >
                        -
                    </button>
                    <input
                        type="number"
                        value={value}
                        onChange={(e) => setValue(parseInt(e.target.value) || 0)}
                        style={{
                            flex: 1,
                            textAlign: 'center',
                            fontSize: '1.5rem',
                            fontWeight: 'bold',
                            border: 'none',
                            background: 'transparent'
                        }}
                    />
                    <button
                        onClick={() => setValue(prev => prev + 1)}
                        style={{
                            width: '40px',
                            height: '40px',
                            borderRadius: 'var(--radius-md)',
                            border: '1px solid var(--color-border)',
                            background: 'var(--color-background)',
                            fontSize: '1.2rem',
                            cursor: 'pointer'
                        }}
                    >
                        +
                    </button>
                </div>

                <div style={{ display: 'flex', gap: 'var(--spacing-md)' }}>
                    <button
                        onClick={onClose}
                        style={{
                            flex: 1,
                            padding: '12px',
                            borderRadius: 'var(--radius-md)',
                            border: '1px solid var(--color-border)',
                            backgroundColor: 'var(--color-surface)',
                            cursor: 'pointer'
                        }}
                    >
                        Abbrechen
                    </button>
                    <button
                        onClick={() => onSave(product, value)}
                        style={{
                            flex: 1,
                            padding: '12px',
                            borderRadius: 'var(--radius-md)',
                            border: 'none',
                            backgroundColor: 'var(--color-primary)',
                            color: 'white',
                            fontWeight: 'bold',
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
