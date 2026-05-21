import { generateId } from "../utils";
import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Mail, Phone, Search, X, AlertTriangle, Package, CheckSquare, Square, Globe, Key, Eye, EyeOff, ExternalLink } from 'lucide-react';
import type { Supplier, Product } from '../types';
import { DataService } from '../services/data';
import { getSupabaseClient } from '../services/supabase';
import { Notification, type NotificationType } from '../components/Notification';

export const Suppliers: React.FC = () => {
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [userRole, setUserRole] = useState<string>('');
    const [currentCompanyId, setCurrentCompanyId] = useState<string>('');
    const [currentUserId, setCurrentUserId] = useState<string>('');

    const [searchTerm, setSearchTerm] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
    const [supplierToDelete, setSupplierToDelete] = useState<Supplier | null>(null);
    const [notification, setNotification] = useState<{ message: string, type: NotificationType } | null>(null);
    const [isCustomCategoryMode, setIsCustomCategoryMode] = useState(false);

    // Form State
    const [formData, setFormData] = useState<Partial<Supplier>>({
        name: '', contactName: '', email: '', phone: '', url: '', notes: [], preferredOrderMethod: 'email'
    });
    const [showPassword, setShowPassword] = useState(false);
    const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        const supabaseClient = getSupabaseClient();
        if (supabaseClient) {
            supabaseClient.auth.getUser().then(({ data: { user } }) => {
                if (user) {
                    setCurrentUserId(user.id);
                    supabaseClient.from('profiles').select('role, company_id').eq('id', user.id).maybeSingle().then(({ data }) => {
                        setUserRole(data?.role || '');
                        setCurrentCompanyId(data?.company_id || '');
                    });
                }
            });
        }
    }, []);

    useEffect(() => {
        loadData();

        const supabaseClient = getSupabaseClient();
        let channel: any;
        if (supabaseClient) {
            // W8: eindeutiger Channel-Name pro Tab
            const channelName = `suppliers_rt_${Math.random().toString(36).slice(2, 8)}`;
            channel = supabaseClient.channel(channelName)
                .on('postgres_changes', { event: '*', schema: 'public', table: 'suppliers' }, () => {
                    loadData();
                })
                .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => {
                    loadData();
                })
                .subscribe();
        }

        return () => {
            if (channel && supabaseClient) {
                supabaseClient.removeChannel(channel);
            }
        };
    }, []);

    useEffect(() => {
        if (notification) {
            const timer = setTimeout(() => setNotification(null), 3000);
            return () => clearTimeout(timer);
        }
    }, [notification]);

    const loadData = async () => {
        try {
            const [supps, prods] = await Promise.all([
                DataService.getSuppliers(),
                DataService.getProducts()
            ]);
            setSuppliers(supps);
            setProducts(prods);
        } catch (e) {
             console.error(e);
             setNotification({ message: 'Lade-Fehler.', type: 'error' });
        }
    };

    const handleOpenModal = async (supplier?: Supplier) => {
        setShowPassword(false);
        if (supplier) {
            setEditingSupplier(supplier);
            setFormData(supplier);
            setSelectedProductIds(products.filter(p => p.supplierId === supplier.id).map(p => p.id));
            // Load encrypted credentials only for admin/owner
            if (userRole === 'owner' || userRole === 'admin') {
                try {
                    const creds = await DataService.getSupplierCredentials(supplier.id);
                    if (creds) {
                        setFormData(prev => ({
                            ...prev,
                            loginUrl: creds.loginUrl ?? prev.loginUrl,
                            loginUsername: creds.loginUsername ?? prev.loginUsername,
                            loginPassword: creds.loginPassword,
                        }));
                    }
                } catch {
                    // Credentials not available — silently ignore
                }
            }
        } else {
            setEditingSupplier(null);
            setFormData({ name: '', contactName: '', email: '', phone: '', url: '', notes: [], documents: [], preferredOrderMethod: 'email' });
            setSelectedProductIds([]);
        }
        setIsModalOpen(true);
    };

    const toggleProductSelection = (productId: string) => {
        setSelectedProductIds(prev => 
            prev.includes(productId) ? prev.filter(id => id !== productId) : [...prev, productId]
        );
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        let payloadDebug = '';
        try {
            if (!formData.name) {
                setNotification({ message: 'Name ist ein Pflichtfeld.', type: 'error' });
                return;
            }

            setIsSubmitting(true);
            const targetSupplierId = editingSupplier ? editingSupplier.id : generateId();

            const supplierToSave: Supplier = {
                id: targetSupplierId,
                company_id: editingSupplier?.company_id || currentCompanyId || undefined,
                user_id: editingSupplier?.user_id || currentUserId || undefined,
                is_auto_generated: editingSupplier?.is_auto_generated,
                name: formData.name,
                contactName: formData.contactName,
                email: formData.email || '',
                phone: formData.phone,
                url: formData.url,
                notes: formData.notes || [],
                documents: formData.documents || [],
                loginUrl: formData.loginUrl,
                loginUsername: formData.loginUsername,
                loginPassword: formData.loginPassword,
                preferredOrderMethod: formData.preferredOrderMethod,
                orderEmail: formData.orderEmail,
                orderPhone: formData.orderPhone,
                orderUrl: formData.orderUrl,
                ignoreOrderProposals: formData.ignoreOrderProposals,
                customerNumber: formData.customerNumber,
                paymentMethod: formData.paymentMethod,
                defaultCategory: formData.defaultCategory || undefined,
            } as Supplier;
            
            payloadDebug = JSON.stringify(supplierToSave);

            await DataService.saveSupplier(supplierToSave);

            // Save credentials encrypted via RPC (admin/owner only)
            if ((userRole === 'owner' || userRole === 'admin') && (formData.loginUsername || formData.loginPassword)) {
                await DataService.saveSupplierCredentials(targetSupplierId, {
                    loginUrl: formData.loginUrl,
                    loginUsername: formData.loginUsername,
                    loginPassword: formData.loginPassword,
                });
            }

            // Update assigned products
            const productUpdates = products.filter(product => {
                const wasAssigned = product.supplierId === targetSupplierId;
                const isNowAssigned = selectedProductIds.includes(product.id);
                return wasAssigned !== isNowAssigned;
            }).map(product => {
                const isNowAssigned = selectedProductIds.includes(product.id);
                return DataService.updateProduct({
                    ...product,
                    supplierId: isNowAssigned ? targetSupplierId : undefined
                });
            });

            if (productUpdates.length > 0) {
                 await Promise.all(productUpdates);
            }

            setNotification({
                message: editingSupplier ? 'Lieferant aktualisiert!' : 'Lieferant erstellt!',
                type: 'success'
            });
            setIsModalOpen(false);
            await loadData();
        } catch (error: any) {
            console.error(error);
            const msg = error?.message || error?.details || JSON.stringify(error);
            setNotification({ message: `Fehler beim Speichern: ${msg}. Payload: ${payloadDebug}`, type: 'error' });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async (id: string) => {
        try {
            await DataService.deleteSupplier(id);
            setNotification({ message: 'Lieferant gelöscht.', type: 'success' });
            setSupplierToDelete(null);
            await loadData();
        } catch (error) {
            console.error(error);
            setNotification({ message: 'Fehler beim Löschen.', type: 'error' });
        }
    };

    const filteredSuppliers = suppliers.filter(s =>
        s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (s.email || '').toLowerCase().includes(searchTerm.toLowerCase())
    );

    // Modal product grouping
    const alreadyAssignedProducts = products.filter(p => p.supplierId === (editingSupplier?.id || '-1'));
    const unassignedProducts = products.filter(p => !p.supplierId);
    const assignedToOthersProducts = products.filter(p => p.supplierId && p.supplierId !== (editingSupplier?.id || '-1'));

    return (
        <div>
            {notification && (
                <Notification
                    message={notification.message}
                    type={notification.type}
                    onClose={() => setNotification(null)}
                />
            )}

            <div className="page-header">
                <h2 className="page-title">Lieferanten Netzwerk</h2>
                <button onClick={() => handleOpenModal()} className="btn btn-primary">
                    <Plus size={18} /> Neuer Lieferant
                </button>
            </div>

            <div style={{ position: 'relative', marginBottom: 'var(--spacing-2xl)' }}>
                <Search size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-faint)', pointerEvents: 'none' }} />
                <input
                    type="text"
                    placeholder="Lieferanten schnell finden..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="input-field"
                    style={{ paddingLeft: '42px', fontSize: '15px' }}
                />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 'var(--spacing-xl)' }}>
                {filteredSuppliers.map(supplier => {
                    const linkedProductsCount = products.filter(p => p.supplierId === supplier.id).length;

                    return (
                        <div key={supplier.id} className="card stat-card-interactive" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                            {/* Header */}
                            <div style={{ padding: 'var(--spacing-lg) var(--spacing-xl)', borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface-elevated)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                <div>
                                    <h3 style={{ margin: '0 0 4px 0', fontSize: '18px', color: 'var(--color-text-main)' }}>{supplier.name}</h3>
                                    {supplier.contactName && (
                                        <div style={{ fontSize: '13px', color: '#64748b', fontWeight: 500 }}>👤 {supplier.contactName}</div>
                                    )}
                                </div>
                                <div style={{ display: 'flex', gap: '6px' }}>
                                    <button onClick={() => handleOpenModal(supplier)} className="btn btn-ghost btn-circle" title="Bearbeiten">
                                        <Edit2 size={15} />
                                    </button>
                                    <button onClick={() => setSupplierToDelete(supplier)} className="btn btn-danger btn-circle" title="Löschen">
                                        <Trash2 size={15} />
                                    </button>
                                </div>
                            </div>

                            {/* Body */}
                            <div style={{ padding: 'var(--spacing-xl)', flex: 1, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                <a href={`mailto:${supplier.email}`} style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#475569', textDecoration: 'none', fontSize: '14px', padding: '8px', borderRadius: 'var(--radius-md)', transition: 'background-color 0.2s' }} onMouseOver={e => e.currentTarget.style.backgroundColor = '#f1f5f9'}  onMouseOut={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                                    <div style={{ padding: '6px', backgroundColor: '#e0e7ff', color: '#4f46e5', borderRadius: '50%' }}><Mail size={14} /></div>
                                    {supplier.email}
                                </a>
                                
                                {supplier.phone && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#475569', fontSize: '14px', padding: '8px', borderRadius: 'var(--radius-md)' }}>
                                        <div style={{ padding: '6px', backgroundColor: '#dcfce7', color: '#16a34a', borderRadius: '50%', flexShrink: 0 }}><Phone size={14} /></div>
                                        {supplier.phone}
                                    </div>
                                )}

                                {supplier.url && (
                                    <a href={/^https?:\/\//i.test(supplier.url) ? supplier.url : `https://${supplier.url}`} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#475569', textDecoration: 'none', fontSize: '14px', padding: '8px', borderRadius: 'var(--radius-md)', transition: 'background-color 0.2s' }} onMouseOver={e => e.currentTarget.style.backgroundColor = '#f1f5f9'}  onMouseOut={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                                        <div style={{ padding: '6px', backgroundColor: '#fef3c7', color: '#d97706', borderRadius: '50%' }}><Globe size={14} /></div>
                                        {supplier.url.replace(/^https?:\/\//i, '').replace(/\/$/, '')}
                                    </a>
                                )}

                                <div style={{ marginTop: 'auto', paddingTop: '16px', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                                    <span className="badge badge-neutral">
                                        <Package size={12} />
                                        {linkedProductsCount} {linkedProductsCount === 1 ? 'Produkt' : 'Produkte'}
                                    </span>
                                    {supplier.documents && supplier.documents.length > 0 && (
                                         <div style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>
                                             + {supplier.documents.length} Dokumente
                                         </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}

                {filteredSuppliers.length === 0 && (
                    <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '60px 20px', backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-xl)', border: '1px dashed var(--color-border)', color: 'var(--color-text-muted)' }}>
                        <Package size={48} style={{ margin: '0 auto 12px auto', opacity: 0.3 }} />
                        <h3 style={{ margin: '0 0 8px 0', color: 'var(--color-text-main)' }}>Keine Lieferanten gefunden.</h3>
                        <p style={{ margin: 0 }}>Überprüfe deinen Suchbegriff oder lege einen neuen Lieferanten an.</p>
                    </div>
                )}
            </div>

            {isModalOpen && (
                <div className="modal-overlay">
                    <div className="modal-box" style={{ maxWidth: '800px' }}>
                        <div className="modal-header">
                            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: 'var(--color-text-main)' }}>
                                {editingSupplier ? 'Lieferant bearbeiten' : 'Neuer Lieferant'}
                            </h2>
                            <button onClick={() => setIsModalOpen(false)} className="btn btn-ghost btn-icon">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="modal-body" style={{ backgroundColor: 'var(--color-background)' }}>
                            <form id="supplierForm" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-lg)' }}>

                                {/* Section: Stammdaten */}
                                <div style={{ backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', padding: 'var(--spacing-lg)', border: '1px solid var(--color-border)' }}>
                                    <p style={{ margin: '0 0 var(--spacing-md) 0', fontSize: 'var(--font-size-xs)', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Stammdaten</p>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                                        <div className="form-group">
                                            <label className="form-label">Firmenname *</label>
                                            <input type="text" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} className="input-field" required />
                                        </div>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                                            <div className="form-group">
                                                <label className="form-label">Ansprechpartner</label>
                                                <input type="text" value={formData.contactName || ''} onChange={e => setFormData({ ...formData, contactName: e.target.value })} className="input-field" />
                                            </div>
                                            <div className="form-group">
                                                <label className="form-label">Telefon</label>
                                                <input type="tel" value={formData.phone || ''} onChange={e => setFormData({ ...formData, phone: e.target.value })} className="input-field" />
                                            </div>
                                        </div>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                                            <div className="form-group">
                                                <label className="form-label">Email (Bestellung)</label>
                                                <input type="email" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} className="input-field" />
                                            </div>
                                            <div className="form-group">
                                                <label className="form-label">Webseite / Portal URL</label>
                                                <input type="text" value={formData.url || ''} onChange={e => setFormData({ ...formData, url: e.target.value })} className="input-field" placeholder="www.beispiel.de" />
                                            </div>
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">Kundennummer (bei diesem Lieferanten)</label>
                                            <input type="text" value={formData.customerNumber || ''} onChange={e => setFormData({ ...formData, customerNumber: e.target.value })} className="input-field" placeholder="z.B. Kd-Nr. 123456" />
                                        </div>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                                            <div className="form-group">
                                                <label className="form-label">Zahlungsart</label>
                                                <select value={formData.paymentMethod || ''} onChange={e => setFormData({ ...formData, paymentMethod: e.target.value })} className="input-field">
                                                    <option value="">Bitte wählen...</option>
                                                    <option value="Rechnung">Rechnung</option>
                                                    <option value="Lastschriftmandat / Bankeinzug">Lastschriftmandat / Bankeinzug</option>
                                                    <option value="Kreditkarte">Kreditkarte</option>
                                                    <option value="Vorkasse">Vorkasse</option>
                                                    <option value="PayPal">PayPal</option>
                                                    <option value="Barzahlung">Barzahlung</option>
                                                </select>
                                            </div>
                                            <div className="form-group">
                                                <label className="form-label">Standard Produktkategorie</label>
                                                {isCustomCategoryMode ? (
                                                    <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
                                                        <input
                                                            value={formData.defaultCategory || ''}
                                                            onChange={e => setFormData({ ...formData, defaultCategory: e.target.value })}
                                                            placeholder="Eigene..."
                                                            autoFocus
                                                            className="input-field"
                                                        />
                                                        <button type="button" onClick={() => { setIsCustomCategoryMode(false); setFormData({ ...formData, defaultCategory: undefined }); }} className="btn btn-ghost btn-icon"><X size={16} /></button>
                                                    </div>
                                                ) : (
                                                    <select
                                                        value={formData.defaultCategory || ''}
                                                        onChange={e => {
                                                            if (e.target.value === 'custom') { setIsCustomCategoryMode(true); setFormData({ ...formData, defaultCategory: '' }); }
                                                            else { setFormData({ ...formData, defaultCategory: e.target.value || undefined }); }
                                                        }}
                                                        className="input-field"
                                                    >
                                                        <option value="">-- Keine Vorgabe --</option>
                                                        <option value="Lebensmittel">Lebensmittel</option>
                                                        <option value="Getränke">Getränke</option>
                                                        <option value="Reinigung">Reinigung</option>
                                                        <option value="Büro">Büro</option>
                                                        <option value="Sonstiges">Sonstiges</option>
                                                        <option value="custom">Eigene eingeben...</option>
                                                    </select>
                                                )}
                                            </div>
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">Standard Bestellweg</label>
                                            <div style={{ display: 'flex', gap: 'var(--spacing-md)', flexWrap: 'wrap', backgroundColor: 'var(--color-surface-elevated)', padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                                                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                                                    <input type="radio" name="pom_supplier" value="email" checked={formData.preferredOrderMethod === 'email' || !formData.preferredOrderMethod} onChange={() => setFormData({ ...formData, preferredOrderMethod: 'email' })} /> <Mail size={14}/> Email
                                                </label>
                                                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                                                    <input type="radio" name="pom_supplier" value="webshop" checked={formData.preferredOrderMethod === 'webshop' || formData.preferredOrderMethod === 'link'} onChange={() => setFormData({ ...formData, preferredOrderMethod: 'webshop' })} /> <ExternalLink size={14}/> Webshop
                                                </label>
                                                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                                                    <input type="radio" name="pom_supplier" value="phone" checked={formData.preferredOrderMethod === 'phone'} onChange={() => setFormData({ ...formData, preferredOrderMethod: 'phone' })} /> <Phone size={14}/> Telefon
                                                </label>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Autopilot exclude */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', backgroundColor: 'var(--color-warning-bg)', padding: '12px var(--spacing-md)', borderRadius: 'var(--radius-md)', border: '1px solid #fcd34d' }}>
                                    <input type="checkbox" id="ignoreProposals" checked={!!formData.ignoreOrderProposals} onChange={e => setFormData({ ...formData, ignoreOrderProposals: e.target.checked })} style={{ width: '18px', height: '18px', cursor: 'pointer', flexShrink: 0 }} />
                                    <label htmlFor="ignoreProposals" style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: '#92400e', cursor: 'pointer' }}>
                                        Diesen Lieferanten aus allen Bestellvorschlägen ausschließen
                                    </label>
                                </div>

                                {/* Section: Portal Login — admin/owner only */}
                                {(userRole === 'owner' || userRole === 'admin') && (
                                <div style={{ backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', padding: 'var(--spacing-lg)', border: '1px solid var(--color-border)' }}>
                                    <p style={{ margin: '0 0 var(--spacing-md) 0', fontSize: 'var(--font-size-xs)', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <Key size={13} /> Kunden-Login / Portal
                                    </p>
                                    <div style={{ backgroundColor: 'var(--color-warning-bg)', border: '1px solid #fcd34d', borderRadius: 'var(--radius-md)', padding: '10px var(--spacing-md)', marginBottom: 'var(--spacing-md)', fontSize: 'var(--font-size-sm)', color: '#92400e' }}>
                                        ⚠️ Passwörter werden verschlüsselt gespeichert und sind nur für Inhaber und Administratoren sichtbar.
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                                        <div className="form-group">
                                            <label className="form-label">Benutzername / Kundennummer</label>
                                            <input type="text" value={formData.loginUsername || ''} onChange={e => setFormData({ ...formData, loginUsername: e.target.value })} className="input-field" placeholder="MaxMuster123" autoComplete="new-password" />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">Passwort</label>
                                            <div style={{ position: 'relative' }}>
                                                <input type={showPassword ? "text" : "password"} value={formData.loginPassword || ''} onChange={e => setFormData({ ...formData, loginPassword: e.target.value })} className="input-field" style={{ paddingRight: '40px' }} placeholder="••••••••" />
                                                <button type="button" onClick={() => setShowPassword(!showPassword)} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-faint)' }}>
                                                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                )}

                                {/* Section: Notizen */}
                                <div style={{ backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', padding: 'var(--spacing-lg)', border: '1px solid var(--color-border)' }}>
                                    <p style={{ margin: '0 0 var(--spacing-md) 0', fontSize: 'var(--font-size-xs)', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Notizen</p>
                                    <button type="button" onClick={() => setFormData({ ...formData, notes: [...(formData.notes || []), { id: generateId(), text: '', showOnOrderCreation: false, showOnOpenOrders: false }] })} className="btn btn-ghost btn-sm" style={{ width: '100%', marginBottom: 'var(--spacing-sm)' }}>+ Notiz hinzufügen</button>
                                    {(formData.notes || []).map((note, idx) => (
                                        <div key={note.id} style={{ marginBottom: 'var(--spacing-sm)', padding: 'var(--spacing-md)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--color-surface-elevated)' }}>
                                            <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                                                <textarea rows={2} value={note.text} onChange={e => { const updated = [...(formData.notes || [])]; updated[idx].text = e.target.value; setFormData({ ...formData, notes: updated }); }} placeholder="Wichtig zu wissen..." className="input-field" />
                                                <button type="button" onClick={() => setFormData({ ...formData, notes: (formData.notes || []).filter((_, i) => i !== idx) })} className="btn btn-ghost btn-icon" style={{ color: 'var(--color-danger)', flexShrink: 0 }}><X size={18} /></button>
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
                                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: 'var(--font-size-sm)' }}>
                                                    <input type="checkbox" checked={note.showOnOrderCreation} onChange={e => { const updated = [...(formData.notes || [])]; updated[idx].showOnOrderCreation = e.target.checked; setFormData({ ...formData, notes: updated }); }} />
                                                    Beim Anlegen einer Bestellung anzeigen
                                                </label>
                                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: 'var(--font-size-sm)' }}>
                                                    <input type="checkbox" checked={note.showOnOpenOrders} onChange={e => { const updated = [...(formData.notes || [])]; updated[idx].showOnOpenOrders = e.target.checked; setFormData({ ...formData, notes: updated }); }} />
                                                    Bei offenen Bestellungen anzeigen
                                                </label>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {/* Section: Produkt-Zuweisung */}
                                <div style={{ backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', padding: 'var(--spacing-lg)', border: '1px solid var(--color-border)' }}>
                                    <p style={{ margin: '0 0 4px 0', fontSize: 'var(--font-size-xs)', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                        Zugeordnete Produkte ({selectedProductIds.length})
                                    </p>
                                    <p style={{ margin: '0 0 var(--spacing-md) 0', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>Wähle die Produkte aus, die standardmäßig bei diesem Lieferanten bestellt werden sollen.</p>
                                    <div style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--color-surface-elevated)', padding: '8px' }}>
                                        {products.length === 0 ? (
                                            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--color-text-muted)' }}>Es existieren noch keine Produkte im Inventar.</div>
                                        ) : (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                {alreadyAssignedProducts.length > 0 && (
                                                    <div style={{ marginBottom: '8px' }}>
                                                        <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-text-faint)', padding: '4px 8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Bereits zugeordnet</div>
                                                        {alreadyAssignedProducts.map(p => (
                                                            <label key={p.id} style={{ display: 'flex', alignItems: 'center', padding: '8px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', backgroundColor: selectedProductIds.includes(p.id) ? '#eff6ff' : 'transparent' }}>
                                                                {selectedProductIds.includes(p.id) ? <CheckSquare size={18} color="var(--color-primary)" style={{ marginRight: '12px', flexShrink: 0 }} /> : <Square size={18} color="var(--color-border-strong)" style={{ marginRight: '12px', flexShrink: 0 }} />}
                                                                <input type="checkbox" checked={selectedProductIds.includes(p.id)} onChange={() => toggleProductSelection(p.id)} style={{ display: 'none' }} />
                                                                <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text-main)' }}>{p.name}{p.productNumber ? <span style={{ color: 'var(--color-text-faint)', fontSize: '12px' }}> ({p.productNumber})</span> : ''}</span>
                                                            </label>
                                                        ))}
                                                    </div>
                                                )}
                                                {unassignedProducts.length > 0 && (
                                                    <div style={{ marginBottom: '8px' }}>
                                                        <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-text-faint)', padding: '4px 8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Freie Produkte</div>
                                                        {unassignedProducts.map(p => (
                                                            <label key={p.id} style={{ display: 'flex', alignItems: 'center', padding: '8px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', backgroundColor: selectedProductIds.includes(p.id) ? '#eff6ff' : 'transparent' }}>
                                                                {selectedProductIds.includes(p.id) ? <CheckSquare size={18} color="var(--color-primary)" style={{ marginRight: '12px', flexShrink: 0 }} /> : <Square size={18} color="var(--color-border-strong)" style={{ marginRight: '12px', flexShrink: 0 }} />}
                                                                <input type="checkbox" checked={selectedProductIds.includes(p.id)} onChange={() => toggleProductSelection(p.id)} style={{ display: 'none' }} />
                                                                <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-main)' }}>{p.name}</span>
                                                            </label>
                                                        ))}
                                                    </div>
                                                )}
                                                {assignedToOthersProducts.length > 0 && (
                                                    <div>
                                                        <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-text-faint)', padding: '4px 8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Anderen Lieferanten zugeordnet</div>
                                                        {assignedToOthersProducts.map(p => {
                                                            const otherSupplier = suppliers.find(s => s.id === p.supplierId);
                                                            return (
                                                            <label key={p.id} style={{ display: 'flex', alignItems: 'center', padding: '8px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', backgroundColor: selectedProductIds.includes(p.id) ? '#eff6ff' : 'transparent' }}>
                                                                {selectedProductIds.includes(p.id) ? <CheckSquare size={18} color="var(--color-primary)" style={{ marginRight: '12px', flexShrink: 0 }} /> : <Square size={18} color="var(--color-border-strong)" style={{ marginRight: '12px', flexShrink: 0 }} />}
                                                                <input type="checkbox" checked={selectedProductIds.includes(p.id)} onChange={() => toggleProductSelection(p.id)} style={{ display: 'none' }} />
                                                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                                    <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-main)' }}>{p.name}</span>
                                                                    <span className="badge badge-warning" style={{ fontSize: '11px', marginTop: '2px', width: 'fit-content' }}>⚠️ Aktuell bei: {otherSupplier?.name || 'Unbekannt'}</span>
                                                                </div>
                                                            </label>
                                                        )})}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </form>
                        </div>

                        <div className="modal-footer">
                            <button type="button" onClick={() => setIsModalOpen(false)} disabled={isSubmitting} className="btn btn-ghost">Abbrechen</button>
                            <button type="submit" form="supplierForm" disabled={isSubmitting} className="btn btn-primary">
                                {isSubmitting ? 'Speichert…' : 'Speichern'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {supplierToDelete && (
                <div className="modal-overlay" style={{ zIndex: 1100 }}>
                    <div className="card" style={{ padding: '32px', maxWidth: '400px', width: '100%', textAlign: 'center' }}>
                        <div style={{ backgroundColor: 'var(--color-danger-bg)', width: '60px', height: '60px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px auto', color: 'var(--color-danger)' }}>
                            <AlertTriangle size={28} />
                        </div>
                        <h3 style={{ margin: '0 0 10px 0', fontSize: '19px', fontWeight: 700, color: 'var(--color-text-main)' }}>Lieferant löschen?</h3>
                        <p style={{ color: 'var(--color-text-muted)', marginBottom: '24px', fontSize: '14px', lineHeight: '1.6' }}>
                            Möchtest du <strong style={{ color: 'var(--color-text-main)' }}>{supplierToDelete.name}</strong> wirklich löschen? Zugeordnete Produkte verlieren ihren Lieferanten, bleiben aber im Inventar erhalten.
                        </p>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button onClick={() => setSupplierToDelete(null)} className="btn btn-ghost" style={{ flex: 1 }}>Abbrechen</button>
                            <button onClick={() => handleDelete(supplierToDelete.id)} className="btn btn-danger-solid" style={{ flex: 1 }}>Löschen</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
