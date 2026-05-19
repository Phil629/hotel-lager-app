import { generateId } from "../utils";
import React, { useState, useEffect, useMemo, useRef } from 'react';
import type { Product, Order, Supplier } from '../types';
import { StorageService } from '../services/storage';
import { DataService } from '../services/data';
import { supabase, getSupabaseClient } from '../services/supabase';
import { Building2, ChevronDown, Plus, Edit2, Trash2, ShoppingCart, X, Mail, ExternalLink, CheckSquare, Wifi, Settings, Phone, Search, AlertTriangle, Euro, ArrowUp, ArrowDown, ArrowUpDown, TrendingUp } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import emailjs from '@emailjs/browser';
import { Notification, type NotificationType } from '../components/Notification';
import { PhoneCallPanel } from '../components/PhoneCallPanel';
import QRCode from "react-qr-code";
import { useSearchParams } from 'react-router-dom';

const CATEGORIES = ['Lebensmittel', 'Getränke', 'Reinigung', 'Büro', 'Sonstiges'];


const PriceHistoryChart = ({ productName }: { productName: string }) => {
    const [data, setData] = useState<any[]>([]);
    
    useEffect(() => {
        if (!productName) return;
        DataService.getOrders().then(orders => {
            const filtered = orders
                .filter(o => o.productName === productName && o.price)
                .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                .map(o => ({
                    date: new Date(o.date).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric'}),
                    price: o.price,
                    supplier: o.supplierName || 'Unbekannt'
                }));
            setData(filtered);
        });
    }, [productName]);

    if (data.length === 0) return <div style={{ padding: '30px 10px', textAlign: 'center', color: '#94a3b8', backgroundColor: '#f8fafc', borderRadius: '8px' }}>Keine historischen Preisdaten für dieses Produkt gefunden. Die Rechnung fällt beim nächsten automatischen Scan ein!</div>;

    return (
        <div style={{ width: '100%', height: 280, marginTop: '20px' }}>
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="date" tick={{fontSize: 12, fill: '#64748b'}} tickMargin={10} axisLine={false} tickLine={false} />
                    <YAxis dataKey="price" tick={{fontSize: 12, fill: '#64748b'}} tickFormatter={val => Number(val).toFixed(2) + '€'} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
                    <Tooltip 
                        contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                        formatter={(value: any, _name: any, props: any) => [`${Number(value).toFixed(2)} € (Lieferant: ${props.payload.supplier})`, 'Einkaufspreis']}
                        labelFormatter={(label: any) => `Kaufdatum: ${label}`}
                    />
                    <Line type="stepAfter" dataKey="price" stroke="#0ea5e9" strokeWidth={3} dot={{r: 4, fill: '#0284c7', strokeWidth: 0}} activeDot={{r: 6}} animationDuration={1500} />
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
};

export const Products: React.FC = () => {
    const [products, setProducts] = useState<Product[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [orders, setOrders] = useState<Order[]>([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [activeModalTab, setActiveModalTab] = useState<'basic' | 'inventory' | 'order' | 'analytics'>('basic');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [newProduct, setNewProduct] = useState<Partial<Product>>({
        category: '',
        unit: '',
        stock: 0,
        minStock: 0,
        price: 0,
        autoOrder: false,
        notes: [],
        preferredOrderMethod: undefined
    });
    const [isCreatingSupplier, setIsCreatingSupplier] = useState(false);
        const [newSupplier, setNewSupplier] = useState<Partial<Supplier>>({
        name: '',
        email: '',
        phone: '',
        contactName: '',
        url: '',
        notes: [],
        emailSubjectTemplate: '',
        emailBodyTemplate: ''
    });
    // isEmailSectionOpen removed as requested
    const [showIoTLink, setShowIoTLink] = useState<{ product: Product, curl: string, powershell: string } | null>(null);
    const [qrTab, setQrTab] = useState<'api' | 'order' | 'stock'>('api');
    const [isOrderEmailExpanded, setIsOrderEmailExpanded] = useState(false);
    const [phoneCallProduct, setPhoneCallProduct] = useState<Product | null>(null);

    const getEffectiveOrderMethod = (product: Product) => {
        if (product.preferredOrderMethod) return product.preferredOrderMethod;
        const supplier = suppliers.find(s => s.id === product.supplierId);
        return supplier?.preferredOrderMethod || 'email';
    };
    const [isCustomCategoryMode, setIsCustomCategoryMode] = useState(false);
        
    const [isOrderModalOpen, setIsOrderModalOpen] = useState(false);
    const [orderCart, setOrderCart] = useState<{product: Product, quantity: number}[]>([]);
    const [orderDate, setOrderDate] = useState(new Date().toISOString().split('T')[0]);
    const [orderNotes, setOrderNotes] = useState('');
    const [emailSubject, setEmailSubject] = useState('');
    const [emailBody, setEmailBody] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
    const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
    const [notification, setNotification] = useState<{ message: string, type: NotificationType } | null>(null);
    const [openSettingsId, setOpenSettingsId] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState("");
    const [showLowStockOnly, setShowLowStockOnly] = useState(false);
    const [expandedSuppliers, setExpandedSuppliers] = useState<Record<string, boolean>>({});
    const [expandedProductsLimit, setExpandedProductsLimit] = useState<Record<string, boolean>>({});
    // O5: war `prev[id] === false ? true : false` — undefined !== false führte zu falschem Init-Wert
    const toggleSupplier = (id: string) => setExpandedSuppliers(prev => ({ ...prev, [id]: !prev[id] }));
    const toggleProductLimit = (id: string) => setExpandedProductsLimit(prev => ({...prev, [id]: !prev[id]}));



    // Stock Update Modal (Scan Action)
    const [isStockUpdateModalOpen, setIsStockUpdateModalOpen] = useState(false);
    const [stockUpdateProduct, setStockUpdateProduct] = useState<Product | null>(null);
    const [stockUpdateValue, setStockUpdateValue] = useState<number>(0);

    const [sortConfig, setSortConfig] = useState<{ key: 'name' | 'stock' | null, direction: 'asc' | 'desc' }>({ key: null, direction: 'asc' });
    const [searchParams] = useSearchParams();

    const rtDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
    const debouncedReloadProducts = () => {
        if (rtDebounce.current) clearTimeout(rtDebounce.current);
        rtDebounce.current = setTimeout(() => {
            DataService.getProducts().then(setProducts);
            DataService.getOrders().then(setOrders);
        }, 300);
    };

    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', handleResize);

        const supabaseClient = getSupabaseClient();
        let channel: any;
        if (supabaseClient) {
            // W8: eindeutiger Channel-Name pro Tab
            const channelName = `products_rt_${Math.random().toString(36).slice(2, 8)}`;
            channel = supabaseClient.channel(channelName)
                .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, debouncedReloadProducts)
                .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, debouncedReloadProducts)
                .subscribe();
        }

        return () => {
            window.removeEventListener('resize', handleResize);
            if (rtDebounce.current) clearTimeout(rtDebounce.current);
            if (channel && supabaseClient) {
                supabaseClient.removeChannel(channel);
            }
        };
    }, []);

    useEffect(() => {
        // Load data and then check params
        const init = async () => {
            try {
                await loadSuppliers().catch(e => console.error('Error loading suppliers:', e));
                const loadedProducts = await DataService.getProducts();
                const loadedOrders = await DataService.getOrders();
                
                // Immediately set products so the UI renders
                setProducts(loadedProducts);
                setOrders(loadedOrders);

                // Handle URL Actions (QR Scans)
                const action = searchParams.get('action');
                const id = searchParams.get('id');

                if (action && id && loadedProducts.length > 0) {
                    const product = loadedProducts.find(p => p.id === id);
                    if (product) {
                        if (action === 'order') handleOrderClick(product);
                        else if (action === 'stock') {
                            setStockUpdateProduct(product);
                            setStockUpdateValue(product.stock);
                            setIsStockUpdateModalOpen(true);
                        }
                    }
                }

                // K7: Auto-Consumption — server-seitig via RPC (verhindert Race Conditions)
                // Fallback auf client-seitige Logik wenn RPC nicht verfügbar
                const runAutoConsumption = async () => {
                    const settings = StorageService.getSettings();
                    if (settings.inventoryMode) return;

                    // K7: Nur einmal pro Tag pro Browser-Tab ausführen (SessionStorage-Guard)
                    const guardKey = `auto_consumption_${new Date().toDateString()}`;
                    if (sessionStorage.getItem(guardKey)) return;
                    sessionStorage.setItem(guardKey, '1');

                    try {
                        // Server-seitige RPC bevorzugen (verhindert Multi-Tab Race Conditions)
                        const supabaseClient = getSupabaseClient();
                        if (supabaseClient) {
                            await supabaseClient.rpc('trigger_auto_consumption');
                            // Frische Daten nach serverseitiger Berechnung laden
                            const fresh = await DataService.getProducts();
                            setProducts(fresh);
                            return;
                        }
                    } catch {
                        // RPC nicht verfügbar — client-seitiger Fallback
                    }

                    // Client-seitiger Fallback (O4: korrekte Immutability via map+spread)
                    const now = new Date();
                    let updatedAny = false;
                    const updatedProducts = loadedProducts.map(p => ({ ...p }));

                    for (let i = 0; i < updatedProducts.length; i++) {
                        const p = updatedProducts[i];
                        if (!p.consumptionAmount || !p.consumptionPeriod) continue;
                        try {
                            if (!p.lastConsumptionDate) {
                                p.lastConsumptionDate = now.toISOString();
                                await DataService.saveProduct(p);
                                updatedAny = true;
                            } else {
                                const lastDate = new Date(p.lastConsumptionDate);
                                if (isNaN(lastDate.getTime())) continue;
                                const diffDays = Math.floor((now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
                                let periodsPassed = p.consumptionPeriod === 'day' ? diffDays : Math.floor(diffDays / 7);
                                if (periodsPassed > 0) {
                                    p.stock = Math.max(0, p.stock - periodsPassed * p.consumptionAmount);
                                    const newLastDate = new Date(lastDate);
                                    if (p.consumptionPeriod === 'day') newLastDate.setDate(newLastDate.getDate() + periodsPassed);
                                    else newLastDate.setDate(newLastDate.getDate() + periodsPassed * 7);
                                    p.lastConsumptionDate = newLastDate.toISOString();
                                    await DataService.saveProduct(p);
                                    updatedAny = true;
                                }
                            }
                        } catch (err) {
                            console.error('Auto-consume failed for', p.id, err);
                        }
                    }
                    if (updatedAny) setProducts(updatedProducts);
                };

                runAutoConsumption();
            } catch (error) {
                console.error('Fatal init error:', error);
            }
        };
        
        init();
    }, [searchParams]); // Re-run if params change (though mostly on mount)

    const loadProducts = async () => {
        const data = await DataService.getProducts();
        setProducts(data);
    };

    const handleStockUpdate = async (product: Product, newStock: number) => {
        const updatedProduct = { ...product, stock: newStock };
        // Optimistic update
        setProducts(products.map(p => p.id === product.id ? updatedProduct : p));
        // Save to backend
        await DataService.updateProduct(updatedProduct);
    };

    const loadSuppliers = async () => {
        const data = await DataService.getSuppliers();
        setSuppliers(data);
    };

    const handleDeleteClick = (id: string) => {
        setDeleteConfirmId(id);
    };

    const confirmDelete = async () => {
        if (deleteConfirmId) {
            setIsLoading(true);
            try {
                await DataService.deleteProduct(deleteConfirmId);
                setDeleteConfirmId(null);
                setNotification({ message: 'Produkt erfolgreich gelöscht', type: 'success' });
                await loadProducts();
            } catch (err: any) {
                console.error("Failed to delete product", err);
                setNotification({ message: 'Fehler beim Löschen: ' + (err.message || String(err)), type: 'error' });
            } finally {
                setIsLoading(false);
            }
        }
    };

    
    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newProduct.name) return;

        let finalSupplierId = newProduct.supplierId;

        // Create new supplier if in creation mode
        if (isCreatingSupplier && newSupplier.name) {
            try {
                const id = generateId();
                const supplier: Supplier = {
                    id,
                    name: newSupplier.name || 'Unbekannt',
                    email: newSupplier.email || '',
                    phone: newSupplier.phone,
                    contactName: newSupplier.contactName,
                    url: newSupplier.url,
                    notes: newSupplier.notes,
                    emailSubjectTemplate: newSupplier.emailSubjectTemplate,
                    emailBodyTemplate: newSupplier.emailBodyTemplate
                };
                await DataService.saveSupplier(supplier);
                finalSupplierId = id;
                await loadSuppliers(); // Refresh list

                // If product email is empty, use the new supplier's email
                if (!newProduct.emailOrderAddress) {
                    newProduct.emailOrderAddress = newSupplier.email;
                }
            } catch (error) {
                console.error("Failed to create supplier:", error);
                setNotification({ message: 'Fehler beim Anlegen des Lieferanten.', type: 'error' });
                return;
            }
        }

        const productData: Product = {
            id: editingId || generateId(),
            name: newProduct.name,
            category: newProduct.category,
            stock: Number(newProduct.stock) || 0,
            minStock: Number(newProduct.minStock) || 0,
            price: Number(newProduct.price) || 0,
            unit: newProduct.unit || 'Stück',
            orderUrl: newProduct.orderUrl,
            image: newProduct.image,
            supplierId: finalSupplierId,
            emailOrderAddress: newProduct.emailOrderAddress,
            emailOrderSubject: newProduct.emailOrderSubject,
            emailOrderBody: newProduct.emailOrderBody,
            autoOrder: newProduct.autoOrder,
            supplierPhone: newProduct.supplierPhone,
            notes: newProduct.notes,
            preferredOrderMethod: newProduct.preferredOrderMethod,
            consumptionAmount: newProduct.consumptionAmount,
            consumptionPeriod: newProduct.consumptionPeriod,
            lastConsumptionDate: newProduct.lastConsumptionDate,
            standardOrderQuantity: newProduct.standardOrderQuantity ? Number(newProduct.standardOrderQuantity) : undefined,
            ignoreOrderProposals: newProduct.ignoreOrderProposals || false
        };

        // Reset consumption date if the user changed the consumption settings,
        // so it doesn't deduct retroactively from an old date.
        const originalProduct = editingId ? products.find(p => p.id === editingId) : null;
        const consumptionChanged = !originalProduct || 
            originalProduct.consumptionAmount !== productData.consumptionAmount || 
            originalProduct.consumptionPeriod !== productData.consumptionPeriod;
            
        if (consumptionChanged && productData.consumptionAmount) {
            productData.lastConsumptionDate = new Date().toISOString();
        }

        setIsLoading(true);
        try {
            await DataService.saveProduct(productData);
            await loadProducts();
            closeModal();
        } finally {
            setIsLoading(false);
        }
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

    const handleOrderClick = (product: Product) => {
        const initialCart = [{ product, quantity: product.standardOrderQuantity || 1 }];
        setOrderCart(initialCart);
        setOrderDate(new Date().toISOString().split('T')[0]);
        setOrderNotes('');

        const { subject, body } = generateEmailTemplate(initialCart);
        setEmailSubject(subject);
        setEmailBody(body);
        setIsOrderEmailExpanded(product.preferredOrderMethod === 'email');
        setIsOrderModalOpen(true);
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

    const handleCreateOrder = async (e: React.FormEvent) => {
        e.preventDefault();
        if (orderCart.length === 0) return;

        setIsLoading(true);
        try {
            const mainProduct = orderCart[0].product;
            if (mainProduct.autoOrder && mainProduct.emailOrderAddress) {
                const settings = StorageService.getSettings();
                if (!settings.serviceId || !settings.templateId || !settings.publicKey) {
                    setNotification({ message: 'Fehler: EmailJS ist nicht konfiguriert.', type: 'error' });
                    setIsLoading(false);
                    return;
                }
                const templateParams = {
                    to_email: mainProduct.emailOrderAddress,
                    subject: emailSubject,
                    message: emailBody,
                    product_name: orderCart.length > 1 ? orderCart.length + " Produkte" : mainProduct.name,
                    quantity: orderCart.length > 1 ? "" : orderCart[0].quantity,
                    unit: orderCart.length > 1 ? "" : mainProduct.unit
                };
                await emailjs.send(settings.serviceId, settings.templateId, templateParams, settings.publicKey);
                setNotification({ message: 'Bestellung wurde automatisch per E-Mail versendet!', type: 'success' });
            }

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

            setIsOrderModalOpen(false);
            setOrderCart([]);
            if (!mainProduct.autoOrder) {
                setNotification({ message: 'Bestellung erfolgreich angelegt!', type: 'success' });
            }
        } catch (error) {
            console.error('Order Error:', error);
            setNotification({ message: 'Fehler beim Anlegen der Bestellung.', type: 'error' });
        } finally {
            setIsLoading(false);
        }
    };

    const closeModal = () => {
        setIsModalOpen(false);
        setNewProduct({ category: '', unit: '', stock: 0, minStock: 0, standardOrderQuantity: undefined, ignoreOrderProposals: false, price: 0, autoOrder: false, notes: [], preferredOrderMethod: undefined });
        setEditingId(null);
        // setIsEmailSectionOpen(false); // Removed
        setIsCustomCategoryMode(false);
        setActiveModalTab('basic');
    };

    const getIoTLink = (product: Product) => {
        const settings = StorageService.getSettings();
        // Return structure even if settings are missing, for QR codes
        if (!settings.supabaseUrl || !settings.supabaseKey) {
            return { product, curl: '', powershell: '' };
        }

        // Ensure no trailing slash in URL
        const baseUrl = settings.supabaseUrl.replace(/\/$/, '');
        const url = `${baseUrl}/rest/v1/orders`;

        const bodyObj = {
            product_name: product.name,
            quantity: 1,
            status: 'open',
            product_image: product.image
        };
        const bodyJson = JSON.stringify(bodyObj);

        // Escape single quotes for shell (curl): ' becomes '\''
        const bodyJsonCurl = bodyJson.replace(/'/g, "'\\''");

        const curl = `curl -X POST '${url}' \\
  -H "apikey: ${settings.supabaseKey}" \\
  -H "Authorization: Bearer ${settings.supabaseKey}" \\
  -H "Content-Type: application/json" \\
  -d '${bodyJsonCurl}'`;

        // Escape single quotes for PowerShell: ' becomes ''
        const bodyJsonPwsh = bodyJson.replace(/'/g, "''");

        // Robust PowerShell command:
        const powershell = `$h=@{"apikey"="${settings.supabaseKey}";"Authorization"="Bearer ${settings.supabaseKey}"}; Invoke-RestMethod -Uri "${url}" -Method Post -Headers $h -ContentType "application/json" -Body ([System.Text.Encoding]::UTF8.GetBytes('${bodyJsonPwsh}'))`;

        return { product, curl, powershell };
    };

        const prepareEmailLink = (type: 'mailto' | 'gmail') => {
        if (orderCart.length === 0) return;

        const mainProduct = orderCart[0].product;
        const supplier = suppliers.find(s => s.id === mainProduct.supplierId);
        const emailAddr = mainProduct.emailOrderAddress || supplier?.email || '';
        if (!emailAddr) return;

        const encodedSubject = encodeURIComponent(emailSubject);
        const encodedBody = encodeURIComponent(emailBody);

        if (type === 'gmail') {
            window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${emailAddr}&su=${encodedSubject}&body=${encodedBody}`, '_blank');
        } else {
            window.location.href = `mailto:${emailAddr}?subject=${encodedSubject}&body=${encodedBody}`;
        }
    };

    const handleSort = (key: 'name' | 'stock') => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const filteredProducts = useMemo(() => products.filter(p => {
        const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesLowStock = showLowStockOnly ? (Number(p.minStock) > 0 && Number(p.stock) <= Number(p.minStock)) : true;
        return matchesSearch && matchesLowStock;
    }).sort((a, b) => {
        if (!sortConfig.key) return 0;

        if (sortConfig.key === 'name') {
            return sortConfig.direction === 'asc'
                ? a.name.localeCompare(b.name)
                : b.name.localeCompare(a.name);
        }

        if (sortConfig.key === 'stock') {
            return sortConfig.direction === 'asc'
                ? a.stock - b.stock
                : b.stock - a.stock;
        }

        return 0;
    }), [products, searchTerm, showLowStockOnly, sortConfig]);

    const totalValue = useMemo(
        () => products.reduce((sum, p) => sum + (p.stock * (p.price || 0)), 0),
        [products]
    );
    const lowStockCount = useMemo(
        () => products.filter(p => Number(p.minStock) > 0 && Number(p.stock) <= Number(p.minStock)).length,
        [products]
    );

    return (
        <div>
            <div className="page-header">
                <h2 className="page-title">Produkte</h2>
                <button onClick={() => setIsModalOpen(true)} className="btn btn-primary">
                    <Plus size={18} /> Neues Produkt
                </button>
            </div>

            {/* Dashboard Cards */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: 'var(--spacing-lg)',
                marginBottom: 'var(--spacing-2xl)'
            }}>
                <div
                    onClick={() => setShowLowStockOnly(false)}
                    className="stat-card-interactive"
                    style={{
                        background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
                        padding: 'var(--spacing-lg)',
                        borderRadius: 'var(--radius-xl)',
                        border: !showLowStockOnly ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                        boxShadow: !showLowStockOnly ? '0 0 0 3px rgba(37,99,235,0.1)' : 'var(--shadow-xs)',
                    }}
                >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Produkte Gesamt</div>
                        <div style={{ padding: '8px', backgroundColor: '#e0f2fe', color: '#0369a1', borderRadius: 'var(--radius-md)' }}>
                            <ShoppingCart size={20} />
                        </div>
                    </div>
                    <div style={{ fontSize: '32px', fontWeight: 800, color: 'var(--color-text-main)' }}>{products.length}</div>
                </div>

                <div
                    onClick={() => setShowLowStockOnly(!showLowStockOnly)}
                    className="stat-card-interactive"
                    style={{
                        background: lowStockCount > 0 ? 'linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)' : 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
                        padding: 'var(--spacing-lg)',
                        borderRadius: 'var(--radius-xl)',
                        border: showLowStockOnly ? '2px solid #ef4444' : (lowStockCount > 0 ? '1px solid #fca5a5' : '1px solid var(--color-border)'),
                        boxShadow: showLowStockOnly ? '0 0 0 3px rgba(239,68,68,0.2)' : (lowStockCount > 0 ? '0 4px 6px -1px rgb(220 38 38 / 0.1)' : 'var(--shadow-xs)'),
                    }}
                >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <div style={{ color: lowStockCount > 0 ? '#b91c1c' : 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Niedriger Bestand
                        </div>
                        <div style={{ padding: '8px', backgroundColor: lowStockCount > 0 ? '#fecaca' : '#f1f5f9', color: lowStockCount > 0 ? '#b91c1c' : '#64748b', borderRadius: 'var(--radius-md)' }}>
                            <AlertTriangle size={20} />
                        </div>
                    </div>
                    <div style={{ fontSize: '32px', fontWeight: 800, color: lowStockCount > 0 ? '#991b1b' : 'inherit' }}>{lowStockCount}</div>
                </div>

                <div className="stat-card-interactive" style={{
                        background: 'linear-gradient(135deg, #ffffff 0%, #f0fdf4 100%)',
                        padding: 'var(--spacing-lg)',
                        borderRadius: 'var(--radius-xl)',
                        border: '1px solid #bbf7d0',
                        boxShadow: 'var(--shadow-xs)',
                    }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <div style={{ color: '#166534', fontSize: 'var(--font-size-sm)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Lagerwert (Netto)
                        </div>
                        <div style={{ padding: '8px', backgroundColor: '#dcfce7', color: '#15803d', borderRadius: 'var(--radius-md)' }}>
                            <Euro size={20} />
                        </div>
                    </div>
                    <div style={{ fontSize: '32px', fontWeight: 800, color: '#14532d' }}>{totalValue.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</div>
                </div>
            </div>

            {/* Search & Filters */}
            <div style={{ display: 'flex', gap: 'var(--spacing-md)', marginBottom: 'var(--spacing-xl)', flexWrap: 'wrap' }}>
                <div style={{ position: 'relative', flex: '1 1 300px' }}>
                    <Search size={22} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                    <input
                        type="text"
                        placeholder="Produkte durchsuchen..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        style={{
                            width: '100%',
                            padding: '14px 16px 14px 48px',
                            borderRadius: 'var(--radius-full)',
                            border: '1px solid var(--color-border)',
                            fontSize: 'var(--font-size-md)',
                            backgroundColor: 'var(--color-surface)',
                            boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
                            outline: 'none',
                            transition: 'border-color 0.2s, box-shadow 0.2s'
                        }}
                        onFocus={e => { e.target.style.borderColor = 'var(--color-primary)'; e.target.style.boxShadow = '0 0 0 3px rgba(37, 99, 235, 0.1)'; }}
                        onBlur={e => { e.target.style.borderColor = 'var(--color-border)'; e.target.style.boxShadow = '0 1px 2px 0 rgb(0 0 0 / 0.05)'; }}
                    />
                </div>
                <button
                    onClick={() => setShowLowStockOnly(!showLowStockOnly)}
                    className={showLowStockOnly ? 'btn btn-danger' : 'btn btn-ghost'}
                    style={{ borderRadius: 'var(--radius-full)', padding: '0 20px', height: '100%', minHeight: '46px' }}
                >
                    <AlertTriangle size={16} />
                    {showLowStockOnly ? 'Filter aufheben' : 'Kritischer Bestand'}
                </button>
            </div>

            {
                filteredProducts.length === 0 ? (
                    <div style={{ padding: '40px', textAlign: 'center', backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-sm)' }}>
                        <ShoppingCart size={48} color="#cbd5e1" style={{ marginBottom: '16px' }} />
                        {products.length === 0 ? (
                            <>
                                <h3 style={{ margin: '0 0 8px 0', color: 'var(--color-text-main)' }}>Noch keine Produkte vorhanden</h3>
                                <p style={{ margin: '0 0 16px 0', color: 'var(--color-text-muted)' }}>Beginne damit, dein erstes Produkt für dieses Unternehmen anzulegen.</p>
                                <button onClick={() => setIsModalOpen(true)} className="btn btn-primary">
                                    <Plus size={18} /> Erstes Produkt anlegen
                                </button>
                            </>
                        ) : (
                            <>
                                <h3 style={{ margin: '0 0 8px 0', color: 'var(--color-text-main)' }}>Keine Produkte gefunden</h3>
                                <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Versuche einen anderen Suchbegriff oder passe die Filter an.</p>
                            </>
                        )}
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                        {Array.from(new Set(filteredProducts.map(p => p.supplierId || 'unsorted'))).map(supplierId => {
                            const supProds = filteredProducts.filter(p => (p.supplierId || 'unsorted') === supplierId);
                            const isUnsorted = supplierId === 'unsorted';
                            const supplier = isUnsorted ? undefined : suppliers.find(s => s.id === supplierId);
                            const supplierName = supplier?.name || "Ohne Lieferant (Unkategorisiert)";
                            
                            const isExpanded = expandedSuppliers[supplierId] !== false; // default true
                            const showAll = expandedProductsLimit[supplierId] === true || showLowStockOnly || searchTerm.trim() !== ""; // auto-expand if filtering
                            const visibleProds = showAll ? supProds : supProds.slice(0, 5);
                            const hasMore = supProds.length > 5;

                            return (
                                <div key={supplierId} style={{ backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-sm)', border: '1px solid var(--color-border)' }}>
                                    <div 
                                        onClick={() => toggleSupplier(supplierId)}
                                        style={{ padding: '16px 24px', backgroundColor: 'var(--color-surface-elevated)', borderBottom: '1px solid var(--color-border)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTopLeftRadius: 'calc(var(--radius-xl) - 1px)', borderTopRightRadius: 'calc(var(--radius-xl) - 1px)' }}
                                    >
                                        <h2 style={{ margin: 0, fontSize: '17px', display: 'flex', alignItems: 'center', gap: '12px', fontWeight: 700 }}>
                                            <div style={{ backgroundColor: '#e2e8f0', padding: '6px', borderRadius: '8px', display: 'flex' }}><Building2 size={18} /></div>
                                            {supplierName}
                                            <span className="badge badge-neutral">{supProds.length} Produkte</span>
                                        </h2>
                                        <button style={{ background: 'none', border: 'none', display: 'flex', cursor: 'pointer' }}>
                                            <ChevronDown style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s', color: '#64748b' }} />
                                        </button>
                                    </div>
                                    
                                    {isExpanded && (
                                        <>
                                            {isMobile ? (
                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '16px', padding: '16px', backgroundColor: 'var(--color-background)' }}>
                                                    {visibleProds.map(product => (
                                                        <div key={product.id} style={{
                                                            backgroundColor: 'var(--color-surface-elevated)',
                                                            borderRadius: 'var(--radius-xl)',
                                                            padding: 'var(--spacing-lg)',
                                                            boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)',
                                                            border: '1px solid var(--color-border)',
                                                            display: 'flex',
                                                            flexDirection: 'column',
                                                            gap: 'var(--spacing-md)',
                                                            position: 'relative'
                                                        }}>
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                                                <div style={{ display: 'flex', gap: 'var(--spacing-md)', flex: 1 }}>
                                                                    {product.image ? (
                                                                        <img src={product.image} alt={product.name} style={{ width: '60px', height: '60px', objectFit: 'cover', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }} />
                                                                    ) : (
                                                                        <div style={{ width: '60px', height: '60px', backgroundColor: '#f1f5f9', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>
                                                                            <ShoppingCart size={24} />
                                                                        </div>
                                                                    )}
                                                                    <div style={{ flex: 1 }}>
                                                                        <h3 style={{ margin: '0 0 4px 0', fontSize: '16px', fontWeight: 700, color: 'var(--color-text-main)' }}>{product.name}</h3>
                                                                        <div style={{ color: '#64748b', fontSize: '14px', fontWeight: 500 }}>
                                                                            {product.price ? product.price.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }) : '-'} / {product.unit}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '8px' }}>
                                                                <div style={{ backgroundColor: '#f8fafc', padding: '12px', borderRadius: 'var(--radius-md)' }}>
                                                                    <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '4px', textTransform: 'uppercase', fontWeight: 600 }}>Bestand</div>
                                                                    <div style={{ fontSize: '20px', fontWeight: 800, color: (Number(product.minStock) > 0 && Number(product.stock) <= Number(product.minStock)) ? '#dc2626' : 'var(--color-text-main)' }}>
                                                                        {product.stock}
                                                                    </div>
                                                                    {(() => {
                                                                        const openOrder = orders.find(o => o.productName === product.name && o.status === 'open');
                                                                        if (openOrder) {
                                                                            return (
                                                                                <div style={{ marginTop: '4px' }}>
                                                                                    <span className="badge badge-warning" style={{ fontSize: '10px' }} title="Bestellung ist unterwegs">
                                                                                        <ShoppingCart size={10} /> Unterwegs
                                                                                    </span>
                                                                                </div>
                                                                            );
                                                                        } else if (Number(product.minStock) > 0 && Number(product.stock) <= Number(product.minStock)) {
                                                                            return (
                                                                                <div style={{ marginTop: '4px' }}>
                                                                                    <span className="badge badge-danger" style={{ fontSize: '10px' }}>
                                                                                        <AlertTriangle size={10} /> Nachbestellen
                                                                                    </span>
                                                                                </div>
                                                                            );
                                                                        }
                                                                        return null;
                                                                    })()}
                                                                </div>
                                                                <div style={{ backgroundColor: '#f8fafc', padding: '12px', borderRadius: 'var(--radius-md)' }}>
                                                                    <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '4px', textTransform: 'uppercase', fontWeight: 600 }}>Gesamtwert</div>
                                                                    <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--color-text-main)' }}>
                                                                        {product.price ? (product.stock * product.price).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }) : '-'}
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' }}>
                                                                {product.orderUrl && (
                                                                    <button onClick={() => window.open(product.orderUrl, '_blank')} style={{ flex: '1 1 auto', padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1d4ed8', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontWeight: 600, transition: 'background-color 0.2s' }}>
                                                                        <ExternalLink size={16} /> Webshop
                                                                    </button>
                                                                )}
                                                                {(product.emailOrderAddress || suppliers.find(s => s.id === product.supplierId)?.email) && (
                                                                    <button onClick={() => window.location.href = `mailto:${product.emailOrderAddress || suppliers.find(s => s.id === product.supplierId)?.email}`} style={{ flex: '1 1 auto', padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid #e2e8f0', background: '#f8fafc', color: '#475569', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontWeight: 500 }}>
                                                                        <Mail size={16} /> E-Mail
                                                                    </button>
                                                                )}
                                                                {(product.supplierPhone || suppliers.find(s => s.id === product.supplierId)?.phone) && (
                                                                    <button onClick={() => setPhoneCallProduct(product)} style={{ flex: '1 1 auto', padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid #e2e8f0', background: '#f8fafc', color: '#475569', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontWeight: 500 }}>
                                                                        <Phone size={16} /> Anrufen
                                                                    </button>
                                                                )}
                                                            </div>
                                                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
                                                                <button onClick={() => { setEditingId(product.id); setNewProduct(product); setIsModalOpen(true); }} style={{ flex: '1 1 auto', padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-main)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontWeight: 500 }}>
                                                                    <Edit2 size={16} /> Edit
                                                                </button>
                                                                <button onClick={() => handleDeleteClick(product.id)} style={{ padding: '10px 14px', borderRadius: 'var(--radius-md)', border: '1px solid #fecaca', background: '#fef2f2', color: '#dc2626', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                                    <Trash2 size={18} />
                                                                </button>
                                                                <button onClick={() => handleOrderClick(product)} style={{ flex: '2 1 100%', padding: '12px', borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--color-primary)', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontWeight: 600, boxShadow: '0 2px 4px 0 rgba(37, 99, 235, 0.2)' }}>
                                                                    <ShoppingCart size={18} /> Bestellen
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <table className="products-table" style={{ tableLayout: 'fixed' }}>
                                                    <thead>
                                                        <tr>
                                                            <th style={{ width: '60px' }}></th>
                                                            <th className="sortable" onClick={() => handleSort('name')} style={{ width: '35%' }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                                    Name {sortConfig.key === 'name' ? (sortConfig.direction === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />) : <ArrowUpDown size={13} style={{ opacity: 0.3 }} />}
                                                                </div>
                                                            </th>
                                                            <th className="sortable" onClick={() => handleSort('stock')} style={{ width: '20%' }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                                    Bestand & Wert {sortConfig.key === 'stock' ? (sortConfig.direction === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />) : <ArrowUpDown size={13} style={{ opacity: 0.3 }} />}
                                                                </div>
                                                            </th>
                                                            <th style={{ width: '20%' }}>Kontakt / Links</th>
                                                            <th style={{ textAlign: 'center', width: '130px' }}>Bestellen</th>
                                                            <th style={{ width: '90px' }}></th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {visibleProds.map((product, index) => {
                                                            const isLastRows = index >= visibleProds.length - 2 && visibleProds.length > 3;
                                                            const openOrder = orders.find(o => o.productName === product.name && o.status === 'open');
                                                            const isLowStock = Number(product.minStock) > 0 && Number(product.stock) <= Number(product.minStock);
                                                            return (
                                                                <tr key={product.id} className={isLowStock && !openOrder ? 'row-low-stock' : ''}>
                                                                    <td>
                                                                        {product.image ? (
                                                                            <img src={product.image} alt={product.name} style={{ width: '44px', height: '44px', objectFit: 'cover', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }} />
                                                                        ) : (
                                                                            <div style={{ width: '44px', height: '44px', backgroundColor: 'var(--color-surface-elevated)', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-faint)' }}>
                                                                                <ShoppingCart size={18} />
                                                                            </div>
                                                                        )}
                                                                    </td>
                                                                    <td style={{ minWidth: '200px' }}>
                                                                        <div style={{ fontWeight: 700, fontSize: '16px', color: 'var(--color-text-main)', marginBottom: '2px' }}>{product.name}</div>
                                                                        <div style={{ color: '#64748b', fontSize: '13px', fontWeight: 500 }}>
                                                                            {product.price ? product.price.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }) : '-'} / {product.unit}
                                                                        </div>
                                                                        
                                                                        {(() => {
                                                                            const _supp = suppliers.find(s => s.id === product.supplierId);
                                                                            if (_supp?.notes) {
                                                                                return (_supp.notes.filter(n => n.showOnOpenOrders) || []).map(n => (
                                                                                    <div key={n.id} style={{ backgroundColor: '#fef3c7', color: '#92400e', padding: '4px 8px', borderRadius: '4px', marginTop: '6px', fontSize: '11px', display: 'inline-block', marginRight: '4px' }}><strong>Lieferant:</strong> {n.text}</div>
                                                                                ));
                                                                            }
                                                                            return null;
                                                                        })()}
                                                                        {(product.notes || []).filter(n => n.showOnOpenOrders).map(n => (
                                                                            <div key={n.id} style={{ backgroundColor: '#fef3c7', color: '#92400e', padding: '4px 8px', borderRadius: '4px', marginTop: '6px', fontSize: '11px', display: 'inline-block', marginRight: '4px' }}><strong>Notiz:</strong> {n.text}</div>
                                                                        ))}
                                                                    </td>
                                                                    <td>
                                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                                            <div style={{ display: 'inline-flex', alignItems: 'center', backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-full)', overflow: 'hidden', width: 'fit-content' }}>
                                                                                <button onClick={() => handleStockUpdate(product, Math.max(0, product.stock - 1))} style={{ padding: '6px 11px', border: 'none', background: 'var(--color-surface-elevated)', cursor: 'pointer', fontWeight: 700, fontSize: '15px', color: 'var(--color-text-muted)', borderRight: '1px solid var(--color-border)' }}>−</button>
                                                                                <input type="number" value={product.stock} min={0} onChange={e => handleStockUpdate(product, Math.max(0, parseInt(e.target.value) || 0))} style={{ width: '48px', textAlign: 'center', fontSize: '14px', fontWeight: 800, border: 'none', padding: '6px 4px', color: Number(product.stock) <= Number(product.minStock || 0) ? 'var(--color-danger)' : 'var(--color-text-main)', background: 'transparent', outline: 'none', MozAppearance: 'textfield' }} />
                                                                                <button onClick={() => handleStockUpdate(product, product.stock + 1)} style={{ padding: '6px 11px', border: 'none', background: 'var(--color-surface-elevated)', cursor: 'pointer', fontWeight: 700, fontSize: '15px', color: 'var(--color-primary)', borderLeft: '1px solid var(--color-border)' }}>+</button>
                                                                            </div>
                                                                            {openOrder ? (
                                                                                <span className="badge badge-warning" style={{ fontSize: '10.5px' }} title="Bestellung ist unterwegs">
                                                                                    <ShoppingCart size={10} /> Unterwegs
                                                                                </span>
                                                                            ) : isLowStock && (
                                                                                <span className="badge badge-danger" style={{ fontSize: '10.5px' }}>
                                                                                    <AlertTriangle size={10} /> Nachbestellen
                                                                                </span>
                                                                            )}
                                                                            {product.price && (
                                                                                <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', fontWeight: 500 }}>
                                                                                    ∑ {(product.stock * product.price).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    </td>
                                                                    <td>
                                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                                            {product.orderUrl && (
                                                                                <button onClick={() => window.open(product.orderUrl, '_blank')} className="btn btn-sm btn-primary" style={{ width: 'fit-content', borderRadius: 'var(--radius-sm)' }}>
                                                                                    <ExternalLink size={13} /> Webshop
                                                                                </button>
                                                                            )}
                                                                            {(product.emailOrderAddress || suppliers.find(s => s.id === product.supplierId)?.email) && (
                                                                                <button onClick={() => window.location.href = `mailto:${product.emailOrderAddress || suppliers.find(s => s.id === product.supplierId)?.email}`} className="btn btn-sm btn-ghost" style={{ width: 'fit-content', borderRadius: 'var(--radius-sm)' }}>
                                                                                    <Mail size={13} /> E-Mail
                                                                                </button>
                                                                            )}
                                                                            {(product.supplierPhone || suppliers.find(s => s.id === product.supplierId)?.phone) && (
                                                                                <button onClick={() => setPhoneCallProduct(product)} className="btn btn-sm btn-ghost" style={{ width: 'fit-content', borderRadius: 'var(--radius-sm)' }}>
                                                                                    <Phone size={13} /> Anrufen
                                                                                </button>
                                                                            )}
                                                                            {!product.orderUrl && !product.emailOrderAddress && !product.supplierPhone && (
                                                                                <span style={{ color: 'var(--color-text-faint)', fontSize: '13px', fontStyle: 'italic' }}>—</span>
                                                                            )}
                                                                        </div>
                                                                    </td>
                                                                    <td style={{ textAlign: 'center' }}>
                                                                        <button onClick={() => handleOrderClick(product)} className="btn btn-primary btn-sm" style={{ borderRadius: 'var(--radius-full)', paddingLeft: '16px', paddingRight: '16px' }}>
                                                                            <ShoppingCart size={15} /> Bestellen
                                                                        </button>
                                                                    </td>
                                                                    <td style={{ textAlign: 'right', position: 'relative' }}>
                                                                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                                                                            <button onClick={() => { setEditingId(product.id); setNewProduct(product); setIsModalOpen(true); }} className="btn btn-ghost btn-icon"><Edit2 size={15} /></button>
                                                                            <button onClick={() => setOpenSettingsId(openSettingsId === product.id ? null : product.id)} className="btn btn-ghost btn-icon"><Settings size={15} /></button>
                                                                        </div>
                                                                        {openSettingsId === product.id && (
                                                                            <>
                                                                                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10 }} onClick={() => setOpenSettingsId(null)} />
                                                                                <div style={{ position: 'absolute', right: '16px', ...(isLastRows ? { bottom: '100%', marginBottom: '8px' } : { top: '100%', marginTop: '8px' }), backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', border: '1px solid var(--color-border)', zIndex: 20, minWidth: '180px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                                                                                    <button onClick={() => { const links = getIoTLink(product); if (links) { setShowIoTLink(links); setOpenSettingsId(null); } }} style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '12px 16px', border: 'none', borderBottom: '1px solid var(--color-border)', backgroundColor: 'transparent', textAlign: 'left', cursor: 'pointer', color: 'var(--color-text-main)', fontSize: '14px', fontWeight: 500 }}><Wifi size={16} /> IoT Setup / QR</button>
                                                                                    <button onClick={() => handleDeleteClick(product.id)} style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '12px 16px', border: 'none', backgroundColor: 'transparent', textAlign: 'left', cursor: 'pointer', color: '#ef4444', fontSize: '14px', fontWeight: 500 }}><Trash2 size={16} /> Produkt löschen</button>
                                                                                </div>
                                                                            </>
                                                                        )}
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>
                                            )}
                                            
                                            {hasMore && (
                                                <div style={{ borderTop: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface-elevated)', padding: '4px 0' }}>
                                                    <button
                                                        onClick={() => toggleProductLimit(supplierId)}
                                                        className="btn btn-ghost"
                                                        style={{ width: '100%', borderRadius: 0, border: 'none', justifyContent: 'center', color: 'var(--color-primary)' }}
                                                    >
                                                        {showAll ? <><ChevronDown style={{ transform: 'rotate(180deg)' }} size={15} /> Einklappen</> : <><ChevronDown size={15} /> Alle {supProds.length} Produkte anzeigen</>}
                                                    </button>
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )
            }
            {
                isModalOpen && (
                    <div className="modal-overlay">
                        <div className="modal-box" style={{ maxWidth: '650px' }}>
                            {/* Modal Header */}
                            <div className="modal-header">
                                <h2 style={{ margin: 0, fontSize: 'var(--font-size-xl)' }}>{editingId ? '✏️ Produkt bearbeiten' : '✨ Neues Produkt anlegen'}</h2>
                                <button onClick={closeModal} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
                                    <X size={24} color="var(--color-text-muted)" />
                                </button>
                                <button 
                                    onClick={() => setActiveModalTab('analytics')}
                                    type="button"
                                    style={{
                                        padding: 'var(--spacing-md) var(--spacing-sm)',
                                        border: 'none',
                                        background: 'none',
                                        cursor: 'pointer',
                                        fontWeight: activeModalTab === 'analytics' ? 600 : 400,
                                        color: activeModalTab === 'analytics' ? '#0ea5e9' : 'var(--color-text-muted)',
                                        borderBottom: activeModalTab === 'analytics' ? '2px solid #0ea5e9' : '2px solid transparent'
                                    }}>
                                    📈 Preis-Analyse
                                </button>
                            </div>

                            {/* Tabs Header */}
                            <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', padding: '0 var(--spacing-lg)' }}>
                                <button 
                                    onClick={() => setActiveModalTab('basic')}
                                    style={{
                                        padding: 'var(--spacing-md) var(--spacing-sm)',
                                        border: 'none',
                                        background: 'none',
                                        cursor: 'pointer',
                                        fontWeight: activeModalTab === 'basic' ? 600 : 400,
                                        color: activeModalTab === 'basic' ? 'var(--color-primary)' : 'var(--color-text-muted)',
                                        borderBottom: activeModalTab === 'basic' ? '2px solid var(--color-primary)' : '2px solid transparent',
                                        marginRight: 'var(--spacing-md)'
                                    }}>
                                    📝 Grunddaten
                                </button>
                                <button 
                                    onClick={() => setActiveModalTab('inventory')}
                                    style={{
                                        padding: 'var(--spacing-md) var(--spacing-sm)',
                                        border: 'none',
                                        background: 'none',
                                        cursor: 'pointer',
                                        fontWeight: activeModalTab === 'inventory' ? 600 : 400,
                                        color: activeModalTab === 'inventory' ? 'var(--color-primary)' : 'var(--color-text-muted)',
                                        borderBottom: activeModalTab === 'inventory' ? '2px solid var(--color-primary)' : '2px solid transparent',
                                        marginRight: 'var(--spacing-md)'
                                    }}>
                                    📊 Bestand & Logistik
                                </button>
                                <button 
                                    onClick={() => setActiveModalTab('order')}
                                    style={{
                                        padding: 'var(--spacing-md) var(--spacing-sm)',
                                        border: 'none',
                                        background: 'none',
                                        cursor: 'pointer',
                                        fontWeight: activeModalTab === 'order' ? 600 : 400,
                                        color: activeModalTab === 'order' ? 'var(--color-primary)' : 'var(--color-text-muted)',
                                        borderBottom: activeModalTab === 'order' ? '2px solid var(--color-primary)' : '2px solid transparent'
                                    }}>
                                    🛒 Beschaffung
                                </button>
                            </div>

                            {/* Scrollable Content */}
                            <div className="modal-body" style={{ backgroundColor: 'var(--color-background)' }}>
                                <form id="product-form" onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                                    
                                    {/* TAB: BASIC */}
                                    {activeModalTab === 'basic' && (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-lg)' }}>

                                            {/* Section: Stammdaten */}
                                            <div style={{ backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', padding: 'var(--spacing-lg)', border: '1px solid var(--color-border)' }}>
                                                <p style={{ margin: '0 0 var(--spacing-md) 0', fontSize: 'var(--font-size-xs)', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Stammdaten</p>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                                                    <div className="form-group">
                                                        <label className="form-label">Name *</label>
                                                        <input
                                                            required
                                                            value={newProduct.name || ''}
                                                            onChange={e => setNewProduct({ ...newProduct, name: e.target.value })}
                                                            className="input-field"
                                                            style={!newProduct.name ? { borderColor: 'var(--color-danger)' } : {}}
                                                        />
                                                    </div>
                                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                                                        <div className="form-group">
                                                            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                                Kategorie
                                                                {(() => {
                                                                    const s = suppliers.find(su => su.id === newProduct.supplierId);
                                                                    return s?.defaultCategory && newProduct.category === s.defaultCategory ? (
                                                                        <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-primary)', backgroundColor: 'rgba(37,99,235,0.08)', padding: '1px 6px', borderRadius: '10px' }}>
                                                                            vom Lieferanten
                                                                        </span>
                                                                    ) : null;
                                                                })()}
                                                            </label>
                                                            {isCustomCategoryMode ? (
                                                                <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
                                                                    <input
                                                                        value={newProduct.category || ''}
                                                                        onChange={e => setNewProduct({ ...newProduct, category: e.target.value })}
                                                                        placeholder="Eigene..."
                                                                        autoFocus
                                                                        className="input-field"
                                                                    />
                                                                    <button type="button" onClick={() => { setIsCustomCategoryMode(false); setNewProduct({ ...newProduct, category: '' }); }} className="btn btn-ghost btn-icon"><X size={16} /></button>
                                                                </div>
                                                            ) : (
                                                                <select
                                                                    value={newProduct.category || ''}
                                                                    onChange={e => {
                                                                        if (e.target.value === 'custom') { setIsCustomCategoryMode(true); setNewProduct({ ...newProduct, category: '' }); }
                                                                        else { setNewProduct({ ...newProduct, category: e.target.value }); }
                                                                    }}
                                                                    className="input-field"
                                                                >
                                                                    <option value="">-- Leer --</option>
                                                                    {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                                                                    <option value="custom">Eigene eingeben...</option>
                                                                </select>
                                                            )}
                                                        </div>
                                                        <div className="form-group">
                                                            <label className="form-label">Produktnummer</label>
                                                            <input
                                                                value={newProduct.productNumber || ''}
                                                                onChange={e => setNewProduct({ ...newProduct, productNumber: e.target.value })}
                                                                placeholder="z.B. 12345-AB"
                                                                className="input-field"
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Section: Produktbild */}
                                            <div style={{ backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', padding: 'var(--spacing-lg)', border: '1px solid var(--color-border)' }}>
                                                <p style={{ margin: '0 0 var(--spacing-md) 0', fontSize: 'var(--font-size-xs)', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Produktbild</p>
                                                <div className="form-group">
                                                <label className="form-label" style={{ display: 'none' }}>Produktbild</label>
                                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                    <input
                                                        type="url"
                                                        placeholder="https://... (URL einfügen)"
                                                        value={newProduct.image || ''}
                                                        onChange={e => setNewProduct({ ...newProduct, image: e.target.value })}
                                                        className="input-field"
                                                        style={{ flex: 1 }}
                                                    />
                                                    <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>oder</span>
                                                    <label style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', padding: '10px', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                                                        Datei hochladen
                                                        <input 
                                                            type="file" 
                                                            accept="image/*"
                                                            style={{ display: 'none' }}
                                                            onChange={async (e) => {
                                                                const file = e.target.files?.[0];
                                                                if (!file) return;
                                                                if (file.size > 5 * 1024 * 1024) {
                                                                    setNotification({ message: 'Das Bild darf maximal 5MB groß sein.', type: 'error' });
                                                                    return;
                                                                }
                                                                // Upload to Supabase Storage
                                                                const fileExt = file.name.split('.').pop();
                                                                const fileName = `${Math.random().toString(36).substring(2)}.${fileExt}`;
                                                                const filePath = `${fileName}`;
                                                                
                                                                try {
                                                                    setNotification({ message: 'Lade Bild hoch...', type: 'info' });
                                                                    if (!supabase) throw new Error("No database");
                                                                    const { error: uploadError } = await supabase.storage.from("product_images").upload(filePath, file);
                                                                    if (uploadError) throw uploadError;
                                                                    
                                                                    const { data: { publicUrl } } = supabase.storage.from('product_images').getPublicUrl(filePath);
                                                                    setNewProduct(prev => ({ ...prev, image: publicUrl }));
                                                                    setNotification({ message: 'Bild erfolgreich hochgeladen', type: 'success' });
                                                                } catch (err) {
                                                                    console.error('Upload Error:', err);
                                                                    setNotification({ message: 'Fehler beim Bild-Upload. Wahrscheinlich blockiert (RLS).', type: 'error' });
                                                                }
                                                            }}
                                                        />
                                                    </label>
                                                </div>
                                                {newProduct.image && (
                                                    <div style={{ marginTop: '8px' }}>
                                                        <img src={newProduct.image} alt="Vorschau" style={{ width: '60px', height: '60px', objectFit: 'cover', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }} />
                                                    </div>
                                                )}
                                                </div>
                                            </div>

                                            {/* Section: Notizen */}
                                            <div style={{ backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', padding: 'var(--spacing-lg)', border: '1px solid var(--color-border)' }}>
                                                <p style={{ margin: '0 0 var(--spacing-md) 0', fontSize: 'var(--font-size-xs)', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Notizen</p>
                                                {(newProduct.notes || []).map((note, idx) => (
                                                    <div key={note.id} style={{ marginBottom: 'var(--spacing-md)', padding: 'var(--spacing-md)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--color-surface-elevated)' }}>
                                                        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                                                            <textarea
                                                                rows={2}
                                                                value={note.text}
                                                                onChange={e => { const updated = [...(newProduct.notes || [])]; updated[idx].text = e.target.value; setNewProduct({ ...newProduct, notes: updated }); }}
                                                                placeholder="Notiz eingeben..."
                                                                className="input-field"
                                                            />
                                                            <button type="button" onClick={() => { const updated = (newProduct.notes || []).filter((_, i) => i !== idx); setNewProduct({ ...newProduct, notes: updated }); }} className="btn btn-ghost btn-icon" style={{ color: 'var(--color-danger)', flexShrink: 0 }}><X size={18} /></button>
                                                        </div>
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
                                                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: 'var(--font-size-sm)' }}>
                                                                <input type="checkbox" checked={note.showOnOrderCreation} onChange={e => { const updated = [...(newProduct.notes || [])]; updated[idx].showOnOrderCreation = e.target.checked; setNewProduct({ ...newProduct, notes: updated }); }} />
                                                                Beim Anlegen einer Bestellung anzeigen
                                                            </label>
                                                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: 'var(--font-size-sm)' }}>
                                                                <input type="checkbox" checked={note.showOnOpenOrders} onChange={e => { const updated = [...(newProduct.notes || [])]; updated[idx].showOnOpenOrders = e.target.checked; setNewProduct({ ...newProduct, notes: updated }); }} />
                                                                Bei offenen Bestellungen anzeigen
                                                            </label>
                                                        </div>
                                                    </div>
                                                ))}
                                                <button type="button" onClick={() => { const updated = [...(newProduct.notes || []), { id: generateId(), text: '', showOnOrderCreation: false, showOnOpenOrders: false }]; setNewProduct({ ...newProduct, notes: updated }); }} className="btn btn-ghost btn-sm" style={{ padding: '6px 0' }}>
                                                    <Plus size={14} /> Notiz hinzufügen
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {/* TAB: ANALYTICS */}
                                    {activeModalTab === 'analytics' && (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                                            <div style={{ padding: 'var(--spacing-lg)', backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
                                                <h4 style={{ margin: '0 0 8px 0', color: '#0369a1', display: 'flex', alignItems: 'center', gap: '8px' }}><TrendingUp size={20} /> Preisentwicklung</h4>
                                                <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', margin: '0 0 8px 0', lineHeight: 1.5 }}>
                                                    Dieses Diagramm wird <strong>automatisch</strong> durch alle manuellen Bestellungen sowie durch eingehende Rechnungen gefüllt, die von der KI verarbeitet wurden.
                                                </p>
                                                
                                                <PriceHistoryChart productName={newProduct.name || ''} />
                                            </div>
                                        </div>
                                    )}

                                    {/* TAB: INVENTORY */}
                                    {activeModalTab === 'inventory' && (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-lg)' }}>

                                            {/* Section: Bestand & Einheit */}
                                            <div style={{ backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', padding: 'var(--spacing-lg)', border: '1px solid var(--color-border)' }}>
                                                <p style={{ margin: '0 0 var(--spacing-md) 0', fontSize: 'var(--font-size-xs)', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Bestand & Einheit</p>
                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--spacing-md)' }}>
                                                    <div className="form-group">
                                                        <label className="form-label">Bestand</label>
                                                        <input type="number" value={newProduct.stock || 0} onChange={e => setNewProduct({ ...newProduct, stock: Number(e.target.value) })} className="input-field" />
                                                    </div>
                                                    <div className="form-group">
                                                        <label className="form-label">Einheit</label>
                                                        <input value={newProduct.unit || ''} onChange={e => setNewProduct({ ...newProduct, unit: e.target.value })} placeholder="Stück, Liter..." className="input-field" />
                                                    </div>
                                                    <div className="form-group">
                                                        <label className="form-label">Preis (Netto €)</label>
                                                        <input type="number" step="0.01" value={newProduct.price || ''} onChange={e => setNewProduct({ ...newProduct, price: parseFloat(e.target.value) || 0 })} placeholder="0.00" className="input-field" />
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Section: Autopilot */}
                                            <div style={{ backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', padding: 'var(--spacing-lg)', border: '1px solid var(--color-border)' }}>
                                                <p style={{ margin: '0 0 var(--spacing-md) 0', fontSize: 'var(--font-size-xs)', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Bestell-Autopilot</p>
                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)', marginBottom: 'var(--spacing-md)' }}>
                                                    <div className="form-group">
                                                        <label className="form-label">Meldebestand (Untergrenze)</label>
                                                        <input type="number" value={newProduct.minStock || 0} onChange={e => setNewProduct({ ...newProduct, minStock: Number(e.target.value) })} className="input-field" />
                                                        <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '2px' }}>0 = keine Bestandswarnung.</span>
                                                    </div>
                                                    <div className="form-group">
                                                        <label className="form-label">Standard Bestellmenge</label>
                                                        <input type="number" value={newProduct.standardOrderQuantity || ''} onChange={e => setNewProduct({ ...newProduct, standardOrderQuantity: e.target.value ? Number(e.target.value) : undefined })} placeholder="Optional" className="input-field" />
                                                    </div>
                                                </div>
                                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: 'var(--font-size-sm)' }}>
                                                    <input type="checkbox" checked={newProduct.ignoreOrderProposals || false} onChange={e => setNewProduct({ ...newProduct, ignoreOrderProposals: e.target.checked })} style={{ width: '18px', height: '18px' }} />
                                                    <span>📉 <strong>Artikel komplett vom Bestell-Autopiloten ausschließen</strong> (keine Vorschläge generieren).</span>
                                                </label>
                                            </div>

                                            {/* Section: Verbrauchssteuerung */}
                                            <div style={{ backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', padding: 'var(--spacing-lg)', border: '1px solid var(--color-border)' }}>
                                                <p style={{ margin: '0 0 var(--spacing-md) 0', fontSize: 'var(--font-size-xs)', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Verbrauchssteuerung</p>
                                                <div className="form-group">
                                                    <label className="form-label">Automatischer System-Verbrauch</label>
                                                    <div style={{ display: 'flex', gap: '8px' }}>
                                                        <input type="number" step="0.01" min="0" value={newProduct.consumptionAmount || ''} onChange={e => setNewProduct({ ...newProduct, consumptionAmount: parseFloat(e.target.value) || undefined })} placeholder="Menge abziehen..." className="input-field" />
                                                        <select value={newProduct.consumptionPeriod || ''} onChange={e => setNewProduct({ ...newProduct, consumptionPeriod: e.target.value as 'day' | 'week' | undefined })} className="input-field" style={{ width: 'auto', minWidth: '140px' }}>
                                                            <option value="">-- Zyklus --</option>
                                                            <option value="day">pro Tag</option>
                                                            <option value="week">pro Woche</option>
                                                        </select>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* TAB: ORDER */}
                                    {activeModalTab === 'order' && (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-lg)' }}>

                                            {/* Section: Lieferant */}
                                            <div style={{ backgroundColor: isCreatingSupplier ? '#f0f9ff' : 'var(--color-surface)', borderRadius: 'var(--radius-lg)', padding: 'var(--spacing-lg)', border: isCreatingSupplier ? '1px solid var(--color-primary)' : '1px solid var(--color-border)', transition: 'all 0.3s' }}>
                                                <p style={{ margin: '0 0 var(--spacing-md) 0', fontSize: 'var(--font-size-xs)', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Lieferant</p>
                                                {!isCreatingSupplier ? (
                                                    <div style={{ display: 'flex', gap: '8px' }}>
                                                        <select
                                                            value={newProduct.supplierId || ''}
                                                            onChange={e => {
                                                                const sId = e.target.value; const s = suppliers.find(su => su.id === sId);
                                                                const fallbackUrl = newProduct.orderUrl ? newProduct.orderUrl : (s?.url || s?.loginUrl || '');
                                                                const autoCategory = !newProduct.category && s?.defaultCategory ? s.defaultCategory : newProduct.category;
                                                                setNewProduct({ ...newProduct, supplierId: sId || undefined, emailOrderAddress: s?.email || '', supplierPhone: s?.phone || '', orderUrl: fallbackUrl, category: autoCategory });
                                                            }}
                                                            className="input-field"
                                                            style={{ flex: 1 }}
                                                        >
                                                            <option value="">-- Keiner --</option>
                                                            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                                        </select>
                                                        <button type="button" onClick={() => { setIsCreatingSupplier(true); setNewSupplier({ name: '', email: '', phone: '' }); }} className="btn btn-primary">Neu</button>
                                                    </div>
                                                ) : (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-sm)' }}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                            <span style={{ fontWeight: 600, color: 'var(--color-primary)', fontSize: '14px' }}>✨ Neuen Lieferanten anlegen</span>
                                                            <button type="button" onClick={() => setIsCreatingSupplier(false)} className="btn btn-ghost btn-sm">Abbrechen</button>
                                                        </div>
                                                        <input type="text" placeholder="Firmenname *" value={newSupplier.name} onChange={e => setNewSupplier({ ...newSupplier, name: e.target.value })} className="input-field" />
                                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-sm)' }}>
                                                            <input type="email" placeholder="Bestell-Email" value={newSupplier.email} onChange={e => setNewSupplier({ ...newSupplier, email: e.target.value })} className="input-field" />
                                                            <input type="tel" placeholder="Telefon (opt.)" value={newSupplier.phone} onChange={e => setNewSupplier({ ...newSupplier, phone: e.target.value })} className="input-field" />
                                                        </div>
                                                        <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', margin: '4px 0 0 0' }}>Der Lieferant wird beim Speichern dieses Produktes dauerhaft im System gespeichert.</p>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Section: Bestellweg */}
                                            <div style={{ backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', padding: 'var(--spacing-lg)', border: '1px solid var(--color-border)' }}>
                                                <p style={{ margin: '0 0 var(--spacing-md) 0', fontSize: 'var(--font-size-xs)', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Bestellweg</p>
                                                <div className="form-group" style={{ marginBottom: 'var(--spacing-md)' }}>
                                                    <label className="form-label">Präferierter Bestellweg (bei Klick auf Bestellen)</label>
                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-md)', backgroundColor: 'var(--color-surface-elevated)', padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                                                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}><input type="radio" name="pom" value="" checked={!newProduct.preferredOrderMethod} onChange={() => setNewProduct({ ...newProduct, preferredOrderMethod: undefined })} /> Vom Lieferanten</label>
                                                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}><input type="radio" name="pom" value="email" checked={newProduct.preferredOrderMethod === 'email'} onChange={() => setNewProduct({ ...newProduct, preferredOrderMethod: 'email' })} /> <Mail size={14}/> Email</label>
                                                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}><input type="radio" name="pom" value="webshop" checked={newProduct.preferredOrderMethod === 'webshop' || newProduct.preferredOrderMethod === 'link'} onChange={() => setNewProduct({ ...newProduct, preferredOrderMethod: 'webshop' })} /> <ExternalLink size={14}/> Webshop</label>
                                                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}><input type="radio" name="pom" value="phone" checked={newProduct.preferredOrderMethod === 'phone'} onChange={() => setNewProduct({ ...newProduct, preferredOrderMethod: 'phone' })} /> <Phone size={14}/> Telefon</label>
                                                    </div>
                                                </div>
                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                                                    <div className="form-group" style={{ 
                                                        transition: 'all 0.3s ease', 
                                                        padding: '12px', 
                                                        borderRadius: 'var(--radius-md)', 
                                                        backgroundColor: (newProduct.preferredOrderMethod === 'link' || newProduct.preferredOrderMethod === 'webshop') ? 'rgba(37, 99, 235, 0.05)' : 'transparent',
                                                        border: (newProduct.preferredOrderMethod === 'link' || newProduct.preferredOrderMethod === 'webshop') ? '1px solid var(--color-primary)' : '1px solid transparent'
                                                    }}>
                                                        <label className="form-label" style={{ color: (newProduct.preferredOrderMethod === 'link' || newProduct.preferredOrderMethod === 'webshop') ? 'var(--color-primary)' : 'inherit' }}>Webshop / Bestell-URL</label>
                                                        <input type="url" value={newProduct.orderUrl || ''} onChange={e => setNewProduct({ ...newProduct, orderUrl: e.target.value })} onBlur={e => { const val = e.target.value; if (val && !/^https?:\/\//i.test(val)) setNewProduct({ ...newProduct, orderUrl: 'https://' + val }); }} placeholder="https://..." className="input-field" style={{ borderColor: (newProduct.preferredOrderMethod === 'link' || newProduct.preferredOrderMethod === 'webshop') ? 'var(--color-primary)' : '' }} />
                                                    </div>
                                                    <div className="form-group" style={{ 
                                                        transition: 'all 0.3s ease', 
                                                        padding: '12px', 
                                                        borderRadius: 'var(--radius-md)', 
                                                        backgroundColor: newProduct.preferredOrderMethod === 'email' ? 'rgba(37, 99, 235, 0.05)' : 'transparent',
                                                        border: newProduct.preferredOrderMethod === 'email' ? '1px solid var(--color-primary)' : '1px solid transparent'
                                                    }}>
                                                        <label className="form-label" style={{ color: newProduct.preferredOrderMethod === 'email' ? 'var(--color-primary)' : 'inherit' }}>Abweichende E-Mail (nur dieses Produkt)</label>
                                                        <input type="email" placeholder="Wenn leer: Lieferanten-Email" value={newProduct.emailOrderAddress || ''} onChange={e => setNewProduct({ ...newProduct, emailOrderAddress: e.target.value })} className="input-field" style={{ borderColor: newProduct.preferredOrderMethod === 'email' ? 'var(--color-primary)' : '' }} />
                                                    </div>
                                                </div>
                                                <div className="form-group" style={{ 
                                                    marginTop: 'var(--spacing-sm)',
                                                    transition: 'all 0.3s ease', 
                                                    padding: '12px', 
                                                    borderRadius: 'var(--radius-md)', 
                                                    backgroundColor: newProduct.preferredOrderMethod === 'phone' ? 'rgba(37, 99, 235, 0.05)' : 'transparent',
                                                    border: newProduct.preferredOrderMethod === 'phone' ? '1px solid var(--color-primary)' : '1px solid transparent'
                                                }}>
                                                    <label className="form-label" style={{ color: newProduct.preferredOrderMethod === 'phone' ? 'var(--color-primary)' : 'inherit' }}>Direkte Bestell-Telefonnummer</label>
                                                    <input type="tel" placeholder="Wenn leer: Lieferanten-Telefon" value={newProduct.supplierPhone || ''} onChange={e => setNewProduct({ ...newProduct, supplierPhone: e.target.value })} className="input-field" style={{ borderColor: newProduct.preferredOrderMethod === 'phone' ? 'var(--color-primary)' : '' }} />
                                                </div>
                                            </div>

                                            {/* Section: E-Mail Vorlage */}
                                            <div style={{ backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', padding: 'var(--spacing-lg)', border: '1px solid var(--color-border)' }}>
                                                <p style={{ margin: '0 0 var(--spacing-md) 0', fontSize: 'var(--font-size-xs)', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>E-Mail Vorlage</p>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                                                    <div className="form-group">
                                                        <label className="form-label">Standard Betreff</label>
                                                        <input type="text" value={newProduct.emailOrderSubject || ''} onChange={e => setNewProduct({ ...newProduct, emailOrderSubject: e.target.value })} className="input-field" />
                                                    </div>
                                                    <div className="form-group">
                                                        <label className="form-label">Standard Nachrichtentext</label>
                                                        <textarea value={newProduct.emailOrderBody || ''} onChange={e => setNewProduct({ ...newProduct, emailOrderBody: e.target.value })} rows={4} className="input-field" />
                                                    </div>
                                                </div>
                                            </div>

                                        </div>
                                    )}
                                </form>
                            </div>

                            {/* Modal Footer (Sticky) */}
                            <div className="modal-footer">
                                <button type="button" onClick={closeModal} className="btn btn-ghost">
                                    Abbrechen
                                </button>
                                <button form="product-form" type="submit" disabled={isLoading} className="btn btn-primary" style={{ opacity: isLoading ? 0.7 : 1 }}>
                                    {isLoading ? 'Speichert...' : '💾 ' + (editingId ? 'Änderungen speichern' : 'Produkt anlegen')}
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            { deleteConfirmId && (
                    <div className="modal-overlay" style={{ zIndex: 1200 }}>
                        <div className="card" style={{ padding: 'var(--spacing-xl)', maxWidth: '400px', textAlign: 'center' }}>
                            <h3 style={{ marginTop: 0 }}>Produkt löschen?</h3>
                            <p style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--spacing-lg)' }}>
                                Möchten Sie dieses Produkt wirklich unwiderruflich löschen?
                            </p>
                            <div style={{ display: 'flex', justifyContent: 'center', gap: 'var(--spacing-md)' }}>
                                <button onClick={() => setDeleteConfirmId(null)} className="btn btn-ghost">
                                    Abbrechen
                                </button>
                                <button
                                    onClick={confirmDelete}
                                    disabled={isLoading}
                                    className="btn btn-danger-solid"
                                    style={{ opacity: isLoading ? 0.7 : 1 }}
                                >
                                    {isLoading ? 'Löscht...' : 'Ja, löschen'}
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {
                isOrderModalOpen && orderCart.length > 0 && ((selectedProductForOrder) => (
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
                            boxShadow: 'var(--shadow-lg)',
                            maxHeight: '90vh', // Ensure it doesn't overflow screen
                            overflowY: 'auto'  // Allow scrolling
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-lg)' }}>
                                <h3 style={{ margin: 0, fontSize: 'var(--font-size-lg)' }}>Bestellung aufgeben</h3>
                                <button onClick={() => setIsOrderModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                                    <X size={24} />
                                </button>
                            </div>

                            <form onSubmit={handleCreateOrder} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                                <div>
                                    <h4 style={{ margin: '0 0 var(--spacing-sm) 0', color: 'var(--color-primary)' }}>Bestellübersicht</h4>
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
                                                        <Trash2 size={18} />
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                    
                                    {(() => {
                                        const supplierId = selectedProductForOrder.supplierId;
                                        if (!supplierId) return null;
                                        const suggestions = products.filter(p => p.supplierId === supplierId && !orderCart.some(c => c.product.id === p.id));
                                        if (suggestions.length === 0) return null;
                                        return (
                                            <div style={{ padding: '12px', backgroundColor: 'var(--color-background)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                                                <h5 style={{ margin: '0 0 10px 0', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>Weitere Produkte vom Lieferanten hinzufügen:</h5>
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
                                                </div>
                                            </div>
                                        );
                                    })()}
                                </div>

                                <div>
                                    <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>Bestelldatum</label>
                                    <input
                                        type="date"
                                        required
                                        value={orderDate}
                                        onChange={e => setOrderDate(e.target.value)}
                                        style={{ width: '100%', padding: 'var(--spacing-sm)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}
                                    />
                                </div>

                                <div>
                                    <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>Notizen</label>
                                    <textarea
                                        rows={3}
                                        value={orderNotes}
                                        onChange={e => setOrderNotes(e.target.value)}
                                        placeholder="Optionale Notizen zur Bestellung..."
                                        style={{ width: '100%', padding: 'var(--spacing-sm)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontFamily: 'inherit' }}
                                    />
                                </div>



                                {/* Product Note Warning */}
                                {(() => {
                                    if (selectedProductForOrder.notes && selectedProductForOrder.notes.length > 0) {
                                        return selectedProductForOrder.notes.filter(n => n.showOnOrderCreation).map(n => (
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

                                {/* Supplier Note Warning */}
                                {(() => {
                                    const supplier = suppliers.find(s => s.id === selectedProductForOrder.supplierId);
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

                                {/* Supplier Documents */}
                                {(() => {
                                    const supplier = suppliers.find(s => s.id === selectedProductForOrder.supplierId);
                                    if (supplier && supplier.documents && supplier.documents.length > 0) {
                                        return (
                                            <div style={{
                                                backgroundColor: 'var(--color-background)',
                                                padding: 'var(--spacing-md)',
                                                borderRadius: 'var(--radius-md)',
                                                border: '1px solid var(--color-border)',
                                                marginBottom: 'var(--spacing-md)'
                                            }}>
                                                <label style={{ display: 'block', marginBottom: 'var(--spacing-sm)', fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>
                                                    Lieferanten-Dokumente:
                                                </label>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                    {supplier.documents.map((doc, index) => (
                                                        <a
                                                            key={index}
                                                            href={doc.url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            style={{
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: '8px',
                                                                color: 'var(--color-primary)',
                                                                textDecoration: 'none',
                                                                fontSize: 'var(--font-size-sm)'
                                                            }}
                                                        >
                                                            <ExternalLink size={14} />
                                                            {doc.name}
                                                            {doc.date && <span style={{ color: 'var(--color-text-muted)', fontSize: '10px' }}>({doc.date})</span>}
                                                        </a>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    }
                                    return null;
                                })()}

                                {/* Order Methods Wrapper */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                                    {(selectedProductForOrder.orderUrl || suppliers.find(s => s.id === selectedProductForOrder.supplierId)?.orderUrl || suppliers.find(s => s.id === selectedProductForOrder.supplierId)?.url) && (
                                        <div style={{
                                            backgroundColor: (getEffectiveOrderMethod(selectedProductForOrder) === 'link' || getEffectiveOrderMethod(selectedProductForOrder) === 'webshop') ? 'rgba(37, 99, 235, 0.05)' : 'var(--color-background)',
                                            padding: 'var(--spacing-md)',
                                            borderRadius: 'var(--radius-md)',
                                            border: (getEffectiveOrderMethod(selectedProductForOrder) === 'link' || getEffectiveOrderMethod(selectedProductForOrder) === 'webshop') ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                                            order: (getEffectiveOrderMethod(selectedProductForOrder) === 'link' || getEffectiveOrderMethod(selectedProductForOrder) === 'webshop') ? -1 : 0
                                        }}>
                                            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--spacing-sm)', fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>
                                                Bestelllink:
                                                {(getEffectiveOrderMethod(selectedProductForOrder) === 'link' || getEffectiveOrderMethod(selectedProductForOrder) === 'webshop') && (
                                                    <span style={{ fontSize: '10px', backgroundColor: 'var(--color-primary)', color: 'white', padding: '2px 6px', borderRadius: '10px' }}>STANDARD</span>
                                                )}
                                            </label>
                                            <a
                                                href={selectedProductForOrder.orderUrl || suppliers.find(s => s.id === selectedProductForOrder.supplierId)?.orderUrl || suppliers.find(s => s.id === selectedProductForOrder.supplierId)?.url}
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
                                                    backgroundColor: (getEffectiveOrderMethod(selectedProductForOrder) === 'link' || getEffectiveOrderMethod(selectedProductForOrder) === 'webshop') ? 'var(--color-primary)' : 'var(--color-surface)',
                                                    color: (getEffectiveOrderMethod(selectedProductForOrder) === 'link' || getEffectiveOrderMethod(selectedProductForOrder) === 'webshop') ? 'white' : 'var(--color-text-main)',
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

                                    {(selectedProductForOrder.supplierPhone || suppliers.find(s => s.id === selectedProductForOrder.supplierId)?.orderPhone || suppliers.find(s => s.id === selectedProductForOrder.supplierId)?.phone) && (
                                        <div style={{
                                            backgroundColor: getEffectiveOrderMethod(selectedProductForOrder) === 'phone' ? 'rgba(37, 99, 235, 0.05)' : 'var(--color-background)',
                                            padding: 'var(--spacing-md)',
                                            borderRadius: 'var(--radius-md)',
                                            border: getEffectiveOrderMethod(selectedProductForOrder) === 'phone' ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                                            order: getEffectiveOrderMethod(selectedProductForOrder) === 'phone' ? -1 : 0
                                        }}>
                                            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--spacing-sm)', fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>
                                                Telefonische Bestellung:
                                                {getEffectiveOrderMethod(selectedProductForOrder) === 'phone' && (
                                                    <span style={{ fontSize: '10px', backgroundColor: 'var(--color-primary)', color: 'white', padding: '2px 6px', borderRadius: '10px' }}>STANDARD</span>
                                                )}
                                            </label>
                                            
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px', padding: '12px', backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-sm)', border: '1px dashed var(--color-border)' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                                                    <span style={{ color: 'var(--color-text-muted)' }}>Menge zu bestellen:</span>
                                                    <span style={{ fontWeight: 700, color: 'var(--color-primary)' }}>{orderCart.find(c => c.product.id === selectedProductForOrder.id)?.quantity || 1} {selectedProductForOrder.unit}</span>
                                                </div>
                                                {selectedProductForOrder.productNumber && (
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                                                        <span style={{ color: 'var(--color-text-muted)' }}>Produktnummer:</span>
                                                        <span style={{ fontWeight: 600 }}>{selectedProductForOrder.productNumber}</span>
                                                    </div>
                                                )}
                                                {suppliers.find(s => s.id === selectedProductForOrder.supplierId)?.customerNumber && (
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                                                        <span style={{ color: 'var(--color-text-muted)' }}>Eigene Kundennr.:</span>
                                                        <span style={{ fontWeight: 600 }}>{suppliers.find(s => s.id === selectedProductForOrder.supplierId)?.customerNumber}</span>
                                                    </div>
                                                )}
                                            </div>

                                            <button
                                                type="button"
                                                onClick={() => setPhoneCallProduct(selectedProductForOrder)}
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    gap: 'var(--spacing-sm)',
                                                    padding: 'var(--spacing-sm)',
                                                    borderRadius: 'var(--radius-sm)',
                                                    border: '1px solid var(--color-border)',
                                                    backgroundColor: getEffectiveOrderMethod(selectedProductForOrder) === 'phone' ? 'var(--color-primary)' : 'var(--color-surface)',
                                                    color: getEffectiveOrderMethod(selectedProductForOrder) === 'phone' ? 'white' : 'var(--color-text-main)',
                                                    cursor: 'pointer',
                                                    fontWeight: 500,
                                                    width: '100%'
                                                }}
                                            >
                                                <Phone size={16} />
                                                {selectedProductForOrder.supplierPhone || suppliers.find(s => s.id === selectedProductForOrder.supplierId)?.orderPhone || suppliers.find(s => s.id === selectedProductForOrder.supplierId)?.phone}
                                                <span style={{ fontSize: 'var(--font-size-xs)', opacity: 0.8 }}>(Anruf vorbereiten)</span>
                                            </button>
                                        </div>
                                    )}

                                    {(selectedProductForOrder.emailOrderAddress || suppliers.find(s => s.id === selectedProductForOrder.supplierId)?.email) && !selectedProductForOrder.autoOrder && (
                                        <>
                                            {getEffectiveOrderMethod(selectedProductForOrder) !== 'email' && !isOrderEmailExpanded ? (
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
                                                    backgroundColor: getEffectiveOrderMethod(selectedProductForOrder) === 'email' ? 'rgba(37, 99, 235, 0.05)' : 'var(--color-background)',
                                                    padding: 'var(--spacing-md)',
                                                    borderRadius: 'var(--radius-md)',
                                                    border: getEffectiveOrderMethod(selectedProductForOrder) === 'email' ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                                                    order: getEffectiveOrderMethod(selectedProductForOrder) === 'email' ? -1 : 0
                                                }}>
                                                    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--spacing-sm)', fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>
                                                        Email Vorschau & Bearbeitung:
                                                        {getEffectiveOrderMethod(selectedProductForOrder) === 'email' && (
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
                                                        onClick={() => prepareEmailLink('gmail')}
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

                                {selectedProductForOrder.autoOrder && (
                                    <div style={{
                                        backgroundColor: 'var(--color-background)',
                                        padding: 'var(--spacing-md)',
                                        borderRadius: 'var(--radius-md)',
                                        border: '1px solid var(--color-border)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 'var(--spacing-sm)',
                                        color: 'var(--color-primary)'
                                    }}>
                                        <CheckSquare size={20} />
                                        <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>
                                            Wird automatisch per EmailJS versendet
                                        </span>
                                    </div>
                                )}

                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--spacing-md)', marginTop: 'var(--spacing-md)' }}>
                                    <button
                                        type="button"
                                        onClick={() => setIsOrderModalOpen(false)}
                                        style={{
                                            padding: 'var(--spacing-sm) var(--spacing-md)',
                                            borderRadius: 'var(--radius-md)',
                                            border: '1px solid var(--color-border)',
                                            backgroundColor: 'transparent',
                                            color: 'var(--color-text-main)'
                                        }}
                                    >
                                        Abbrechen
                                    </button>
                                    <button
                                        type="submit"
                                        style={{
                                            padding: 'var(--spacing-sm) var(--spacing-md)',
                                            borderRadius: 'var(--radius-md)',
                                            border: 'none',
                                            backgroundColor: 'var(--color-primary)',
                                            color: 'white'
                                        }}
                                    >
                                        Bestellung anlegen
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                ))(orderCart[0].product)
            }
            {/* IoT / QR Code Modal with Tabs */}
            {showIoTLink && (
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
                            <button onClick={() => setShowIoTLink(null)} style={{ border: 'none', background: 'none', cursor: 'pointer' }}><X size={24} /></button>
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
                                {showIoTLink.curl ? (
                                    <>
                                        <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--spacing-md)' }}>
                                            Dieser API-Endpunkt erzeugt eine offene Bestellung für <strong>{showIoTLink.product.name}</strong>.
                                            Ideal für IoT-Buttons (z.B. AWS IoT Button, flic.io) oder Skripte.
                                        </p>

                                        <div style={{ marginBottom: 'var(--spacing-md)' }}>
                                            <div style={{ fontWeight: 600, marginBottom: '4px' }}>CURL (Linux/Mac)</div>
                                            <div style={{ backgroundColor: '#1e1e1e', color: '#d4d4d4', padding: '12px', borderRadius: '4px', overflowX: 'auto', fontFamily: 'monospace', fontSize: '12px' }}>
                                                {showIoTLink.curl}
                                            </div>
                                        </div>

                                        <div>
                                            <div style={{ fontWeight: 600, marginBottom: '4px' }}>PowerShell (Windows)</div>
                                            <div style={{ backgroundColor: '#012456', color: '#ffffff', padding: '12px', borderRadius: '4px', overflowX: 'auto', fontFamily: 'monospace', fontSize: '12px' }}>
                                                {showIoTLink.powershell}
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
                                <p>Scannt diesen Code, um direkt die Bestellmaske für <strong>{showIoTLink.product.name}</strong> zu öffnen.</p>
                                <div style={{ padding: '20px', background: 'white', border: '1px solid #eee' }}>
                                    <QRCode
                                        value={`${window.location.protocol}//${window.location.host}${window.location.pathname}?action=order&id=${showIoTLink.product.id}`}
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
                                <p>Scannt diesen Code, um den Bestand von <strong>{showIoTLink.product.name}</strong> zu aktualisieren.</p>
                                <div style={{ padding: '20px', background: 'white', border: '1px solid #eee' }}>
                                    <QRCode
                                        value={`${window.location.protocol}//${window.location.host}${window.location.pathname}?action=stock&id=${showIoTLink.product.id}`}
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
            )}

            {/* Stock Update Modal (Scan Action) */}
            {isStockUpdateModalOpen && stockUpdateProduct && (
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
                            Produkt: <strong>{stockUpdateProduct.name}</strong>
                        </p>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)', marginBottom: 'var(--spacing-xl)' }}>
                            <button
                                onClick={() => setStockUpdateValue(prev => Math.max(0, prev - 1))}
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
                                value={stockUpdateValue}
                                onChange={(e) => setStockUpdateValue(parseInt(e.target.value) || 0)}
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
                                onClick={() => setStockUpdateValue(prev => prev + 1)}
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
                                onClick={() => setIsStockUpdateModalOpen(false)}
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
                                onClick={() => {
                                    handleStockUpdate(stockUpdateProduct, stockUpdateValue);
                                    setIsStockUpdateModalOpen(false);
                                    setNotification({ message: 'Bestand aktualisiert!', type: 'success' });
                                }}
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
            )}

            {phoneCallProduct && (
                <PhoneCallPanel
                    mode="order"
                    supplier={suppliers.find(s => s.id === phoneCallProduct.supplierId) ?? null}
                    lowStockProducts={[{
                        product: phoneCallProduct,
                        suggestedQty: orderCart.find(c => c.product.id === phoneCallProduct.id)?.quantity
                            ?? phoneCallProduct.standardOrderQuantity
                            ?? (phoneCallProduct.minStock !== undefined && phoneCallProduct.stock < phoneCallProduct.minStock
                                ? Math.max((phoneCallProduct.minStock * 2) - phoneCallProduct.stock, 1)
                                : 1),
                        openQty: orders.filter(o => o.status === 'open' && o.productName.trim().toLowerCase() === phoneCallProduct.name.trim().toLowerCase()).reduce((sum, o) => sum + o.quantity, 0)
                    }]}
                    onClose={() => setPhoneCallProduct(null)}
                />
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
        </div >
    );
};
