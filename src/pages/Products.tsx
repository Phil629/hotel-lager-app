import React, { useState, useEffect } from 'react';
import type { Product, Order, Supplier } from '../types';
import { StorageService } from '../services/storage';
import { DataService } from '../services/data';
import { Plus, Edit2, Trash2, ShoppingCart, X, Mail, ExternalLink, CheckSquare, Square, Wifi, Settings, Phone, MessageSquare, Search, AlertTriangle, Euro } from 'lucide-react';
import emailjs from '@emailjs/browser';
import { Notification, type NotificationType } from '../components/Notification';

const CATEGORIES = ['Lebensmittel', 'Getränke', 'Reinigung', 'Büro', 'Sonstiges'];

export const Products: React.FC = () => {
    const [products, setProducts] = useState<Product[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [newProduct, setNewProduct] = useState<Partial<Product>>({
        category: '',
        unit: '',
        stock: 0,
        minStock: 0,
        minStock: 0,
        price: 0,
        autoOrder: false,
        notes: '',
        preferredOrderMethod: 'email'
    });
    // isEmailSectionOpen removed as requested
    const [showIoTLink, setShowIoTLink] = useState<{ curl: string, powershell: string } | null>(null);
    const [isCustomCategoryMode, setIsCustomCategoryMode] = useState(false);
    const [isInventoryDetailsOpen, setIsInventoryDetailsOpen] = useState(false);
    const [isEmailTemplateOpen, setIsEmailTemplateOpen] = useState(false);

    const [isOrderModalOpen, setIsOrderModalOpen] = useState(false);
    const [selectedProductForOrder, setSelectedProductForOrder] = useState<Product | null>(null);
    const [orderQuantity, setOrderQuantity] = useState(1);
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

    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    useEffect(() => {
        loadProducts();
        loadSuppliers();
    }, []);

    const loadProducts = async () => {
        const data = await DataService.getProducts();
        setProducts(data);
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

    const handleEdit = (product: Product) => {
        setNewProduct(product);
        setEditingId(product.id);
        // setIsEmailSectionOpen(!!product.emailOrderAddress); // Removed
        setIsCustomCategoryMode(!CATEGORIES.includes(product.category || ''));
        setIsModalOpen(true);
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newProduct.name) return;

        const productData: Product = {
            id: editingId || crypto.randomUUID(),
            name: newProduct.name,
            category: newProduct.category,
            stock: Number(newProduct.stock) || 0,
            minStock: Number(newProduct.minStock) || 0,
            price: Number(newProduct.price) || 0,
            unit: newProduct.unit || 'Stück',
            orderUrl: newProduct.orderUrl,
            image: newProduct.image,
            supplierId: newProduct.supplierId,
            emailOrderAddress: newProduct.emailOrderAddress,
            emailOrderSubject: newProduct.emailOrderSubject,
            emailOrderBody: newProduct.emailOrderBody,
            autoOrder: newProduct.autoOrder,
            supplierPhone: newProduct.supplierPhone,
            notes: newProduct.notes,
            preferredOrderMethod: newProduct.preferredOrderMethod
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

    const handleOrderClick = (product: Product) => {
        setSelectedProductForOrder(product);
        setOrderQuantity(1);
        setOrderDate(new Date().toISOString().split('T')[0]);
        setOrderNotes('');

        // Pre-fill email template
        const supplier = suppliers.find(s => s.id === product.supplierId);
        let subject = '';
        let body = '';

        if (supplier) {
            subject = supplier.emailSubjectTemplate || `Bestellung: ${product.name}`;
            body = supplier.emailBodyTemplate || `Sehr geehrte Damen und Herren,\n\nbitte liefern Sie {quantity}x {product_name} ({unit}).\n\nMit freundlichen Grüßen\nHotel Rezeption`;
        } else {
            subject = product.emailOrderSubject || `Bestellung: ${product.name}`;
            body = product.emailOrderBody || `Guten Tag,\n\nbitte liefern Sie folgende Ware:\n\nProdukt: {product_name}\nMenge: {quantity} {unit}\n\nMit freundlichen Grüßen`;
        }

        // Initial replacement for display (quantity is 1 initially)
        subject = subject.replace(/{product_name}/g, product.name)
            .replace(/{quantity}/g, '1')
            .replace(/{unit}/g, product.unit);

        body = body.replace(/{product_name}/g, product.name)
            .replace(/{quantity}/g, '1')
            .replace(/{unit}/g, product.unit);

        setEmailSubject(subject);
        setEmailBody(body);
        setIsOrderModalOpen(true);
    };

    const handleCreateOrder = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedProductForOrder) return;

        setIsLoading(true);
        try {
            // Check for automated order
            if (selectedProductForOrder.autoOrder && selectedProductForOrder.emailOrderAddress) {
                const settings = StorageService.getSettings();

                if (!settings.serviceId || !settings.templateId || !settings.publicKey) {
                    setNotification({ message: 'Fehler: EmailJS ist nicht konfiguriert. Bitte prüfen Sie die Einstellungen.', type: 'error' });
                    return;
                }

                const templateParams = {
                    to_email: selectedProductForOrder.emailOrderAddress,
                    subject: emailSubject,
                    message: emailBody,
                    product_name: selectedProductForOrder.name,
                    quantity: orderQuantity,
                    unit: selectedProductForOrder.unit
                };

                await emailjs.send(
                    settings.serviceId,
                    settings.templateId,
                    templateParams,
                    settings.publicKey
                );

                setNotification({ message: 'Bestellung wurde automatisch per E-Mail versendet!', type: 'success' });
            }

            const newOrder: Order = {
                id: crypto.randomUUID(),
                date: new Date(orderDate).toISOString(),
                productName: selectedProductForOrder.name,
                quantity: orderQuantity,
                status: 'open',
                productImage: selectedProductForOrder.image,
                supplierEmail: selectedProductForOrder.emailOrderAddress,
                supplierPhone: selectedProductForOrder.supplierPhone,
                notes: orderNotes
            };

            await DataService.saveOrder(newOrder);
            setIsOrderModalOpen(false);
            setSelectedProductForOrder(null);
            if (!selectedProductForOrder.autoOrder) {
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
        setNewProduct({ category: '', unit: '', stock: 0, minStock: 0, price: 0, autoOrder: false, notes: '', preferredOrderMethod: 'email' });
        setEditingId(null);
        // setIsEmailSectionOpen(false); // Removed
        setIsCustomCategoryMode(false);
        setIsInventoryDetailsOpen(false);
        setIsEmailTemplateOpen(false);
    };

    const getIoTLink = (product: Product) => {
        const settings = StorageService.getSettings();
        if (!settings.supabaseUrl || !settings.supabaseKey) return null;

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
        // 1. Uses -ContentType parameter explicitly
        // 2. Forces UTF-8 encoding for the body to handle special characters (umlauts, emojis)
        // 3. Uses a one-liner format with ; for easy copy-pasting
        const powershell = `$h=@{"apikey"="${settings.supabaseKey}";"Authorization"="Bearer ${settings.supabaseKey}"}; Invoke-RestMethod -Uri "${url}" -Method Post -Headers $h -ContentType "application/json" -Body ([System.Text.Encoding]::UTF8.GetBytes('${bodyJsonPwsh}'))`;

        return { curl, powershell };
    };

    const prepareEmailLink = (type: 'mailto' | 'gmail') => {
        if (!selectedProductForOrder?.emailOrderAddress) return;

        const encodedSubject = encodeURIComponent(emailSubject);
        const encodedBody = encodeURIComponent(emailBody);

        if (type === 'gmail') {
            window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${selectedProductForOrder.emailOrderAddress}&su=${encodedSubject}&body=${encodedBody}`, '_blank');
        } else {
            window.location.href = `mailto:${selectedProductForOrder.emailOrderAddress}?subject=${encodedSubject}&body=${encodedBody}`;
        }
    };

    const filteredProducts = products.filter(p => {
        const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesLowStock = showLowStockOnly ? p.stock <= (p.minStock || 0) : true;
        return matchesSearch && matchesLowStock;
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
                gap: 'var(--spacing-md)',
                marginBottom: 'var(--spacing-xl)'
            }}>
                <div style={{ backgroundColor: 'var(--color-surface)', padding: 'var(--spacing-md)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}>
                    <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', marginBottom: '4px' }}>Produkte Gesamt</div>
                    <div style={{ fontSize: '24px', fontWeight: 700 }}>{products.length}</div>
                </div>
                <div
                    onClick={() => setShowLowStockOnly(!showLowStockOnly)}
                    style={{
                        backgroundColor: lowStockCount > 0 ? '#FEF2F2' : 'var(--color-surface)',
                        padding: 'var(--spacing-md)',
                        borderRadius: 'var(--radius-md)',
                        border: lowStockCount > 0 ? '1px solid #FECACA' : '1px solid var(--color-border)',
                        boxShadow: 'var(--shadow-sm)',
                        cursor: 'pointer'
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: lowStockCount > 0 ? '#DC2626' : 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', marginBottom: '4px' }}>
                        <AlertTriangle size={16} /> Niedriger Bestand
                    </div>
                    <div style={{ fontSize: '24px', fontWeight: 700, color: lowStockCount > 0 ? '#DC2626' : 'inherit' }}>{lowStockCount}</div>
                </div>
                <div style={{ backgroundColor: 'var(--color-surface)', padding: 'var(--spacing-md)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', marginBottom: '4px' }}>
                        <Euro size={16} /> Lagerwert (Netto)
                    </div>
                    <div style={{ fontSize: '24px', fontWeight: 700 }}>{totalValue.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</div>
                </div>
            </div>

            <div style={{ display: 'flex', gap: 'var(--spacing-md)', marginBottom: 'var(--spacing-lg)' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                    <Search size={20} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                    <input
                        type="text"
                        placeholder="Produkte suchen..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        style={{
                            width: '100%',
                            padding: '10px 10px 10px 40px',
                            borderRadius: 'var(--radius-md)',
                            border: '1px solid var(--color-border)',
                            fontSize: 'var(--font-size-md)',
                            backgroundColor: 'var(--color-surface)'
                        }}
                    />
                </div>
                <button
                    onClick={() => setShowLowStockOnly(!showLowStockOnly)}
                    style={{
                        padding: '0 20px',
                        borderRadius: 'var(--radius-md)',
                        border: showLowStockOnly ? '1px solid #DC2626' : '1px solid var(--color-border)',
                        backgroundColor: showLowStockOnly ? '#FEF2F2' : 'var(--color-surface)',
                        color: showLowStockOnly ? '#DC2626' : 'var(--color-text-main)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        fontWeight: 500,
                        whiteSpace: 'nowrap'
                    }}
                >
                    <AlertTriangle size={18} />
                    {showLowStockOnly ? 'Alle anzeigen' : '⚠️ Kritischer Bestand'}
                </button>
            </div>

            {
                isMobile ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                        {filteredProducts.map(product => (
                            <div key={product.id} style={{
                                backgroundColor: 'var(--color-surface)',
                                borderRadius: 'var(--radius-md)',
                                padding: 'var(--spacing-md)',
                                boxShadow: 'var(--shadow-sm)',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 'var(--spacing-sm)'
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <div style={{ display: 'flex', gap: 'var(--spacing-md)', alignItems: 'center' }}>
                                        {product.image && (
                                            <img
                                                src={product.image}
                                                alt={product.name}
                                                style={{ width: '60px', height: '60px', objectFit: 'cover', borderRadius: 'var(--radius-sm)' }}
                                            />
                                        )}
                                        <div>
                                            <div style={{ fontWeight: 600, fontSize: 'var(--font-size-lg)' }}>{product.name}</div>
                                            <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>{product.category}</div>
                                        </div>
                                    </div>
                                    <div style={{ textAlign: 'right' }}>
                                        <div style={{
                                            fontSize: 'var(--font-size-xl)',
                                            fontWeight: 700,
                                            color: product.stock <= (product.minStock || 0) ? 'var(--color-danger)' : 'inherit'
                                        }}>
                                            {product.stock}
                                        </div>
                                        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>{product.unit}</div>
                                        {product.price && (
                                            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                                                Ø {(product.stock * product.price).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--spacing-xs)', paddingTop: 'var(--spacing-sm)', borderTop: '1px solid var(--color-border)' }}>
                                    <div style={{ display: 'flex', gap: 'var(--spacing-xs)' }}>
                                        {product.orderUrl && (
                                            <a href={product.orderUrl} target="_blank" rel="noopener noreferrer"
                                                style={{ padding: '6px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--color-background)', color: 'var(--color-primary)' }}>
                                                <ExternalLink size={18} />
                                            </a>
                                        )}
                                        {product.emailOrderAddress && (
                                            <div style={{ padding: '6px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--color-background)', color: 'var(--color-text-muted)' }}>
                                                <Mail size={18} />
                                            </div>
                                        )}
                                    </div>
                                    <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
                                        <button onClick={() => {
                                            const links = getIoTLink(product);
                                            if (links) setShowIoTLink(links);
                                            else setNotification({ message: 'Bitte konfigurieren Sie zuerst Supabase in den Einstellungen.', type: 'error' });
                                        }} style={{ padding: '8px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'white', cursor: 'pointer' }}>
                                            <Wifi size={18} />
                                        </button>
                                        <button onClick={() => handleEdit(product)} style={{ padding: '8px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'white', cursor: 'pointer' }}>
                                            <Edit2 size={18} />
                                        </button>
                                        <button onClick={() => handleDeleteClick(product.id)} style={{ padding: '8px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'white', color: 'var(--color-danger)', cursor: 'pointer' }}>
                                            <Trash2 size={18} />
                                        </button>
                                        <button onClick={() => handleOrderClick(product)} style={{
                                            padding: '8px 16px', borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--color-primary)', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px'
                                        }}>
                                            <ShoppingCart size={18} /> Bestellen
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div style={{
                        backgroundColor: 'var(--color-surface)',
                        borderRadius: 'var(--radius-lg)',
                        boxShadow: 'var(--shadow-sm)'
                    }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead style={{ backgroundColor: 'var(--color-background)', borderBottom: '1px solid var(--color-border)' }}>
                                <tr>
                                    <th style={{ padding: 'var(--spacing-md)', textAlign: 'left', color: 'var(--color-text-muted)', fontWeight: 600 }}>Bild</th>
                                    <th style={{ padding: 'var(--spacing-md)', textAlign: 'left', color: 'var(--color-text-muted)', fontWeight: 600 }}>Name</th>
                                    <th style={{ padding: 'var(--spacing-md)', textAlign: 'right', color: 'var(--color-text-muted)', fontWeight: 600 }}>Bestand & Wert</th>
                                    <th style={{ padding: 'var(--spacing-md)', textAlign: 'left', color: 'var(--color-text-muted)', fontWeight: 600 }}>Kontakt / Links</th>
                                    <th style={{ padding: 'var(--spacing-md)', textAlign: 'center', color: 'var(--color-text-muted)', fontWeight: 600 }}>Bestellen</th>
                                    <th style={{ padding: 'var(--spacing-md)', textAlign: 'right', color: 'var(--color-text-muted)', fontWeight: 600 }}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredProducts.map((product, index) => {
                                    const isLastRows = index >= filteredProducts.length - 2 && filteredProducts.length > 3;
                                    return (
                                        <tr key={product.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                            <td style={{ padding: 'var(--spacing-md)' }}>
                                                {product.image && (
                                                    <img
                                                        src={product.image}
                                                        alt={product.name}
                                                        style={{ width: '40px', height: '40px', objectFit: 'cover', borderRadius: 'var(--radius-sm)' }}
                                                    />
                                                )}
                                            </td>
                                            <td style={{ padding: 'var(--spacing-md)' }}>
                                                <div style={{ fontWeight: 500, fontSize: 'var(--font-size-lg)' }}>{product.name}</div>
                                                <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
                                                    {product.price ? product.price.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }) : '-'} / {product.unit}
                                                </div>
                                            </td>
                                            <td style={{ padding: 'var(--spacing-md)', textAlign: 'right' }}>
                                                <div style={{
                                                    fontSize: 'var(--font-size-lg)',
                                                    fontWeight: 700,
                                                    color: product.stock <= (product.minStock || 0) ? 'var(--color-danger)' : 'inherit'
                                                }}>
                                                    {product.stock} {product.unit}
                                                </div>
                                                {product.price && (
                                                    <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
                                                        = {(product.stock * product.price).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
                                                    </div>
                                                )}
                                            </td>
                                            <td style={{ padding: 'var(--spacing-md)' }}>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                    {product.orderUrl && (
                                                        <a href={product.orderUrl} target="_blank" rel="noopener noreferrer"
                                                            style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--color-primary)', textDecoration: 'none', fontSize: 'var(--font-size-sm)' }}>
                                                            <ExternalLink size={14} /> Link
                                                        </a>
                                                    )}
                                                    {product.emailOrderAddress && (
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
                                                            <Mail size={14} /> {product.emailOrderAddress}
                                                        </div>
                                                    )}
                                                    {product.supplierPhone && (
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
                                                            <Phone size={14} /> {product.supplierPhone}
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                            <td style={{ padding: 'var(--spacing-md)', textAlign: 'center' }}>
                                                <button
                                                    onClick={() => handleOrderClick(product)}
                                                    style={{
                                                        backgroundColor: 'var(--color-primary)',
                                                        color: 'white',
                                                        border: 'none',
                                                        padding: '8px 16px',
                                                        borderRadius: 'var(--radius-md)',
                                                        cursor: 'pointer',
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: '6px',
                                                        fontWeight: 500,
                                                        boxShadow: 'var(--shadow-sm)'
                                                    }}
                                                >
                                                    <ShoppingCart size={18} />
                                                    Bestellen
                                                </button>
                                            </td>
                                            <td style={{ padding: 'var(--spacing-md)', textAlign: 'right', position: 'relative' }}>
                                                <button
                                                    onClick={() => setOpenSettingsId(openSettingsId === product.id ? null : product.id)}
                                                    style={{
                                                        background: 'none',
                                                        border: 'none',
                                                        color: 'var(--color-text-muted)',
                                                        padding: '8px',
                                                        borderRadius: 'var(--radius-md)',
                                                        cursor: 'pointer',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center'
                                                    }}
                                                >
                                                    <Settings size={20} />
                                                </button>

                                                {openSettingsId === product.id && (
                                                    <>
                                                        <div
                                                            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10 }}
                                                            onClick={() => setOpenSettingsId(null)}
                                                        />
                                                        <div style={{
                                                            position: 'absolute',
                                                            right: 'var(--spacing-md)',
                                                            ...(isLastRows
                                                                ? { bottom: '100%', marginBottom: '4px' }
                                                                : { top: '100%', marginTop: '4px' }
                                                            ),
                                                            backgroundColor: 'var(--color-surface)',
                                                            borderRadius: 'var(--radius-md)',
                                                            boxShadow: 'var(--shadow-lg)',
                                                            border: '1px solid var(--color-border)',
                                                            zIndex: 20,
                                                            minWidth: '160px',
                                                            overflow: 'hidden'
                                                        }}>
                                                            <button
                                                                onClick={() => {
                                                                    handleEdit(product);
                                                                    setOpenSettingsId(null);
                                                                }}
                                                                style={{
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '8px',
                                                                    width: '100%',
                                                                    padding: '10px 16px',
                                                                    border: 'none',
                                                                    background: 'none',
                                                                    textAlign: 'left',
                                                                    cursor: 'pointer',
                                                                    color: 'var(--color-text-main)',
                                                                    fontSize: 'var(--font-size-sm)'
                                                                }}
                                                                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-background)'}
                                                                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                                            >
                                                                <Edit2 size={16} /> Bearbeiten
                                                            </button>
                                                            <button
                                                                onClick={() => {
                                                                    const links = getIoTLink(product);
                                                                    if (links) setShowIoTLink(links);
                                                                    else setNotification({ message: 'Bitte konfigurieren Sie zuerst Supabase in den Einstellungen.', type: 'error' });
                                                                    setOpenSettingsId(null);
                                                                }}
                                                                style={{
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '8px',
                                                                    width: '100%',
                                                                    padding: '10px 16px',
                                                                    border: 'none',
                                                                    background: 'none',
                                                                    textAlign: 'left',
                                                                    cursor: 'pointer',
                                                                    color: 'var(--color-text-main)',
                                                                    fontSize: 'var(--font-size-sm)'
                                                                }}
                                                                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-background)'}
                                                                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                                            >
                                                                <Wifi size={16} /> IoT Link
                                                            </button>
                                                            <div style={{ borderTop: '1px solid var(--color-border)', margin: '4px 0' }} />
                                                            <button
                                                                onClick={() => {
                                                                    handleDeleteClick(product.id);
                                                                    setOpenSettingsId(null);
                                                                }}
                                                                style={{
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '8px',
                                                                    width: '100%',
                                                                    padding: '10px 16px',
                                                                    border: 'none',
                                                                    background: 'none',
                                                                    textAlign: 'left',
                                                                    cursor: 'pointer',
                                                                    color: 'var(--color-danger)',
                                                                    fontSize: 'var(--font-size-sm)'
                                                                }}
                                                                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-background)'}
                                                                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                                            >
                                                                <Trash2 size={16} /> Löschen
                                                            </button>
                                                        </div>
                                                    </>
                                                )
                                                }
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table >
                    </div >
                )
            }

            {/* IoT Link Modal */}
            {
                showIoTLink && (
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
                            maxWidth: '600px',
                            boxShadow: 'var(--shadow-lg)'
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-md)' }}>
                                <h3 style={{ margin: 0 }}>IoT Button Konfiguration</h3>
                                <button onClick={() => setShowIoTLink(null)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={24} /></button>
                            </div>
                            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--spacing-md)' }}>
                                Nutzen Sie den CURL-Befehl für den IoT Button. Zum Testen am Windows-PC nutzen Sie den PowerShell-Befehl.
                            </p>

                            <div style={{ marginBottom: 'var(--spacing-md)' }}>
                                <strong style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)' }}>Für Shelly Button / IoT Gerät (CURL):</strong>
                                <pre style={{
                                    backgroundColor: 'var(--color-background)',
                                    padding: 'var(--spacing-md)',
                                    borderRadius: 'var(--radius-md)',
                                    overflowX: 'auto',
                                    fontSize: '12px',
                                    fontFamily: 'monospace',
                                    whiteSpace: 'pre-wrap',
                                    margin: 0
                                }}>
                                    {showIoTLink.curl}
                                </pre>
                            </div>

                            <div>
                                <strong style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)' }}>Zum Testen in Windows PowerShell:</strong>
                                <pre style={{
                                    backgroundColor: 'var(--color-background)',
                                    padding: 'var(--spacing-md)',
                                    borderRadius: 'var(--radius-md)',
                                    overflowX: 'auto',
                                    fontSize: '12px',
                                    fontFamily: 'monospace',
                                    whiteSpace: 'pre-wrap',
                                    margin: 0
                                }}>
                                    {showIoTLink.powershell}
                                </pre>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--spacing-md)' }}>
                                <button
                                    onClick={() => setShowIoTLink(null)}
                                    style={{
                                        padding: 'var(--spacing-sm) var(--spacing-md)',
                                        borderRadius: 'var(--radius-md)',
                                        border: 'none',
                                        backgroundColor: 'var(--color-primary)',
                                        color: 'white'
                                    }}
                                >
                                    Schließen
                                </button>
                            </div>
                        </div>
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
                        overflowY: 'auto'
                    }}>
                        <div style={{
                            backgroundColor: 'var(--color-surface)',
                            padding: 'var(--spacing-xl)',
                            borderRadius: 'var(--radius-lg)',
                            width: '100%',
                            maxWidth: '500px',
                            boxShadow: 'var(--shadow-lg)',
                            maxHeight: '90vh',
                            overflowY: 'auto'
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-lg)' }}>
                                <h3 style={{ margin: 0, fontSize: 'var(--font-size-lg)' }}>{editingId ? 'Produkt bearbeiten' : 'Neues Produkt anlegen'}</h3>
                                <button onClick={closeModal} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                                    <X size={24} />
                                </button>
                            </div>

                            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                                <div>
                                    <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>Name</label>
                                    <input
                                        required
                                        value={newProduct.name || ''}
                                        onChange={e => setNewProduct({ ...newProduct, name: e.target.value })}
                                        style={{ width: '100%', padding: 'var(--spacing-sm)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}
                                    />
                                </div>



                                <div>
                                    <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>Lieferant</label>
                                    <select
                                        value={newProduct.supplierId || ''}
                                        onChange={e => {
                                            const supplierId = e.target.value;
                                            const supplier = suppliers.find(s => s.id === supplierId);
                                            setNewProduct({
                                                ...newProduct,
                                                supplierId: supplierId || undefined,
                                                // Pre-fill legacy fields if empty, but prefer keeping them clean if using supplier
                                                emailOrderAddress: supplier?.email || newProduct.emailOrderAddress,
                                                supplierPhone: supplier?.phone || newProduct.supplierPhone
                                            });
                                        }}
                                        style={{ width: '100%', padding: 'var(--spacing-sm)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', marginBottom: 'var(--spacing-sm)' }}
                                    >
                                        <option value="">-- Kein Lieferant ausgewählt --</option>
                                        {suppliers.map(s => (
                                            <option key={s.id} value={s.id}>{s.name}</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>Email-Adresse</label>
                                    <input
                                        type="email"
                                        placeholder="bestellung@lieferant.de"
                                        value={newProduct.emailOrderAddress || ''}
                                        onChange={e => setNewProduct({ ...newProduct, emailOrderAddress: e.target.value })}
                                        style={{ width: '100%', padding: 'var(--spacing-sm)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}
                                    />

                                    <div style={{ marginTop: 'var(--spacing-sm)' }}>
                                        <button
                                            type="button"
                                            onClick={() => setIsEmailTemplateOpen(!isEmailTemplateOpen)}
                                            style={{
                                                background: 'none',
                                                border: 'none',
                                                padding: 0,
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                fontSize: 'var(--font-size-sm)',
                                                color: 'var(--color-primary)',
                                                fontWeight: 500
                                            }}
                                        >
                                            Standardbestelltext hinzufügen
                                            <span style={{ transform: isEmailTemplateOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s', marginLeft: '4px' }}>▼</span>
                                        </button>

                                        {isEmailTemplateOpen && (
                                            <div style={{ marginTop: 'var(--spacing-sm)', paddingLeft: 'var(--spacing-md)', borderLeft: '2px solid var(--color-border)' }}>
                                                <div style={{ marginBottom: 'var(--spacing-sm)' }}>
                                                    <label style={{ display: 'block', marginBottom: '4px', fontSize: 'var(--font-size-xs)' }}>Standard Betreff</label>
                                                    <input
                                                        type="text"
                                                        value={newProduct.emailOrderSubject || ''}
                                                        onChange={e => setNewProduct({ ...newProduct, emailOrderSubject: e.target.value })}
                                                        placeholder=""
                                                        style={{ width: '100%', padding: '6px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}
                                                    />
                                                </div>
                                                <div style={{ marginBottom: 'var(--spacing-sm)' }}>
                                                    <label style={{ display: 'block', marginBottom: '4px', fontSize: 'var(--font-size-xs)' }}>Standard Nachricht</label>
                                                    <textarea
                                                        value={newProduct.emailOrderBody || ''}
                                                        onChange={e => setNewProduct({ ...newProduct, emailOrderBody: e.target.value })}
                                                        rows={4}
                                                        placeholder=""
                                                        style={{ width: '100%', padding: '6px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontFamily: 'inherit' }}
                                                    />
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)', marginTop: 'var(--spacing-sm)' }}>
                                                    <button
                                                        type="button"
                                                        onClick={() => setNewProduct({ ...newProduct, autoOrder: !newProduct.autoOrder })}
                                                        style={{
                                                            background: 'none',
                                                            border: 'none',
                                                            padding: 0,
                                                            cursor: 'pointer',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            color: newProduct.autoOrder ? 'var(--color-primary)' : 'var(--color-text-muted)'
                                                        }}
                                                    >
                                                        {newProduct.autoOrder ? <CheckSquare size={20} /> : <Square size={20} />}
                                                    </button>
                                                    <label
                                                        onClick={() => setNewProduct({ ...newProduct, autoOrder: !newProduct.autoOrder })}
                                                        style={{ cursor: 'pointer', fontWeight: 500, fontSize: 'var(--font-size-sm)' }}
                                                    >
                                                        Automatische Bestellung (via EmailJS)
                                                    </label>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div>
                                    <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>Shop-Link / Bestell-URL</label>
                                    <input
                                        type="url"
                                        value={newProduct.orderUrl || ''}
                                        onChange={e => setNewProduct({ ...newProduct, orderUrl: e.target.value })}
                                        style={{ width: '100%', padding: 'var(--spacing-sm)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}
                                    />
                                </div>

                                <div>
                                    <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>Bild URL (optional)</label>
                                    <input
                                        type="url"
                                        value={newProduct.image || ''}
                                        onChange={e => setNewProduct({ ...newProduct, image: e.target.value })}
                                        style={{ width: '100%', padding: 'var(--spacing-sm)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}
                                    />
                                </div>

                                <div>
                                    <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>Standard Bestellweg</label>
                                    <div style={{ display: 'flex', gap: 'var(--spacing-lg)' }}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)', cursor: 'pointer' }}>
                                            <input
                                                type="radio"
                                                name="preferredOrderMethod"
                                                value="email"
                                                checked={newProduct.preferredOrderMethod === 'email'}
                                                onChange={() => setNewProduct({ ...newProduct, preferredOrderMethod: 'email' })}
                                            />
                                            Email
                                        </label>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)', cursor: 'pointer' }}>
                                            <input
                                                type="radio"
                                                name="preferredOrderMethod"
                                                value="link"
                                                checked={newProduct.preferredOrderMethod === 'link'}
                                                onChange={() => setNewProduct({ ...newProduct, preferredOrderMethod: 'link' })}
                                            />
                                            Link / Shop
                                        </label>
                                    </div>
                                </div>

                                <div>
                                    <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>Notizen</label>
                                    <div style={{ position: 'relative' }}>
                                        <MessageSquare size={16} style={{ position: 'absolute', top: '10px', left: '10px', color: 'var(--color-text-muted)' }} />
                                        <textarea
                                            rows={3}
                                            value={newProduct.notes || ''}
                                            onChange={e => setNewProduct({ ...newProduct, notes: e.target.value })}
                                            placeholder="Notizen zum Produkt..."
                                            style={{ width: '100%', padding: 'var(--spacing-sm) var(--spacing-sm) var(--spacing-sm) 36px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontFamily: 'inherit' }}
                                        />
                                    </div>
                                </div>



                                <div style={{
                                    border: '1px solid var(--color-border)',
                                    borderRadius: 'var(--radius-md)',
                                    overflow: 'hidden'
                                }}>
                                    <button
                                        type="button"
                                        onClick={() => setIsInventoryDetailsOpen(!isInventoryDetailsOpen)}
                                        style={{
                                            width: '100%',
                                            padding: 'var(--spacing-md)',
                                            background: 'var(--color-background)',
                                            border: 'none',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            cursor: 'pointer',
                                            fontWeight: 500
                                        }}
                                    >
                                        Lager & Details
                                        <span style={{ transform: isInventoryDetailsOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>▼</span>
                                    </button>

                                    {isInventoryDetailsOpen && (
                                        <div style={{ padding: 'var(--spacing-md)', display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                                                <div>
                                                    <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>Kategorie</label>
                                                    {isCustomCategoryMode ? (
                                                        <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
                                                            <input
                                                                value={newProduct.category || ''}
                                                                onChange={e => setNewProduct({ ...newProduct, category: e.target.value })}
                                                                placeholder="Kategorie eingeben..."
                                                                autoFocus
                                                                style={{ width: '100%', padding: 'var(--spacing-sm)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}
                                                            />
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setIsCustomCategoryMode(false);
                                                                    setNewProduct({ ...newProduct, category: '' });
                                                                }}
                                                                style={{
                                                                    background: 'var(--color-background)',
                                                                    border: '1px solid var(--color-border)',
                                                                    borderRadius: 'var(--radius-sm)',
                                                                    cursor: 'pointer',
                                                                    padding: '0 var(--spacing-sm)'
                                                                }}
                                                                title="Zurück zur Auswahl"
                                                            >
                                                                <X size={18} />
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <select
                                                            value={newProduct.category || ''}
                                                            onChange={e => {
                                                                if (e.target.value === 'custom') {
                                                                    setIsCustomCategoryMode(true);
                                                                    setNewProduct({ ...newProduct, category: '' });
                                                                } else {
                                                                    setNewProduct({ ...newProduct, category: e.target.value });
                                                                }
                                                            }}
                                                            style={{ width: '100%', padding: 'var(--spacing-sm)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}
                                                        >
                                                            <option value="">-- Leer --</option>
                                                            {CATEGORIES.map(cat => (
                                                                <option key={cat} value={cat}>{cat}</option>
                                                            ))}
                                                            <option value="custom">Eigene eingeben...</option>
                                                        </select>
                                                    )}
                                                </div>
                                                <div>
                                                    <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>Einheit</label>
                                                    <input
                                                        value={newProduct.unit || ''}
                                                        onChange={e => setNewProduct({ ...newProduct, unit: e.target.value })}
                                                        placeholder="z.B. Stück"
                                                        style={{ width: '100%', padding: 'var(--spacing-sm)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}
                                                    />
                                                </div>
                                            </div>

                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                                                <div>
                                                    <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>Bestand</label>
                                                    <input
                                                        type="number"
                                                        value={newProduct.stock || 0}
                                                        onChange={e => setNewProduct({ ...newProduct, stock: Number(e.target.value) })}
                                                        style={{ width: '100%', padding: 'var(--spacing-sm)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}
                                                    />
                                                </div>
                                                <div>
                                                    <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>Mindestbestand</label>
                                                    <input
                                                        type="number"
                                                        value={newProduct.minStock || 0}
                                                        onChange={e => setNewProduct({ ...newProduct, minStock: Number(e.target.value) })}
                                                        style={{ width: '100%', padding: 'var(--spacing-sm)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--spacing-md)', marginTop: 'var(--spacing-md)' }}>
                                    <button
                                        type="button"
                                        onClick={closeModal}
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
                                        {isLoading ? 'Speichert...' : 'Speichern'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )
            }

            {/* Delete Confirmation Modal */}
            {
                deleteConfirmId && (
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
                isOrderModalOpen && selectedProductForOrder && (
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
                                    <p style={{ margin: '0 0 var(--spacing-sm) 0', fontWeight: 500 }}>Produkt: {selectedProductForOrder.name}</p>
                                </div>

                                <div>
                                    <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>Menge ({selectedProductForOrder.unit})</label>
                                    <input
                                        type="number"
                                        min="1"
                                        required
                                        value={orderQuantity}
                                        onChange={e => {
                                            const newQty = Number(e.target.value);
                                            setOrderQuantity(newQty);

                                            // Update body placeholder dynamically if needed, 
                                            // but since we allow manual edits, maybe we shouldn't overwrite automatically 
                                            // unless the user hasn't edited it? 
                                            // For simplicity, we won't auto-update text after initial load to avoid overwriting user edits.
                                            // But we could re-run the replacement if we want strictly template behavior.
                                            // Better strategy: Simple replacement on load, then manual.
                                        }}
                                        style={{ width: '100%', padding: 'var(--spacing-sm)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}
                                    />
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

                                    {selectedProductForOrder.emailOrderAddress && !selectedProductForOrder.autoOrder && (
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
        </div >
    );
};
