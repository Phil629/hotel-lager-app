/* eslint-disable */
import { generateId } from "../utils";
import React, { useState, useEffect, useRef } from 'react';
import type { Product, Order, Supplier } from '../types';
import { DataService } from '../services/data';
import { StorageService } from '../services/storage';
import { Trash2, CheckCircle, Clock, Package, AlertTriangle, Calendar, Phone, Mail, X, Plus, Search, ExternalLink, CheckSquare, Edit2, ChevronDown, ChevronUp, ShoppingCart, Bot, Save, Settings, Truck } from 'lucide-react';
import { getSupabaseClient } from '../services/supabase';
import { Notification, type NotificationType } from '../components/Notification';
import { PhoneCallPanel } from '../components/PhoneCallPanel';
import { CheckoutButton } from '../components/CheckoutButton';

// ── KI-Log ───────────────────────────────────────────────────────────────────

interface InboundEmail {
    id: string;
    supplier_name: string;
    subject: string;
    body_text: string;
    extracted_data: {
        document_type?: string;
        confidence?: number;
        supplier_name?: string;
        items?: { product_name: string; quantity: number; price?: number }[];
        total_price?: number;
        order_date?: string;
        invoice_number?: string;
    } | null;
    status: string;
    created_at: string;
}

const timeAgo = (dateStr: string): string => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 2) return 'gerade eben';
    if (mins < 60) return `vor ${mins} Min.`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `vor ${hours} Std.`;
    const days = Math.floor(hours / 24);
    return `vor ${days} Tag${days !== 1 ? 'en' : ''}`;
};

const KiStatusBadge: React.FC<{ status: string }> = ({ status }) => {
    if (status === 'processed') return <span className="badge badge-success">Erfolgreich</span>;
    if (status === 'gemini_error') return <span className="badge badge-danger">KI-Fehler</span>;
    if (status === 'processed_duplicate') return <span className="badge badge-warning" title="Bestellung war bereits vorhanden">Duplikat</span>;
    return <span className="badge badge-neutral">{status}</span>;
};

const KiLogDetail: React.FC<{ email: InboundEmail }> = ({ email }) => {
    const d = email.extracted_data;
    const fmtPrice = (v: number) => v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });

    if (!d || email.status === 'gemini_error') {
        return (
            <div style={{ color: 'var(--color-danger)', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <AlertTriangle size={14} />
                KI konnte die E-Mail nicht verarbeiten – kein JSON extrahiert.
            </div>
        );
    }
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 24px', fontSize: '13px' }}>
                {d.document_type && <span><span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>Typ:</span> {d.document_type}</span>}
                {d.supplier_name && <span><span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>Lieferant:</span> {d.supplier_name}</span>}
                {d.order_date && <span><span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>Datum:</span> {d.order_date}</span>}
                {d.invoice_number && <span><span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>Belegnr.:</span> {d.invoice_number}</span>}
                {d.total_price != null && <span><span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>Gesamt:</span> {fmtPrice(d.total_price)}</span>}
                {d.confidence != null && (
                    <span>
                        <span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>Konfidenz:</span>{' '}
                        <span style={{ color: d.confidence >= 0.8 ? 'var(--color-success)' : d.confidence >= 0.5 ? 'var(--color-warning)' : 'var(--color-danger)', fontWeight: 600 }}>
                            {(d.confidence * 100).toFixed(0)}%
                        </span>
                    </span>
                )}
            </div>
            {d.items?.length ? (
                <div>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
                        {d.items.length} Positionen erkannt
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                        {d.items.slice(0, 12).map((item, i) => (
                            <span key={i} style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '3px 10px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                                {item.quantity}× {item.product_name}{item.price ? ` · ${fmtPrice(item.price)}` : ''}
                            </span>
                        ))}
                        {d.items.length > 12 && (
                            <span style={{ fontSize: '12px', color: 'var(--color-text-faint)', padding: '3px 4px' }}>
                                +{d.items.length - 12} weitere
                            </span>
                        )}
                    </div>
                </div>
            ) : (
                <div style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginTop: '8px', padding: '12px', backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}>
                    ℹ️ <strong>Keine Bestell-Daten erkannt:</strong> Diese E-Mail enthielt keine relevanten Positionen (vermutlich Newsletter oder Werbung). Es wurden <u>keine</u> Bestellungen angelegt.
                </div>
            )}
        </div>
    );
};

