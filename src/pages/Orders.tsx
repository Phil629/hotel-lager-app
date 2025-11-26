import React, { useState, useEffect } from 'react';
import type { Order, Product } from '../types';
import { DataService } from '../services/data';
import { StorageService } from '../services/storage';
import { CheckCircle, Clock, Package, AlertTriangle, Calendar, Phone, Mail, X, Plus, Search, ExternalLink } from 'lucide-react';
import { Notification, type NotificationType } from '../components/Notification';
import emailjs from '@emailjs/browser';

export const Orders: React.FC = () => {
    const [orders, setOrders] = useState<Order[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [defectModalOrder, setDefectModalOrder] = useState<Order | null>(null);
    const [defectNotes, setDefectNotes] = useState('');
    const [deliveryDateModalOrder, setDeliveryDateModalOrder] = useState<Order | null>(null);
    const [deliveryDate, setDeliveryDate] = useState('');
    const [notification, setNotification] = useState<{ message: string, type: NotificationType } | null>(null);

    // Create Order Modal State
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [createTab, setCreateTab] = useState<'existing' | 'onetime'>('existing');
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
    const [orderQuantity, setOrderQuantity] = useState<number | ''>(1);
    const [orderDate, setOrderDate] = useState(new Date().toISOString().split('T')[0]);

    // Pagination State
    const [visibleReceivedCount, setVisibleReceivedCount] = useState(10);

    // One-time Order State
    const [oneTimeOrder, setOneTimeOrder] = useState<{
        name: string;
        quantity: number | '';
        supplierName: string;
        supplierEmail: string;
        supplierPhone: string;
        orderNumber: string;
        price: number | '';
        orderUrl: string;
    }>({
        name: '',
        quantity: 1,
        supplierName: '',
        supplierEmail: '',
        supplierPhone: '',
        orderNumber: '',
        price: '',
        orderUrl: ''
    });

    // Collapsible Details State
    const [isDetailsOpen, setIsDetailsOpen] = useState(false);

    useEffect(() => {
        loadOrders();
        loadProducts();
    }, []);

    const loadOrders = async () => {
        const data = await DataService.getOrders();
        setOrders(data);
    };

    const loadProducts = async () => {
        const data = await DataService.getProducts();
        setProducts(data);
    };

    const handleCreateOrder = async () => {
        try {
            const quantity = orderQuantity === '' ? 1 : orderQuantity;

            if (createTab === 'existing') {
                if (!selectedProduct) return;

                // 1. Send Email if configured
                if (selectedProduct.autoOrder && selectedProduct.emailOrderAddress) {
                    const settings = StorageService.getSettings();
                    if (settings.serviceId && settings.templateId && settings.publicKey) {
                        try {
                            await emailjs.send(
                                settings.serviceId,
                                settings.templateId,
                                {
                                    to_email: selectedProduct.emailOrderAddress,
                                    subject: selectedProduct.emailOrderSubject || `Bestellung: ${selectedProduct.name}`,
                                    message: selectedProduct.emailOrderBody || `Bitte liefern Sie ${quantity}x ${selectedProduct.name}.`,
                                    product_name: selectedProduct.name,
                                    quantity: quantity,
                                    unit: selectedProduct.unit
                                },
                                settings.publicKey
                            );
                            setNotification({ message: 'Bestellung wurde per E-Mail versendet!', type: 'success' });
                        } catch (error) {
                            console.error('EmailJS Error:', error);
                            setNotification({ message: 'Fehler beim Senden der E-Mail, Bestellung wird trotzdem gespeichert.', type: 'info' });
                        }
                    }
                }

                // 2. Save Order
                const newOrder: Order = {
                    id: crypto.randomUUID(),
                    date: new Date(orderDate).toISOString(),
                    productName: selectedProduct.name,
                    quantity: quantity,
                    status: 'open',
                    productImage: selectedProduct.image,
                    supplierEmail: selectedProduct.emailOrderAddress,
                    supplierPhone: selectedProduct.supplierPhone
                };
                await DataService.saveOrder(newOrder);

            } else {
                // One-time Order
                if (!oneTimeOrder.name) {
                    setNotification({ message: 'Bitte geben Sie einen Produktnamen ein.', type: 'error' });
                    return;
                }

                const oneTimeQty = oneTimeOrder.quantity === '' ? 1 : oneTimeOrder.quantity;

                const newOrder: Order = {
                    id: crypto.randomUUID(),
                    date: new Date(orderDate).toISOString(),
                    productName: oneTimeOrder.name,
                    quantity: oneTimeQty,
                    status: 'open',
                    supplierName: oneTimeOrder.supplierName,
                    supplierEmail: oneTimeOrder.supplierEmail,
                    supplierPhone: oneTimeOrder.supplierPhone,
                    orderNumber: oneTimeOrder.orderNumber,
                    price: oneTimeOrder.price === '' ? undefined : (typeof oneTimeOrder.price === 'string' ? parseFloat(oneTimeOrder.price) : oneTimeOrder.price),
                };
                await DataService.saveOrder(newOrder);
            }

            setNotification({ message: 'Bestellung erfolgreich angelegt!', type: 'success' });
            setIsCreateModalOpen(false);
            setSelectedProduct(null);
            setOrderQuantity(1);
            setOneTimeOrder({
                name: '',
                quantity: 1,
                supplierName: '',
                supplierEmail: '',
                supplierPhone: '',
                orderNumber: '',
                price: '',
                orderUrl: ''
            });
            setIsDetailsOpen(false);
            loadOrders();

        } catch (error: any) {
            console.error('Error creating order:', error);
            setNotification({ message: 'Fehler beim Anlegen der Bestellung.', type: 'error' });
        }
    };

    const toggleOrderStatus = async (id: string) => {
        const order = orders.find(o => o.id === id);
        if (order) {
            const newStatus = order.status === 'open' ? 'received' : 'open';
            const updatedOrder: Order = {
                ...order,
                status: newStatus as 'open' | 'received',
                receivedAt: newStatus === 'received' ? new Date().toISOString() : undefined
            };
            await DataService.updateOrder(updatedOrder);
            loadOrders();
        }
    };

    const openDefectModal = (order: Order) => {
        setDefectModalOrder(order);
        setDefectNotes(order.defectNotes || '');
    };

    const closeDefectModal = () => {
        setDefectModalOrder(null);
        setDefectNotes('');
    };

    const saveDefect = async () => {
        if (defectModalOrder && defectNotes.trim()) {
            try {
                const updatedOrder: Order = {
                    ...defectModalOrder,
                    hasDefect: true,
                    defectNotes: defectNotes.trim(),
                    defectReportedAt: new Date().toISOString()
                };
                await DataService.updateOrder(updatedOrder);
                await loadOrders();
                closeDefectModal();
                setNotification({ message: 'Mangel wurde erfolgreich gemeldet!', type: 'success' });
            } catch (error: any) {
                console.error('Error saving defect:', error);
                const errorMsg = error?.message || error?.error_description || JSON.stringify(error);
                setNotification({ message: 'Fehler beim Speichern des Mangels: ' + errorMsg, type: 'error' });
            }
        }
    };

    const sendDefectEmail = (order: Order) => {
        if (!order.supplierEmail) {
            setNotification({ message: 'Keine Lieferanten-Email hinterlegt!', type: 'error' });
            return;
        }

        const subject = encodeURIComponent(`Mangel - Bestellung ${order.productName}`);
        const body = encodeURIComponent(
            `Sehr geehrte Damen und Herren,\n\n` +
            `wir möchten einen Mangel bei folgender Bestellung melden:\n\n` +
            `Produkt: ${order.productName}\n` +
            `Menge: ${order.quantity}\n` +
            `Bestelldatum: ${new Date(order.date).toLocaleDateString('de-DE')}\n\n` +
            `Mangelbeschreibung:\n${order.defectNotes || 'Keine Details angegeben'}\n\n` +
            `Mit freundlichen Grüßen\n` +
            `Hotel Rezeption`
        );

        window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${order.supplierEmail}&su=${subject}&body=${body}`, '_blank');
    };

    const openDeliveryDateModal = (order: Order) => {
        setDeliveryDateModalOrder(order);
        setDeliveryDate(order.expectedDeliveryDate || '');
    };

    const closeDeliveryDateModal = () => {
        setDeliveryDateModalOrder(null);
        setDeliveryDate('');
    };

    const saveDeliveryDate = async () => {
        if (deliveryDateModalOrder) {
            const updatedOrder: Order = {
                ...deliveryDateModalOrder,
                expectedDeliveryDate: deliveryDate || undefined
            };
            await DataService.updateOrder(updatedOrder);
            loadOrders();
            closeDeliveryDateModal();
        }
    };

    const getOrderBackgroundColor = (order: Order): string => {
        if (order.status === 'received') return 'var(--color-surface)';
        if (order.expectedDeliveryDate) return 'var(--color-surface)';

        const orderDate = new Date(order.date);
        const now = new Date();
        const daysDiff = Math.floor((now.getTime() - orderDate.getTime()) / (1000 * 60 * 60 * 24));

        if (daysDiff > 14) return '#ffe0e0'; // Light red
        if (daysDiff > 7) return '#fff4cc'; // Light yellow
        return 'var(--color-surface)';
    };

    const getOrderBorderColor = (order: Order): string => {
        if (order.hasDefect && !order.defectResolved) return '#ff9800';
        if (order.status === 'received') return '#4caf50';
        return '#2196f3';
    };

    const openOrders = orders
        .filter(o => o.status === 'open')
        .sort((a, b) => {
            const now = new Date();

            // Helper function to calculate days since order
            const getDaysSince = (order: Order) => {
                const orderDate = new Date(order.date);
                return Math.floor((now.getTime() - orderDate.getTime()) / (1000 * 60 * 60 * 24));
            };

            // Helper function to get days until delivery
            const getDaysUntilDelivery = (order: Order) => {
                if (!order.expectedDeliveryDate) return null;
                const deliveryDate = new Date(order.expectedDeliveryDate);
                return Math.floor((deliveryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            };

            // Priority levels:
            // 1 = Highest (defects or >14 days old - RED)
            // 2 = High (>7 days old - ORANGE)
            // 3 = Normal (recent orders)
            // 4 = Low (delivery date >5 days away)

            const getPriority = (order: Order) => {
                // Defects always highest priority
                if (order.hasDefect && !order.defectResolved) return 1;

                const daysSince = getDaysSince(order);
                const daysUntil = getDaysUntilDelivery(order);

                // Orders >14 days old (RED) - highest priority
                if (daysSince > 14) return 1;

                // Orders >7 days old (ORANGE) - high priority
                if (daysSince > 7) return 2;

                // Orders with delivery date >5 days away - lowest priority
                if (daysUntil !== null && daysUntil > 5) return 4;

                // Normal priority
                return 3;
            };

            const priorityA = getPriority(a);
            const priorityB = getPriority(b);

            // Sort by priority first
            if (priorityA !== priorityB) {
                return priorityA - priorityB; // Lower number = higher priority
            }

            // Within same priority, sort by appropriate date
            if (priorityA === 4) {
                // For orders with delivery dates (Priority 4), sort by delivery date (earliest first)
                const dateA = a.expectedDeliveryDate ? new Date(a.expectedDeliveryDate).getTime() : new Date(a.date).getTime();
                const dateB = b.expectedDeliveryDate ? new Date(b.expectedDeliveryDate).getTime() : new Date(b.date).getTime();
                return dateA - dateB; // Earliest delivery date first
            } else {
                // For all other priorities (1, 2, 3), sort by order date (oldest first)
                return new Date(a.date).getTime() - new Date(b.date).getTime();
            }
        });

    const receivedOrders = orders
        .filter(o => o.status === 'received')
        .sort((a, b) => {
            const dateA = a.receivedAt || a.date;
            const dateB = b.receivedAt || b.date;
            return new Date(dateB).getTime() - new Date(dateA).getTime();
        });

    const renderOrderCard = (order: Order) => (
        <div key={order.id} style={{
            backgroundColor: getOrderBackgroundColor(order),
            padding: 'var(--spacing-lg)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-sm)',
            borderLeft: `4px solid ${getOrderBorderColor(order)}`
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--spacing-md)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)', flex: 1 }}>
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
                    <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 'var(--font-size-lg)', marginBottom: 'var(--spacing-xs)' }}>
                            {order.productName}
                            {order.hasDefect && (
                                <span style={{
                                    marginLeft: 'var(--spacing-sm)',
                                    color: '#ff9800',
                                    fontSize: 'var(--font-size-sm)',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px'
                                }}>
                                    <AlertTriangle size={16} />
                                    Mangel gemeldet
                                </span>
                            )}
                        </div>
                        <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', marginBottom: 'var(--spacing-xs)' }}>
                            Menge: {order.quantity} • Bestellt am: {new Date(order.date).toLocaleDateString('de-DE')}
                            {order.supplierName && ` • Bei: ${order.supplierName}`}
                            {order.orderNumber && ` • Nr: ${order.orderNumber}`}
                            {order.price && ` • Preis: ${order.price.toFixed(2)} €`}
                        </div>
                        {order.supplierEmail && (
                            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--spacing-xs)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <Mail size={12} />
                                <a
                                    href={`https://mail.google.com/mail/?view=cm&fs=1&to=${order.supplierEmail}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{ color: 'inherit', textDecoration: 'underline' }}
                                >
                                    {order.supplierEmail}
                                </a>
                            </div>
                        )}

                        {order.expectedDeliveryDate && (
                            <div style={{
                                marginTop: 'var(--spacing-xs)',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                padding: '4px 8px',
                                backgroundColor: '#e3f2fd',
                                borderRadius: 'var(--radius-sm)',
                                fontSize: 'var(--font-size-sm)',
                                fontWeight: 500,
                                color: '#1976d2'
                            }}>
                                <Calendar size={14} />
                                Lieferung erwartet: {new Date(order.expectedDeliveryDate).toLocaleDateString('de-DE')}
                            </div>
                        )}

                        {order.hasDefect && order.defectNotes && (
                            <div style={{
                                marginTop: 'var(--spacing-xs)',
                                padding: 'var(--spacing-sm)',
                                backgroundColor: order.defectResolved ? '#f1f8e9' : '#fff3e0',
                                border: `1px solid ${order.defectResolved ? '#8bc34a' : '#ff9800'}`,
                                borderRadius: 'var(--radius-sm)',
                                fontSize: 'var(--font-size-sm)',
                                opacity: order.defectResolved ? 0.7 : 1
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <input
                                            type="checkbox"
                                            checked={order.defectResolved || false}
                                            onChange={async (e) => {
                                                const updatedOrder: Order = {
                                                    ...order,
                                                    defectResolved: e.target.checked
                                                };
                                                await DataService.updateOrder(updatedOrder);
                                                await loadOrders();
                                            }}
                                            style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                                        />
                                        <div style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '4px',
                                            color: order.defectResolved ? '#8bc34a' : '#ff9800',
                                            fontWeight: 600,
                                            textDecoration: order.defectResolved ? 'line-through' : 'none'
                                        }}>
                                            <AlertTriangle size={16} />
                                            {order.defectResolved ? 'Mangel erledigt' : 'Gemeldeter Mangel'}
                                        </div>
                                    </div>
                                </div>

                                {!order.defectResolved && (
                                    <>
                                        <div style={{ marginTop: '8px' }}>{order.defectNotes}</div>
                                        {order.defectReportedAt && (
                                            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                                                Gemeldet am: {new Date(order.defectReportedAt).toLocaleDateString('de-DE')}
                                            </div>
                                        )}

                                        {(order.supplierEmail || order.supplierPhone) && (
                                            <div style={{ marginTop: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                                {order.supplierEmail && (
                                                    <button
                                                        onClick={() => {
                                                            const subject = encodeURIComponent(`Mangel - Bestellung ${order.productName}`);
                                                            const body = encodeURIComponent(
                                                                `Sehr geehrte Damen und Herren,\n\n` +
                                                                `wir möchten einen Mangel bei folgender Bestellung melden:\n\n` +
                                                                `Produkt: ${order.productName}\n` +
                                                                `Menge: ${order.quantity}\n` +
                                                                `Bestelldatum: ${new Date(order.date).toLocaleDateString('de-DE')}\n\n` +
                                                                `Mangelbeschreibung:\n${order.defectNotes || 'Keine Details angegeben'}\n\n` +
                                                                `Mit freundlichen Grüßen\n` +
                                                                `Hotel Rezeption`
                                                            );
                                                            window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${order.supplierEmail}&su=${subject}&body=${body}`, '_blank');
                                                        }}
                                                        style={{
                                                            display: 'flex', alignItems: 'center', gap: '6px',
                                                            padding: '6px 12px',
                                                            backgroundColor: '#EA4335',
                                                            border: 'none',
                                                            borderRadius: '4px',
                                                            color: 'white',
                                                            fontSize: '12px',
                                                            cursor: 'pointer'
                                                        }}
                                                    >
                                                        <Mail size={14} />
                                                        In Gmail öffnen
                                                    </button>
                                                )}
                                                {order.supplierPhone && (
                                                    <a
                                                        href={`tel:${order.supplierPhone}`}
                                                        style={{
                                                            display: 'flex', alignItems: 'center', gap: '6px',
                                                            padding: '6px 12px',
                                                            backgroundColor: '#fff',
                                                            border: '1px solid #ff9800',
                                                            borderRadius: '4px',
                                                            color: '#ff9800',
                                                            fontSize: '12px',
                                                            textDecoration: 'none'
                                                        }}
                                                    >
                                                        <Phone size={14} />
                                                        {order.supplierPhone}
                                                    </a>
                                                )}
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        )}

                        {(order.supplierPhone || order.supplierEmail) && (!order.hasDefect || order.defectResolved) && (
                            <div style={{ marginTop: 'var(--spacing-xs)', display: 'flex', gap: 'var(--spacing-md)', fontSize: 'var(--font-size-sm)' }}>
                                {order.supplierPhone && (
                                    <a href={`tel:${order.supplierPhone}`} style={{ color: 'var(--color-primary)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <Phone size={14} />
                                        {order.supplierPhone}
                                    </a>
                                )}
                            </div>
                        )}
                    </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-sm)' }}>
                    {order.status === 'open' && (
                        <>
                            <button
                                onClick={() => toggleOrderStatus(order.id)}
                                style={{
                                    padding: 'var(--spacing-sm) var(--spacing-md)',
                                    borderRadius: 'var(--radius-md)',
                                    border: 'none',
                                    backgroundColor: 'var(--color-success)',
                                    color: 'white',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 'var(--spacing-xs)',
                                    fontSize: 'var(--font-size-sm)',
                                    whiteSpace: 'nowrap'
                                }}
                            >
                                <CheckCircle size={16} />
                                Erhalten
                            </button>
                            <button
                                onClick={() => openDefectModal(order)}
                                style={{
                                    padding: 'var(--spacing-sm) var(--spacing-md)',
                                    borderRadius: 'var(--radius-md)',
                                    border: '1px solid #ff9800',
                                    backgroundColor: 'white',
                                    color: '#ff9800',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 'var(--spacing-xs)',
                                    fontSize: 'var(--font-size-sm)',
                                    whiteSpace: 'nowrap'
                                }}
                            >
                                <AlertTriangle size={16} />
                                Mangel melden
                            </button>
                            {order.hasDefect && order.supplierEmail && (
                                <button
                                    onClick={() => sendDefectEmail(order)}
                                    style={{
                                        padding: 'var(--spacing-sm) var(--spacing-md)',
                                        borderRadius: 'var(--radius-md)',
                                        border: '1px solid var(--color-primary)',
                                        backgroundColor: 'white',
                                        color: 'var(--color-primary)',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 'var(--spacing-xs)',
                                        fontSize: 'var(--font-size-sm)',
                                        whiteSpace: 'nowrap'
                                    }}
                                >
                                    <Mail size={16} />
                                    Email senden
                                </button>
                            )}
                            <button
                                onClick={() => openDeliveryDateModal(order)}
                                style={{
                                    padding: 'var(--spacing-sm) var(--spacing-md)',
                                    borderRadius: 'var(--radius-md)',
                                    border: '1px solid var(--color-border)',
                                    backgroundColor: 'white',
                                    color: 'var(--color-text-main)',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 'var(--spacing-xs)',
                                    fontSize: 'var(--font-size-sm)',
                                    whiteSpace: 'nowrap'
                                }}
                            >
                                <Calendar size={16} />
                                Liefertermin
                            </button>
                        </>
                    )}
                    {order.status === 'received' && (
                        <button
                            onClick={() => toggleOrderStatus(order.id)}
                            style={{
                                padding: 'var(--spacing-sm) var(--spacing-md)',
                                borderRadius: 'var(--radius-md)',
                                border: '1px solid var(--color-border)',
                                backgroundColor: 'white',
                                color: 'var(--color-text-main)',
                                cursor: 'pointer',
                                fontSize: 'var(--font-size-sm)',
                                whiteSpace: 'nowrap'
                            }}
                        >
                            Rückgängig
                        </button>
                    )}
                </div>
            </div>
        </div>
    );

    const visibleReceivedOrders = receivedOrders.slice(0, visibleReceivedCount);

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-xl)' }}>
                <h2 style={{ fontSize: 'var(--font-size-2xl)', margin: 0 }}>Bestellungen</h2>
                <button
                    onClick={() => setIsCreateModalOpen(true)}
                    style={{
                        backgroundColor: 'var(--color-primary)',
                        color: 'white',
                        border: 'none',
                        padding: '10px 20px',
                        borderRadius: 'var(--radius-md)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        fontWeight: 500,
                        boxShadow: 'var(--shadow-md)'
                    }}
                >
                    <Plus size={20} /> Neue Bestellung
                </button>
            </div>

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
                        {openOrders.map(renderOrderCard)}
                    </div>
                )}
            </div>

            <div>
                <h3 style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--spacing-sm)',
                    color: 'var(--color-success)',
                    marginBottom: 'var(--spacing-lg)'
                }}>
                    <CheckCircle size={24} />
                    Erhaltene Bestellungen
                </h3>

                {receivedOrders.length === 0 ? (
                    <div style={{
                        padding: 'var(--spacing-xl)',
                        textAlign: 'center',
                        backgroundColor: 'var(--color-surface)',
                        borderRadius: 'var(--radius-lg)',
                        color: 'var(--color-text-muted)'
                    }}>
                        Noch keine Bestellungen erhalten.
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                        {visibleReceivedOrders.map(renderOrderCard)}

                        {visibleReceivedCount < receivedOrders.length && (
                            <button
                                onClick={() => setVisibleReceivedCount(prev => prev + 10)}
                                style={{
                                    padding: '10px',
                                    marginTop: '10px',
                                    backgroundColor: 'var(--color-surface)',
                                    border: '1px solid var(--color-border)',
                                    borderRadius: 'var(--radius-md)',
                                    cursor: 'pointer',
                                    color: 'var(--color-text-main)',
                                    fontWeight: 500
                                }}
                            >
                                Mehr laden ({receivedOrders.length - visibleReceivedCount} verbleibend)
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* Create Order Modal */}
            {isCreateModalOpen && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.5)',
                    display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000
                }}>
                    <div style={{
                        backgroundColor: 'var(--color-surface)',
                        padding: 'var(--spacing-xl)',
                        borderRadius: 'var(--radius-lg)',
                        width: '100%',
                        maxWidth: '600px',
                        maxHeight: '90vh',
                        overflowY: 'auto',
                        boxShadow: 'var(--shadow-lg)'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-lg)' }}>
                            <h3 style={{ margin: 0 }}>Neue Bestellung</h3>
                            <button onClick={() => setIsCreateModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                                <X size={24} />
                            </button>
                        </div>

                        {/* Tabs */}
                        <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', marginBottom: 'var(--spacing-lg)' }}>
                            <button
                                onClick={() => setCreateTab('existing')}
                                style={{
                                    padding: '10px 20px',
                                    border: 'none',
                                    background: 'none',
                                    borderBottom: createTab === 'existing' ? '2px solid var(--color-primary)' : 'none',
                                    color: createTab === 'existing' ? 'var(--color-primary)' : 'var(--color-text-muted)',
                                    fontWeight: 500,
                                    cursor: 'pointer'
                                }}
                            >
                                Aus Sortiment
                            </button>
                            <button
                                onClick={() => setCreateTab('onetime')}
                                style={{
                                    padding: '10px 20px',
                                    border: 'none',
                                    background: 'none',
                                    borderBottom: createTab === 'onetime' ? '2px solid var(--color-primary)' : 'none',
                                    color: createTab === 'onetime' ? 'var(--color-primary)' : 'var(--color-text-muted)',
                                    fontWeight: 500,
                                    cursor: 'pointer'
                                }}
                            >
                                Einmalige Bestellung
                            </button>
                        </div>

                        {createTab === 'existing' ? (
                            <>
                                <div style={{ position: 'relative', marginBottom: 'var(--spacing-md)' }}>
                                    <Search size={20} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                                    <input
                                        type="text"
                                        placeholder="Produkt suchen..."
                                        value={searchTerm}
                                        onChange={e => setSearchTerm(e.target.value)}
                                        style={{
                                            width: '100%',
                                            padding: '10px 10px 10px 40px',
                                            borderRadius: 'var(--radius-md)',
                                            border: '1px solid var(--color-border)',
                                            fontSize: 'var(--font-size-md)'
                                        }}
                                    />
                                </div>

                                {!selectedProduct ? (
                                    <div style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
                                        {products
                                            .filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()))
                                            .map(product => (
                                                <div
                                                    key={product.id}
                                                    onClick={() => setSelectedProduct(product)}
                                                    style={{
                                                        padding: '10px',
                                                        borderBottom: '1px solid var(--color-border)',
                                                        cursor: 'pointer',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '10px'
                                                    }}
                                                    onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--color-background)'}
                                                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                                                >
                                                    {product.image ? (
                                                        <img src={product.image} alt={product.name} style={{ width: '40px', height: '40px', borderRadius: '4px', objectFit: 'cover' }} />
                                                    ) : (
                                                        <div style={{ width: '40px', height: '40px', borderRadius: '4px', backgroundColor: '#eee', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                            <Package size={20} color="#888" />
                                                        </div>
                                                    )}
                                                    <span style={{ fontWeight: 500 }}>{product.name}</span>
                                                </div>
                                            ))}
                                    </div>
                                ) : (
                                    <div style={{ padding: 'var(--spacing-md)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-md)' }}>
                                            <h4 style={{ margin: 0 }}>{selectedProduct.name}</h4>
                                            <button onClick={() => setSelectedProduct(null)} style={{ color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>Ändern</button>
                                        </div>

                                        {/* Contact Info Display */}
                                        {(selectedProduct.emailOrderAddress || selectedProduct.orderUrl) && (
                                            <div style={{ marginBottom: 'var(--spacing-md)', padding: 'var(--spacing-sm)', backgroundColor: 'var(--color-background)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-sm)' }}>
                                                {selectedProduct.emailOrderAddress && (
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: selectedProduct.orderUrl ? '4px' : '0' }}>
                                                        <Mail size={14} color="var(--color-text-muted)" />
                                                        <span>{selectedProduct.emailOrderAddress}</span>
                                                    </div>
                                                )}
                                                {selectedProduct.orderUrl && (
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <ExternalLink size={14} color="var(--color-text-muted)" />
                                                        <a href={selectedProduct.orderUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>
                                                            Zum Shop
                                                        </a>
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        <div style={{ marginBottom: 'var(--spacing-md)' }}>
                                            <label style={{ display: 'block', marginBottom: '4px', fontSize: 'var(--font-size-sm)' }}>Menge</label>
                                            <input
                                                type="number"
                                                min="1"
                                                value={orderQuantity}
                                                onChange={e => {
                                                    const val = e.target.value;
                                                    setOrderQuantity(val === '' ? '' : parseInt(val));
                                                }}
                                                style={{ width: '100%', padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}
                                            />
                                        </div>
                                        <div style={{ marginBottom: 'var(--spacing-md)' }}>
                                            <label style={{ display: 'block', marginBottom: '4px', fontSize: 'var(--font-size-sm)' }}>Bestelldatum</label>
                                            <input
                                                type="date"
                                                value={orderDate}
                                                onChange={e => setOrderDate(e.target.value)}
                                                style={{ width: '100%', padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}
                                            />
                                        </div>
                                        <button
                                            onClick={handleCreateOrder}
                                            style={{
                                                width: '100%',
                                                padding: '10px',
                                                backgroundColor: 'var(--color-primary)',
                                                color: 'white',
                                                border: 'none',
                                                borderRadius: 'var(--radius-md)',
                                                cursor: 'pointer',
                                                fontWeight: 500
                                            }}
                                        >
                                            Bestellung aufgeben
                                        </button>
                                    </div>
                                )}
                            </>
                        ) : (
                            // One-time Order Form
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '4px', fontSize: 'var(--font-size-sm)' }}>Produktname *</label>
                                    <input
                                        type="text"
                                        value={oneTimeOrder.name}
                                        onChange={e => setOneTimeOrder({ ...oneTimeOrder, name: e.target.value })}
                                        placeholder=""
                                        style={{ width: '100%', padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '4px', fontSize: 'var(--font-size-sm)' }}>Menge</label>
                                    <input
                                        type="number"
                                        min="1"
                                        value={oneTimeOrder.quantity}
                                        onChange={e => {
                                            const val = e.target.value;
                                            setOneTimeOrder({ ...oneTimeOrder, quantity: val === '' ? '' : parseInt(val) });
                                        }}
                                        style={{ width: '100%', padding: '6px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}
                                    />
                                </div>

                                {/* Collapsible Supplier Details */}
                                <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                                    <button
                                        onClick={() => setIsDetailsOpen(!isDetailsOpen)}
                                        style={{
                                            width: '100%',
                                            padding: '10px',
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            background: 'var(--color-background)',
                                            border: 'none',
                                            cursor: 'pointer',
                                            fontWeight: 500,
                                            fontSize: 'var(--font-size-sm)'
                                        }}
                                    >
                                        <span>Details</span>
                                        <span>{isDetailsOpen ? '▲' : '▼'}</span>
                                    </button>

                                    {isDetailsOpen && (
                                        <div style={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: '10px', borderTop: '1px solid var(--color-border)' }}>
                                            <div>
                                                <label style={{ display: 'block', marginBottom: '4px', fontSize: 'var(--font-size-xs)' }}>Lieferant Name</label>
                                                <input
                                                    type="text"
                                                    value={oneTimeOrder.supplierName}
                                                    onChange={e => setOneTimeOrder({ ...oneTimeOrder, supplierName: e.target.value })}
                                                    style={{ width: '100%', padding: '6px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}
                                                />
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', marginBottom: '4px', fontSize: 'var(--font-size-xs)' }}>Bestellnummer</label>
                                                <input
                                                    type="text"
                                                    value={oneTimeOrder.orderNumber}
                                                    onChange={e => setOneTimeOrder({ ...oneTimeOrder, orderNumber: e.target.value })}
                                                    style={{ width: '100%', padding: '6px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}
                                                />
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', marginBottom: '4px', fontSize: 'var(--font-size-xs)' }}>Preis (€)</label>
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    value={oneTimeOrder.price}
                                                    onChange={e => {
                                                        const val = e.target.value;
                                                        setOneTimeOrder({ ...oneTimeOrder, price: val === '' ? '' : parseFloat(val) });
                                                    }}
                                                    style={{ width: '100%', padding: '6px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}
                                                />
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', marginBottom: '4px', fontSize: 'var(--font-size-xs)' }}>Email</label>
                                                <input
                                                    type="email"
                                                    value={oneTimeOrder.supplierEmail}
                                                    onChange={e => setOneTimeOrder({ ...oneTimeOrder, supplierEmail: e.target.value })}
                                                    style={{ width: '100%', padding: '6px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}
                                                />
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', marginBottom: '4px', fontSize: 'var(--font-size-xs)' }}>Telefon</label>
                                                <input
                                                    type="tel"
                                                    value={oneTimeOrder.supplierPhone}
                                                    onChange={e => setOneTimeOrder({ ...oneTimeOrder, supplierPhone: e.target.value })}
                                                    style={{ width: '100%', padding: '6px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div>
                                    <label style={{ display: 'block', marginBottom: '4px', fontSize: 'var(--font-size-sm)' }}>Bestelldatum</label>
                                    <input
                                        type="date"
                                        value={orderDate}
                                        onChange={e => setOrderDate(e.target.value)}
                                        style={{ width: '100%', padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}
                                    />
                                </div>
                                <button
                                    onClick={handleCreateOrder}
                                    style={{
                                        width: '100%',
                                        padding: '10px',
                                        backgroundColor: 'var(--color-primary)',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: 'var(--radius-md)',
                                        cursor: 'pointer',
                                        fontWeight: 500,
                                        marginTop: 'var(--spacing-sm)'
                                    }}
                                >
                                    Bestellung anlegen
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Defect Modal */}
            {
                defectModalOrder && (
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
                            maxWidth: '500px',
                            boxShadow: 'var(--shadow-lg)'
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-md)' }}>
                                <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
                                    <AlertTriangle size={24} color="#ff9800" />
                                    Mangel melden
                                </h3>
                                <button onClick={closeDefectModal} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                                    <X size={24} />
                                </button>
                            </div>
                            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--spacing-md)' }}>
                                Produkt: <strong>{defectModalOrder.productName}</strong>
                            </p>
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
                            </div>
                            <div style={{ display: 'flex', gap: 'var(--spacing-sm)', justifyContent: 'flex-end' }}>
                                <button
                                    onClick={closeDefectModal}
                                    style={{
                                        padding: 'var(--spacing-sm) var(--spacing-md)',
                                        borderRadius: 'var(--radius-md)',
                                        border: '1px solid var(--color-border)',
                                        backgroundColor: 'white',
                                        color: 'var(--color-text-main)',
                                        cursor: 'pointer'
                                    }}
                                >
                                    Abbrechen
                                </button>
                                <button
                                    onClick={saveDefect}
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
                                    Mangel speichern
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Delivery Date Modal */}
            {
                deliveryDateModalOrder && (
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
                                <button onClick={closeDeliveryDateModal} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                                    <X size={24} />
                                </button>
                            </div>
                            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--spacing-md)' }}>
                                Produkt: <strong>{deliveryDateModalOrder.productName}</strong>
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
                            <div style={{ display: 'flex', gap: 'var(--spacing-sm)', justifyContent: 'flex-end' }}>
                                <button
                                    onClick={closeDeliveryDateModal}
                                    style={{
                                        padding: 'var(--spacing-sm) var(--spacing-md)',
                                        borderRadius: 'var(--radius-md)',
                                        border: '1px solid var(--color-border)',
                                        backgroundColor: 'white',
                                        color: 'var(--color-text-main)',
                                        cursor: 'pointer'
                                    }}
                                >
                                    Abbrechen
                                </button>
                                <button
                                    onClick={saveDeliveryDate}
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
                )
            }

            {
                notification && (
                    <Notification
                        message={notification.message}
                        type={notification.type}
                        onClose={() => setNotification(null)}
                    />
                )
            }
        </div>
    );
};
