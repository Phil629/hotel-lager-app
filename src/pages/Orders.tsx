import React, { useState, useEffect } from 'react';
import type { Order } from '../types';
import { DataService } from '../services/data';
import { CheckCircle, Clock, Package } from 'lucide-react';

export const Orders: React.FC = () => {
    const [orders, setOrders] = useState<Order[]>([]);

    useEffect(() => {
        loadOrders();
    }, []);

    const loadOrders = async () => {
        const data = await DataService.getOrders();
        setOrders(data);
    };

    const toggleOrderStatus = async (id: string) => {
        const order = orders.find(o => o.id === id);
        if (order) {
            const newStatus = order.status === 'open' ? 'received' : 'open';
            const updatedOrder = { ...order, status: newStatus as 'open' | 'received' };
            await DataService.updateOrder(updatedOrder);
            loadOrders();
        }
    };

    const openOrders = orders.filter(o => o.status === 'open');
    const receivedOrders = orders.filter(o => o.status === 'received');

    return (
        <div>
            <h2 style={{ fontSize: 'var(--font-size-2xl)', marginBottom: 'var(--spacing-xl)' }}>Bestellungen</h2>

            <div style={{ marginBottom: 'var(--spacing-2xl)' }}>
                <h3 style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--spacing-sm)',
                    color: 'var(--color-primary)',
                    marginBottom: 'var(--spacing-lg)'
                }}>
                    <Clock size={24} />
                    Offene Bestellungen
                </h3>

                {openOrders.length === 0 ? (
                    <div style={{
                        padding: 'var(--spacing-xl)',
                        textAlign: 'center',
                        backgroundColor: 'var(--color-surface)',
                        borderRadius: 'var(--radius-lg)',
                        color: 'var(--color-text-muted)'
                    }}>
                        Keine offenen Bestellungen.
                    </div>
                ) : (
                    <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                        {openOrders.map((order) => (
                            <div key={order.id} style={{
                                backgroundColor: 'var(--color-surface)',
                                padding: 'var(--spacing-lg)',
                                borderRadius: 'var(--radius-lg)',
                                boxShadow: 'var(--shadow-sm)',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                borderLeft: '4px solid var(--color-primary)'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)' }}>
                                    {order.productImage ? (
                                        <img
                                            src={order.productImage}
                                            alt={order.productName}
                                            style={{ width: '50px', height: '50px', objectFit: 'cover', borderRadius: 'var(--radius-sm)' }}
                                        />
                                    ) : (
                                        <div style={{
                                            width: '50px',
                                            height: '50px',
                                            backgroundColor: 'var(--color-background)',
                                            borderRadius: 'var(--radius-sm)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: 'var(--color-text-muted)'
                                        }}>
                                            <Package size={24} />
                                        </div>
                                    )}
                                    <div>
                                        <div style={{ fontWeight: 600, fontSize: 'var(--font-size-lg)' }}>{order.productName}</div>
                                        <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
                                            Menge: {order.quantity} • Bestellt am: {new Date(order.date).toLocaleDateString('de-DE')}
                                        </div>
                                    </div>
                                </div>
                                <button
                                    onClick={() => toggleOrderStatus(order.id)}
                                    style={{
                                        backgroundColor: 'var(--color-success)',
                                        color: 'white',
                                        border: 'none',
                                        padding: 'var(--spacing-sm) var(--spacing-md)',
                                        borderRadius: 'var(--radius-md)',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 'var(--spacing-sm)',
                                        fontWeight: 500
                                    }}
                                >
                                    <CheckCircle size={18} />
                                    Erhalten
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div>
                <h3 style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--spacing-sm)',
                    color: 'var(--color-text-muted)',
                    marginBottom: 'var(--spacing-lg)'
                }}>
                    <CheckCircle size={24} />
                    Erledigte Bestellungen
                </h3>

                <div style={{ display: 'grid', gap: 'var(--spacing-md)', opacity: 0.7 }}>
                    {receivedOrders.map((order) => (
                        <div key={order.id} style={{
                            backgroundColor: 'var(--color-surface)',
                            padding: 'var(--spacing-lg)',
                            borderRadius: 'var(--radius-lg)',
                            border: '1px solid var(--color-border)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)' }}>
                                {order.productImage && (
                                    <img
                                        src={order.productImage}
                                        alt={order.productName}
                                        style={{ width: '40px', height: '40px', objectFit: 'cover', borderRadius: 'var(--radius-sm)', filter: 'grayscale(100%)' }}
                                    />
                                )}
                                <div>
                                    <div style={{ fontWeight: 500, textDecoration: 'line-through', color: 'var(--color-text-muted)' }}>{order.productName}</div>
                                    <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
                                        Menge: {order.quantity} • Bestellt am: {new Date(order.date).toLocaleDateString('de-DE')}
                                    </div>
                                </div>
                            </div>
                            <button
                                onClick={() => toggleOrderStatus(order.id)}
                                style={{
                                    padding: '4px 12px',
                                    backgroundColor: 'var(--color-background)',
                                    borderRadius: 'var(--radius-full)',
                                    fontSize: 'var(--font-size-sm)',
                                    color: 'var(--color-text-muted)',
                                    border: '1px solid var(--color-border)',
                                    cursor: 'pointer'
                                }}
                            >
                                Rückgängig
                            </button>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};