export const Orders: React.FC = () => {
    const [orders, setOrders] = useState<Order[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [defectModalOrder, setDefectModalOrder] = useState<Order | null>(null);
    const [defectModalOrderOptions, setDefectModalOrderOptions] = useState<Order[] | null>(null);
    const [defectNotes, setDefectNotes] = useState('');
    const [defectAdjustStock, setDefectAdjustStock] = useState(false);
    const [defectUsableQty, setDefectUsableQty] = useState<number | ''>('');
    const [deliveryDateModalOrder, setDeliveryDateModalOrder] = useState<Order | null>(null);
    const [deliveryDateModalOrders, setDeliveryDateModalOrders] = useState<Order[] | null>(null);
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
    const [minStockEdits, setMinStockEdits] = useState<Record<string, number | ''>>({});
    
    // Derived state for legacy compatibility
    const selectedProduct = orderCart.length > 0 ? orderCart[0].product : null;

    
    const [orderDate, setOrderDate] = useState(new Date().toISOString().split('T')[0]);
    const [orderNotes, setOrderNotes] = useState('');
    const [emailSubject, setEmailSubject] = useState('');
    const [emailBody, setEmailBody] = useState('');
    const [isOrderEmailExpanded, setIsOrderEmailExpanded] = useState(false);

    const [isCreatingNewProduct, setIsCreatingNewProduct] = useState(false);
    const [newSupplierProduct, setNewSupplierProduct] = useState('');
    const [filterCategory, setFilterCategory] = useState('');
    const [expandedSupplierGroups, setExpandedSupplierGroups] = useState<Record<string, boolean>>({});

    const getEffectiveOrderMethod = (product: Product) => {
        if (product.preferredOrderMethod) return product.preferredOrderMethod;
        const supplier = suppliers.find(s => s.id === product.supplierId);
        return supplier?.preferredOrderMethod || 'email';
    };
    const [editingOrder, setEditingOrder] = useState<Order | null>(null);
    const [orderToDelete, setOrderToDelete] = useState<Order | null>(null);

    // Pagination State
    const [visibleReceivedCount, setVisibleReceivedCount] = useState(10);
    const [searchOpenTerm, setSearchOpenTerm] = useState('');
    const [searchReceivedTerm, setSearchReceivedTerm] = useState('');
    const [expandedReceivedOrders, setExpandedReceivedOrders] = useState<Set<string>>(new Set());

    const [inboundEmails, setInboundEmails] = useState<InboundEmail[]>([]);
    const [showKiLogModal, setShowKiLogModal] = useState(false);
    const [selectedKiLog, setSelectedKiLog] = useState<InboundEmail | null>(null);

    const [phoneCallPanelData, setPhoneCallPanelData] = useState<{ order: Order; mode: 'order' | 'defect' } | null>(null);
    const [phoneCallProposalData, setPhoneCallProposalData] = useState<{ product: Product, quantity: number } | null>(null);

    const getSupplierForOrder = (order: Order) => {
        const product = products.find(p => p.name === order.productName);
        if (product?.supplierId) return suppliers.find(s => s.id === product.supplierId) ?? null;
        return suppliers.find(s => s.name === order.supplierName) ?? null;
    };

    const [expandedSuppliers, setExpandedSuppliers] = useState<Set<string>>(new Set());
    const toggleSupplier = (supplierKey: string) => {
        setExpandedSuppliers(prev => {
            const next = new Set(prev);
            if (next.has(supplierKey)) next.delete(supplierKey);
            else next.add(supplierKey);
            return next;
        });
    };

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

    const rtDebounce = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
    const debounced = (key: string, fn: () => void, ms = 300) => {
        clearTimeout(rtDebounce.current[key]);
        rtDebounce.current[key] = setTimeout(fn, ms);
    };

    useEffect(() => {
        loadOrders();
        loadProducts();
        loadSuppliers();
        loadInboundEmails();

        const supabase = getSupabaseClient();
        if (!supabase) return;

        // W8: eindeutiger Channel-Name pro Tab verhindert Konflikte
        const channelName = `orders_rt_${Math.random().toString(36).slice(2, 8)}`;
        const channel = supabase.channel(channelName)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
                debounced('orders', loadOrders);
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => {
                debounced('products', loadProducts);
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'suppliers' }, () => {
                debounced('suppliers', loadSuppliers);
            })
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'inbound_emails' }, () => {
                debounced('inbound_emails', loadInboundEmails);
            })
            .subscribe();

        return () => {
            Object.values(rtDebounce.current).forEach(clearTimeout);
            supabase.removeChannel(channel);
        };
    }, []);

    async function loadOrders() {
        const data = await DataService.getOrders();
        setOrders(data);
    };

    async function loadProducts() {
        const data = await DataService.getProducts();
        setProducts(data);
    };

    async function loadSuppliers() {
        const data = await DataService.getSuppliers();
        setSuppliers(data);
    };

    async function loadInboundEmails() {
        const supabase = getSupabaseClient();
        if (!supabase) return;
        const { data, error } = await supabase
            .from('inbound_emails')
            .select('id, supplier_name, subject, body_text, extracted_data, status, created_at')
            .order('created_at', { ascending: false })
            .limit(50);
        if (error) {
            console.error('Error loading inbound emails:', error);
        }
        if (data) setInboundEmails(data as InboundEmail[]);
    };

    
    const generateEmailTemplate = (cart: {product: Product, quantity: number}[]) => {
        if (cart.length === 0) return { subject: '', body: '' };
        const mainProduct = cart[0].product;
        const supplier = suppliers.find(s => s.id === mainProduct.supplierId);
        
        let subject = supplier?.emailSubjectTemplate || mainProduct.emailOrderSubject || `Bestellung: {product_name}`;
        let body = supplier?.emailBodyTemplate || mainProduct.emailOrderBody || `Sehr geehrte Damen und Herren,\n\nbitte liefern Sie {quantity}x {product_name} ({unit}).\n\nMit freundlichen Grüßen\nEinkauf`;

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
        const initialCart = [{ product, quantity: product.standardOrderQuantity || 1 }];
        setOrderCart(initialCart);
        setIsOrderEmailExpanded(getEffectiveOrderMethod(product) === 'email');

        const { subject, body } = generateEmailTemplate(initialCart);
        setEmailSubject(subject);
        setEmailBody(body);
    };

    const addToCart = (product: Product) => {
        setOrderCart(prev => {
            const newCart = [...prev, { product, quantity: product.standardOrderQuantity || 1 }];
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
            setNotification({ message: `Fehler: ${error instanceof Error ? error.message : JSON.stringify(error)}`, type: 'error' });
        }
    };

    const toggleOrderStatus = async (id: string) => {
        const order = orders.find(o => o.id === id);
        if (!order) return;
        try {
            if (order.status === 'open') {
                // mark_order_received: atomically sets status + received_at + updates product stock
                await DataService.markOrderReceived(id);
            } else {
                // unmark_order_received: atomically reverts status and stock
                await DataService.unmarkOrderReceived(id);
            }
            // Realtime will trigger reload; also load immediately for responsiveness
            loadOrders();
            loadProducts();
        } catch (err) {
            console.error('toggleOrderStatus error:', err);
            setNotification({ message: `Fehler beim Aktualisieren der Bestellung: ${err instanceof Error ? err.message : String(err)}`, type: 'error' });
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

    const openDefectModal = (target: Order | Order[]) => {
        setDefectAdjustStock(false);
        setDefectUsableQty('');
        if (Array.isArray(target) && target.length > 1) {
            setDefectModalOrderOptions(target);
            setDefectModalOrder({ id: 'ALL', productName: 'Alle Produkte der Lieferung', quantity: 0 } as any);
            setDefectNotes('');
        } else if (Array.isArray(target) && target.length === 1) {
            setDefectModalOrderOptions(null);
            setDefectModalOrder(target[0]);
            setDefectNotes(target[0].defectNotes || '');
        } else if (!Array.isArray(target)) {
            setDefectModalOrderOptions(null);
            setDefectModalOrder(target);
            setDefectNotes(target.defectNotes || '');
        }
    };

    const closeDefectModal = () => {
        setDefectModalOrder(null);
        setDefectModalOrderOptions(null);
        setDefectNotes('');
        setDefectAdjustStock(false);
        setDefectUsableQty('');
    };

    const saveDefect = async () => {
        if (!defectModalOrder || !defectNotes.trim()) return;
        try {
            const doAdjust = defectAdjustStock && defectUsableQty !== '' && defectModalOrder.id !== 'ALL';
            const usableQty = doAdjust ? Number(defectUsableQty) : 0;
            const isOpen = defectModalOrder.status === 'open';

            if (defectModalOrder.id === 'ALL' && defectModalOrderOptions) {
                for (const order of defectModalOrderOptions) {
                    await DataService.updateOrder({
                        ...order,
                        hasDefect: true,
                        defectNotes: defectNotes.trim(),
                        defectReportedAt: new Date().toISOString(),
                    });
                }
            } else {
                // If open order + stock adjustment: mark as received here so the standard
                // markOrderReceived RPC is never called later (prevents double-counting).
                const statusPatch = (doAdjust && isOpen)
                    ? { status: 'received' as const, receivedAt: new Date().toISOString() }
                    : {};
                await DataService.updateOrder({
                    ...defectModalOrder,
                    hasDefect: true,
                    defectNotes: defectNotes.trim(),
                    defectReportedAt: new Date().toISOString(),
                    ...statusPatch,
                });
            }

            if (doAdjust) {
                const product = products.find(p => p.name === defectModalOrder.productName);
                if (product) {
                    // Open order: stock not yet booked → add usable amount.
                    // Received order: full qty already booked → subtract the unusable difference.
                    const stockDelta = isOpen ? usableQty : usableQty - defectModalOrder.quantity;
                    const newStock = Math.max(0, product.stock + stockDelta);
                    await DataService.updateProduct({ ...product, stock: newStock });
                }
            }

            await loadOrders();
            closeDefectModal();
            setNotification({
                message: doAdjust ? 'Mangel gemeldet & Bestand korrigiert!' : 'Mangel wurde erfolgreich gemeldet!',
                type: 'success',
            });
        } catch (error: any) {
            console.error('Error saving defect:', error);
            const errorMsg = error?.message || error?.error_description || JSON.stringify(error);
            setNotification({ message: 'Fehler beim Speichern des Mangels: ' + errorMsg, type: 'error' });
        }
    };

    const sendDefectEmail = (order: Order) => {
        const product = products.find(p => p.name === order.productName);
        const supplier = getSupplierForOrder(order);
        const emailAddr = order.supplierEmail || product?.emailOrderAddress || supplier?.email || '';
        if (!emailAddr) {
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
            `Einkauf`
        );

        window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${emailAddr}&su=${subject}&body=${body}`, '_blank');
    };

    const openDeliveryDateModal = (target: Order | Order[]) => {
        if (Array.isArray(target)) {
            setDeliveryDateModalOrders(target);
            setDeliveryDateModalOrder(target[0]);
            setDeliveryDate(target[0].expectedDeliveryDate || '');
            setDeliveryTrackingLink(target[0].trackingLink || '');
        } else {
            setDeliveryDateModalOrders(null);
            setDeliveryDateModalOrder(target);
            setDeliveryDate(target.expectedDeliveryDate || '');
            setDeliveryTrackingLink(target.trackingLink || '');
        }
    };

    const closeDeliveryDateModal = () => {
        setDeliveryDateModalOrder(null);
        setDeliveryDateModalOrders(null);
        setDeliveryDate('');
        setDeliveryTrackingLink('');
    };

    const saveDeliveryDate = async () => {
        if (deliveryDateModalOrders) {
            for (const order of deliveryDateModalOrders) {
                const updatedOrder: Order = {
                    ...order,
                    expectedDeliveryDate: deliveryDate || undefined,
                    trackingLink: deliveryTrackingLink || undefined
                };
                await DataService.updateOrder(updatedOrder);
            }
            loadOrders();
            closeDeliveryDateModal();
        } else if (deliveryDateModalOrder) {
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
            const supplier = suppliers.find(s => s.id === product.supplierId);
            if (supplier && supplier.ignoreOrderProposals) continue;
            const min = Number(product.minStock || 0);
            if (min > 0 && product.stock <= min) {
                const productNameLower = product.name.trim().toLowerCase();
                const openOrdersForProduct = orders.filter(o =>
                    o.status === 'open' && o.productName.trim().toLowerCase() === productNameLower
                );
                const openQty = openOrdersForProduct.reduce((sum, o) => sum + o.quantity, 0);
                
                // Do not propose if it has already been ordered, or if stock + ordered >= min
                if (openQty > 0 || product.stock + openQty >= min) {
                    continue;
                }

                const standardQty = product.standardOrderQuantity ? product.standardOrderQuantity : min * 2;

                
                const needed = standardQty;
                if (needed > 0) {
                    const supplier = suppliers.find(s => s.id === product.supplierId);
                    proposals.push({
                        product,
                        supplierName: supplier ? supplier.name : 'Kein Lieferant',
                        supplierId: product.supplierId || 'unassigned',
                        quantity: needed,
                        openQty: openQty,
                        selected: true
                    });
                }
            }
        }
        return proposals;
    }, [products, orders, suppliers]);

    const productsWithoutMinStock = React.useMemo(
        () => products.filter(p => !p.ignoreOrderProposals && (!p.minStock || p.minStock === 0)),
        [products]
    );

    const handleOpenProposals = () => {
        setModalProposals(orderProposals);
        setSessionGeneratedOrderIds([]);
        setIsProposalModalOpen(true);
    };

    const handleSaveMinStock = async (productId: string) => {
        const val = minStockEdits[productId];
        if (val === '' || val === undefined || Number(val) <= 0) return;
        const prod = products.find(p => p.id === productId);
        if (!prod) return;
        await DataService.updateProduct({ ...prod, minStock: Number(val) });
        loadProducts();
    };

    
    const executeProposalDbSave = async (proposal: {product: Product, quantity: number}) => {
        try {
            const prod = proposal.product;
            const nowIso = new Date().toISOString();
            const newOrder: import('../types').Order = {
                 id: generateId(),
                 date: nowIso,
                 productName: prod.name,
                 quantity: proposal.quantity,
                 status: 'open',
                 productImage: prod.image,
                 supplierEmail: prod.emailOrderAddress,
                 supplierPhone: prod.supplierPhone,
                 notes: 'Aus Bestellvorschlägen generiert'
            };
            
            await DataService.saveOrder(newOrder);
            setSessionGeneratedOrderIds(prev => [...prev, newOrder.id]);
            setModalProposals(prev => prev.filter(p => p.product.id !== prod.id));
            loadOrders();
            setNotification({ message: 'Bestelldatensatz erfasst.', type: 'success' });
        } catch(e) {
            console.error('Order Proposal Error:', e);
            setNotification({ message: 'Fehler beim Speichern', type: 'error' });
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
        .filter(o => {
            if (!searchOpenTerm) return true;
            const term = searchOpenTerm.toLowerCase();
            return o.productName.toLowerCase().includes(term) || (o.supplierName && o.supplierName.toLowerCase().includes(term)) || (o.notes && o.notes.toLowerCase().includes(term));
        })
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
        .filter(o => {
            if (!searchReceivedTerm) return true;
            const term = searchReceivedTerm.toLowerCase();
            return o.productName.toLowerCase().includes(term) || (o.supplierName && o.supplierName.toLowerCase().includes(term)) || (o.notes && o.notes.toLowerCase().includes(term));
        })
        .sort((a, b) => {
            const aHasUnresolvedDefect = a.hasDefect && !a.defectResolved;
            const bHasUnresolvedDefect = b.hasDefect && !b.defectResolved;
            
            if (aHasUnresolvedDefect && !bHasUnresolvedDefect) return -1;
            if (!aHasUnresolvedDefect && bHasUnresolvedDefect) return 1;

            const dateA = a.receivedAt || a.date;
            const dateB = b.receivedAt || b.date;
            return new Date(dateB).getTime() - new Date(dateA).getTime();
        });



    
    const handleAcceptAi = async (orderId: string) => {
        const order = orders.find(o => o.id === orderId);
        if (!order || !order.aiRevisions) return;

        let updatedOrder = { ...order, aiRevisions: null };
        const d = new Date().toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
        
        const changes = [];
        if (order.aiRevisions.quantity && !order.aiRevisions.quantity.reverted) {
            changes.push(`Menge (${order.aiRevisions.quantity.suggested} statt ${order.aiRevisions.quantity.original})`);
        }
        if (order.aiRevisions.price && !order.aiRevisions.price.reverted) {
            changes.push(`Preis (${order.aiRevisions.price.suggested}€ statt ${order.aiRevisions.price.original}€)`);
        }
        if (order.aiRevisions.date && !order.aiRevisions.date.reverted) {
            const sgDate = new Date(order.aiRevisions.date.suggested).toLocaleDateString('de-DE');
            const ogDate = new Date(order.aiRevisions.date.original).toLocaleDateString('de-DE');
            changes.push(`Datum (${sgDate} statt ${ogDate})`);
        }

        const noteStr = `[KI-Log ${d}] KI-Änderungen beibehalten: ${changes.join(', ')}`;
        updatedOrder.notes = updatedOrder.notes ? `${updatedOrder.notes}\n${noteStr}` : noteStr;

        setOrders(prev => prev.map(o => o.id === orderId ? updatedOrder : o));
        await DataService.updateOrder(updatedOrder);
        setNotification({ message: 'KI-Änderungen bestätigt und übernommen.', type: 'success' });
    };

    const handleRevertAi = async (orderId: string, type: 'quantity' | 'price' | 'date' | 'all', originalValue: any) => {
        const order = orders.find(o => o.id === orderId);
        if (!order || !order.aiRevisions) return;

        let updatedOrder = { ...order };
        let updatedRevisions = { ...order.aiRevisions };
        const d = new Date().toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });

        let noteStr = '';

        if (type === 'all') {
            if (updatedRevisions.quantity) {
                updatedOrder.quantity = updatedRevisions.quantity.original;
                updatedRevisions.quantity.reverted = true;
            }
            if (updatedRevisions.price) {
                updatedOrder.price = updatedRevisions.price.original;
                updatedRevisions.price.reverted = true;
            }
            if (updatedRevisions.date) {
                updatedOrder.date = updatedRevisions.date.original;
                updatedRevisions.date.reverted = true;
            }
            noteStr = `[KI-Log ${d}] Alle KI-Eingriffe verworfen. Zurück auf manuelle Werte.`;
            updatedOrder.aiRevisions = null; // hide entirely since everything is discarded
        } else {
            if (type === 'quantity') {
                updatedOrder.quantity = originalValue;
                if (updatedRevisions.quantity) updatedRevisions.quantity.reverted = true;
                noteStr = `[KI-Log ${d}] KI-Menge abgelehnt (${originalValue} wiederhergestellt).`;
            }
            if (type === 'price') {
                updatedOrder.price = originalValue;
                if (updatedRevisions.price) updatedRevisions.price.reverted = true;
                noteStr = `[KI-Log ${d}] KI-Preis abgelehnt (${originalValue}€ wiederhergestellt).`;
            }
            if (type === 'date') {
                updatedOrder.date = originalValue;
                if (updatedRevisions.date) updatedRevisions.date.reverted = true;
                const ogDate = new Date(originalValue).toLocaleDateString('de-DE');
                noteStr = `[KI-Log ${d}] KI-Datum abgelehnt (${ogDate} wiederhergestellt).`;
            }
            updatedOrder.aiRevisions = updatedRevisions;
        }
        
        updatedOrder.notes = updatedOrder.notes ? `${updatedOrder.notes}\n${noteStr}` : noteStr;

        setOrders(prev => prev.map(o => o.id === orderId ? updatedOrder : o));
        await DataService.updateOrder(updatedOrder);
        setNotification({ message: 'KI-Änderung rückgängig gemacht.', type: 'info' });
    };

    const renderOrderCard = (order: Order) => {
        const currentProduct = products.find(p => p.name === order.productName);
        const displayImage = currentProduct?.image || order.productImage;
        
        return (
        <div key={order.id} style={{
            backgroundColor: getOrderBackgroundColor(order),
            padding: 'var(--spacing-lg)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-sm)',
            borderLeft: `4px solid ${getOrderBorderColor(order)}`
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--spacing-md)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)', flex: 1 }}>
                    {displayImage ? (
                        <img
                            src={displayImage}
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
                        <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', marginBottom: 'var(--spacing-xs)', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <span className="badge badge-primary">{order.quantity}x bestellt</span>
                            <span>Bestellt am: {new Date(order.date).toLocaleDateString('de-DE')}</span>
                            {order.supplierName && <span>• {order.supplierName}</span>}
                            {order.orderNumber && <span>• Nr: {order.orderNumber}</span>}
                            {order.price && <span>• {order.price.toFixed(2)} €</span>}
                        </div>
                        {order.notes && (
                            <div style={{ fontSize: 'var(--font-size-sm)', fontStyle: 'italic', marginBottom: 'var(--spacing-xs)', color: 'var(--color-text-main)' }}>
                                "{order.notes}"
                            </div>
                        )}
                        {(() => {
                            const product = products.find((p: Product) => p.name === order.productName);
                            if (!product) return null;
                            const supplier = suppliers.find(s => s.id === product.supplierId) ?? null;
                            const effectiveEmail = order.supplierEmail || product.emailOrderAddress || supplier?.email || '';
                            const effectivePhone = order.supplierPhone || product.supplierPhone || supplier?.orderPhone || supplier?.phone || '';
                            const effectiveUrl = product.orderUrl || supplier?.orderUrl || supplier?.url || supplier?.loginUrl || '';
                            const effMethod = getEffectiveOrderMethod(product);
                            return (
                                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '10px', marginBottom: '6px' }}>
                                    {effectiveUrl && (
                                        <a href={effectiveUrl} target="_blank" rel="noopener noreferrer"
                                            className={(effMethod === 'link' || effMethod === 'webshop') ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-ghost'}
                                        >
                                            <ExternalLink size={13} /> Webshop
                                            {(effMethod === 'link' || effMethod === 'webshop') && <span style={{ fontSize: '9px', opacity: 0.8 }}>(Standard)</span>}
                                        </a>
                                    )}
                                    {effectiveEmail && !product.autoOrder && (
                                        <a href={`https://mail.google.com/mail/?view=cm&fs=1&to=${effectiveEmail}`} target="_blank" rel="noopener noreferrer"
                                            className={effMethod === 'email' ? 'btn btn-sm btn-danger-solid' : 'btn btn-sm btn-ghost'}
                                            style={effMethod === 'email' ? { backgroundColor: '#EA4335' } : {}}
                                        >
                                            <Mail size={13} /> Gmail
                                            {effMethod === 'email' && <span style={{ fontSize: '9px', opacity: 0.8 }}>(Standard)</span>}
                                        </a>
                                    )}
                                    {effectivePhone && (
                                        <button
                                            onClick={() => setPhoneCallPanelData({ order, mode: 'order' })}
                                            className={effMethod === 'phone' ? 'btn btn-sm btn-warning' : 'btn btn-sm btn-ghost'}
                                        >
                                            <Phone size={13} /> Anrufen
                                            {effMethod === 'phone' && <span style={{ fontSize: '9px', opacity: 0.8 }}>(Standard)</span>}
                                        </button>
                                    )}
                                </div>
                            );
                        })()}
                        {(() => {
                            if (!order.aiRevisions) return null;
                            const revs = order.aiRevisions;
                            
                            const hasPendingQty = revs.quantity && !revs.quantity.reverted;
                            const hasPendingPrice = revs.price && !revs.price.reverted;
                            const hasPendingDate = revs.date && !revs.date.reverted;
                            
                            if (!hasPendingQty && !hasPendingPrice && !hasPendingDate) return null;
                            
                            return (
                                <div style={{ backgroundColor: '#fff8e1', border: '1px solid #ffe082', padding: '12px', borderRadius: 'var(--radius-md)', marginTop: '8px', marginBottom: '8px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#f57c00', fontWeight: 600, marginBottom: '12px', fontSize: 'var(--font-size-sm)' }}>
                                        <span>✨ KI-Aktualisierung erkannt:</span>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        {hasPendingQty && (
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px' }}>
                                                <span><strong style={{color:'#f57c00'}}>Menge: {revs.quantity?.suggested}</strong> (vorher {revs.quantity?.original})</span>
                                                <button onClick={() => handleRevertAi(order.id, 'quantity', revs.quantity?.original)} className="btn btn-sm btn-ghost" style={{ fontSize: '11px' }}>
                                                    Auf {revs.quantity?.original} zurücksetzen
                                                </button>
                                            </div>
                                        )}
                                        {hasPendingPrice && (
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px' }}>
                                                <span><strong style={{color:'#f57c00'}}>Preis: {revs.price?.suggested} €</strong> (vorher {revs.price?.original} €)</span>
                                                <button onClick={() => handleRevertAi(order.id, 'price', revs.price?.original)} className="btn btn-sm btn-ghost" style={{ fontSize: '11px' }}>
                                                    Zurücksetzen
                                                </button>
                                            </div>
                                        )}
                                        {hasPendingDate && (
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px' }}>
                                                <span><strong style={{color:'#f57c00'}}>Datum: {new Date(revs.date?.suggested || new Date()).toLocaleDateString('de-DE')}</strong> (vorher {new Date(revs.date?.original || new Date()).toLocaleDateString('de-DE')})</span>
                                                <button onClick={() => handleRevertAi(order.id, 'date', revs.date?.original)} className="btn btn-sm btn-ghost" style={{ fontSize: '11px' }}>
                                                    Zurücksetzen
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                    <div style={{ borderTop: '1px solid #ffe082', marginTop: '12px', paddingTop: '8px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                                        <button onClick={() => handleAcceptAi(order.id)} className="btn btn-sm btn-success">
                                            Alles beibehalten
                                        </button>
                                        <button onClick={() => handleRevertAi(order.id, 'all', 0)} className="btn btn-sm btn-warning">
                                            Alle verwerfen
                                        </button>
                                    </div>
                                </div>
                            );
                        })()}
                        {order.aiRevisions?.quantity?.reverted && <div style={{fontSize: '11px', color: '#9e9e9e', marginBottom: '4px'}}>↳ KI-Mengenänderung abgelehnt</div>}
                        {order.aiRevisions?.date?.reverted && <div style={{fontSize: '11px', color: '#9e9e9e', marginBottom: '4px'}}>↳ KI-Datumsänderung abgelehnt</div>}
                        {order.aiRevisions?.price?.reverted && <div style={{fontSize: '11px', color: '#9e9e9e', marginBottom: '4px'}}>↳ KI-Preisänderung abgelehnt</div>}
                        
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

                                        {(() => {
                                            const prod = products.find(p => p.name === order.productName);
                                            const supp = getSupplierForOrder(order);
                                            const effectiveEmail = order.supplierEmail || prod?.emailOrderAddress || supp?.email || '';
                                            const effectivePhone = order.supplierPhone || prod?.supplierPhone || supp?.orderPhone || supp?.phone || '';
                                            if (!effectiveEmail && !effectivePhone) return null;
                                            return (
                                                <div style={{ marginTop: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                                    {effectiveEmail && (
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
                                                                    `Einkauf`
                                                                );
                                                                window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${effectiveEmail}&su=${subject}&body=${body}`, '_blank');
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
                                                    {effectivePhone && (
                                                        <button
                                                            onClick={() => setPhoneCallPanelData({ order, mode: 'defect' })}
                                                            style={{
                                                                display: 'flex', alignItems: 'center', gap: '6px',
                                                                padding: '6px 12px',
                                                                backgroundColor: 'var(--color-surface)',
                                                                border: '1px solid #ff9800',
                                                                borderRadius: '4px',
                                                                color: '#ff9800',
                                                                fontSize: '12px',
                                                                cursor: 'pointer'
                                                            }}
                                                        >
                                                            <Phone size={14} />
                                                            Anruf vorbereiten
                                                        </button>
                                                    )}
                                                </div>
                                            );
                                        })()}
                                    </>
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
                        {(order.creatorEmail || order.updaterEmail) && (
                            <div style={{ marginTop: 'var(--spacing-sm)', paddingTop: 'var(--spacing-xs)', borderTop: '1px dashed var(--color-border)', fontSize: '11px', color: 'var(--color-text-muted)' }}>
                                {order.creatorEmail && <div>Erstellt von: {order.creatorEmail}</div>}
                                {order.updaterEmail && <div>Zuletzt bearbeitet von: {order.updaterEmail}</div>}
                            </div>
                        )}
                    </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: '130px' }}>
                    {order.status === 'open' && (
                        <>
                            <button onClick={() => toggleOrderStatus(order.id)} className="btn btn-sm btn-success">
                                <CheckCircle size={15} /> Erhalten
                            </button>
                            <button onClick={() => openDefectModal(order)} className="btn btn-sm btn-warning">
                                <AlertTriangle size={15} /> Mangel
                            </button>
                            {order.hasDefect && !!(order.supplierEmail || products.find(p => p.name === order.productName)?.emailOrderAddress || getSupplierForOrder(order)?.email) && (
                                <button onClick={() => sendDefectEmail(order)} className="btn btn-sm btn-ghost">
                                    <Mail size={15} /> Email senden
                                </button>
                            )}
                            <button onClick={() => openDeliveryDateModal(order)} className="btn btn-sm btn-ghost">
                                <Calendar size={15} /> Liefertermin
                            </button>
                            <button onClick={() => setEditingOrder(order)} className="btn btn-sm btn-ghost">
                                <Edit2 size={15} /> Bearbeiten
                            </button>
                            <button onClick={() => handleRepeatOrder(order)} className="btn btn-sm btn-ghost" style={{ color: 'var(--color-primary)', borderColor: '#bfdbfe' }}>
                                <Plus size={15} /> Wiederholen
                            </button>
                        </>
                    )}
                    {order.status === 'received' && (
                        <>
                            <button onClick={() => toggleOrderStatus(order.id)} className="btn btn-sm btn-ghost">
                                Rückgängig
                            </button>
                            <button onClick={() => setEditingOrder(order)} className="btn btn-sm btn-ghost">
                                <Edit2 size={15} /> Bearbeiten
                            </button>
                            <button onClick={() => handleRepeatOrder(order)} className="btn btn-sm btn-ghost" style={{ color: 'var(--color-primary)', borderColor: '#bfdbfe' }}>
                                <Plus size={15} /> Wiederholen
                            </button>
                        </>
                    )}
                </div>
                </div>
            </div>
        );
    };
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
                        className="btn btn-sm btn-ghost"
                        style={{ alignSelf: 'flex-start', marginTop: '4px', color: 'var(--color-primary)', borderColor: '#bfdbfe' }}
                    >
                        Details anzeigen
                    </button>
                </div>
            );
        }

        return (
            <div key={`expanded-${order.id}`}>
                {renderOrderCard(order)}
                {!hasUnresolvedDefect && (
                    <div style={{ marginTop: '8px', textAlign: 'center' }}>
                        <button onClick={() => toggleReceivedOrder(order.id)} className="btn btn-sm btn-ghost" style={{ color: 'var(--color-primary)' }}>
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
            <div className="page-header">
                <h2 className="page-title">Bestellungen</h2>
                <div style={{ display: 'flex', gap: 'var(--spacing-md)' }}>

                    {orderProposals.length > 0 ? (
                        <button onClick={handleOpenProposals} className="btn btn-warning">
                            ✨ Bestellvorschläge ({orderProposals.length})
                        </button>
                    ) : (
                        <button onClick={handleOpenProposals} className="btn btn-success" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <CheckCircle size={16} /> Alles bestellt
                        </button>
                    )}

                    <button onClick={() => setIsCreateModalOpen(true)} className="btn btn-primary">
                        <Plus size={18} /> Neue Bestellung
                    </button>

                    </div>

                    </div>

            {/* ── KI-Import Banner ── */}
            {inboundEmails.length > 0 && (
                <div
                    onClick={() => setShowKiLogModal(true)}
                    style={{
                        marginBottom: 'var(--spacing-lg)',
                        padding: '9px 16px',
                        backgroundColor: 'var(--color-surface-elevated)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-lg)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                    }}
                >
                    <Bot size={15} color="var(--color-primary)" style={{ flexShrink: 0 }} />
                    <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        Letzter KI-Import:
                    </span>
                    <span style={{ fontSize: '13px', color: 'var(--color-text-muted)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {inboundEmails[0].subject || '(kein Betreff)'}
                    </span>
                    <span style={{ fontSize: '12px', color: 'var(--color-text-faint)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                        {timeAgo(inboundEmails[0].created_at)}
                    </span>
                    <div style={{ flexShrink: 0 }}>
                        <KiStatusBadge status={inboundEmails[0].status} />
                    </div>
                    <ChevronDown size={14} color="var(--color-text-muted)" style={{ flexShrink: 0, transform: 'rotate(-90deg)' }} />
                </div>
            )}

            <div style={{ marginBottom: 'var(--spacing-2xl)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--spacing-lg)', flexWrap: 'wrap', gap: '16px' }}>
                    <h3 style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--spacing-sm)',
                        color: 'var(--color-primary)',
                        margin: 0
                    }}>
                        <Clock size={24} />
                        Offene Bestellungen
                    </h3>
                    <div style={{ display: 'flex', alignItems: 'center', backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-full)', padding: '6px 16px', border: '1px solid var(--color-border)', flex: '1 1 250px', maxWidth: '400px' }}>
                        <Search size={18} color="var(--color-text-muted)" style={{ marginRight: '8px' }} />
                        <input
                            type="text"
                            placeholder="Offene Bestellungen suchen..."
                            value={searchOpenTerm}
                            onChange={e => setSearchOpenTerm(e.target.value)}
                            style={{ border: 'none', background: 'transparent', outline: 'none', width: '100%', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-main)' }}
                        />
                    </div>
                </div>

                {openOrders.length === 0 ? (
                    <div style={{
                        padding: 'var(--spacing-xl)',
                        textAlign: 'center',
                        backgroundColor: 'var(--color-surface)',
                        borderRadius: 'var(--radius-lg)',
                        color: 'var(--color-text-muted)'
                    }}>
                        {orders.filter(o => o.status === 'open').length === 0 && orders.some(o => o.status === 'received') ? (
                            <>
                                <CheckCircle size={48} color="#22c55e" style={{ marginBottom: '16px' }} />
                                <h3 style={{ margin: '0 0 8px 0', color: '#16a34a' }}>Alle Bestellungen erledigt</h3>
                                <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Keine offenen Bestellungen — alles wurde empfangen.</p>
                            </>
                        ) : orders.filter(o => o.status === 'open').length === 0 ? (
                            <>
                                <ShoppingCart size={48} color="#cbd5e1" style={{ marginBottom: '16px' }} />
                                <h3 style={{ margin: '0 0 8px 0', color: 'var(--color-text-main)' }}>Noch keine Bestellungen</h3>
                                <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Lege deine erste Bestellung an.</p>
                            </>
                        ) : (
                            "Keine passenden offenen Bestellungen gefunden."
                        )}
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-xl)' }}>
                        {Array.from(new Set(openOrders.map(o => {
                            const p = products.find(prod => prod.name === o.productName);
                            return p?.supplierId || o.supplierName || 'Sonstige / Einmalbestellungen';
                        }))).map(supplierKey => {
                            const supplier = suppliers.find(s => s.id === supplierKey);
                            const supplierName = supplier?.name || (supplierKey === 'Sonstige / Einmalbestellungen' ? supplierKey : (openOrders.find(o => o.supplierName === supplierKey)?.supplierName || 'Unbekannter Lieferant'));
                            const supplierOrders = openOrders.filter(o => {
                                const p = products.find(prod => prod.name === o.productName);
                                return (p?.supplierId || o.supplierName || 'Sonstige / Einmalbestellungen') === supplierKey;
                            });

                            const isExpanded = expandedSuppliers.has(supplierKey);
                            
                            // Calculate supplier properties for styling
                            const hasDefect = supplierOrders.some(o => o.hasDefect && !o.defectResolved);
                            const isDelayed = supplierOrders.some(o => o.expectedDeliveryDate && new Date(o.expectedDeliveryDate).setHours(0,0,0,0) < new Date().setHours(0,0,0,0));
                            const supplierDeliveryDate = supplierOrders.map(o => o.expectedDeliveryDate).find(d => !!d);
                            
                            const supplierBgColor = hasDefect ? '#fff3e0' : isDelayed ? '#ffebee' : '#f8fafc';
                            const supplierBorderColor = hasDefect ? '#ff9800' : isDelayed ? '#f44336' : 'var(--color-border)';
                            const iconColor = hasDefect ? '#ff9800' : isDelayed ? '#f44336' : 'var(--color-primary)';
                            
                            return (
                                <div key={supplierKey} style={{
                                    backgroundColor: 'var(--color-surface)',
                                    borderRadius: 'var(--radius-lg)',
                                    border: `1px solid ${supplierBorderColor}`,
                                    overflow: 'hidden',
                                    transition: 'all 0.2s ease-in-out'
                                }}>
                                    <div style={{
                                        padding: 'var(--spacing-md) var(--spacing-lg)',
                                        backgroundColor: supplierBgColor,
                                        borderBottom: isExpanded ? `1px solid ${supplierBorderColor}` : 'none',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        flexWrap: 'wrap',
                                        gap: 'var(--spacing-md)'
                                    }}>
                                        <div 
                                            onClick={() => toggleSupplier(supplierKey)}
                                            style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', flex: 1 }}
                                        >
                                            <div style={{ color: 'var(--color-text-muted)' }}>
                                                {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                                            </div>
                                            <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '15px', fontWeight: 700, color: 'var(--color-text-main)', flexWrap: 'wrap' }}>
                                                <Package size={17} color={iconColor} />
                                                {supplierName}
                                                <span className="badge badge-neutral">{supplierOrders.length}</span>
                                                {hasDefect && <span className="badge badge-warning"><AlertTriangle size={11} /> Mangel</span>}
                                                {isDelayed && <span className="badge badge-danger"><Clock size={11} /> Verspätet</span>}
                                                {!isDelayed && supplierDeliveryDate && (
                                                    <span className="badge badge-primary"><Calendar size={11} /> {new Date(supplierDeliveryDate).toLocaleDateString('de-DE')}</span>
                                                )}
                                            </h4>
                                        </div>
                                        <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); openDeliveryDateModal(supplierOrders); }}
                                                className="btn btn-sm btn-ghost"
                                                title="Liefertermin für gesamte Lieferung setzen"
                                            >
                                                <Calendar size={15} /> Termin
                                            </button>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); openDefectModal(supplierOrders); }}
                                                className="btn btn-sm btn-warning"
                                                title="Mangel bei einem Produkt der Lieferung melden"
                                            >
                                                <AlertTriangle size={15} /> Mangel
                                            </button>
                                            <button
                                                onClick={async (e) => {
                                                    e.stopPropagation();
                                                    for (const o of supplierOrders) { await toggleOrderStatus(o.id); }
                                                    setNotification({ message: `Alle ${supplierOrders.length} Bestellungen von ${supplierName} als erhalten markiert.`, type: 'success' });
                                                }}
                                                className="btn btn-sm btn-success"
                                            >
                                                <CheckSquare size={15} /> Alle erhalten
                                            </button>
                                        </div>
                                    </div>
                                    {isExpanded && (
                                        <div style={{ padding: 'var(--spacing-md)', display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                                            {supplierOrders.map(renderOrderCard)}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--spacing-lg)', flexWrap: 'wrap', gap: '16px' }}>
                    <h3 style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--spacing-sm)',
                        color: 'var(--color-success)',
                        margin: 0
                    }}>
                        <CheckCircle size={24} />
                        Erhaltene Bestellungen
                    </h3>
                    <div style={{ display: 'flex', alignItems: 'center', backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-full)', padding: '6px 16px', border: '1px solid var(--color-border)', flex: '1 1 250px', maxWidth: '400px' }}>
                        <Search size={18} color="var(--color-text-muted)" style={{ marginRight: '8px' }} />
                        <input
                            type="text"
                            placeholder="Erhaltene Bestellungen suchen..."
                            value={searchReceivedTerm}
                            onChange={e => setSearchReceivedTerm(e.target.value)}
                            style={{ border: 'none', background: 'transparent', outline: 'none', width: '100%', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-main)' }}
                        />
                    </div>
                </div>

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
                            <button onClick={() => setVisibleReceivedCount(prev => prev + 10)} className="btn btn-ghost" style={{ marginTop: '8px', width: '100%', justifyContent: 'center' }}>
                                Mehr laden ({receivedOrders.length - visibleReceivedCount} verbleibend)
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* Create Order Modal */}
            {isCreateModalOpen && (
                <div className="modal-overlay">
                    <div className="modal-box" style={{ maxWidth: '600px' }}>
                        <div className="modal-header">
                            <h3 style={{ margin: 0, fontSize: 'var(--font-size-lg)' }}>Neue Bestellung</h3>
                            <button onClick={() => setIsCreateModalOpen(false)} className="btn btn-ghost btn-icon">
                                <X size={20} />
                            </button>
                        </div>

                        {/* Tabs */}
                        <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface-elevated)' }}>
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

                        <div className="modal-body">
                        {createTab === 'existing' ? (
                            <>
                                <div style={{ display: 'flex', gap: '8px', marginBottom: 'var(--spacing-md)' }}>
                                    <div style={{ position: 'relative', flex: 1 }}>
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
                                    <select
                                        value={filterCategory}
                                        onChange={e => setFilterCategory(e.target.value)}
                                        style={{
                                            padding: '10px',
                                            borderRadius: 'var(--radius-md)',
                                            border: '1px solid var(--color-border)',
                                            fontSize: 'var(--font-size-md)',
                                            backgroundColor: 'var(--color-surface)',
                                            color: 'var(--color-text-main)'
                                        }}
                                    >
                                        <option value="">Alle Kategorien</option>
                                        {Array.from(new Set(products.map(p => p.category).filter(Boolean))).map(cat => (
                                            <option key={cat} value={cat}>{cat}</option>
                                        ))}
                                    </select>
                                </div>

                                {!selectedProduct ? (
                                    <div style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
                                        {(() => {
                                            const filteredProducts = products.filter(p => {
                                                const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase());
                                                const matchesCategory = filterCategory ? p.category === filterCategory : true;
                                                return matchesSearch && matchesCategory;
                                            });
                                            if (filteredProducts.length === 0) return <div style={{ padding: '16px', color: 'var(--color-text-muted)', textAlign: 'center' }}>Keine Produkte gefunden.</div>;
                                            
                                            // Group by supplier
                                            const grouped: Record<string, Product[]> = {};
                                            filteredProducts.forEach(p => {
                                                const sId = p.supplierId || 'none';
                                                if (!grouped[sId]) grouped[sId] = [];
                                                grouped[sId].push(p);
                                            });

                                            const isSearchingOrFiltering = searchTerm !== '' || filterCategory !== '';

                                            return Object.entries(grouped).map(([supplierId, prods]) => {
                                                const supplierName = supplierId === 'none' ? 'Sonstige / Ohne Lieferant' : (suppliers.find(s => s.id === supplierId)?.name || 'Unbekannter Lieferant');
                                                const isExpanded = isSearchingOrFiltering || expandedSupplierGroups[supplierId];
                                                const visibleProds = isExpanded ? prods : prods.slice(0, 2);
                                                const hiddenCount = prods.length - visibleProds.length;

                                                return (
                                                    <div key={supplierId} style={{ marginBottom: 'var(--spacing-md)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden', backgroundColor: 'var(--color-surface)', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                                                        <div style={{ padding: '10px 14px', backgroundColor: 'var(--color-surface-elevated)', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: '8px', position: 'sticky', top: 0, zIndex: 1 }}>
                                                            <Truck size={16} color="var(--color-text-muted)" />
                                                            <strong style={{ fontSize: '14px', color: 'var(--color-text-main)' }}>{supplierName}</strong>
                                                            <span style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--color-text-muted)', backgroundColor: 'var(--color-background)', padding: '2px 8px', borderRadius: '10px', border: '1px solid var(--color-border)' }}>{prods.length} {prods.length === 1 ? 'Produkt' : 'Produkte'}</span>
                                                        </div>
                                                        <div style={{ padding: '0' }}>
                                                            {visibleProds.map(product => (
                                                                <div
                                                                    key={product.id}
                                                                    onClick={() => handleProductSelect(product)}
                                                                    style={{
                                                                        padding: '12px 14px',
                                                                        borderBottom: '1px solid var(--color-border)',
                                                                        cursor: 'pointer',
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        gap: '12px',
                                                                        transition: 'background-color 0.2s'
                                                                    }}
                                                                    onMouseEnter={e => e.currentTarget.style.backgroundColor = '#f8fafc'}
                                                                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                                                                >
                                                                    {product.image ? (
                                                                        <img src={product.image} alt="" style={{ width: '40px', height: '40px', objectFit: 'cover', borderRadius: '6px', border: '1px solid var(--color-border)' }} />
                                                                    ) : (
                                                                        <div style={{ width: '40px', height: '40px', backgroundColor: '#f1f5f9', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--color-border)' }}>
                                                                            <Package size={20} color="#94a3b8" />
                                                                        </div>
                                                                    )}
                                                                    <div>
                                                                        <div style={{ fontWeight: 600, color: 'var(--color-text-main)', fontSize: '14px' }}>{product.name}</div>
                                                                        <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '2px' }}>Bestand: {product.stock} {product.unit}</div>
                                                                    </div>
                                                                    <div style={{ marginLeft: 'auto' }}>
                                                                        <button type="button" className="btn btn-sm btn-ghost" style={{ padding: '6px', color: 'var(--color-primary)' }}>
                                                                            <Plus size={16} />
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                        {!isExpanded && hiddenCount > 0 && (
                                                            <button 
                                                                type="button" 
                                                                onClick={() => setExpandedSupplierGroups(prev => ({ ...prev, [supplierId]: true }))}
                                                                style={{ padding: '10px 14px', width: '100%', textAlign: 'center', border: 'none', backgroundColor: '#f8fafc', color: 'var(--color-primary)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                                                                onMouseEnter={e => e.currentTarget.style.backgroundColor = '#f1f5f9'}
                                                                onMouseLeave={e => e.currentTarget.style.backgroundColor = '#f8fafc'}
                                                            >
                                                                <ChevronDown size={16} /> {hiddenCount} weitere Produkte einblenden
                                                            </button>
                                                        )}
                                                    </div>
                                                );
                                            });
                                        })()}
                                    </div>
                                ) : (
                                    <div style={{ padding: '0', border: 'none', borderRadius: '0' }}>
                                        <div style={{ padding: '16px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 'var(--radius-md)', marginBottom: 'var(--spacing-lg)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                {selectedProduct.image ? (
                                                    <img src={selectedProduct.image} alt={selectedProduct.name} style={{ width: '48px', height: '48px', borderRadius: '6px', objectFit: 'cover' }} />
                                                ) : (
                                                    <div style={{ width: '48px', height: '48px', borderRadius: '6px', backgroundColor: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                        <Package size={24} color="#64748b" />
                                                    </div>
                                                )}
                                                <div>
                                                    <div style={{ fontSize: '13px', color: '#64748b', fontWeight: 500, marginBottom: '2px' }}>Ausgewähltes Produkt</div>
                                                    <div style={{ fontSize: '16px', fontWeight: 600, color: '#0f172a', margin: 0 }}>{selectedProduct.name}</div>
                                                </div>
                                            </div>
                                            <button 
                                                onClick={(e) => { e.preventDefault(); setSelectedProduct(null); }}
                                                className="btn btn-ghost"
                                                style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#3b82f6', backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', padding: '8px 12px', fontSize: '14px', borderRadius: '6px' }}
                                                type="button"
                                            >
                                                <Edit2 size={16} /> Produkt ändern
                                            </button>
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
                                                            value={item.quantity === 0 ? '' : item.quantity} 
                                                            onChange={e => {
                                                                const val = e.target.value;
                                                                updateCartQuantity(index, val === '' ? 0 : Number(val.replace(/^0+/, '')) || 0);
                                                            }}
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
                                                                    <Plus size={14} /> {p.name}
                                                                </button>
                                                            ))}
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                                {isCreatingNewProduct ? (
                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                                        <input 
                                                                            type="text" 
                                                                            placeholder="Produktname..." 
                                                                            value={newSupplierProduct} 
                                                                            onChange={e => setNewSupplierProduct(e.target.value)}
                                                                            style={{ padding: '4px 8px', fontSize: '13px', borderRadius: '4px', border: '1px solid var(--color-border)', width: '150px' }}
                                                                            autoFocus
                                                                            onKeyDown={async e => {
                                                                                if (e.key === 'Enter') {
                                                                                    e.preventDefault();
                                                                                    if (!newSupplierProduct.trim()) return;
                                                                                    const newProduct: any = {
                                                                                        id: generateId(),
                                                                                        name: newSupplierProduct.trim(),
                                                                                        supplierId: supplierId,
                                                                                        category: 'Sonstiges',
                                                                                        unit: 'Stück',
                                                                                        stock: 0,
                                                                                        price: 0
                                                                                    };
                                                                                    await DataService.saveProduct(newProduct);
                                                                                    await loadProducts();
                                                                                    addToCart(newProduct);
                                                                                    setNewSupplierProduct('');
                                                                                    setIsCreatingNewProduct(false);
                                                                                }
                                                                            }}
                                                                        />
                                                                        <button type="button" onClick={async () => {
                                                                            if (!newSupplierProduct.trim()) return;
                                                                            const newProduct: any = {
                                                                                id: generateId(),
                                                                                name: newSupplierProduct.trim(),
                                                                                supplierId: supplierId,
                                                                                category: 'Sonstiges',
                                                                                unit: 'Stück',
                                                                                stock: 0,
                                                                                price: 0
                                                                            };
                                                                            await DataService.saveProduct(newProduct);
                                                                            await loadProducts();
                                                                            addToCart(newProduct);
                                                                            setNewSupplierProduct('');
                                                                            setIsCreatingNewProduct(false);
                                                                        }} className="btn btn-sm btn-primary" style={{ padding: '4px 8px' }}>Hinzufügen</button>
                                                                        <button type="button" onClick={() => { setIsCreatingNewProduct(false); setNewSupplierProduct(''); }} className="btn btn-sm btn-ghost" style={{ padding: '4px' }}><X size={14} /></button>
                                                                    </div>
                                                                ) : (
                                                                    <button 
                                                                        type="button" 
                                                                        onClick={() => setIsCreatingNewProduct(true)}
                                                                        style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 10px', borderRadius: 'var(--radius-md)', border: '1px dashed var(--color-border)', backgroundColor: 'transparent', fontSize: 'var(--font-size-xs)', cursor: 'pointer', color: 'var(--color-primary)', fontWeight: 600 }}
                                                                    >
                                                                        <Plus size={14} /> Neues Produkt anlegen
                                                                    </button>
                                                                )}
                                                            </div>
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
                                            {selectedProduct.supplierId && (
                                                <div style={{
                                                    backgroundColor: 'rgba(37, 99, 235, 0.05)',
                                                    padding: 'var(--spacing-md)',
                                                    borderRadius: 'var(--radius-md)',
                                                    border: '2px solid var(--color-primary)',
                                                    order: -2
                                                }}>
                                                    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--spacing-sm)', fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>
                                                        KI-Checkout Autopilot:
                                                    </label>
                                                    <CheckoutButton 
                                                        supplierId={selectedProduct.supplierId}
                                                        supplierName={suppliers.find(s => s.id === selectedProduct.supplierId)?.name || 'Lieferant'}
                                                        items={orderCart.map(c => ({
                                                            product_id: c.product.id,
                                                            product_name: c.product.name,
                                                            quantity: c.quantity,
                                                            unit: c.product.unit,
                                                            price_expected: c.product.price || undefined
                                                        }))}
                                                    />
                                                </div>
                                            )}

                                            {(selectedProduct.supplierPhone || (suppliers.find(s => s.id === selectedProduct.supplierId)?.phone)) && (
                                                <div style={{
                                                    backgroundColor: getEffectiveOrderMethod(selectedProduct) === 'phone' ? 'rgba(37, 99, 235, 0.05)' : 'var(--color-background)',
                                                    padding: 'var(--spacing-md)',
                                                    borderRadius: 'var(--radius-md)',
                                                    border: getEffectiveOrderMethod(selectedProduct) === 'phone' ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                                                    order: getEffectiveOrderMethod(selectedProduct) === 'phone' ? -1 : 0
                                                }}>
                                                    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--spacing-sm)', fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>
                                                        Telefonische Bestellung:
                                                        {getEffectiveOrderMethod(selectedProduct) === 'phone' && (
                                                            <span style={{ fontSize: '10px', backgroundColor: 'var(--color-primary)', color: 'white', padding: '2px 6px', borderRadius: '10px' }}>STANDARD</span>
                                                        )}
                                                    </label>
                                                    <div
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
                                                            fontWeight: 500
                                                        }}>
                                                            <div
                                                                style={{
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '6px',
                                                                    fontWeight: 500
                                                                }}
                                                            >
                                                                <Phone size={16} color="var(--color-primary)" />
                                                                {selectedProduct.supplierPhone || suppliers.find(s => s.id === selectedProduct.supplierId)?.phone}
                                                                {suppliers.find(s => s.id === selectedProduct.supplierId)?.customerNumber && (
                                                                    <span style={{ marginLeft: '12px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
                                                                        KdNr: <strong style={{ color: 'var(--color-text-main)' }}>{suppliers.find(s => s.id === selectedProduct.supplierId)?.customerNumber}</strong>
                                                                    </span>
                                                                )}
                                                            </div>
                                                    </div>
                                                </div>
                                            )}
                                            {(selectedProduct.orderUrl || suppliers.find(s => s.id === selectedProduct.supplierId)?.orderUrl || suppliers.find(s => s.id === selectedProduct.supplierId)?.url || suppliers.find(s => s.id === selectedProduct.supplierId)?.loginUrl) && (
                                                <div style={{
                                                    backgroundColor: (getEffectiveOrderMethod(selectedProduct) === 'link' || getEffectiveOrderMethod(selectedProduct) === 'webshop') ? 'rgba(37, 99, 235, 0.05)' : 'var(--color-background)',
                                                    padding: 'var(--spacing-md)',
                                                    borderRadius: 'var(--radius-md)',
                                                    border: (getEffectiveOrderMethod(selectedProduct) === 'link' || getEffectiveOrderMethod(selectedProduct) === 'webshop') ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                                                    order: (getEffectiveOrderMethod(selectedProduct) === 'link' || getEffectiveOrderMethod(selectedProduct) === 'webshop') ? -1 : 0
                                                }}>
                                                    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--spacing-sm)', fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>
                                                        Bestelllink:
                                                        {(getEffectiveOrderMethod(selectedProduct) === 'link' || getEffectiveOrderMethod(selectedProduct) === 'webshop') && (
                                                            <span style={{ fontSize: '10px', backgroundColor: 'var(--color-primary)', color: 'white', padding: '2px 6px', borderRadius: '10px' }}>STANDARD</span>
                                                        )}
                                                    </label>
                                                    <a
                                                        href={selectedProduct.orderUrl || suppliers.find(s => s.id === selectedProduct.supplierId)?.orderUrl || suppliers.find(s => s.id === selectedProduct.supplierId)?.url || suppliers.find(s => s.id === selectedProduct.supplierId)?.loginUrl || ''}
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
                                                            backgroundColor: (getEffectiveOrderMethod(selectedProduct) === 'link' || getEffectiveOrderMethod(selectedProduct) === 'webshop') ? 'var(--color-primary)' : 'var(--color-surface)',
                                                            color: (getEffectiveOrderMethod(selectedProduct) === 'link' || getEffectiveOrderMethod(selectedProduct) === 'webshop') ? 'white' : 'var(--color-text-main)',
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

                                            {(selectedProduct.emailOrderAddress || suppliers.find(s => s.id === selectedProduct.supplierId)?.email) && !selectedProduct.autoOrder && (
                                                <>
                                                    {getEffectiveOrderMethod(selectedProduct) !== 'email' && !isOrderEmailExpanded ? (
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
                                                            backgroundColor: getEffectiveOrderMethod(selectedProduct) === 'email' ? 'rgba(37, 99, 235, 0.05)' : 'var(--color-background)',
                                                            padding: 'var(--spacing-md)',
                                                            borderRadius: 'var(--radius-md)',
                                                            border: getEffectiveOrderMethod(selectedProduct) === 'email' ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                                                            order: getEffectiveOrderMethod(selectedProduct) === 'email' ? -1 : 0
                                                        }}>
                                                            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--spacing-sm)', fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>
                                                                Email Vorschau & Bearbeitung:
                                                                {getEffectiveOrderMethod(selectedProduct) === 'email' && (
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
                                                                    const emailTo = selectedProduct.emailOrderAddress || suppliers.find(s => s.id === selectedProduct.supplierId)?.email || '';
                                                                    window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${emailTo}&su=${encodedSubject}&body=${encodedBody}`, '_blank');
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
                                                    supplierEmail: supplier.email || '',
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
                            </div>
                        )}
                        </div>{/* modal-body */}
                        <div className="modal-footer">
                            <button onClick={() => setIsCreateModalOpen(false)} className="btn btn-ghost">Abbrechen</button>
                            <button onClick={handleCreateOrder} className="btn btn-primary">Bestellung anlegen</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Phone Call Panel */}
            {phoneCallPanelData && (
                <PhoneCallPanel
                    mode={phoneCallPanelData.mode}
                    order={phoneCallPanelData.order}
                    supplier={getSupplierForOrder(phoneCallPanelData.order)}
                    supplierPhone={phoneCallPanelData.order.supplierPhone}
                    supplierName={phoneCallPanelData.order.supplierName}
                    onClose={() => setPhoneCallPanelData(null)}
                />
            )}
            
            {phoneCallProposalData && (
                <PhoneCallPanel
                    mode="order"
                    supplier={suppliers.find(s => s.id === phoneCallProposalData.product.supplierId) ?? null}
                    lowStockProducts={[{
                        product: phoneCallProposalData.product,
                        suggestedQty: phoneCallProposalData.quantity
                    }]}
                    onClose={() => setPhoneCallProposalData(null)}
                />
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
                            {defectModalOrderOptions && defectModalOrderOptions.length > 1 ? (
                                <div style={{ marginBottom: 'var(--spacing-md)' }}>
                                    <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>
                                        Produkt auswählen
                                    </label>
                                    <select
                                        value={defectModalOrder.id}
                                        onChange={e => {
                                            if (e.target.value === 'ALL') {
                                                setDefectModalOrder({ id: 'ALL', productName: 'Alle Produkte der Lieferung', quantity: 0 } as any);
                                                setDefectNotes('');
                                            } else {
                                                const selected = defectModalOrderOptions.find(o => o.id === e.target.value);
                                                if (selected) {
                                                    setDefectModalOrder(selected);
                                                    setDefectNotes(selected.defectNotes || '');
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
                                        {defectModalOrderOptions.map(o => (
                                            <option key={o.id} value={o.id}>{o.productName} ({o.quantity}x)</option>
                                        ))}
                                    </select>
                                </div>
                            ) : (
                                <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--spacing-md)' }}>
                                    Produkt: <strong>{defectModalOrder.productName}</strong>
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
                            </div>
                            {/* Stock adjustment section — hidden for "ALL" grouped orders */}
                            {defectModalOrder.id !== 'ALL' && (() => {
                                const product = products.find(p => p.name === defectModalOrder.productName);
                                if (!product) return null;
                                const isOpen = defectModalOrder.status === 'open';
                                const usable = defectUsableQty === '' ? defectModalOrder.quantity : Number(defectUsableQty);
                                const stockDelta = isOpen ? usable : usable - defectModalOrder.quantity;
                                const newStock = Math.max(0, product.stock + stockDelta);
                                const belowMin = product.minStock !== undefined && newStock < product.minStock;
                                return (
                                    <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 'var(--spacing-md)', marginBottom: 'var(--spacing-md)' }}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', marginBottom: defectAdjustStock ? 'var(--spacing-md)' : 0 }}>
                                            <input
                                                type="checkbox"
                                                checked={defectAdjustStock}
                                                onChange={e => {
                                                    setDefectAdjustStock(e.target.checked);
                                                    if (e.target.checked && defectUsableQty === '') setDefectUsableQty(defectModalOrder.quantity);
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
                                                    <span>Bestellmenge: <strong style={{ color: 'var(--color-text-main)' }}>{defectModalOrder.quantity} {product.unit}</strong></span>
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
                                );
                            })()}

                            <div style={{ display: 'flex', gap: 'var(--spacing-sm)', justifyContent: 'flex-end' }}>
                                <button
                                    onClick={closeDefectModal}
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
                                    {defectAdjustStock ? 'Mangel & Bestand speichern' : 'Mangel speichern'}
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
                                {deliveryDateModalOrders && deliveryDateModalOrders.length > 1 ? (
                                    <>Lieferant: <strong>{deliveryDateModalOrder.supplierName || 'Lieferung'}</strong> ({deliveryDateModalOrders.length} Produkte)</>
                                ) : (
                                    <>Produkt: <strong>{deliveryDateModalOrder.productName}</strong></>
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
                                    onClick={closeDeliveryDateModal}
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
                                        value={editingOrder.quantity === 0 ? '' : editingOrder.quantity}
                                        onChange={e => {
                                            const val = e.target.value;
                                            setEditingOrder({ ...editingOrder, quantity: val === '' ? 0 : Number(val.replace(/^0+/, '')) || 0 });
                                        }}
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
                                                    setEditingOrder({
                                                        ...editingOrder,
                                                        hasDefect: false,
                                                        defectNotes: null as unknown as string,
                                                        defectReportedAt: null as unknown as string,
                                                        defectResolved: null as unknown as boolean
                                                    });
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
                                                const originalOrder = orders.find(o => o.id === editingOrder.id);
                                                if (originalOrder && originalOrder.status === 'received' && originalOrder.quantity !== editingOrder.quantity) {
                                                    const diff = editingOrder.quantity - originalOrder.quantity;
                                                    const product = products.find(p => p.name === editingOrder.productName);
                                                    if (product) {
                                                        const updatedProduct = { ...product, stock: Math.max(0, (product.stock || 0) + diff) };
                                                        await DataService.updateProduct(updatedProduct);
                                                    }
                                                }
                                                await DataService.updateOrder(editingOrder);
                                                setEditingOrder(null);
                                                loadOrders();
                                                loadProducts();
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
                    <div className="modal-overlay" style={{ zIndex: 1100 }}>
                        <div className="card" style={{ padding: 'var(--spacing-xl)', maxWidth: '400px', textAlign: 'center' }}>
                            <div style={{ color: 'var(--color-danger)', marginBottom: 'var(--spacing-md)' }}>
                                <AlertTriangle size={48} style={{ margin: '0 auto' }} />
                            </div>
                            <h3 style={{ margin: '0 0 var(--spacing-sm) 0' }}>Bestellung löschen?</h3>
                            <p style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--spacing-lg)' }}>
                                Möchtest du die Bestellung für <strong>{orderToDelete.productName}</strong> ({orderToDelete.quantity}x) wirklich unwiderruflich löschen?
                            </p>
                            <div style={{ display: 'flex', gap: 'var(--spacing-md)', justifyContent: 'center' }}>
                                <button onClick={() => setOrderToDelete(null)} className="btn btn-ghost">
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
                                    className="btn btn-danger-solid"
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

                            <div style={{ padding: 'var(--spacing-xl)', overflowY: 'auto', flex: 1, backgroundColor: 'var(--color-surface)' }}>
                                {modalProposals.length === 0 ? (
                                    <div>
                                        {/* Green "all done" header */}
                                        <div style={{ textAlign: 'center', padding: 'var(--spacing-xl) 0 var(--spacing-2xl)' }}>
                                            <CheckCircle size={56} color="#22c55e" style={{ display: 'block', margin: '0 auto 16px' }} />
                                            <h3 style={{ margin: '0 0 8px 0', color: '#16a34a', fontSize: '20px' }}>Alles erledigt!</h3>
                                            <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: '14px' }}>
                                                Alle Bestände sind über dem Mindestbestand — keine Bestellungen nötig.
                                            </p>
                                        </div>

                                        {/* MinStock setup */}
                                        {productsWithoutMinStock.length > 0 && (
                                            <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 'var(--spacing-xl)' }}>
                                                <div style={{ marginBottom: 'var(--spacing-lg)' }}>
                                                    <h3 style={{ margin: '0 0 4px 0', fontSize: '15px', color: 'var(--color-text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <Settings size={16} color="var(--color-text-muted)" /> Mindestbestände einrichten
                                                    </h3>
                                                    <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-text-muted)' }}>
                                                        {productsWithoutMinStock.length} Produkt{productsWithoutMinStock.length > 1 ? 'e haben' : ' hat'} noch keinen Mindestbestand — ohne diesen kann der Assistent keine Bestellvorschläge machen.
                                                    </p>
                                                </div>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                    {productsWithoutMinStock.map(p => (
                                                        <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)', padding: '10px var(--spacing-md)', backgroundColor: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', flexWrap: 'wrap' }}>
                                                            <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                                                                <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--color-text-main)' }}>{p.name}</div>
                                                                <div style={{ fontSize: '12px', color: 'var(--color-text-faint)' }}>Bestand: {p.stock} {p.unit}</div>
                                                            </div>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, flexWrap: 'wrap' }}>
                                                                <span style={{ fontSize: '12px', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>Mindestbestand:</span>
                                                                <input
                                                                    type="number"
                                                                    min="1"
                                                                    placeholder="z.B. 5"
                                                                    value={minStockEdits[p.id] ?? ''}
                                                                    onChange={e => setMinStockEdits(prev => ({ ...prev, [p.id]: e.target.value === '' ? '' : Number(e.target.value) }))}
                                                                    style={{ width: '72px', padding: '6px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text-main)', fontSize: '14px', fontWeight: 600 }}
                                                                />
                                                                <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>{p.unit}</span>
                                                                <button
                                                                    className="btn btn-primary btn-sm"
                                                                    disabled={!minStockEdits[p.id] || Number(minStockEdits[p.id]) <= 0}
                                                                    onClick={() => handleSaveMinStock(p.id)}
                                                                >
                                                                    <Save size={13} /> Speichern
                                                                </button>
                                                                <button
                                                                    className="btn btn-ghost btn-sm"
                                                                    onClick={() => handleIgnorePermanently(p.id)}
                                                                    title="Produkt dauerhaft aus Bestellvorschlägen ausblenden"
                                                                >
                                                                    <X size={13} /> Ignorieren
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <>
                                        <p style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--spacing-xl)', marginTop: 0, fontSize: 'var(--font-size-md)' }}>Diese Produkte liegen unter dem Mindestbestand. Klicke auf Bestellen, um das Ticket anzulegen und optional die Bestellung beim Lieferanten manuell oder per Auto-Mail zu platzieren.</p>
                                        
                                        {Array.from(new Set(modalProposals.map(p => p.supplierName))).map(supplierName => {
                                            const supplierProposals = modalProposals.filter(p => p.supplierName === supplierName);
                                            if (supplierProposals.length === 0) return null;
                                            
                                            return (
                                                <div key={supplierName} style={{ marginBottom: 'var(--spacing-2xl)' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '8px', marginBottom: 'var(--spacing-md)' }}>
                                                        <h3 style={{ margin: 0, fontSize: '18px', color: 'var(--color-text-main)' }}>{supplierName}</h3>
                                                        {supplierName !== 'Kein Lieferant' && (
                                                            <div style={{ display: 'flex', gap: 'var(--spacing-md)', alignItems: 'center' }}>
                                                                <CheckoutButton
                                                                    supplierId={supplierProposals[0].supplierId}
                                                                    supplierName={supplierName}
                                                                    items={supplierProposals.map(p => ({
                                                                        product_id: p.product.id,
                                                                        product_name: p.product.name,
                                                                        quantity: p.quantity,
                                                                        unit: p.product.unit,
                                                                        price_expected: p.product.price ?? undefined,
                                                                        url: p.product.orderUrl ?? undefined,
                                                                    }))}
                                                                    priceThresholdPct={5}
                                                                    onCartReady={(url) => {
                                                                        console.log('Warenkorb übergeben:', url);
                                                                    }}
                                                                />
                                                                <button 
                                                                    onClick={async () => {
                                                                        const supplierToIgnore = suppliers.find(s => s.name === supplierName);
                                                                        if (supplierToIgnore) {
                                                                            await DataService.saveSupplier({ ...supplierToIgnore, ignoreOrderProposals: true });
                                                                            setNotification({ message: `${supplierName} wird nun von Vorschlägen ausgeschlossen.`, type: 'success' });
                                                                            setModalProposals(prev => prev.filter(p => p.supplierName !== supplierName));
                                                                            loadSuppliers();
                                                                        }
                                                                    }}
                                                                    title="Lieferant aus automatischen Vorschlägen ausblenden"
                                                                    style={{ fontSize: '12px', padding: '4px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid #fca5a5', backgroundColor: '#fee2e2', color: '#ef4444', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 500, transition: 'all 0.2s' }}>
                                                                    <AlertTriangle size={14} />
                                                                    Lieferant ignorieren
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                                                        {supplierProposals.map(prop => {
                                                            const originalIndex = modalProposals.findIndex(p => p.product.id === prop.product.id);
                                                            
                                                            const prod = prop.product;
                                                            const supp = suppliers.find(s => s.id === prod.supplierId);
                                                            const emailAddr = prod.emailOrderAddress || supp?.email || '';
                                                            const effM = getEffectiveOrderMethod(prod);
                                                            const effWebUrl = prod.orderUrl || supp?.orderUrl || supp?.url || supp?.loginUrl || '';
                                                            let btnText = "Bestellen";
                                                            if ((effM === 'link' || effM === 'webshop') && effWebUrl) btnText = "🔗 Im Tab bestellen";
                                                            else if (effM === 'phone') btnText = "📞 Anrufen & Bestellen";
                                                            else if (effM === 'email' || emailAddr) btnText = "📧 E-Mail öffnen";

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
                                                                        {prop.openQty > 0 ? (
                                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#fffbeb', border: '1px solid #fde68a', padding: '10px 16px', borderRadius: 'var(--radius-md)', color: '#d97706', fontWeight: 600 }}>
                                                                                <Package size={16} />
                                                                                Bereits bestellt ({prop.openQty} {prod.unit || 'Stk'} unterwegs)
                                                                            </div>
                                                                        ) : (
                                                                            <>
                                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#f1f5f9', padding: '6px', borderRadius: 'var(--radius-md)' }}>
                                                                                    <span style={{ fontSize: '12px', fontWeight: 600, color: '#475569', paddingLeft: '4px' }}>BESTELLEN:</span>
                                                                                    <input type="number" min="1" value={prop.quantity || 1} onChange={e => updateProposalQuantity(originalIndex, Number(e.target.value))} style={{ width: '60px', padding: '6px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontWeight: 700, fontSize: '15px' }} />
                                                                                    <span style={{ fontSize: '13px', color: '#475569', width: '30px', fontWeight: 500 }}>{prod.unit || 'Stk'}</span>
                                                                                </div>
                                                                                
                                                                                {(() => {
                                                                                    const _emailAddr = prod.emailOrderAddress || suppliers.find(s => s.id === prod.supplierId)?.email || '';
                                                                                    const { subject, body } = generateEmailTemplate([{ product: prod, quantity: prop.quantity }]);
                                                                                    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${_emailAddr}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
                                                                                    const mailtoUrl = `mailto:${_emailAddr}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
                                                                                    const webshopUrl = effWebUrl;

                                                                                    if (btnText === '📧 E-Mail öffnen') {
                                                                                        const pref = StorageService.getSettings().preferredEmailClient;
                                                                                        return (
                                                                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                                                                {(pref === 'all' || pref === 'gmail') && (
                                                                                                    <a 
                                                                                                        href={gmailUrl}
                                                                                                        target="_blank"
                                                                                                        rel="noopener noreferrer"
                                                                                                        onClick={() => executeProposalDbSave(prop)}
                                                                                                        style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '10px 16px', borderRadius: 'var(--radius-md)', backgroundColor: '#ef4444', color: 'white', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap', textDecoration: 'none' }}>
                                                                                                        <Mail size={16} /> {pref === 'gmail' ? 'E-Mail öffnen' : 'Gmail'}
                                                                                                    </a>
                                                                                                )}
                                                                                                {(pref === 'all' || pref === 'mailto' || !pref) && (
                                                                                                    <a 
                                                                                                        href={mailtoUrl}
                                                                                                        onClick={() => executeProposalDbSave(prop)}
                                                                                                        style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '10px 16px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--color-primary)', color: 'white', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap', textDecoration: 'none' }}>
                                                                                                        <Mail size={16} /> {pref === 'mailto' ? 'E-Mail öffnen' : 'Mail-App'}
                                                                                                    </a>
                                                                                                )}
                                                                                            </div>
                                                                                        );
                                                                                    } else if (btnText === '🔗 Im Tab bestellen') {
                                                                                        return (
                                                                                            <a 
                                                                                                href={webshopUrl}
                                                                                                target="_blank"
                                                                                                rel="noopener noreferrer"
                                                                                                onClick={() => executeProposalDbSave(prop)}
                                                                                                style={{ display: 'inline-flex', alignItems: 'center', padding: '10px 16px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--color-primary)', color: 'white', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap', textDecoration: 'none', boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.1)' }}>
                                                                                                {btnText}
                                                                                            </a>
                                                                                        );
                                                                                    } else if (btnText === '📞 Anrufen & Bestellen') {
                                                                                        return (
                                                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end' }}>
                                                                                                {(prod.productNumber || supp?.customerNumber) && (
                                                                                                    <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', textAlign: 'right', display: 'flex', gap: '8px' }}>
                                                                                                        {prod.productNumber && <span>Art-Nr: <strong style={{ color: 'var(--color-text-main)' }}>{prod.productNumber}</strong></span>}
                                                                                                        {supp?.customerNumber && <span>Kd-Nr: <strong style={{ color: 'var(--color-text-main)' }}>{supp.customerNumber}</strong></span>}
                                                                                                    </div>
                                                                                                )}
                                                                                                <div style={{ display: 'flex', gap: '8px' }}>
                                                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0 12px', fontSize: '15px', fontWeight: 700, color: 'var(--color-text-main)', backgroundColor: 'var(--color-surface-elevated)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', height: '40px' }}>
                                                                                                        <Phone size={16} color="var(--color-primary)" />
                                                                                                        {supp?.orderPhone || supp?.phone || 'Keine Nr. hinterlegt'}
                                                                                                    </div>
                                                                                                    <button 
                                                                                                        onClick={() => executeProposalDbSave(prop)}
                                                                                                        style={{ border: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '0 16px', height: '40px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--color-primary)', color: 'white', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap', boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.1)' }}>
                                                                                                        <CheckSquare size={16} /> Als bestellt markieren
                                                                                                    </button>
                                                                                                </div>
                                                                                            </div>
                                                                                        );
                                                                                    } else {
                                                                                        return (
                                                                                            <button 
                                                                                                onClick={() => executeProposalDbSave(prop)}
                                                                                                style={{ padding: '10px 16px', borderRadius: 'var(--radius-md)', border: 'none', backgroundColor: 'var(--color-primary)', color: 'white', cursor: 'pointer', transition: 'all 0.2s', fontWeight: 600, whiteSpace: 'nowrap', boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.1)' }}>
                                                                                                {btnText}
                                                                                            </button>
                                                                                        );
                                                                                    }
                                                                                })()}
                                                                            </>
                                                                        )}
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

            {/* ── KI-Log Modal ── */}
            {showKiLogModal && (
                <div className="modal-overlay" onClick={() => { setShowKiLogModal(false); setSelectedKiLog(null); }}>
                    <div
                        className="modal-box"
                        style={{ maxWidth: '720px', maxHeight: '82vh', display: 'flex', flexDirection: 'column' }}
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="modal-header">
                            <Bot size={18} color="var(--color-primary)" />
                            <h3 style={{ flex: 1 }}>KI-Import Protokoll</h3>
                            <button
                                className="btn btn-ghost btn-sm"
                                style={{ padding: '4px 8px' }}
                                onClick={() => { setShowKiLogModal(false); setSelectedKiLog(null); }}
                            >
                                <X size={16} />
                            </button>
                        </div>

                        {/* Body */}
                        <div style={{ flex: 1, overflowY: 'auto' }}>
                            {inboundEmails.length === 0 ? (
                                <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                                    <Bot size={36} style={{ opacity: 0.2, display: 'block', margin: '0 auto 12px' }} />
                                    Noch keine KI-Importe vorhanden.
                                </div>
                            ) : (
                                <table className="products-table">
                                    <thead>
                                        <tr>
                                            <th style={{ width: '130px' }}>Datum</th>
                                            <th style={{ width: '160px' }}>Absender</th>
                                            <th>Betreff</th>
                                            <th style={{ width: '120px', textAlign: 'center' }}>Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {inboundEmails.map(email => {
                                            const isSelected = selectedKiLog?.id === email.id;
                                            return (
                                                <React.Fragment key={email.id}>
                                                    <tr
                                                        onClick={() => setSelectedKiLog(isSelected ? null : email)}
                                                        style={{ cursor: 'pointer', backgroundColor: isSelected ? 'var(--color-surface-elevated)' : undefined }}
                                                    >
                                                        <td style={{ fontSize: '12px', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                                                            {new Date(email.created_at).toLocaleString('de-DE', {
                                                                day: '2-digit', month: '2-digit', year: '2-digit',
                                                                hour: '2-digit', minute: '2-digit',
                                                            })}
                                                        </td>
                                                        <td style={{ fontSize: '13px', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                            {email.supplier_name || '–'}
                                                        </td>
                                                        <td style={{ fontSize: '13px', color: 'var(--color-text-main)', maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                            {email.subject || <span style={{ color: 'var(--color-text-faint)' }}>(kein Betreff)</span>}
                                                        </td>
                                                        <td style={{ textAlign: 'center' }}>
                                                            <KiStatusBadge status={email.status} />
                                                        </td>
                                                    </tr>
                                                    {isSelected && (
                                                        <tr>
                                                            <td colSpan={4} style={{ padding: '14px 20px 16px', backgroundColor: 'var(--color-surface-elevated)', borderBottom: '1px solid var(--color-border)' }}>
                                                                <KiLogDetail email={email} />
                                                            </td>
                                                        </tr>
                                                    )}
                                                </React.Fragment>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="modal-footer">
                            <span style={{ fontSize: '12px', color: 'var(--color-text-faint)', marginRight: 'auto' }}>
                                {inboundEmails.length} Einträge · Klick auf Zeile für Details
                            </span>
                            <button className="btn btn-ghost" onClick={() => { setShowKiLogModal(false); setSelectedKiLog(null); }}>
                                Schließen
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
