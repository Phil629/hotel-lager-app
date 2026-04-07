import { generateId } from "../utils";
import React, { useState, useEffect } from 'react';
import type { Product, Order, Supplier } from '../types';
import { DataService } from '../services/data';
import { StorageService } from '../services/storage';
import { Trash2, CheckCircle, Clock, Package, AlertTriangle, Calendar, Phone, Mail, X, Plus, Search, ExternalLink, CheckSquare, Edit2 } from 'lucide-react';
import { Notification, type NotificationType } from '../components/Notification';
import emailjs from '@emailjs/browser';

export const Orders: React.FC = () => {
    const [orders, setOrders] = useState<Order[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [defectModalOrder, setDefectModalOrder] = useState<Order | null>(null);
    const [defectNotes, setDefectNotes] = useState('');
    const [deliveryDateModalOrder, setDeliveryDateModalOrder] = useState<Order | null>(null);
    const [deliveryDate, setDeliveryDate] = useState('');
    const [deliveryTrackingLink, setDeliveryTrackingLink] = useState('');
    const [notification, setNotification] = useState<{ message: string, type: NotificationType } | null>(null);

    // Create Order Modal State
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [createTab, setCreateTab] = useState<'existing' | 'onetime'>('existing');
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [orderCart, setOrderCart] = useState<{product: Product, quantity: number}[]>([]);
    const [isProposalModalOpen, setIsProposalModalOpen] = useState(false);
    const [sessionGeneratedOrderIds, setSessionGeneratedOrderIds] = React.useState<string[]>([]);
    const [modalProposals, setModalProposals] = useState<{product: Product, supplierName: string, supplierId: string, quantity: number, openQty: number, selected: boolean}[]>([]);
    
    // Derived state for legacy compatibility
    const selectedProduct = orderCart.length > 0 ? orderCart[0].product : null;

    
    const [orderDate, setOrderDate] = useState(new Date().toISOString().split('T')[0]);
    const [orderNotes, setOrderNotes] = useState('');
    const [emailSubject, setEmailSubject] = useState('');
    const [emailBody, setEmailBody] = useState('');
    const [isOrderEmailExpanded, setIsOrderEmailExpanded] = useState(false);
    const [editingOrder, setEditingOrder] = useState<Order | null>(null);
    const [orderToDelete, setOrderToDelete] = useState<Order | null>(null);

    // Pagination State
    const [visibleReceivedCount, setVisibleReceivedCount] = useState(10);
    const [expandedReceivedOrders, setExpandedReceivedOrders] = useState<Set<string>>(new Set());

    const toggleReceivedOrder = (id: string) => {
        setExpandedReceivedOrders(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    // One-time Order State
    const [oneTimeOrder, setOneTimeOrder] = useState<{
        name: string;
        quantity: number | '';
        supplierName: string;
        supplierId: string;
        orderNumber: string;
        price: number | '';
        supplierEmail: string;
        supplierPhone: string;
        notes: string;
        orderUrl: string;
    }>({
        name: '',
        quantity: 1,
        supplierName: '',
        supplierId: '',
        orderNumber: '',
        price: '',
        supplierEmail: '',
        supplierPhone: '',
        notes: '',
        orderUrl: ''
    });

    // Collapsible Details State
    const [isDetailsOpen, setIsDetailsOpen] = useState(false);

    useEffect(() => {
        loadOrders();
        loadProducts();
        loadSuppliers();
    }, []);

    const loadOrders = async () => {
        const data = await DataService.getOrders();
        setOrders(data);
    };

    const loadProducts = async () => {
        const data = await DataService.getProducts();
        setProducts(data);
    };

    const loadSuppliers = async () => {
        const data = await DataService.getSuppliers();
        setSuppliers(data);
    };

    
    const generateEmailTemplate = (cart: {product: Product, quantity: number}[]) => {
        if (cart.length === 0) return { subject: '', body: '' };
        const mainProduct = cart[0].product;
        const supplier = suppliers.find(s => s.id === mainProduct.supplierId);
        
        let subject = supplier?.emailSubjectTemplate || mainProduct.emailOrderSubject || `Bestellung: {product_name}`;
        let body = supplier?.emailBodyTemplate || mainProduct.emailOrderBody || `Sehr geehrte Damen und Herren,\n\nbitte liefern Sie {quantity}x {product_name} ({unit}).\n\nMit freundlichen Grüßen\nHotel Rezeption`;

        if (cart.length === 1) {
            subject = subject.replace(/{product_name}/g, mainProduct.name).replace(/{quantity}/g, cart[0].quantity.toString()).replace(/{unit}/g, mainProduct.unit || '');
            body = body.replace(/{product_name}/g, mainProduct.name).replace(/{quantity}/g, cart[0].quantity.toString()).replace(/{unit}/g, mainProduct.unit || '');
        } else {
            const listSubjectInfo = cart.length + " Produkte";
            const listBodyInfo = '\n' + cart.map(c => `- ${c.quantity}x ${c.product.name} (${c.product.unit || ''})`).join('\n');
            
            subject = subject.replace(/{quantity}x?\s*{product_name}(?:\s*\({unit}\))?|{product_name}/g, listSubjectInfo);
            body = body.replace(/{quantity}x?\s*{product_name}(?:\s*\({unit}\))?|{product_name}/g, listBodyInfo);
        }
        return { subject, body };
    };

    const handleProductSelect = (product: Product) => {
        const initialCart = [{ product, quantity: 1 }];
        setOrderCart(initialCart);
        setIsOrderEmailExpanded(product.preferredOrderMethod === 'email');

        const { subject, body } = generateEmailTemplate(initialCart);
        setEmailSubject(subject);
        setEmailBody(body);
    };

    const addToCart = (product: Product) => {
        setOrderCart(prev => {
            const newCart = [...prev, { product, quantity: 1 }];
            const { subject, body } = generateEmailTemplate(newCart);
            setEmailSubject(subject);
            setEmailBody(body);
            return newCart;
        });
    };

    const updateCartQuantity = (index: number, quantity: number) => {
        setOrderCart(prev => {
            const newCart = prev.map((c, i) => i === index ? { ...c, quantity } : c);
            const { subject, body } = generateEmailTemplate(newCart);
            setEmailSubject(subject);
            setEmailBody(body);
            return newCart;
        });
    };

    const removeFromCart = (index: number) => {
        setOrderCart(prev => {
            const newCart = prev.filter((_, i) => i !== index);
            const { subject, body } = generateEmailTemplate(newCart);
            setEmailSubject(subject);
            setEmailBody(body);
            return newCart;
        });
    };
    
    // setSelectedProduct compatibility wrapper for resetting modal
    const setSelectedProduct = (val: Product | null) => {
        if (val === null) setOrderCart([]);
        else handleProductSelect(val);
    };

    const handleCreateOrder = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        try {
            if (createTab === 'existing') {
                if (orderCart.length === 0) return;
                const mainProduct = orderCart[0].product;

                // 1. Send Email if configured
                if (mainProduct.autoOrder && mainProduct.emailOrderAddress) {
                    const settings = StorageService.getSettings();
                    if (settings && settings.serviceId && settings.templateId && settings.publicKey) {
                        try {
                            const qty = orderCart[0].quantity;
                            const templateParams = {
                                to_email: mainProduct.emailOrderAddress,
                                subject: emailSubject,
                                message: emailBody,
                                product_name: orderCart.length > 1 ? orderCart.length + " Produkte" : mainProduct.name,
                                quantity: orderCart.length > 1 ? "" : qty,
                                unit: orderCart.length > 1 ? "" : mainProduct.unit
                            };
                            await emailjs.send(settings.serviceId, settings.templateId, templateParams, settings.publicKey);
                            setNotification({ message: 'Bestellung wurde automatisch per E-Mail versendet!', type: 'success' });
                        } catch (error) {
                            console.error('Email send error:', error);
                            setNotification({ message: 'Bestellung erstellt, aber Email konnte nicht gesendet werden.', type: 'error' });
                        }
                    }
                }

                // 2. Save Orders
                for (const item of orderCart) {
                    const newOrder: Order = {
                        id: generateId(),
                        date: new Date(orderDate).toISOString(),
                        productName: item.product.name,
                        quantity: item.quantity,
                        status: 'open',
                        productImage: item.product.image,
                        supplierEmail: item.product.emailOrderAddress,
                        supplierPhone: item.product.supplierPhone,
                        notes: orderNotes
                    };
                    await DataService.saveOrder(newOrder);
                }
            } else {
                // One-time Order
                if (!oneTimeOrder.name) {
                    setNotification({ message: 'Bitte geben Sie einen Produktnamen ein.', type: 'error' });
                    return;
                }
                const newOrder: Order = {
                    id: generateId(),
                    date: new Date(orderDate).toISOString(),
                    productName: oneTimeOrder.name,
                    quantity: oneTimeOrder.quantity === '' ? 1 : oneTimeOrder.quantity,
                    status: 'open',
                    supplierName: oneTimeOrder.supplierName,
                    supplierEmail: oneTimeOrder.supplierEmail,
                    supplierPhone: oneTimeOrder.supplierPhone,
                    orderNumber: oneTimeOrder.orderNumber,
                    price: oneTimeOrder.price === '' ? undefined : (typeof oneTimeOrder.price === 'string' ? parseFloat(oneTimeOrder.price) : oneTimeOrder.price),
                    notes: oneTimeOrder.notes
                };
                await DataService.saveOrder(newOrder);
            }

            setNotification({ message: 'Bestellung erfolgreich erstellt!', type: 'success' });
            setIsCreateModalOpen(false);
            setOrderCart([]);
            setOrderNotes('');
            setOneTimeOrder({ name: '', quantity: 1, supplierName: '', supplierId: '', orderNumber: '', price: '', supplierEmail: '', supplierPhone: '', notes: '', orderUrl: '' });
            loadOrders();
        } catch (error) {
            console.error('Order Error:', error);
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

    const handleRepeatOrder = (order: Order) => {
        const product = products.find(p => p.name === order.productName);
        if (product) {
            handleProductSelect(product);
            setIsCreateModalOpen(true);
        } else {
            // One-time order repeating
            setCreateTab('onetime');
            setOneTimeOrder({
                name: order.productName,
                quantity: order.quantity,
                supplierName: order.supplierName || '',
                supplierId: '',
                orderNumber: order.orderNumber || '',
                price: order.price || '',
                supplierEmail: order.supplierEmail || '',
                supplierPhone: order.supplierPhone || '',
                notes: order.notes || '',
                orderUrl: ''
            });
            setIsCreateModalOpen(true);
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
        setDeliveryTrackingLink(order.trackingLink || '');
    };

    const closeDeliveryDateModal = () => {
        setDeliveryDateModalOrder(null);
        setDeliveryDate('');
        setDeliveryTrackingLink('');
    };

    const saveDeliveryDate = async () => {
        if (deliveryDateModalOrder) {
            const updatedOrder: Order = {
                ...deliveryDateModalOrder,
                expectedDeliveryDate: deliveryDate || undefined,
                trackingLink: deliveryTrackingLink || undefined
            };
            await DataService.updateOrder(updatedOrder);
            loadOrders();
            closeDeliveryDateModal();
        }
    };

    const getOrderBackgroundColor = (order: Order): string => {
        if (order.status === 'received') return 'var(--color-surface)';

        const now = new Date();

        if (order.expectedDeliveryDate) {
            const deliveryDate = new Date(order.expectedDeliveryDate);
            const deliveryDaysDiff = Math.floor((now.getTime() - deliveryDate.getTime()) / (1000 * 60 * 60 * 24));
            
            if (deliveryDaysDiff > 0) return '#ffe0e0'; // Light red if overdue
            return 'var(--color-surface)';
        }

        const orderDate = new Date(order.date);
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

    const orderProposals = React.useMemo(() => {
        const proposals: {product: Product, supplierName: string, supplierId: string, quantity: number, openQty: number, selected: boolean}[] = [];
        for (const product of products) {
            if (product.ignoreOrderProposals) continue;
            
            const min = product.minStock || 0;
            if (product.stock <= min) {
                const standardQty = product.standardOrderQuantity ? product.standardOrderQuantity : (min > 0 ? min * 2 : 1);
                
                const openOrdersForProduct = orders.filter(o => o.status === 'open' && o.productName === product.name);
                const openQuantity = openOrdersForProduct.reduce((sum, o) => sum + (o.quantity || 0), 0);
                
                const needed = standardQty - openQuantity;
                if (needed > 0) {
                    const supplier = suppliers.find(s => s.id === product.supplierId);
                    proposals.push({
                        product,
                        supplierName: supplier ? supplier.name : 'Kein Lieferant',
                        supplierId: product.supplierId || 'unassigned',
                        quantity: needed,
                        openQty: openQuantity,
                        selected: true
                    });
                }
            }
        }
        return proposals;
    }, [products, orders, suppliers]);

    const handleOpenProposals = () => {
        setModalProposals(orderProposals);
        setSessionGeneratedOrderIds([]);
        setIsProposalModalOpen(true);
    };

    
    const handleExecuteProposal = async (proposal: {product: Product, quantity: number}) => {
        try {
            const nowIso = new Date().toISOString();
            const newOrder: import('../types').Order = {
                 id: generateId(),
                 date: nowIso,
                 productName: proposal.product.name,
                 quantity: proposal.quantity,
                 status: 'open',
                 productImage: proposal.product.image,
                 supplierEmail: proposal.product.emailOrderAddress,
                 supplierPhone: proposal.product.supplierPhone,
                 notes: 'Aus Bestellvorschlägen generiert'
            };
            
            await DataService.saveOrder(newOrder);
            setSessionGeneratedOrderIds(prev => [...prev, newOrder.id]);

            const { subject, body } = generateEmailTemplate([{ product: proposal.product, quantity: proposal.quantity }]);
            
            if (proposal.product.autoOrder && proposal.product.emailOrderAddress) {
                const settings = StorageService.getSettings();
                if (settings.serviceId && settings.templateId && settings.publicKey) {
                     const templateParams = {
                         to_email: proposal.product.emailOrderAddress,
                         subject: subject,
                         message: body,
                         product_name: proposal.product.name,
                         quantity: proposal.quantity,
                         unit: proposal.product.unit || ''
                     };
                     await emailjs.send(settings.serviceId, settings.templateId, templateParams, settings.publicKey);
                     setNotification({ message: 'Bestellung erfasst & Mail versendet!', type: 'success' });
                } else {
                     setNotification({ message: 'Bestellung erfasst, aber EmailJS Fehler!', type: 'error' });
                }
            } else if (proposal.product.preferredOrderMethod === 'link' && proposal.product.orderUrl) {
                window.open(proposal.product.orderUrl, '_blank');
                setNotification({ message: 'Bestellung erfasst! Shop geöffnet.', type: 'success' });
            } else {
                 const supplier = suppliers.find(s => s.id === proposal.product.supplierId);
                 const emailAddress = supplier?.email || proposal.product.emailOrderAddress || '';
                 
                 if (proposal.product.preferredOrderMethod === 'email' || emailAddress) {
                     const mailto = `mailto:${emailAddress}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
                     window.location.href = mailto;
                     setNotification({ message: 'Bestellung erfasst! E-Mail geöffnet.', type: 'success' });
                 } else {
                     setNotification({ message: 'Bestelldatensatz erfasst.', type: 'success' });
                 }
            }

            setModalProposals(prev => prev.filter(p => p.product.id !== proposal.product.id));
            loadOrders();
        } catch(e) {
             console.error('Order Proposal Error:', e);
             setNotification({ message: 'Fehler beim Ausführen', type: 'error' });
        }
    };

    const handleIgnorePermanently = async (productId: string) => {
        const prod = products.find(p => p.id === productId);
        if (prod) {
             const updated = { ...prod, ignoreOrderProposals: true };
             await DataService.updateProduct(updated);
             loadProducts();
             setModalProposals(prev => prev.filter(p => p.product.id !== productId));
        }
    };

    const updateProposalQuantity = (index: number, quantity: number) => {
        setModalProposals(prev => prev.map((p, i) => i === index ? { ...p, quantity } : p));
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
            // 0 = Critical (defects - always first!)
            // 1 = Highest (>14 days old - RED)
            // 2 = High (>7 days old - ORANGE)
            // 3 = Normal (recent orders)
            // 4 = Low (delivery date >5 days away)

            const getPriority = (order: Order) => {
                // Defects ALWAYS highest priority - separate from age-based priorities
                if (order.hasDefect && !order.defectResolved) return 0;

                const daysSince = getDaysSince(order);
                const daysUntil = getDaysUntilDelivery(order);

                // Orders >14 days old (RED) - highest priority (after defects)
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
            const aHasUnresolvedDefect = a.hasDefect && !a.defectResolved;
            const bHasUnresolvedDefect = b.hasDefect && !b.defectResolved;
            
            if (aHasUnresolvedDefect && !bHasUnresolvedDefect) return -1;
            if (!aHasUnresolvedDefect && bHasUnresolvedDefect) return 1;

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
                        {order.notes && (
                            <div style={{ fontSize: 'var(--font-size-sm)', fontStyle: 'italic', marginBottom: 'var(--spacing-xs)', color: 'var(--color-text-main)' }}>
                                "{order.notes}"
                            </div>
                        )}
                        {(() => {
                            let supplier = suppliers.find((s: Supplier) => s.name === order.supplierName);
                            // Fallback if supplier name was changed
                            if (!supplier) {
                                const prod = products.find((p: Product) => p.name === order.productName);
                                if (prod && prod.supplierId) {
                                    supplier = suppliers.find((s: Supplier) => s.id === prod.supplierId);
                                }
                            }

                            if (supplier?.notes && supplier.notes.length > 0) {
                                return supplier.notes.filter(n => n.showOnOpenOrders).map(n => (
                                    <div key={n.id} style={{ backgroundColor: '#fff3cd', color: '#856404', padding: '8px', borderRadius: 'var(--radius-sm)', marginTop: 'var(--spacing-xs)', marginBottom: 'var(--spacing-xs)', border: '1px solid #ffeeba', display: 'flex', gap: '8px', alignItems: 'flex-start', fontSize: 'var(--font-size-sm)' }}>
                                        <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                                        <div>
                                            <strong>Lieferantennotiz:</strong><br />
                                            {n.text}
                                        </div>
                                    </div>
                                ));
                            }
                            return null;
                        })()}
                        {(() => {
                            const product = products.find((p: Product) => p.name === order.productName);
                            if (product?.notes && product.notes.length > 0) {
                                return product.notes.filter(n => n.showOnOpenOrders).map(n => (
                                    <div key={n.id} style={{ backgroundColor: '#e3f2fd', color: '#0d47a1', padding: '8px', borderRadius: 'var(--radius-sm)', marginTop: 'var(--spacing-xs)', marginBottom: 'var(--spacing-xs)', border: '1px solid #bbdefb', display: 'flex', gap: '8px', alignItems: 'flex-start', fontSize: 'var(--font-size-sm)' }}>
                                        <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                                        <div>
                                            <strong>Produktnotiz:</strong><br />
                                            {n.text}
                                        </div>
                                    </div>
                                ));
                            }
                            return null;
                        })()}
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
                                    </a>
                                )}
                            </div>
                        )}
                        {order.trackingLink && (
                            <div style={{ marginTop: 'var(--spacing-xs)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: 'var(--font-size-sm)' }}>
                                <ExternalLink size={14} />
                                <a href={/^https?:\/\//i.test(order.trackingLink) ? order.trackingLink : `https://${order.trackingLink}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}>
                                    Sendungsverfolgung
                                </a>
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
                                Liefertermin/ -link
                            </button>
                            <button
                                onClick={() => setEditingOrder(order)}
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
                                <Edit2 size={16} />
                                Bearbeiten
                            </button>
                            <button
                                onClick={() => handleRepeatOrder(order)}
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
                                <Plus size={16} />
                                Wiederholen
                            </button>
                        </>
                    )}
                    {order.status === 'received' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-sm)' }}>
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
                            <button
                                onClick={() => handleRepeatOrder(order)}
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
                                <Plus size={16} />
                                Wiederholen
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
    const renderReceivedOrderCard = (order: Order) => {
        const hasUnresolvedDefect = order.hasDefect && !order.defectResolved;
        const isExpanded = expandedReceivedOrders.has(order.id) || hasUnresolvedDefect;
        
        if (!isExpanded) {
            return (
                <div key={order.id} style={{
                    backgroundColor: getOrderBackgroundColor(order),
                    padding: 'var(--spacing-md)',
                    borderRadius: 'var(--radius-md)',
                    boxShadow: 'var(--shadow-sm)',
                    borderLeft: `4px solid ${getOrderBorderColor(order)}`,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ fontWeight: 600, fontSize: 'var(--font-size-md)' }}>
                            {order.productName}
                        </div>
                        <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
                            Eingegangen am: {new Date(order.receivedAt || order.date).toLocaleDateString('de-DE')}
                        </div>
                    </div>
                    {hasUnresolvedDefect && (
                        <div style={{ color: '#ff9800', fontSize: 'var(--font-size-sm)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <AlertTriangle size={14} /> Mangel gemeldet
                        </div>
                    )}
                    <button
                        onClick={() => toggleReceivedOrder(order.id)}
                        style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: 'var(--color-primary)', fontSize: 'var(--font-size-sm)', padding: 0, marginTop: '4px', cursor: 'pointer', textDecoration: 'underline' }}
                    >
                        Weitere Details
                    </button>
                </div>
            );
        }

        return (
            <div key={`expanded-${order.id}`}>
                {renderOrderCard(order)}
                {!hasUnresolvedDefect && (
                    <div style={{ marginTop: '8px', textAlign: 'center' }}>
                        <button
                            onClick={() => toggleReceivedOrder(order.id)}
                            style={{ background: 'none', border: 'none', color: 'var(--color-primary)', fontSize: 'var(--font-size-sm)', cursor: 'pointer', textDecoration: 'underline' }}
                        >
                            Details ausblenden
                        </button>
                    </div>
                )}
            </div>
        );
    };

    const visibleReceivedOrders = receivedOrders.slice(0, visibleReceivedCount);

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-xl)' }}>
                <h2 style={{ fontSize: 'var(--font-size-2xl)', margin: 0 }}>Bestellungen</h2>
                <div style={{ display: 'flex', gap: 'var(--spacing-md)' }}>

                    {orderProposals.length > 0 && (

                        <button

                            onClick={handleOpenProposals}

                            style={{

                                backgroundColor: '#FF9800',

                                color: 'white',

                                border: 'none',

                                padding: '10px 20px',

                                borderRadius: 'var(--radius-md)',

                                cursor: 'pointer',

                                display: 'flex',

                                alignItems: 'center',

                                gap: '8px',

                                fontWeight: 600,

                                boxShadow: 'var(--shadow-md)'

                            }}

                        >

                            ✨ Bestellvorschläge ({orderProposals.length})

                        </button>

                    )}

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
                        {visibleReceivedOrders.map(renderReceivedOrderCard)}

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
                                                    onClick={() => handleProductSelect(product)}
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

                                        {(() => {
                                            if (selectedProduct.notes && selectedProduct.notes.length > 0) {
                                                return selectedProduct.notes.filter(n => n.showOnOrderCreation).map(n => (
                                                    <div key={n.id} style={{ backgroundColor: '#fff3cd', color: '#856404', padding: '12px', borderRadius: 'var(--radius-md)', marginBottom: 'var(--spacing-md)', border: '1px solid #ffeeba', display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                                                        <AlertTriangle size={20} style={{ flexShrink: 0, marginTop: '2px' }} />
                                                        <div>
                                                            <strong>Wichtige Produktnotiz:</strong><br />
                                                            {n.text}
                                                        </div>
                                                    </div>
                                                ));
                                            }
                                            return null;
                                        })()}

                                        {(() => {
                                            const supplier = suppliers.find(s => s.id === selectedProduct.supplierId);
                                            if (supplier?.notes && supplier.notes.length > 0) {
                                                return supplier.notes.filter(n => n.showOnOrderCreation).map(n => (
                                                    <div key={n.id} style={{ backgroundColor: '#fff3cd', color: '#856404', padding: '12px', borderRadius: 'var(--radius-md)', marginBottom: 'var(--spacing-md)', border: '1px solid #ffeeba', display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                                                        <AlertTriangle size={20} style={{ flexShrink: 0, marginTop: '2px' }} />
                                                        <div>
                                                            <strong>Wichtige Lieferantennotiz:</strong><br />
                                                            {n.text}
                                                        </div>
                                                    </div>
                                                ));
                                            }
                                            return null;
                                        })()}

                                        <div>
                                            <h5 style={{ margin: '0 0 var(--spacing-sm) 0', color: 'var(--color-primary)' }}>Bestellübersicht</h5>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: 'var(--spacing-md)' }}>
                                                {orderCart.map((item, index) => (
                                                    <div key={item.product.id} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <div style={{ flex: 1, fontWeight: 500, fontSize: 'var(--font-size-md)' }}>{item.product.name} ({item.product.unit})</div>
                                                        <input 
                                                            type="number" 
                                                            min="1" 
                                                            value={item.quantity} 
                                                            onChange={e => updateCartQuantity(index, Number(e.target.value))}
                                                            style={{ width: '60px', padding: '6px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontSize: 'var(--font-size-md)' }} 
                                                        />
                                                        {index > 0 && (
                                                            <button type="button" onClick={() => removeFromCart(index)} style={{ background: 'none', border: 'none', color: 'var(--color-danger)', cursor: 'pointer', padding: '4px' }}>
                                                                <span style={{ fontSize: '18px', fontWeight: 'bold' }}>×</span>
                                                            </button>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                            
                                            {(() => {
                                                const supplierId = selectedProduct?.supplierId;
                                                if (!supplierId) return null;
                                                const suggestions = products.filter(p => p.supplierId === supplierId && !orderCart.some(c => c.product.id === p.id));
                                                if (suggestions.length === 0) return null;
                                                return (
                                                    <div style={{ padding: '12px', backgroundColor: 'var(--color-background)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                                                        <h6 style={{ margin: '0 0 10px 0', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>Weitere Produkte vom Lieferanten hinzufügen:</h6>
                                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                                            {suggestions.map(p => (
                                                                <button 
                                                                    key={p.id} 
                                                                    type="button"
                                                                    onClick={() => addToCart(p)}
                                                                    style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', fontSize: 'var(--font-size-xs)', cursor: 'pointer', color: 'var(--color-text-main)' }}
                                                                >
                                                                    + {p.name}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>
                                                );
                                            })()}
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
                                        <div style={{ marginBottom: 'var(--spacing-md)' }}>
                                            <label style={{ display: 'block', marginBottom: '4px', fontSize: 'var(--font-size-sm)' }}>Notizen</label>
                                            <textarea
                                                rows={3}
                                                value={orderNotes}
                                                onChange={e => setOrderNotes(e.target.value)}
                                                placeholder="Optionale Notizen..."
                                                style={{ width: '100%', padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontFamily: 'inherit' }}
                                            />
                                        </div>

                                        {/* Order Methods Wrapper */}
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)', marginTop: 'var(--spacing-md)' }}>
                                            {(selectedProduct.supplierPhone || (suppliers.find(s => s.id === selectedProduct.supplierId)?.phone)) && (
                                                <div style={{
                                                    backgroundColor: selectedProduct.preferredOrderMethod === 'phone' ? 'rgba(37, 99, 235, 0.05)' : 'var(--color-background)',
                                                    padding: 'var(--spacing-md)',
                                                    borderRadius: 'var(--radius-md)',
                                                    border: selectedProduct.preferredOrderMethod === 'phone' ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                                                    order: selectedProduct.preferredOrderMethod === 'phone' ? -1 : 0
                                                }}>
                                                    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--spacing-sm)', fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>
                                                        Telefonische Bestellung:
                                                        {selectedProduct.preferredOrderMethod === 'phone' && (
                                                            <span style={{ fontSize: '10px', backgroundColor: 'var(--color-primary)', color: 'white', padding: '2px 6px', borderRadius: '10px' }}>STANDARD</span>
                                                        )}
                                                    </label>
                                                    <a
                                                        href={`tel:${selectedProduct.supplierPhone || suppliers.find(s => s.id === selectedProduct.supplierId)?.phone}`}
                                                        style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                            gap: 'var(--spacing-sm)',
                                                            padding: 'var(--spacing-sm)',
                                                            borderRadius: 'var(--radius-sm)',
                                                            border: '1px solid var(--color-border)',
                                                            backgroundColor: 'var(--color-surface)',
                                                            color: 'var(--color-text-main)',
                                                            cursor: 'pointer',
                                                            fontWeight: 500,
                                                            textDecoration: 'none'
                                                        }}
                                                    >
                                                        <Phone size={16} />
                                                        {selectedProduct.supplierPhone || suppliers.find(s => s.id === selectedProduct.supplierId)?.phone}
                                                        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>(Anrufen)</span>
                                                    </a>
                                                </div>
                                            )}
                                            {selectedProduct.orderUrl && (
                                                <div style={{
                                                    backgroundColor: selectedProduct.preferredOrderMethod === 'link' ? 'rgba(37, 99, 235, 0.05)' : 'var(--color-background)',
                                                    padding: 'var(--spacing-md)',
                                                    borderRadius: 'var(--radius-md)',
                                                    border: selectedProduct.preferredOrderMethod === 'link' ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                                                    order: selectedProduct.preferredOrderMethod === 'link' ? -1 : 0
                                                }}>
                                                    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--spacing-sm)', fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>
                                                        Bestelllink:
                                                        {selectedProduct.preferredOrderMethod === 'link' && (
                                                            <span style={{ fontSize: '10px', backgroundColor: 'var(--color-primary)', color: 'white', padding: '2px 6px', borderRadius: '10px' }}>STANDARD</span>
                                                        )}
                                                    </label>
                                                    <a
                                                        href={selectedProduct.orderUrl}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                            gap: 'var(--spacing-sm)',
                                                            padding: 'var(--spacing-sm)',
                                                            borderRadius: 'var(--radius-sm)',
                                                            border: '1px solid var(--color-border)',
                                                            backgroundColor: selectedProduct.preferredOrderMethod === 'link' ? 'var(--color-primary)' : 'var(--color-surface)',
                                                            color: selectedProduct.preferredOrderMethod === 'link' ? 'white' : 'var(--color-text-main)',
                                                            cursor: 'pointer',
                                                            fontWeight: 500,
                                                            textDecoration: 'none'
                                                        }}
                                                    >
                                                        <ExternalLink size={16} />
                                                        Zur Webseite
                                                    </a>
                                                </div>
                                            )}

                                            {selectedProduct.emailOrderAddress && !selectedProduct.autoOrder && (
                                                <>
                                                    {selectedProduct.preferredOrderMethod !== 'email' && !isOrderEmailExpanded ? (
                                                        <button
                                                            type="button"
                                                            onClick={() => setIsOrderEmailExpanded(true)}
                                                            style={{
                                                                width: '100%',
                                                                padding: 'var(--spacing-md)',
                                                                borderRadius: 'var(--radius-md)',
                                                                border: '1px solid var(--color-border)',
                                                                backgroundColor: 'var(--color-background)',
                                                                color: 'var(--color-text-muted)',
                                                                cursor: 'pointer',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'center',
                                                                gap: '8px',
                                                                fontWeight: 500
                                                            }}
                                                        >
                                                            <Mail size={16} />
                                                            Email-Bestellung öffnen
                                                        </button>
                                                    ) : (
                                                        <div style={{
                                                            backgroundColor: selectedProduct.preferredOrderMethod === 'email' ? 'rgba(37, 99, 235, 0.05)' : 'var(--color-background)',
                                                            padding: 'var(--spacing-md)',
                                                            borderRadius: 'var(--radius-md)',
                                                            border: selectedProduct.preferredOrderMethod === 'email' ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                                                            order: selectedProduct.preferredOrderMethod === 'email' ? -1 : 0
                                                        }}>
                                                            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--spacing-sm)', fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>
                                                                Email Vorschau & Bearbeitung:
                                                                {selectedProduct.preferredOrderMethod === 'email' && (
                                                                    <span style={{ fontSize: '10px', backgroundColor: 'var(--color-primary)', color: 'white', padding: '2px 6px', borderRadius: '10px' }}>STANDARD</span>
                                                                )}
                                                            </label>

                                                            <div style={{ marginBottom: 'var(--spacing-sm)' }}>
                                                                <label style={{ display: 'block', marginBottom: '4px', fontSize: 'var(--font-size-xs)' }}>Betreff</label>
                                                                <input
                                                                    type="text"
                                                                    value={emailSubject}
                                                                    onChange={e => setEmailSubject(e.target.value)}
                                                                    style={{ width: '100%', padding: '6px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}
                                                                />
                                                            </div>

                                                            <div style={{ marginBottom: 'var(--spacing-sm)' }}>
                                                                <label style={{ display: 'block', marginBottom: '4px', fontSize: 'var(--font-size-xs)' }}>Nachricht</label>
                                                                <textarea
                                                                    value={emailBody}
                                                                    onChange={e => setEmailBody(e.target.value)}
                                                                    rows={5}
                                                                    style={{ width: '100%', padding: '6px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontFamily: 'inherit' }}
                                                                />
                                                            </div>

                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    const encodedSubject = encodeURIComponent(emailSubject);
                                                                    const encodedBody = encodeURIComponent(emailBody);
                                                                    window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${selectedProduct.emailOrderAddress}&su=${encodedSubject}&body=${encodedBody}`, '_blank');
                                                                }}
                                                                style={{
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    justifyContent: 'center',
                                                                    gap: 'var(--spacing-sm)',
                                                                    padding: 'var(--spacing-sm)',
                                                                    borderRadius: 'var(--radius-sm)',
                                                                    border: '1px solid var(--color-border)',
                                                                    backgroundColor: '#EA4335',
                                                                    color: 'white',
                                                                    cursor: 'pointer',
                                                                    fontWeight: 500,
                                                                    width: '100%'
                                                                }}
                                                            >
                                                                <Mail size={16} />
                                                                In Gmail öffnen
                                                            </button>
                                                        </div>
                                                    )}
                                                </>
                                            )}
                                        </div>

                                        {selectedProduct.autoOrder && (
                                            <div style={{
                                                backgroundColor: 'var(--color-background)',
                                                padding: 'var(--spacing-md)',
                                                borderRadius: 'var(--radius-md)',
                                                border: '1px solid var(--color-border)',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 'var(--spacing-sm)',
                                                color: 'var(--color-primary)',
                                                marginTop: 'var(--spacing-md)'
                                            }}>
                                                <CheckSquare size={20} />
                                                <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>
                                                    Wird automatisch per EmailJS versendet
                                                </span>
                                            </div>
                                        )}

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
                                                marginTop: 'var(--spacing-md)'
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

                                <div>
                                    <label style={{ display: 'block', marginBottom: '4px', fontSize: 'var(--font-size-sm)' }}>Lieferant (Optional)</label>
                                    <select
                                        value={oneTimeOrder.supplierId || ''}
                                        onChange={e => {
                                            const supplierId = e.target.value;
                                            const supplier = suppliers.find(s => s.id === supplierId);
                                            if (supplier) {
                                                setOneTimeOrder({
                                                    ...oneTimeOrder,
                                                    supplierId: supplierId,
                                                    supplierName: supplier.name,
                                                    supplierEmail: supplier.email,
                                                    supplierPhone: supplier.phone || ''
                                                });
                                            } else {
                                                setOneTimeOrder({
                                                    ...oneTimeOrder,
                                                    supplierId: '',
                                                    supplierName: '',
                                                    supplierEmail: '',
                                                    supplierPhone: ''
                                                });
                                            }
                                        }}
                                        style={{ width: '100%', padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}
                                    >
                                        <option value="">-- Kein Lieferant / Manuell --</option>
                                        {suppliers.map(s => (
                                            <option key={s.id} value={s.id}>{s.name}</option>
                                        ))}
                                    </select>
                                </div>

                                {(() => {
                                    const supplier = suppliers.find(s => s.id === oneTimeOrder.supplierId);
                                    if (supplier?.notes && supplier.notes.length > 0) {
                                        return supplier.notes.filter(n => n.showOnOrderCreation).map(n => (
                                            <div key={n.id} style={{ backgroundColor: '#fff3cd', color: '#856404', padding: '12px', borderRadius: 'var(--radius-md)', marginBottom: 'var(--spacing-md)', border: '1px solid #ffeeba', display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                                                <AlertTriangle size={20} style={{ flexShrink: 0, marginTop: '2px' }} />
                                                <div>
                                                    <strong>Wichtige Lieferantennotiz:</strong><br />
                                                    {n.text}
                                                </div>
                                            </div>
                                        ));
                                    }
                                    return null;
                                })()}

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
                                <div>
                                    <label style={{ display: 'block', marginBottom: '4px', fontSize: 'var(--font-size-sm)' }}>Notizen</label>
                                    <textarea
                                        rows={3}
                                        value={oneTimeOrder.notes}
                                        onChange={e => setOneTimeOrder({ ...oneTimeOrder, notes: e.target.value })}
                                        placeholder="Optionale Notizen..."
                                        style={{ width: '100%', padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontFamily: 'inherit' }}
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
                editingOrder && (
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
                        zIndex: 1100
                    }}>
                        <div style={{
                            backgroundColor: 'var(--color-surface)',
                            padding: 'var(--spacing-xl)',
                            borderRadius: 'var(--radius-lg)',
                            width: '100%',
                            maxWidth: '500px',
                            boxShadow: 'var(--shadow-lg)'
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-lg)' }}>
                                <h3 style={{ margin: 0, fontSize: 'var(--font-size-lg)' }}>Bestellung bearbeiten</h3>
                                <button onClick={() => setEditingOrder(null)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                                    <X size={24} />
                                </button>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                                <div>
                                    <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>
                                        Menge
                                    </label>
                                    <input
                                        type="number"
                                        min="1"
                                        value={editingOrder.quantity}
                                        onChange={e => setEditingOrder({ ...editingOrder, quantity: Number(e.target.value) })}
                                        style={{ width: '100%', padding: 'var(--spacing-sm)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}
                                    />
                                </div>

                                <div>
                                    <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>
                                        Notizen
                                    </label>
                                    <textarea
                                        rows={3}
                                        value={editingOrder.notes || ''}
                                        onChange={e => setEditingOrder({ ...editingOrder, notes: e.target.value })}
                                        style={{ width: '100%', padding: 'var(--spacing-sm)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontFamily: 'inherit' }}
                                    />
                                </div>

                                <div>
                                    <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>
                                        Tracking Link / Sendungsverfolgung
                                    </label>
                                    <input
                                        type="url"
                                        value={editingOrder.trackingLink || ''}
                                        onChange={e => setEditingOrder({ ...editingOrder, trackingLink: e.target.value })}
                                        onBlur={e => {
                                            const val = e.target.value;
                                            if (val && !/^https?:\/\//i.test(val)) {
                                                setEditingOrder({ ...editingOrder, trackingLink: `https://${val}` });
                                            }
                                        }}
                                        placeholder="https://..."
                                        style={{ width: '100%', padding: 'var(--spacing-sm)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}
                                    />
                                </div>

                                {editingOrder.hasDefect && (
                                    <div style={{ marginTop: 'var(--spacing-xs)', padding: 'var(--spacing-sm)', border: '1px solid #ff9800', borderRadius: 'var(--radius-sm)', backgroundColor: '#fff3e0' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#e65100', fontWeight: 500, fontSize: 'var(--font-size-sm)' }}>
                                                <AlertTriangle size={16} />
                                                Dieser Bestellung ist ein Mangel zugeordnet.
                                            </div>
                                            <button
                                                onClick={() => {
                                                    const updated = { ...editingOrder };
                                                    delete updated.hasDefect;
                                                    delete updated.defectNotes;
                                                    delete updated.defectReportedAt;
                                                    delete updated.defectResolved;
                                                    setEditingOrder(updated);
                                                }}
                                                style={{
                                                    padding: '6px 12px',
                                                    borderRadius: 'var(--radius-sm)',
                                                    border: '1px solid currentColor',
                                                    backgroundColor: 'transparent',
                                                    color: '#d32f2f',
                                                    cursor: 'pointer',
                                                    fontSize: 'var(--font-size-sm)',
                                                    fontWeight: 500,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '4px'
                                                }}
                                            >
                                                <X size={14} /> Mangel entfernen
                                            </button>
                                        </div>
                                    </div>
                                )}

                                <div style={{ display: 'flex', gap: 'var(--spacing-md)', justifyContent: 'space-between', marginTop: 'var(--spacing-sm)' }}>
                                    <button
                                        onClick={() => setOrderToDelete(editingOrder)}
                                        style={{
                                            padding: 'var(--spacing-sm) var(--spacing-md)',
                                            borderRadius: 'var(--radius-md)',
                                            border: 'none',
                                            backgroundColor: 'var(--color-danger)',
                                            color: 'white',
                                            cursor: 'pointer'
                                        }}
                                    >
                                        Löschen
                                    </button>
                                    <div style={{ display: 'flex', gap: 'var(--spacing-md)' }}>
                                        <button
                                            onClick={() => setEditingOrder(null)}
                                            style={{
                                                padding: 'var(--spacing-sm) var(--spacing-md)',
                                                borderRadius: 'var(--radius-md)',
                                                border: '1px solid var(--color-border)',
                                                backgroundColor: 'transparent',
                                                cursor: 'pointer'
                                            }}
                                        >
                                            Abbrechen
                                        </button>
                                        <button
                                            onClick={async () => {
                                                await DataService.updateOrder(editingOrder);
                                                setEditingOrder(null);
                                                loadOrders();
                                            }}
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
                        </div>
                    </div>
                )
            }

            {
                orderToDelete && (
                    <div style={{
                        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                        backgroundColor: 'rgba(0,0,0,0.5)',
                        display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1100
                    }}>
                        <div style={{
                            backgroundColor: 'white',
                            padding: 'var(--spacing-xl)',
                            borderRadius: 'var(--radius-lg)',
                            maxWidth: '400px',
                            width: '100%',
                            boxShadow: 'var(--shadow-lg)',
                            textAlign: 'center'
                        }}>
                            <div style={{ color: 'var(--color-danger)', marginBottom: 'var(--spacing-md)' }}>
                                <AlertTriangle size={48} style={{ margin: '0 auto' }} />
                            </div>
                            <h3 style={{ margin: '0 0 var(--spacing-sm) 0' }}>Bestellung löschen?</h3>
                            <p style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--spacing-lg)' }}>
                                Möchtest du die Bestellung für <strong>{orderToDelete.productName}</strong> ({orderToDelete.quantity}x) wirklich unwiderruflich löschen?
                            </p>
                            <div style={{ display: 'flex', gap: 'var(--spacing-md)', justifyContent: 'center' }}>
                                <button
                                    onClick={() => setOrderToDelete(null)}
                                    style={{
                                        padding: 'var(--spacing-sm) var(--spacing-lg)',
                                        borderRadius: 'var(--radius-md)',
                                        border: '1px solid var(--color-border)',
                                        backgroundColor: 'transparent',
                                        cursor: 'pointer',
                                        fontWeight: 500
                                    }}
                                >
                                    Abbrechen
                                </button>
                                <button
                                    onClick={async () => {
                                        await DataService.deleteOrder(orderToDelete.id);
                                        setOrderToDelete(null);
                                        setEditingOrder(null);
                                        loadOrders();
                                        setNotification({ message: 'Bestellung erfolgreich gelöscht.', type: 'success' });
                                    }}
                                    style={{
                                        padding: 'var(--spacing-sm) var(--spacing-lg)',
                                        borderRadius: 'var(--radius-md)',
                                        border: 'none',
                                        backgroundColor: 'var(--color-danger)',
                                        color: 'white',
                                        cursor: 'pointer',
                                        fontWeight: 500
                                    }}
                                >
                                    Löschen
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {


                isProposalModalOpen && (
                    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: 'var(--spacing-md)' }}>
                        <div style={{ backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-xl)', width: '100%', maxWidth: '800px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)' }}>
                            <div style={{ padding: 'var(--spacing-lg) var(--spacing-xl)', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f8fafc', borderTopLeftRadius: 'var(--radius-xl)', borderTopRightRadius: 'var(--radius-xl)' }}>
                                <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--font-size-xl)' }}>✨ Bestell-Assistent</h2>
                                <button onClick={() => setIsProposalModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}><X size={24} color="#64748b" /></button>
                            </div>

                            <div style={{ padding: 'var(--spacing-xl)', overflowY: 'auto', flex: 1, backgroundColor: 'white' }}>
                                {modalProposals.length === 0 ? (
                                    <div style={{ textAlign: 'center', color: 'var(--color-text-muted)', padding: 'var(--spacing-2xl) 0' }}>Keine offenen Vorschläge mehr! 🎉</div>
                                ) : (
                                    <>
                                        <p style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--spacing-xl)', marginTop: 0, fontSize: 'var(--font-size-md)' }}>Diese Produkte liegen unter dem Mindestbestand. Klicke auf Bestellen, um das Ticket anzulegen und optional die Bestellung beim Lieferanten manuell oder per Auto-Mail zu platzieren.</p>
                                        
                                        {Array.from(new Set(modalProposals.map(p => p.supplierName))).map(supplierName => {
                                            const supplierProposals = modalProposals.filter(p => p.supplierName === supplierName);
                                            if (supplierProposals.length === 0) return null;
                                            
                                            return (
                                                <div key={supplierName} style={{ marginBottom: 'var(--spacing-2xl)' }}>
                                                    <h3 style={{ paddingBottom: '8px', marginBottom: 'var(--spacing-md)', fontSize: '18px', color: 'var(--color-text-main)' }}>{supplierName}</h3>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                                                        {supplierProposals.map(prop => {
                                                            const originalIndex = modalProposals.findIndex(p => p.product.id === prop.product.id);
                                                            
                                                            let btnText = "Bedarf merken";
                                                            const prod = prop.product;
                                                            if (prod.autoOrder && prod.emailOrderAddress) btnText = "🤖 Auto-Mail senden";
                                                            else if (prod.preferredOrderMethod === 'link' || (!prod.preferredOrderMethod && prod.orderUrl)) btnText = "🔗 Im Tab bestellen";
                                                            else if (prod.preferredOrderMethod === 'email' || prod.emailOrderAddress) btnText = "📧 E-Mail öffnen";

                                                            return (
                                                                <div key={prod.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)', padding: 'var(--spacing-md)', backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)', flexWrap: 'wrap' }}>
                                                                    <div style={{ flex: '1 1 200px' }}>
                                                                        <div style={{ fontWeight: 600, fontSize: '16px', color: 'var(--color-text-main)', marginBottom: '4px' }}>{prod.name}</div>
                                                                        <div style={{ fontSize: '13px', color: '#64748b', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                                                                            <span>Bestand: {prod.stock} / Min: {prod.minStock || 0}</span>
                                                                            {prop.openQty > 0 && <span style={{ color: '#d97706', fontWeight: 500 }}>({prop.openQty} ausstehend)</span>}
                                                                            <button onClick={() => handleIgnorePermanently(prod.id)} style={{ border: 'none', background: 'none', color: '#ef4444', fontSize: '12px', padding: 0, cursor: 'pointer', textDecoration: 'underline' }}>Dauerhaft ignorieren</button>
                                                                        </div>
                                                                    </div>
                                                                    
                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#f1f5f9', padding: '6px', borderRadius: 'var(--radius-md)' }}>
                                                                            <span style={{ fontSize: '12px', fontWeight: 600, color: '#475569', paddingLeft: '4px' }}>BESTELLEN:</span>
                                                                            <input type="number" min="1" value={prop.quantity || 1} onChange={e => updateProposalQuantity(originalIndex, Number(e.target.value))} style={{ width: '60px', padding: '6px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontWeight: 700, fontSize: '15px' }} />
                                                                            <span style={{ fontSize: '13px', color: '#475569', width: '30px', fontWeight: 500 }}>{prod.unit || 'Stk'}</span>
                                                                        </div>
                                                                        
                                                                        <button 
                                                                            onClick={() => handleExecuteProposal(prop)}
                                                                            style={{ 
                                                                                padding: '10px 16px', 
                                                                                borderRadius: 'var(--radius-md)', 
                                                                                border: 'none', 
                                                                                backgroundColor: 'var(--color-primary)', 
                                                                                color: 'white', 
                                                                                cursor: 'pointer', 
                                                                                fontWeight: 600, 
                                                                                boxShadow: '0 1px 2px 0 rgba(37, 99, 235, 0.3)',
                                                                                whiteSpace: 'nowrap',
                                                                                display: 'flex',
                                                                                alignItems: 'center',
                                                                                gap: '6px'
                                                                            }}
                                                                        >
                                                                            {btnText}
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </>
                                )}

                                
                                {sessionGeneratedOrderIds.length > 0 && (
                                    <div style={{ marginTop: 'var(--spacing-2xl)', borderTop: '2px solid var(--color-border)', paddingTop: 'var(--spacing-xl)' }}>
                                        <h3 style={{ color: 'var(--color-success)', marginBottom: 'var(--spacing-lg)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <CheckCircle size={20} />
                                            Gerade angelegt
                                        </h3>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            {orders.filter(o => sessionGeneratedOrderIds.includes(o.id)).map(order => (
                                                <div key={order.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)', padding: 'var(--spacing-sm) var(--spacing-md)', backgroundColor: '#f8fafc', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
                                                    <div style={{ flex: 1, fontWeight: 600, fontSize: '15px', color: 'var(--color-text-main)' }}>{order.productName}</div>
                                                    
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>Menge:</span>
                                                        <input 
                                                            type="number" 
                                                            min="1"
                                                            value={order.quantity} 
                                                            onChange={async (e) => {
                                                                const newQty = Number(e.target.value);
                                                                if (newQty < 1) return;
                                                                const updated = { ...order, quantity: newQty };
                                                                setOrders(prev => prev.map(o => o.id === order.id ? updated : o));
                                                                await DataService.updateOrder(updated);
                                                            }}
                                                            style={{ width: '60px', padding: '6px', borderRadius: '4px', border: '1px solid #cbd5e1', fontWeight: 600 }}
                                                        />
                                                    </div>

                                                    <input 
                                                        type="text"
                                                        placeholder="Notiz hinzufügen..."
                                                        value={order.notes || ''}
                                                        onChange={(e) => {
                                                            const updated = { ...order, notes: e.target.value };
                                                            setOrders(prev => prev.map(o => o.id === order.id ? updated : o));
                                                        }}
                                                        onBlur={async (e) => {
                                                            const updated = { ...order, notes: e.target.value };
                                                            await DataService.updateOrder(updated);
                                                        }}
                                                        style={{ width: '180px', padding: '6px 8px', borderRadius: '4px', border: '1px solid #fde68a', backgroundColor: '#fef3c7', color: '#92400e', fontSize: '13px' }}
                                                    />

                                                    <button 
                                                        onClick={async () => {
                                                            await DataService.deleteOrder(order.id);
                                                            setSessionGeneratedOrderIds(prev => prev.filter(id => id !== order.id));
                                                            loadOrders();
                                                        }}
                                                        style={{ padding: '6px', background: 'none', border: '1px solid #fecaca', borderRadius: '4px', color: '#ef4444', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fef2f2' }}
                                                        title="Löschen"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}


                            </div>
                            <div style={{ padding: 'var(--spacing-lg) var(--spacing-xl)', borderTop: '1px solid var(--color-border)', backgroundColor: '#f8fafc', borderBottomLeftRadius: 'var(--radius-xl)', borderBottomRightRadius: 'var(--radius-xl)', display: 'flex', justifyContent: 'flex-end' }}>
                                 <button onClick={() => { setIsProposalModalOpen(false); setSessionGeneratedOrderIds([]); }} style={{ padding: '10px 32px', backgroundColor: 'var(--color-primary)', color: 'white', border: 'none', borderRadius: 'var(--radius-md)', fontWeight: 600, cursor: 'pointer', fontSize: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                                     Fertig
                                 </button>
                            </div>
                        </div>
                    </div>
                )}

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
