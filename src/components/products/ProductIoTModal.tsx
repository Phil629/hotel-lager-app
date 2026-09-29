import React, { useState } from 'react';
import { X } from 'lucide-react';
import QRCode from 'react-qr-code';
import type { Product } from '../../types';

interface ProductIoTModalProps {
    data: { product: Product; curl: string; powershell: string } | null;
    onClose: () => void;
}

export const ProductIoTModal: React.FC<ProductIoTModalProps> = ({ data, onClose }) => {
    const [qrTab, setQrTab] = useState<'api' | 'order' | 'stock'>('api');

    if (!data) return null;

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
                maxWidth: '600px',
                maxHeight: '90vh',
                overflowY: 'auto'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-md)' }}>
                    <h3 style={{ margin: 0 }}>IoT & QR Code Integration</h3>
                    <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer' }}><X size={24} /></button>
                </div>

                {/* Tabs */}
                <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', marginBottom: 'var(--spacing-md)' }}>
                    <button
                        onClick={() => setQrTab('api')}
                        style={{
                            padding: '10px 16px',
                            border: 'none',
                            background: 'none',
                            borderBottom: qrTab === 'api' ? '2px solid var(--color-primary)' : 'none',
                            color: qrTab === 'api' ? 'var(--color-primary)' : 'var(--color-text-muted)',
                            fontWeight: qrTab === 'api' ? 600 : 400,
                            cursor: 'pointer'
                        }}
                    >
                        API / IoT Button
                    </button>
                    <button
                        onClick={() => setQrTab('order')}
                        style={{
                            padding: '10px 16px',
                            border: 'none',
                            background: 'none',
                            borderBottom: qrTab === 'order' ? '2px solid var(--color-primary)' : 'none',
                            color: qrTab === 'order' ? 'var(--color-primary)' : 'var(--color-text-muted)',
                            fontWeight: qrTab === 'order' ? 600 : 400,
                            cursor: 'pointer'
                        }}
                    >
                        QR: Bestellen
                    </button>
                    <button
                        onClick={() => setQrTab('stock')}
                        style={{
                            padding: '10px 16px',
                            border: 'none',
                            background: 'none',
                            borderBottom: qrTab === 'stock' ? '2px solid var(--color-primary)' : 'none',
                            color: qrTab === 'stock' ? 'var(--color-primary)' : 'var(--color-text-muted)',
                            fontWeight: qrTab === 'stock' ? 600 : 400,
                            cursor: 'pointer'
                        }}
                    >
                        QR: Bestand
                    </button>
                </div>

                {/* Tab Content */}
                {qrTab === 'api' && (
                    <>
                        {data.curl ? (
                            <>
                                <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--spacing-md)' }}>
                                    Dieser API-Endpunkt erzeugt eine offene Bestellung für <strong>{data.product.name}</strong>.
                                    Ideal für IoT-Buttons (z.B. AWS IoT Button, flic.io) oder Skripte.
                                </p>

                                <div style={{ marginBottom: 'var(--spacing-md)' }}>
                                    <div style={{ fontWeight: 600, marginBottom: '4px' }}>CURL (Linux/Mac)</div>
                                    <div style={{ backgroundColor: '#1e1e1e', color: '#d4d4d4', padding: '12px', borderRadius: '4px', overflowX: 'auto', fontFamily: 'monospace', fontSize: '12px' }}>
                                        {data.curl}
                                    </div>
                                </div>

                                <div>
                                    <div style={{ fontWeight: 600, marginBottom: '4px' }}>PowerShell (Windows)</div>
                                    <div style={{ backgroundColor: '#012456', color: '#ffffff', padding: '12px', borderRadius: '4px', overflowX: 'auto', fontFamily: 'monospace', fontSize: '12px' }}>
                                        {data.powershell}
                                    </div>
                                </div>
                            </>
                        ) : (
                            <div>
                                <div style={{ padding: '20px', backgroundColor: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', color: '#991B1B' }}>
                                    <h4 style={{ marginTop: 0 }}>Supabase ist nicht konfiguriert</h4>
                                    <p>Die IoT-Button Integration benötigt eine Supabase-Datenbank.</p>
                                    <p>Bitte konfigurieren Sie diese in den Einstellungen.</p>
                                    <p style={{ fontWeight: 'bold' }}>Die QR-Codes (siehe andere Tabs) funktionieren auch ohne Supabase!</p>
                                </div>
                            </div>
                        )}
                    </>
                )}

                {qrTab === 'order' && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                        <p>Scannt diesen Code, um direkt die Bestellmaske für <strong>{data.product.name}</strong> zu öffnen.</p>
                        <div style={{ padding: '20px', background: 'white', border: '1px solid #eee' }}>
                            <QRCode
                                value={`${window.location.protocol}//${window.location.host}${window.location.pathname}?action=order&id=${data.product.id}`}
                                size={200}
                            />
                        </div>
                        <p style={{ fontSize: '12px', color: '#666', marginTop: '10px' }}>
                            Funktioniert auf jedem Gerät im gleichen Netzwerk.
                        </p>
                    </div>
                )}

                {qrTab === 'stock' && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                        <p>Scannt diesen Code, um den Bestand von <strong>{data.product.name}</strong> zu aktualisieren.</p>
                        <div style={{ padding: '20px', background: 'white', border: '1px solid #eee' }}>
                            <QRCode
                                value={`${window.location.protocol}//${window.location.host}${window.location.pathname}?action=stock&id=${data.product.id}`}
                                size={200}
                            />
                        </div>
                        <p style={{ fontSize: '12px', color: '#666', marginTop: '10px' }}>
                            Öffnet direkt den Dialog zur Bestandsänderung (+/-).
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};
