import { generateId } from "../utils";
import React, { useState, useEffect } from 'react';
import type { Product, Order, Supplier } from '../types';
import { StorageService } from '../services/storage';
import { DataService } from '../services/data';
import { Plus, Edit2, Trash2, ShoppingCart, X, Mail, ExternalLink, CheckSquare, Wifi, Settings, Phone, Search, AlertTriangle, Euro, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import emailjs from '@emailjs/browser';
import { Notification, type NotificationType } from '../components/Notification';
import QRCode from "react-qr-code";
import { useSearchParams } from 'react-router-dom';

const CATEGORIES = ['Lebensmittel', 'Getränke', 'Reinigung', 'Büro', 'Sonstiges'];

export const Products: React.FC = () => {
    const [products, setProducts] = useState<Product[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [activeModalTab, setActiveModalTab] = useState<'basic' | 'inventory' | 'order'>('basic');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [newProduct, setNewProduct] = useState<Partial<Product>>({
        category: '',
        unit: '',
        stock: 0,
        minStock: 0,
        price: 0,
        autoOrder: false,
        notes: [],
        preferredOrderMethod: 'email'
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
    const [searchTerm, setSearchTerm] = useState('');
    const [showLowStockOnly, setShowLowStockOnly] = useState(false);



    // Stock Update Modal (Scan Action)
    const [isStockUpdateModalOpen, setIsStockUpdateModalOpen] = useState(false);
    const [stockUpdateProduct, setStockUpdateProduct] = useState<Product | null>(null);
    const [stockUpdateValue, setStockUpdateValue] = useState<number>(0);

    const [sortConfig, setSortConfig] = useState<{ key: 'name' | 'stock' | null, direction: 'asc' | 'desc' }>({ key: null, direction: 'asc' });
    const [searchParams] = useSearchParams();

    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    useEffect(() => {
        // Load data and then check params
        const init = async () => {
            try {
                await loadSuppliers().catch(e => console.error('Error loading suppliers:', e));
                const loadedProducts = await DataService.getProducts();
                
                // Immediately set products so the UI renders
                setProducts(loadedProducts);

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

                // Auto-consumption logic in the background
                const runAutoConsumption = async () => {
                    const settings = StorageService.getSettings();
                    if (settings.inventoryMode) {
                        console.log('Inventur-Modus aktiv: Automatischer Verbrauch pausiert.');
                        return;
                    }
                    const now = new Date();
                    let updatedAny = false;
                    const updatedProducts = [...loadedProducts];

                    for (let i = 0; i < updatedProducts.length; i++) {
                        const p = updatedProducts[i];
                        if (p.consumptionAmount && p.consumptionPeriod) {
                            try {
                                if (!p.lastConsumptionDate) {
                                    p.lastConsumptionDate = now.toISOString();
                                    await DataService.saveProduct(p);
                                    updatedAny = true;
                                } else {
                                    const lastDate = new Date(p.lastConsumptionDate);
                                    if (isNaN(lastDate.getTime())) continue;
                                    
                                    const diffTime = Math.abs(now.getTime() - lastDate.getTime());
                                    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                                    
                                    let periodsPassed = 0;
                                    if (p.consumptionPeriod === 'day') periodsPassed = diffDays;
                                    else if (p.consumptionPeriod === 'week') periodsPassed = Math.floor(diffDays / 7);

                                    if (periodsPassed > 0) {
                                        const toDeduct = periodsPassed * p.consumptionAmount;
                                        p.stock = Math.max(0, p.stock - toDeduct);
                                        
                                        const newLastDate = new Date(lastDate);
                                        if (p.consumptionPeriod === 'day') newLastDate.setDate(newLastDate.getDate() + periodsPassed);
                                        else if (p.consumptionPeriod === 'week') newLastDate.setDate(newLastDate.getDate() + (periodsPassed * 7));
                                        
                                        p.lastConsumptionDate = newLastDate.toISOString();
                                        await DataService.saveProduct(p);
                                        updatedAny = true;
                                    }
                                }
                            } catch (err) {
                                console.error('Failed to auto-consume product', p.id, err);
                            }
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
            await DataService.deleteProduct(deleteConfirmId);
            await loadProducts();
            setIsLoading(false);
            setDeleteConfirmId(null);
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
            targetStock: newProduct.targetStock ? Number(newProduct.targetStock) : undefined,
            ignoreOrderProposals: newProduct.ignoreOrderProposals || false
        };

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

    const handleOrderClick = (product: Product) => {
        const initialCart = [{ product, quantity: 1 }];
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
        setNewProduct({ category: '', unit: '', stock: 0, minStock: 0, targetStock: undefined, ignoreOrderProposals: false, price: 0, autoOrder: false, notes: [], preferredOrderMethod: 'email' });
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
        if (orderCart.length === 0 || !orderCart[0].product.emailOrderAddress) return;

        const mainProduct = orderCart[0].product;
        const encodedSubject = encodeURIComponent(emailSubject);
        const encodedBody = encodeURIComponent(emailBody);

        if (type === 'gmail') {
            window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${mainProduct.emailOrderAddress}&su=${encodedSubject}&body=${encodedBody}`, '_blank');
        } else {
            window.location.href = `mailto:${mainProduct.emailOrderAddress}?subject=${encodedSubject}&body=${encodedBody}`;
        }
    };

    const handleSort = (key: 'name' | 'stock') => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const filteredProducts = products.filter(p => {
        const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesLowStock = showLowStockOnly ? p.stock <= (p.minStock || 0) : true;
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
    });

    const totalValue = products.reduce((sum, p) => sum + (p.stock * (p.price || 0)), 0);
    const lowStockCount = products.filter(p => p.stock <= (p.minStock || 0)).length;

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-md)' }}>
                <h2 style={{ fontSize: 'var(--font-size-2xl)', margin: 0 }}>Produkte</h2>
                <button
                    onClick={() => setIsModalOpen(true)}
                    style={{
                        backgroundColor: 'var(--color-primary)',
                        color: 'white',
                        border: 'none',
                        padding: 'var(--spacing-sm) var(--spacing-md)',
                        borderRadius: 'var(--radius-md)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--spacing-sm)',
                        fontWeight: 500
                    }}
                >
                    <Plus size={20} />
                    Neues Produkt
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
                    style={{ 
                        background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', 
                        padding: 'var(--spacing-lg)', 
                        borderRadius: 'var(--radius-xl)', 
                        border: !showLowStockOnly ? '2px solid var(--color-primary)' : '1px solid var(--color-border)', boxShadow: !showLowStockOnly ? '0 0 0 3px rgba(37,99,235,0.1)' : '0 4px 6px -1px rgb(0 0 0 / 0.05)', cursor: 'pointer',
                        transition: 'transform 0.2s, box-shadow 0.2s',
                    }}
                    onMouseOver={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 10px 15px -3px rgb(0 0 0 / 0.08), 0 4px 6px -4px rgb(0 0 0 / 0.05)'; }}
                    onMouseOut={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 6px -1px rgb(0 0 0 / 0.05), 0 2px 4px -2px rgb(0 0 0 / 0.05)'; }}
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
                    style={{
                        background: lowStockCount > 0 ? 'linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)' : 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
                        padding: 'var(--spacing-lg)',
                        borderRadius: 'var(--radius-xl)',
                        border: showLowStockOnly ? '2px solid #ef4444' : (lowStockCount > 0 ? '1px solid #fca5a5' : '1px solid var(--color-border)'), boxShadow: showLowStockOnly ? '0 0 0 3px rgba(239,68,68,0.2)' : (lowStockCount > 0 ? '0 4px 6px -1px rgb(220 38 38 / 0.1)' : '0 4px 6px -1px rgb(0 0 0 / 0.05)'),
                        cursor: 'pointer',
                        transition: 'transform 0.2s, box-shadow 0.2s',
                    }}
                    onMouseOver={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = lowStockCount > 0 ? '0 10px 15px -3px rgb(220 38 38 / 0.15)' : '0 10px 15px -3px rgb(0 0 0 / 0.08)'; }}
                    onMouseOut={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = lowStockCount > 0 ? '0 4px 6px -1px rgb(220 38 38 / 0.1)' : '0 4px 6px -1px rgb(0 0 0 / 0.05)'; }}
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

                <div style={{ 
                        background: 'linear-gradient(135deg, #ffffff 0%, #f0fdf4 100%)', 
                        padding: 'var(--spacing-lg)', 
                        borderRadius: 'var(--radius-xl)', 
                        border: '1px solid #bbf7d0', 
                        boxShadow: '0 4px 6px -1px rgb(22 101 52 / 0.05), 0 2px 4px -2px rgb(22 101 52 / 0.05)'
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
                            backgroundColor: 'white',
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
                    style={{
                        padding: '0 24px',
                        borderRadius: 'var(--radius-full)',
                        border: showLowStockOnly ? '2px solid #ef4444' : '1px solid var(--color-border)',
                        backgroundColor: showLowStockOnly ? '#fef2f2' : 'white',
                        color: showLowStockOnly ? '#b91c1c' : 'var(--color-text-main)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                        boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
                        transition: 'all 0.2s'
                    }}
                    onMouseOver={e => { if(!showLowStockOnly) Object.assign(e.currentTarget.style, { backgroundColor: '#f8fafc', borderColor: '#cbd5e1' }) }}
                    onMouseOut={e => { if(!showLowStockOnly) Object.assign(e.currentTarget.style, { backgroundColor: 'white', borderColor: 'var(--color-border)' }) }}
                >
                    <AlertTriangle size={18} color={showLowStockOnly ? '#ef4444' : '#64748b'} />
                    {showLowStockOnly ? 'Filter aufheben' : 'Kritischer Bestand'}
                </button>
            </div>

            {
                isMobile ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-lg)' }}>
                        {filteredProducts.map(product => (
                            <div key={product.id} style={{
                                backgroundColor: 'white',
                                borderRadius: 'var(--radius-xl)',
                                padding: 'var(--spacing-lg)',
                                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05), 0 2px 4px -2px rgb(0 0 0 / 0.05)',
                                border: '1px solid var(--color-border)',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 'var(--spacing-md)',
                                position: 'relative',
                                overflow: 'hidden'
                            }}>
                                {/* Mobile Low Stock Indicator */}
                                {product.stock <= (product.minStock || 0) && (
                                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '4px', backgroundColor: '#ef4444' }} />
                                )}
                                
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <div style={{ display: 'flex', gap: 'var(--spacing-md)', alignItems: 'center' }}>
                                        {product.image && (
                                            <div style={{ position: 'relative' }}>
                                                <img src={product.image} alt={product.name} style={{ width: '64px', height: '64px', objectFit: 'cover', borderRadius: 'var(--radius-md)', boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.1)' }} />
                                            </div>
                                        )}
                                        <div>
                                            <div style={{ fontWeight: 700, fontSize: 'var(--font-size-lg)', color: 'var(--color-text-main)', marginBottom: '4px' }}>{product.name}</div>
                                            <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
                                                {product.price ? product.price.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }) : '-'} / {product.unit}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '8px' }}>
                                    <div style={{ backgroundColor: '#f8fafc', padding: '12px', borderRadius: 'var(--radius-md)' }}>
                                        <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '4px', textTransform: 'uppercase', fontWeight: 600 }}>Bestand</div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <div style={{ fontSize: '20px', fontWeight: 800, color: product.stock <= (product.minStock || 0) ? '#dc2626' : 'var(--color-text-main)' }}>
                                                {product.stock}
                                            </div>
                                        </div>
                                    </div>
                                    <div style={{ backgroundColor: '#f8fafc', padding: '12px', borderRadius: 'var(--radius-md)' }}>
                                        <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '4px', textTransform: 'uppercase', fontWeight: 600 }}>Gesamtwert</div>
                                        <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--color-text-main)' }}>
                                            {product.price ? (product.stock * product.price).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }) : '-'}
                                        </div>
                                    </div>
                                </div>

                                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '4px' }}>
                                    <button onClick={() => { setEditingId(product.id); setNewProduct(product); setIsModalOpen(true); }} style={{ flex: '1 1 auto', padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'white', color: 'var(--color-text-main)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontWeight: 500 }}>
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
                    <div style={{
                        backgroundColor: 'white',
                        borderRadius: 'var(--radius-xl)',
                        boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05), 0 2px 4px -2px rgb(0 0 0 / 0.05)',
                        border: '1px solid var(--color-border)',
                        overflow: 'hidden'
                    }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid var(--color-border)' }}>
                                <tr>
                                    <th style={{ padding: '16px', textAlign: 'left', color: '#475569', fontWeight: 600, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em' }}></th>
                                    <th
                                        onClick={() => handleSort('name')}
                                        style={{ padding: '16px', textAlign: 'left', color: '#475569', fontWeight: 600, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer' }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            Name {sortConfig.key === 'name' ? (sortConfig.direction === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />) : <ArrowUpDown size={14} style={{ opacity: 0.3 }} />}
                                        </div>
                                    </th>
                                    <th
                                        onClick={() => handleSort('stock')}
                                        style={{ padding: '16px', textAlign: 'left', color: '#475569', fontWeight: 600, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer' }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            Bestand & Wert {sortConfig.key === 'stock' ? (sortConfig.direction === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />) : <ArrowUpDown size={14} style={{ opacity: 0.3 }} />}
                                        </div>
                                    </th>
                                    <th style={{ padding: '16px', textAlign: 'left', color: '#475569', fontWeight: 600, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Kontakt / Links</th>
                                    <th style={{ padding: '16px', textAlign: 'center', color: '#475569', fontWeight: 600, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Aktion</th>
                                    <th style={{ padding: '16px', textAlign: 'right', color: '#475569', fontWeight: 600, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em' }}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredProducts.map((product, index) => {
                                    const isLastRows = index >= filteredProducts.length - 2 && filteredProducts.length > 3;
                                    return (
                                        <tr key={product.id} style={{ borderBottom: '1px solid var(--color-border)', transition: 'background-color 0.2s' }} onMouseOver={e => e.currentTarget.style.backgroundColor = '#f8fafc'} onMouseOut={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                                            <td style={{ padding: '16px' }}>
                                                {product.image ? (
                                                    <img
                                                        src={product.image}
                                                        alt={product.name}
                                                        style={{ width: '48px', height: '48px', objectFit: 'cover', borderRadius: 'var(--radius-md)', boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)', border: '1px solid var(--color-border)' }}
                                                    />
                                                ) : (
                                                    <div style={{ width: '48px', height: '48px', backgroundColor: '#f1f5f9', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>
                                                        <ShoppingCart size={20} />
                                                    </div>
                                                )}
                                            </td>
                                            <td style={{ padding: '16px', minWidth: '220px' }}>
                                                <div style={{ fontWeight: 700, fontSize: '16px', color: 'var(--color-text-main)', marginBottom: '2px' }}>{product.name}</div>
                                                <div style={{ color: '#64748b', fontSize: '13px', fontWeight: 500 }}>
                                                    {product.price ? product.price.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }) : '-'} / {product.unit}
                                                </div>
                                                
                                                {(() => {
                                                    const supplier = suppliers.find(s => s.id === product.supplierId);
                                                    if (supplier?.notes) {
                                                        return (supplier.notes.filter(n => n.showOnOpenOrders) || []).map(n => (
                                                            <div key={n.id} style={{ backgroundColor: '#fef3c7', color: '#92400e', padding: '4px 8px', borderRadius: '4px', marginTop: '6px', fontSize: '11px', display: 'inline-block', marginRight: '4px' }}>
                                                                <strong>Lieferant:</strong> {n.text}
                                                            </div>
                                                        ));
                                                    }
                                                    return null;
                                                })()}
                                                {(product.notes || []).filter(n => n.showOnOpenOrders).map(n => (
                                                    <div key={n.id} style={{ backgroundColor: '#fef3c7', color: '#92400e', padding: '4px 8px', borderRadius: '4px', marginTop: '6px', fontSize: '11px', display: 'inline-block', marginRight: '4px' }}>
                                                        <strong>Notiz:</strong> {n.text}
                                                    </div>
                                                ))}
                                            </td>
                                            <td style={{ padding: '16px' }}>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                    <div style={{
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        backgroundColor: 'white',
                                                        border: '1px solid var(--color-border)',
                                                        borderRadius: 'var(--radius-full)',
                                                        overflow: 'hidden',
                                                        boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
                                                        width: 'fit-content'
                                                    }}>
                                                        <button
                                                            onClick={() => handleStockUpdate(product, Math.max(0, product.stock - 1))}
                                                            style={{ padding: '6px 12px', border: 'none', background: '#f8fafc', cursor: 'pointer', fontWeight: 700, fontSize: '16px', color: '#64748b', transition: 'background 0.2s', borderRight: '1px solid var(--color-border)' }}
                                                            onMouseOver={e => e.currentTarget.style.backgroundColor = '#e2e8f0'}
                                                            onMouseOut={e => e.currentTarget.style.backgroundColor = '#f8fafc'}
                                                        >−</button>
                                                        <input
                                                            type="number"
                                                            value={product.stock}
                                                            min={0}
                                                            onChange={e => handleStockUpdate(product, Math.max(0, parseInt(e.target.value) || 0))}
                                                            style={{
                                                                width: '50px',
                                                                textAlign: 'center',
                                                                fontSize: '15px',
                                                                fontWeight: 800,
                                                                border: 'none',
                                                                padding: '6px 4px',
                                                                color: product.stock <= (product.minStock || 0) ? '#dc2626' : 'var(--color-text-main)',
                                                                background: 'transparent',
                                                                outline: 'none',
                                                                MozAppearance: 'textfield'
                                                            }}
                                                        />
                                                        <button
                                                            onClick={() => handleStockUpdate(product, product.stock + 1)}
                                                            style={{ padding: '6px 12px', border: 'none', background: '#f8fafc', cursor: 'pointer', fontWeight: 700, fontSize: '16px', color: 'var(--color-primary)', transition: 'background 0.2s', borderLeft: '1px solid var(--color-border)' }}
                                                            onMouseOver={e => e.currentTarget.style.backgroundColor = '#e2e8f0'}
                                                            onMouseOut={e => e.currentTarget.style.backgroundColor = '#f8fafc'}
                                                        >+</button>
                                                    </div>
                                                    {product.price && (
                                                        <div style={{ fontSize: '13px', color: '#64748b', fontWeight: 500, paddingLeft: '4px' }}>
                                                            ∑ {(product.stock * product.price).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                            <td style={{ padding: '16px' }}>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                    {product.orderUrl && (
                                                        <a href={product.orderUrl} target="_blank" rel="noopener noreferrer"
                                                            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--color-primary)', textDecoration: 'none', fontSize: '13px', fontWeight: 500, padding: '4px 8px', backgroundColor: '#eff6ff', borderRadius: '6px', width: 'fit-content' }}>
                                                            <ExternalLink size={14} /> Webshop
                                                        </a>
                                                    )}
                                                    {product.emailOrderAddress && (
                                                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#475569', fontSize: '13px', padding: '4px 8px', backgroundColor: '#f1f5f9', borderRadius: '6px', width: 'fit-content' }}>
                                                            <Mail size={14} /> {product.emailOrderAddress}
                                                        </div>
                                                    )}
                                                    {product.supplierPhone && (
                                                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#475569', fontSize: '13px', padding: '4px 8px', backgroundColor: '#f1f5f9', borderRadius: '6px', width: 'fit-content' }}>
                                                            <Phone size={14} /> {product.supplierPhone}
                                                        </div>
                                                    )}
                                                    {!product.orderUrl && !product.emailOrderAddress && !product.supplierPhone && (
                                                         <div style={{ color: '#94a3b8', fontSize: '13px', fontStyle: 'italic' }}>Keine Info</div>
                                                    )}
                                                </div>
                                            </td>
                                            <td style={{ padding: '16px', textAlign: 'center' }}>
                                                <button
                                                    onClick={() => handleOrderClick(product)}
                                                    style={{
                                                        backgroundColor: 'var(--color-primary)',
                                                        color: 'white',
                                                        border: 'none',
                                                        padding: '10px 18px',
                                                        borderRadius: 'var(--radius-full)',
                                                        cursor: 'pointer',
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: '8px',
                                                        fontWeight: 600,
                                                        boxShadow: '0 4px 6px -1px rgba(37, 99, 235, 0.2), 0 2px 4px -2px rgba(37, 99, 235, 0.2)',
                                                        transition: 'transform 0.1s, box-shadow 0.1s'
                                                    }}
                                                    onMouseOver={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 6px 8px -1px rgba(37, 99, 235, 0.3)'; }}
                                                    onMouseOut={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 6px -1px rgba(37, 99, 235, 0.2)'; }}
                                                >
                                                    <ShoppingCart size={16} />
                                                    Bestellen
                                                </button>
                                            </td>
                                            <td style={{ padding: '16px', textAlign: 'right', position: 'relative' }}>
                                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                                                    <button
                                                        onClick={() => { setEditingId(product.id); setNewProduct(product); setIsModalOpen(true); }}
                                                        style={{ background: 'none', border: '1px solid var(--color-border)', backgroundColor: 'white', color: '#475569', padding: '8px', borderRadius: 'var(--radius-md)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s', boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)' }}
                                                    >
                                                        <Edit2 size={16} />
                                                    </button>
                                                    <button
                                                        onClick={() => setOpenSettingsId(openSettingsId === product.id ? null : product.id)}
                                                        style={{ background: 'none', border: '1px solid var(--color-border)', backgroundColor: 'white', color: '#475569', padding: '8px', borderRadius: 'var(--radius-md)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.2s', boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)' }}
                                                    >
                                                        <Settings size={16} />
                                                    </button>
                                                </div>

                                                {openSettingsId === product.id && (
                                                    <>
                                                        <div
                                                            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10 }}
                                                            onClick={() => setOpenSettingsId(null)}
                                                        />
                                                        <div style={{
                                                            position: 'absolute',
                                                            right: '16px',
                                                            ...(isLastRows
                                                                ? { bottom: '100%', marginBottom: '8px' }
                                                                : { top: '100%', marginTop: '8px' }
                                                            ),
                                                            backgroundColor: 'white',
                                                            borderRadius: 'var(--radius-lg)',
                                                            boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
                                                            border: '1px solid var(--color-border)',
                                                            zIndex: 20,
                                                            minWidth: '180px',
                                                            overflow: 'hidden',
                                                            display: 'flex',
                                                            flexDirection: 'column'
                                                        }}>
                                                            <button
                                                                onClick={() => {
                                                                    const links = getIoTLink(product);
                                                                    if (links) { setShowIoTLink(links); setOpenSettingsId(null); }
                                                                }}
                                                                style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '12px 16px', border: 'none', borderBottom: '1px solid var(--color-border)', backgroundColor: 'transparent', textAlign: 'left', cursor: 'pointer', color: 'var(--color-text-main)', fontSize: '14px', fontWeight: 500 }}
                                                                onMouseOver={e => e.currentTarget.style.backgroundColor = '#f8fafc'}
                                                                onMouseOut={e => e.currentTarget.style.backgroundColor = 'transparent'}
                                                            >
                                                                <Wifi size={16} /> IoT Setup / QR
                                                            </button>
                                                            <button
                                                                onClick={() => handleDeleteClick(product.id)}
                                                                style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '12px 16px', border: 'none', backgroundColor: 'transparent', textAlign: 'left', cursor: 'pointer', color: '#ef4444', fontSize: '14px', fontWeight: 500 }}
                                                                onMouseOver={e => e.currentTarget.style.backgroundColor = '#fef2f2'}
                                                                onMouseOut={e => e.currentTarget.style.backgroundColor = 'transparent'}
                                                            >
                                                                <Trash2 size={16} /> Produkt löschen
                                                            </button>
                                                        </div>
                                                    </>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table >
                    </div>
                )
            }

            {
                isModalOpen && (
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
                        zIndex: 1000,
                        padding: 'var(--spacing-md)'
                    }}>
                        <div style={{
                            backgroundColor: 'var(--color-surface)',
                            borderRadius: 'var(--radius-lg)',
                            width: '100%',
                            maxWidth: '650px',
                            maxHeight: '90vh',
                            display: 'flex',
                            flexDirection: 'column',
                            boxShadow: 'var(--shadow-lg)'
                        }}>
                            {/* Modal Header */}
                            <div style={{ padding: 'var(--spacing-lg)', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <h2 style={{ margin: 0, fontSize: 'var(--font-size-xl)' }}>{editingId ? '✏️ Produkt bearbeiten' : '✨ Neues Produkt anlegen'}</h2>
                                <button onClick={closeModal} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
                                    <X size={24} color="var(--color-text-muted)" />
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
                            <div style={{ padding: 'var(--spacing-lg)', overflowY: 'auto', flex: 1, backgroundColor: 'var(--color-background)' }}>
                                <form id="product-form" onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                                    
                                    {/* TAB: BASIC */}
                                    {activeModalTab === 'basic' && (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 'var(--spacing-md)' }}>
                                                <div>
                                                    <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>Name *</label>
                                                    <input
                                                        required
                                                        value={newProduct.name || ''}
                                                        onChange={e => setNewProduct({ ...newProduct, name: e.target.value })}
                                                        style={{ width: '100%', padding: '10px', borderRadius: 'var(--radius-md)', border: !newProduct.name ? '1px solid var(--color-danger)' : '1px solid var(--color-border)' }}
                                                    />
                                                </div>
                                            </div>

                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                                                <div>
                                                    <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>Kategorie</label>
                                                    {isCustomCategoryMode ? (
                                                        <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
                                                            <input
                                                                value={newProduct.category || ''}
                                                                onChange={e => setNewProduct({ ...newProduct, category: e.target.value })}
                                                                placeholder="Eigene..."
                                                                autoFocus
                                                                style={{ width: '100%', padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}
                                                            />
                                                            <button type="button" onClick={() => { setIsCustomCategoryMode(false); setNewProduct({ ...newProduct, category: '' }); }} style={{ background: 'white', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', padding: '0 10px' }}><X size={18} /></button>
                                                        </div>
                                                    ) : (
                                                        <select
                                                            value={newProduct.category || ''}
                                                            onChange={e => {
                                                                if (e.target.value === 'custom') { setIsCustomCategoryMode(true); setNewProduct({ ...newProduct, category: '' }); } 
                                                                else { setNewProduct({ ...newProduct, category: e.target.value }); }
                                                            }}
                                                            style={{ width: '100%', padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', backgroundColor: 'white' }}
                                                        >
                                                            <option value="">-- Leer --</option>
                                                            {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                                                            <option value="custom">Eigene eingeben...</option>
                                                        </select>
                                                    )}
                                                </div>
                                                <div>
                                                    <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>Produktnummer</label>
                                                    <input
                                                        value={newProduct.productNumber || ''}
                                                        onChange={e => setNewProduct({ ...newProduct, productNumber: e.target.value })}
                                                        placeholder="z.B. 12345-AB"
                                                        style={{ width: '100%', padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}
                                                    />
                                                </div>
                                            </div>

                                            <div>
                                                <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>Bild URL (optional)</label>
                                                <input
                                                    type="url"
                                                    value={newProduct.image || ''}
                                                    onChange={e => setNewProduct({ ...newProduct, image: e.target.value })}
                                                    onBlur={e => { const val = e.target.value; if (val && !/^https?:\/\//i.test(val)) setNewProduct({ ...newProduct, image: 'https://' + val }); }}
                                                    style={{ width: '100%', padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}
                                                />
                                            </div>

                                            <div>
                                                <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>Produkt-Notizen</label>
                                                {(newProduct.notes || []).map((note, idx) => (
                                                    <div key={note.id} style={{ marginBottom: 'var(--spacing-md)', padding: 'var(--spacing-md)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', backgroundColor: 'white' }}>
                                                        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                                                            <textarea
                                                                rows={2}
                                                                value={note.text}
                                                                onChange={e => { const updated = [...(newProduct.notes || [])]; updated[idx].text = e.target.value; setNewProduct({ ...newProduct, notes: updated }); }}
                                                                placeholder="Notiz eingeben..."
                                                                style={{ width: '100%', padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontFamily: 'inherit' }}
                                                            />
                                                            <button type="button" onClick={() => { const updated = (newProduct.notes || []).filter((_, i) => i !== idx); setNewProduct({ ...newProduct, notes: updated }); }} style={{ background: 'none', border: 'none', color: 'var(--color-danger)', cursor: 'pointer' }}><X size={18} /></button>
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
                                                <button type="button" onClick={() => { const updated = [...(newProduct.notes || []), { id: generateId(), text: '', showOnOrderCreation: false, showOnOpenOrders: false }]; setNewProduct({ ...newProduct, notes: updated }); }} style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: 'none', color: 'var(--color-primary)', fontWeight: 600, cursor: 'pointer', padding: 0 }}>
                                                    <Plus size={16} /> Weitere Notiz hinzufügen
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {/* TAB: INVENTORY */}
                                    {activeModalTab === 'inventory' && (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--spacing-md)' }}>
                                                <div>
                                                    <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>Bestand</label>
                                                    <input type="number" value={newProduct.stock || 0} onChange={e => setNewProduct({ ...newProduct, stock: Number(e.target.value) })} style={{ width: '100%', padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }} />
                                                </div>
                                                <div>
                                                    <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>Einheit</label>
                                                    <input value={newProduct.unit || ''} onChange={e => setNewProduct({ ...newProduct, unit: e.target.value })} placeholder="Stück, Liter..." style={{ width: '100%', padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }} />
                                                </div>
                                                <div>
                                                    <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>Preis (Netto €)</label>
                                                    <input type="number" step="0.01" value={newProduct.price || ''} onChange={e => setNewProduct({ ...newProduct, price: parseFloat(e.target.value) || 0 })} placeholder="0.00" style={{ width: '100%', padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }} />
                                                </div>
                                            </div>

                                            <div style={{ padding: 'var(--spacing-md)', backgroundColor: 'white', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
                                                <h4 style={{ margin: '0 0 var(--spacing-sm) 0', color: 'var(--color-primary)' }}>Bestell-Logistik (Autopilot)</h4>
                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)', marginBottom: 'var(--spacing-md)' }}>
                                                    <div>
                                                        <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>Meldebestand (Untergrenze)</label>
                                                        <input type="number" value={newProduct.minStock || 0} onChange={e => setNewProduct({ ...newProduct, minStock: Number(e.target.value) })} style={{ width: '100%', padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }} />
                                                        <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Ab hier schlägt der Autopilot an.</span>
                                                    </div>
                                                    <div>
                                                        <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>Soll-Bestand (Auffüllen bis)</label>
                                                        <input type="number" value={newProduct.targetStock || ''} onChange={e => setNewProduct({ ...newProduct, targetStock: e.target.value ? Number(e.target.value) : undefined })} placeholder="Optional" style={{ width: '100%', padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }} />
                                                    </div>
                                                </div>
                                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: 'var(--font-size-sm)' }}>
                                                    <input type="checkbox" checked={newProduct.ignoreOrderProposals || false} onChange={e => setNewProduct({ ...newProduct, ignoreOrderProposals: e.target.checked })} style={{ width: '18px', height: '18px' }} />
                                                    <span>📉 <strong>Artikel komplett vom Bestell-Autopiloten ausschließen</strong> (keine Vorschläge generieren).</span>
                                                </label>
                                            </div>

                                            <div>
                                                <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>Automatischer System-Verbrauch</label>
                                                <div style={{ display: 'flex', gap: '8px' }}>
                                                    <input type="number" step="0.01" min="0" value={newProduct.consumptionAmount || ''} onChange={e => setNewProduct({ ...newProduct, consumptionAmount: parseFloat(e.target.value) || undefined })} placeholder="Menge abziehen..." style={{ width: '50%', padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }} />
                                                    <select value={newProduct.consumptionPeriod || ''} onChange={e => setNewProduct({ ...newProduct, consumptionPeriod: e.target.value as 'day' | 'week' | undefined })} style={{ width: '50%', padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', backgroundColor: 'white' }}>
                                                        <option value="">-- Zyklus --</option>
                                                        <option value="day">pro Tag</option>
                                                        <option value="week">pro Woche</option>
                                                    </select>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* TAB: ORDER */}
                                    {activeModalTab === 'order' && (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                                            
                                            {/* Supplier Selection or Creation */}
                                            <div style={{ padding: 'var(--spacing-md)', backgroundColor: isCreatingSupplier ? '#f0f9ff' : 'white', borderRadius: 'var(--radius-lg)', border: isCreatingSupplier ? '1px solid var(--color-primary)' : '1px solid var(--color-border)', transition: 'all 0.3s' }}>
                                                <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-sm)', fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>
                                                    Lieferant
                                                </label>

                                                {!isCreatingSupplier ? (
                                                    <div style={{ display: 'flex', gap: '8px' }}>
                                                        <select
                                                            value={newProduct.supplierId || ''}
                                                            onChange={e => {
                                                                const sId = e.target.value; const s = suppliers.find(su => su.id === sId);
                                                                setNewProduct({ ...newProduct, supplierId: sId || undefined, emailOrderAddress: s?.email || '', supplierPhone: s?.phone || '' });
                                                            }}
                                                            style={{ flex: 1, padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', backgroundColor: 'white', fontWeight: 500 }}
                                                        >
                                                            <option value="">-- Keiner --</option>
                                                            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                                        </select>
                                                        <button type="button" onClick={() => { setIsCreatingSupplier(true); setNewSupplier({ name: '', email: '', phone: '' }); }} style={{ padding: '0 16px', borderRadius: 'var(--radius-md)', border: 'none', backgroundColor: 'var(--color-primary)', color: 'white', cursor: 'pointer', fontWeight: 600 }}>Neu</button>
                                                    </div>
                                                ) : (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-sm)' }}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                            <span style={{ fontWeight: 600, color: 'var(--color-primary)', fontSize: '14px' }}>✨ Neuen Lieferanten anlegen</span>
                                                            <button type="button" onClick={() => setIsCreatingSupplier(false)} style={{ border: 'none', background: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>Abbrechen</button>
                                                        </div>
                                                        <input type="text" placeholder="Firmenname *" value={newSupplier.name} onChange={e => setNewSupplier({ ...newSupplier, name: e.target.value })} style={{ width: '100%', padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }} />
                                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-sm)' }}>
                                                            <input type="email" placeholder="Bestell-Email" value={newSupplier.email} onChange={e => setNewSupplier({ ...newSupplier, email: e.target.value })} style={{ width: '100%', padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }} />
                                                            <input type="tel" placeholder="Telefon (opt.)" value={newSupplier.phone} onChange={e => setNewSupplier({ ...newSupplier, phone: e.target.value })} style={{ width: '100%', padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }} />
                                                        </div>
                                                        <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', margin: '4px 0 0 0' }}>Der Lieferant wird bim Speichern dieses Produktes dauerhaft im System gespeichert.</p>
                                                    </div>
                                                )}
                                            </div>

                                            <div>
                                                <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>Präferierter Bestellweg (bei Klick auf Bestellen)</label>
                                                <div style={{ display: 'flex', gap: 'var(--spacing-md)', backgroundColor: 'white', padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                                                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}><input type="radio" name="pom" value="email" checked={newProduct.preferredOrderMethod === 'email'} onChange={() => setNewProduct({ ...newProduct, preferredOrderMethod: 'email' })} /> <Mail size={16}/> Email</label>
                                                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}><input type="radio" name="pom" value="link" checked={newProduct.preferredOrderMethod === 'link'} onChange={() => setNewProduct({ ...newProduct, preferredOrderMethod: 'link' })} /> <ExternalLink size={16}/> Webshop (Link)</label>
                                                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}><input type="radio" name="pom" value="phone" checked={newProduct.preferredOrderMethod === 'phone'} onChange={() => setNewProduct({ ...newProduct, preferredOrderMethod: 'phone' })} /> <Phone size={16}/> Telefon</label>
                                                </div>
                                            </div>

                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 'var(--spacing-md)' }}>
                                                <div>
                                                    <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>Webshop / Bestell-URL</label>
                                                    <input type="url" value={newProduct.orderUrl || ''} onChange={e => setNewProduct({ ...newProduct, orderUrl: e.target.value })} onBlur={e => { const val = e.target.value; if (val && !/^https?:\/\//i.test(val)) setNewProduct({ ...newProduct, orderUrl: 'https://' + val }); }} placeholder="https://..." style={{ width: '100%', padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }} />
                                                </div>
                                                <div>
                                                    <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>Abweichende E-Mail-Adresse (Nur für dieses Produkt)</label>
                                                    <input type="email" placeholder="Wenn leer, wird die Lieferanten-Email verwendet" value={newProduct.emailOrderAddress || ''} onChange={e => setNewProduct({ ...newProduct, emailOrderAddress: e.target.value })} style={{ width: '100%', padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }} />
                                                </div>
                                            </div>

                                            <div style={{ padding: 'var(--spacing-md)', backgroundColor: 'white', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
                                                <h4 style={{ margin: '0 0 var(--spacing-sm) 0', color: 'var(--color-primary)' }}>E-Mail Layout & Automatisierung</h4>
                                                
                                                <div style={{ marginBottom: 'var(--spacing-sm)' }}>
                                                    <label style={{ display: 'block', marginBottom: '4px', fontSize: 'var(--font-size-xs)' }}>Standard Betreff</label>
                                                    <input type="text" value={newProduct.emailOrderSubject || ''} onChange={e => setNewProduct({ ...newProduct, emailOrderSubject: e.target.value })} style={{ width: '100%', padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }} />
                                                </div>
                                                <div style={{ marginBottom: 'var(--spacing-sm)' }}>
                                                    <label style={{ display: 'block', marginBottom: '4px', fontSize: 'var(--font-size-xs)' }}>Standard Nachrichtentext</label>
                                                    <textarea value={newProduct.emailOrderBody || ''} onChange={e => setNewProduct({ ...newProduct, emailOrderBody: e.target.value })} rows={3} style={{ width: '100%', padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontFamily: 'inherit' }} />
                                                </div>

                                                <div style={{ marginTop: 'var(--spacing-md)', padding: '12px', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 'var(--radius-md)' }}>
                                                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 600, color: '#166534' }}>
                                                        <input type="checkbox" checked={newProduct.autoOrder || false} onChange={e => setNewProduct({ ...newProduct, autoOrder: e.target.checked })} style={{ width: '18px', height: '18px' }} />
                                                        Auto-Order (Vollautomatischer Versand via EmailJS) aktivieren
                                                    </label>
                                                </div>
                                            </div>

                                        </div>
                                    )}
                                </form>
                            </div>

                            {/* Modal Footer (Sticky) */}
                            <div style={{ padding: 'var(--spacing-lg)', borderTop: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', display: 'flex', justifyContent: 'flex-end', gap: 'var(--spacing-md)', borderBottomLeftRadius: 'var(--radius-lg)', borderBottomRightRadius: 'var(--radius-lg)' }}>
                                <button type="button" onClick={closeModal} style={{ padding: '10px 20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', backgroundColor: 'transparent', color: 'var(--color-text-main)', cursor: 'pointer', fontWeight: 500 }}>
                                    Abbrechen
                                </button>
                                <button form="product-form" type="submit" disabled={isLoading} style={{ padding: '10px 20px', borderRadius: 'var(--radius-md)', border: 'none', backgroundColor: 'var(--color-primary)', color: 'white', cursor: 'pointer', fontWeight: 600, opacity: isLoading ? 0.7 : 1 }}>
                                    {isLoading ? 'Speichert...' : '💾 ' + (editingId ? 'Änderungen speichern' : 'Produkt anlegen')}
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            { deleteConfirmId && (
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
                            boxShadow: 'var(--shadow-lg)',
                            textAlign: 'center'
                        }}>
                            <h3 style={{ marginTop: 0 }}>Produkt löschen?</h3>
                            <p style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--spacing-lg)' }}>
                                Möchten Sie dieses Produkt wirklich unwiderruflich löschen?
                            </p>
                            <div style={{ display: 'flex', justifyContent: 'center', gap: 'var(--spacing-md)' }}>
                                <button
                                    onClick={() => setDeleteConfirmId(null)}
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
                                    onClick={confirmDelete}
                                    disabled={isLoading}
                                    style={{
                                        padding: 'var(--spacing-sm) var(--spacing-md)',
                                        borderRadius: 'var(--radius-md)',
                                        border: 'none',
                                        backgroundColor: 'var(--color-danger)',
                                        color: 'white',
                                        cursor: 'pointer',
                                        opacity: isLoading ? 0.7 : 1
                                    }}
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
                                    {selectedProductForOrder.orderUrl && (
                                        <div style={{
                                            backgroundColor: selectedProductForOrder.preferredOrderMethod === 'link' ? 'rgba(37, 99, 235, 0.05)' : 'var(--color-background)',
                                            padding: 'var(--spacing-md)',
                                            borderRadius: 'var(--radius-md)',
                                            border: selectedProductForOrder.preferredOrderMethod === 'link' ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                                            order: selectedProductForOrder.preferredOrderMethod === 'link' ? -1 : 0
                                        }}>
                                            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--spacing-sm)', fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>
                                                Bestelllink:
                                                {selectedProductForOrder.preferredOrderMethod === 'link' && (
                                                    <span style={{ fontSize: '10px', backgroundColor: 'var(--color-primary)', color: 'white', padding: '2px 6px', borderRadius: '10px' }}>STANDARD</span>
                                                )}
                                            </label>
                                            <a
                                                href={selectedProductForOrder.orderUrl}
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
                                                    backgroundColor: selectedProductForOrder.preferredOrderMethod === 'link' ? 'var(--color-primary)' : 'var(--color-surface)',
                                                    color: selectedProductForOrder.preferredOrderMethod === 'link' ? 'white' : 'var(--color-text-main)',
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

                                    {(selectedProductForOrder.supplierPhone || (suppliers.find(s => s.id === selectedProductForOrder.supplierId)?.phone)) && (
                                        <div style={{
                                            backgroundColor: selectedProductForOrder.preferredOrderMethod === 'phone' ? 'rgba(37, 99, 235, 0.05)' : 'var(--color-background)',
                                            padding: 'var(--spacing-md)',
                                            borderRadius: 'var(--radius-md)',
                                            border: selectedProductForOrder.preferredOrderMethod === 'phone' ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                                            order: selectedProductForOrder.preferredOrderMethod === 'phone' ? -1 : 0
                                        }}>
                                            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--spacing-sm)', fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>
                                                Telefonische Bestellung:
                                                {selectedProductForOrder.preferredOrderMethod === 'phone' && (
                                                    <span style={{ fontSize: '10px', backgroundColor: 'var(--color-primary)', color: 'white', padding: '2px 6px', borderRadius: '10px' }}>STANDARD</span>
                                                )}
                                            </label>
                                            <a
                                                href={`tel:${selectedProductForOrder.supplierPhone || suppliers.find(s => s.id === selectedProductForOrder.supplierId)?.phone}`}
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
                                                {selectedProductForOrder.supplierPhone || suppliers.find(s => s.id === selectedProductForOrder.supplierId)?.phone}
                                                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>(Anrufen)</span>
                                            </a>
                                        </div>
                                    )}

                                    {selectedProductForOrder.emailOrderAddress && !selectedProductForOrder.autoOrder && (
                                        <>
                                            {selectedProductForOrder.preferredOrderMethod !== 'email' && !isOrderEmailExpanded ? (
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
                                                    backgroundColor: selectedProductForOrder.preferredOrderMethod === 'email' ? 'rgba(37, 99, 235, 0.05)' : 'var(--color-background)',
                                                    padding: 'var(--spacing-md)',
                                                    borderRadius: 'var(--radius-md)',
                                                    border: selectedProductForOrder.preferredOrderMethod === 'email' ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                                                    order: selectedProductForOrder.preferredOrderMethod === 'email' ? -1 : 0
                                                }}>
                                                    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--spacing-sm)', fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>
                                                        Email Vorschau & Bearbeitung:
                                                        {selectedProductForOrder.preferredOrderMethod === 'email' && (
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
                                    backgroundColor: 'white',
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
