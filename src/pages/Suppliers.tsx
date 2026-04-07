import { generateId } from "../utils";
import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Mail, Phone, Search, X, AlertTriangle, Package, CheckSquare, Square, Globe, Key, Eye, EyeOff } from 'lucide-react';
import type { Supplier, Product } from '../types';
import { DataService } from '../services/data';
import { Notification, type NotificationType } from '../components/Notification';

export const Suppliers: React.FC = () => {
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    
    const [searchTerm, setSearchTerm] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
    const [supplierToDelete, setSupplierToDelete] = useState<Supplier | null>(null);
    const [notification, setNotification] = useState<{ message: string, type: NotificationType } | null>(null);

    // Form State
    const [formData, setFormData] = useState<Partial<Supplier>>({
        name: '', contactName: '', email: '', phone: '', url: '', notes: []
    });
    const [showPassword, setShowPassword] = useState(false);
    const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        loadData();
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

    const handleOpenModal = (supplier?: Supplier) => {
        setShowPassword(false);
        if (supplier) {
            setEditingSupplier(supplier);
            setFormData(supplier);
            setSelectedProductIds(products.filter(p => p.supplierId === supplier.id).map(p => p.id));
        } else {
            setEditingSupplier(null);
            setFormData({ name: '', contactName: '', email: '', phone: '', url: '', notes: [], documents: [] });
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
        try {
            if (!formData.name || !formData.email) {
                setNotification({ message: 'Name und Email sind Pflichtfelder.', type: 'error' });
                return;
            }

            setIsSubmitting(true);
            const targetSupplierId = editingSupplier ? editingSupplier.id : generateId();

            const supplierToSave: Supplier = {
                id: targetSupplierId,
                name: formData.name,
                contactName: formData.contactName,
                email: formData.email,
                phone: formData.phone,
                url: formData.url,
                notes: formData.notes || [],
                documents: formData.documents || []
            } as Supplier;

            await DataService.saveSupplier(supplierToSave);

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
        } catch (error) {
            console.error(error);
            setNotification({ message: 'Fehler beim Speichern.', type: 'error' });
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
        s.email.toLowerCase().includes(searchTerm.toLowerCase())
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

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-xl)' }}>
                <h2 style={{ fontSize: 'var(--font-size-2xl)', margin: 0, fontWeight: 700, color: 'var(--color-text-main)' }}>Lieferanten Netzwerk</h2>
                <button
                    onClick={() => handleOpenModal()}
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
                        fontWeight: 600,
                        boxShadow: 'var(--shadow-md)',
                        transition: 'transform 0.1s',
                    }}
                    onMouseOver={e => e.currentTarget.style.transform = 'translateY(-1px)'}
                    onMouseOut={e => e.currentTarget.style.transform = 'none'}
                >
                    <Plus size={20} /> Neuer Lieferant
                </button>
            </div>

            <div style={{ position: 'relative', marginBottom: 'var(--spacing-2xl)' }}>
                <Search size={22} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                <input
                    type="text"
                    placeholder="Lieferanten schnell finden..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    style={{
                        width: '100%',
                        padding: '14px 14px 14px 50px',
                        borderRadius: 'var(--radius-lg)',
                        border: '1px solid var(--color-border)',
                        fontSize: '16px',
                        backgroundColor: 'var(--color-surface)',
                        boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
                        transition: 'border-color 0.2s, box-shadow 0.2s',
                        outline: 'none'
                    }}
                    onFocus={e => {
                        e.target.style.borderColor = 'var(--color-primary)';
                        e.target.style.boxShadow = '0 0 0 3px rgba(37, 99, 235, 0.1)';
                    }}
                    onBlur={e => {
                        e.target.style.borderColor = 'var(--color-border)';
                        e.target.style.boxShadow = '0 1px 2px 0 rgba(0, 0, 0, 0.05)';
                    }}
                />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 'var(--spacing-xl)' }}>
                {filteredSuppliers.map(supplier => {
                    const linkedProductsCount = products.filter(p => p.supplierId === supplier.id).length;

                    return (
                        <div key={supplier.id} style={{
                            backgroundColor: 'var(--color-surface)',
                            borderRadius: 'var(--radius-xl)',
                            boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
                            display: 'flex',
                            flexDirection: 'column',
                            overflow: 'hidden',
                            border: '1px solid #e2e8f0',
                            transition: 'transform 0.2s ease, box-shadow 0.2s ease'
                        }}
                        onMouseOver={e => {
                            e.currentTarget.style.transform = 'translateY(-2px)';
                            e.currentTarget.style.boxShadow = '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)';
                        }}
                        onMouseOut={e => {
                            e.currentTarget.style.transform = 'none';
                            e.currentTarget.style.boxShadow = '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)';
                        }}>
                            {/* Header */}
                            <div style={{ padding: 'var(--spacing-lg) var(--spacing-xl)', borderBottom: '1px solid var(--color-border)', backgroundColor: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                <div>
                                    <h3 style={{ margin: '0 0 4px 0', fontSize: '18px', color: 'var(--color-text-main)' }}>{supplier.name}</h3>
                                    {supplier.contactName && (
                                        <div style={{ fontSize: '13px', color: '#64748b', fontWeight: 500 }}>👤 {supplier.contactName}</div>
                                    )}
                                </div>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <button onClick={() => handleOpenModal(supplier)} style={{ padding: '8px', borderRadius: '50%', backgroundColor: 'white', border: '1px solid #cbd5e1', color: '#475569', cursor: 'pointer', transition: 'all 0.2s' }} onMouseOver={e => {e.currentTarget.style.borderColor = 'var(--color-primary)'; e.currentTarget.style.color = 'var(--color-primary)';}} onMouseOut={e => {e.currentTarget.style.borderColor = '#cbd5e1'; e.currentTarget.style.color = '#475569';}} title="Bearbeiten">
                                        <Edit2 size={16} />
                                    </button>
                                    <button onClick={() => setSupplierToDelete(supplier)} style={{ padding: '8px', borderRadius: '50%', backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#ef4444', cursor: 'pointer', transition: 'all 0.2s' }} onMouseOver={e => {e.currentTarget.style.backgroundColor = '#fee2e2';}} onMouseOut={e => {e.currentTarget.style.backgroundColor = '#fef2f2';}} title="Löschen">
                                        <Trash2 size={16} />
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
                                    <a href={`tel:${supplier.phone}`} style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#475569', textDecoration: 'none', fontSize: '14px', padding: '8px', borderRadius: 'var(--radius-md)', transition: 'background-color 0.2s' }} onMouseOver={e => e.currentTarget.style.backgroundColor = '#f1f5f9'}  onMouseOut={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                                        <div style={{ padding: '6px', backgroundColor: '#dcfce7', color: '#16a34a', borderRadius: '50%' }}><Phone size={14} /></div>
                                        {supplier.phone}
                                    </a>
                                )}

                                {supplier.url && (
                                    <a href={/^https?:\/\//i.test(supplier.url) ? supplier.url : `https://${supplier.url}`} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#475569', textDecoration: 'none', fontSize: '14px', padding: '8px', borderRadius: 'var(--radius-md)', transition: 'background-color 0.2s' }} onMouseOver={e => e.currentTarget.style.backgroundColor = '#f1f5f9'}  onMouseOut={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                                        <div style={{ padding: '6px', backgroundColor: '#fef3c7', color: '#d97706', borderRadius: '50%' }}><Globe size={14} /></div>
                                        {supplier.url.replace(/^https?:\/\//i, '').replace(/\/$/, '')}
                                    </a>
                                )}

                                <div style={{ marginTop: 'auto', paddingTop: '16px', display: 'flex', gap: '12px', alignItems: 'center' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#f1f5f9', padding: '6px 12px', borderRadius: '9999px', fontSize: '13px', fontWeight: 600, color: '#475569' }}>
                                        <Package size={14} />
                                        {linkedProductsCount} {linkedProductsCount === 1 ? 'Produkt' : 'Produkte'}
                                    </div>
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
                    <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '60px 20px', backgroundColor: 'white', borderRadius: 'var(--radius-xl)', border: '1px dashed #cbd5e1', color: '#64748b' }}>
                        <Package size={48} style={{ margin: '0 auto 12px auto', opacity: 0.3 }} />
                        <h3 style={{ margin: '0 0 8px 0', color: 'var(--color-text-main)' }}>Keine Lieferanten gefunden.</h3>
                        <p style={{ margin: 0 }}>Überprüfe deinen Suchbegriff oder lege einen neuen Lieferanten an.</p>
                    </div>
                )}
            </div>

            {isModalOpen && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(4px)',
                    display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: '20px'
                }}>
                    <div style={{
                        backgroundColor: 'var(--color-surface)',
                        borderRadius: 'var(--radius-xl)',
                        width: '100%',
                        maxWidth: '800px',
                        maxHeight: '90vh',
                        display: 'flex',
                        flexDirection: 'column',
                        boxShadow: '0 25px 50px -12px rgb(0 0 0 / 0.25)'
                    }}>
                        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f8fafc', borderTopLeftRadius: 'var(--radius-xl)', borderTopRightRadius: 'var(--radius-xl)' }}>
                            <h2 style={{ margin: 0, fontSize: '20px', color: 'var(--color-text-main)' }}>{editingSupplier ? 'Lieferant bearbeiten' : 'Neuer Lieferant'}</h2>
                            <button onClick={() => setIsModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: '#64748b' }}>
                                <X size={24} />
                            </button>
                        </div>

                        <div style={{ padding: '24px', overflowY: 'auto', flex: 1, backgroundColor: 'white' }}>
                            <form id="supplierForm" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                
                                {/* Stammdaten Section */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                    <h3 style={{ margin: '0 0 4px 0', fontSize: '15px', textTransform: 'uppercase', color: '#94a3b8', letterSpacing: '0.05em' }}>Stammdaten</h3>
                                    
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, fontSize: '14px', color: 'var(--color-text-main)' }}>Firmenname *</label>
                                        <input type="text" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '15px' }} required />
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px' }}>
                                        <div>
                                            <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, fontSize: '14px', color: 'var(--color-text-main)' }}>Ansprechpartner</label>
                                            <input type="text" value={formData.contactName || ''} onChange={e => setFormData({ ...formData, contactName: e.target.value })} style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '15px' }} />
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, fontSize: '14px', color: 'var(--color-text-main)' }}>Telefon</label>
                                            <input type="tel" value={formData.phone || ''} onChange={e => setFormData({ ...formData, phone: e.target.value })} style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '15px' }} />
                                        </div>
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px' }}>
                                        <div>
                                            <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, fontSize: '14px', color: 'var(--color-text-main)' }}>Email Adresse (Bestellung) *</label>
                                            <input type="email" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '15px' }} required />
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, fontSize: '14px', color: 'var(--color-text-main)' }}>Webseite / Login-Portal URL</label>
                                            <input type="url" value={formData.url || ''} onChange={e => setFormData({ ...formData, url: e.target.value })} style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '15px' }} placeholder="https://" />
                                        </div>
                                    </div>
                                </div>

                                <div style={{ height: '1px', backgroundColor: 'var(--color-border)', margin: '8px 0' }}></div>

                                {/* Portal Login Infos */}
                                <div>
                                    <h3 style={{ margin: '0 0 16px 0', fontSize: '15px', textTransform: 'uppercase', color: '#94a3b8', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <Key size={16} /> Kunden-Login / Portal
                                    </h3>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                        <div style={{ gridColumn: '1 / -1' }}>
                                            <label style={{ display: 'block', marginBottom: '6px', fontSize: '14px', fontWeight: 600, color: '#475569' }}>Portal / Shop Webadresse (Optional)</label>
                                            <input type="url" value={formData.loginUrl || ''} onChange={e => setFormData({ ...formData, loginUrl: e.target.value })} style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '15px' }} placeholder="https://shop.lieferant.de/login" />
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', marginBottom: '6px', fontSize: '14px', fontWeight: 600, color: '#475569' }}>Benutzername / Kundennummer</label>
                                            <input type="text" value={formData.loginUsername || ''} onChange={e => setFormData({ ...formData, loginUsername: e.target.value })} style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '15px' }} placeholder="MaxMuster123" />
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', marginBottom: '6px', fontSize: '14px', fontWeight: 600, color: '#475569' }}>Passwort</label>
                                            <div style={{ position: 'relative' }}>
                                                <input type={showPassword ? "text" : "password"} value={formData.loginPassword || ''} onChange={e => setFormData({ ...formData, loginPassword: e.target.value })} style={{ width: '100%', padding: '10px 40px 10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '15px' }} placeholder="••••••••" />
                                                <button type="button" onClick={() => setShowPassword(!showPassword)} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}>
                                                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                
                                <div style={{ height: '1px', backgroundColor: 'var(--color-border)', margin: '8px 0' }}></div>

                                {/* Zusatz-Infos / Notizen */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                    <h3 style={{ margin: '0', fontSize: '15px', textTransform: 'uppercase', color: '#94a3b8', letterSpacing: '0.05em' }}>Zusatz-Infos & Notizen</h3>
                                    
                                    <div>
                                        <button type="button" onClick={() => setFormData({ ...formData, notes: [...(formData.notes || []), { id: generateId(), text: '', showOnOrderCreation: false, showOnOpenOrders: false }] })} style={{ background: '#f8fafc', border: '1px dashed #cbd5e1', color: 'var(--color-primary)', fontSize: '14px', fontWeight: 600, cursor: 'pointer', padding: '10px', borderRadius: '8px', width: '100%' }}>+ Notiz hinzufügen</button>
                                        
                                        {(formData.notes || []).map((note, idx) => (
                                            <div key={note.id} style={{ marginTop: '12px', padding: '12px', border: '1px solid #e2e8f0', borderRadius: '8px', backgroundColor: '#f8fafc' }}>
                                                <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                                                    <textarea rows={2} value={note.text} onChange={e => { const updated = [...(formData.notes || [])]; updated[idx].text = e.target.value; setFormData({ ...formData, notes: updated }); }} placeholder="Wichtig zu wissen..." style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontFamily: 'inherit' }} />
                                                    <button type="button" onClick={() => setFormData({ ...formData, notes: (formData.notes || []).filter((_, i) => i !== idx) })} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px' }}><X size={18} /></button>
                                                </div>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px', padding: '12px', backgroundColor: 'white', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                                                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                                        <input type="checkbox" checked={note.showOnOrderCreation} onChange={e => { const updated = [...(formData.notes || [])]; updated[idx].showOnOrderCreation = e.target.checked; setFormData({ ...formData, notes: updated }); }} />
                                                        <span style={{ fontSize: '13px', color: '#475569', fontWeight: 500 }}>Beim Anlegen einer Bestellung anzeigen</span>
                                                    </label>
                                                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                                        <input type="checkbox" checked={note.showOnOpenOrders} onChange={e => { const updated = [...(formData.notes || [])]; updated[idx].showOnOpenOrders = e.target.checked; setFormData({ ...formData, notes: updated }); }} />
                                                        <span style={{ fontSize: '13px', color: '#475569', fontWeight: 500 }}>Bei offenen Bestellungen anzeigen</span>
                                                    </label>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div style={{ height: '1px', backgroundColor: 'var(--color-border)', margin: '8px 0' }}></div>

                                {/* Produkt Zuweisung Section */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                    <div>
                                        <h3 style={{ margin: '0 0 4px 0', fontSize: '15px', textTransform: 'uppercase', color: '#94a3b8', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            Zugeordnete Produkte ({selectedProductIds.length})
                                        </h3>
                                        <p style={{ margin: '0 0 12px 0', fontSize: '13px', color: 'var(--color-text-muted)' }}>Wähle die Produkte aus, die standardmäßig bei diesem Lieferanten bestellt werden sollen.</p>
                                    </div>

                                    <div style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px', backgroundColor: '#f8fafc', padding: '8px' }}>
                                        {products.length === 0 ? (
                                            <div style={{ padding: '20px', textAlign: 'center', color: '#64748b' }}>Es existieren noch keine Produkte im Inventar.</div>
                                        ) : (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                {/* Group: Already assigned to this supplier */}
                                                {alreadyAssignedProducts.length > 0 && (
                                                    <div style={{ marginBottom: '8px' }}>
                                                        <div style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8', padding: '4px 8px' }}>BEREITS ZUGEORDNET</div>
                                                        {alreadyAssignedProducts.map(p => (
                                                            <label key={p.id} style={{ display: 'flex', alignItems: 'center', padding: '8px', borderRadius: '6px', cursor: 'pointer', transition: 'background-color 0.2s', backgroundColor: selectedProductIds.includes(p.id) ? '#eff6ff' : 'transparent' }} onMouseOver={e => {if(!selectedProductIds.includes(p.id)) e.currentTarget.style.backgroundColor = '#f1f5f9'}} onMouseOut={e => {if(!selectedProductIds.includes(p.id)) e.currentTarget.style.backgroundColor = 'transparent'}}>
                                                                {selectedProductIds.includes(p.id) ? <CheckSquare size={18} color="var(--color-primary)" style={{ marginRight: '12px' }} /> : <Square size={18} color="#cbd5e1" style={{ marginRight: '12px' }} />}
                                                                <input type="checkbox" checked={selectedProductIds.includes(p.id)} onChange={() => toggleProductSelection(p.id)} style={{ display: 'none' }} />
                                                                <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--color-text-main)' }}>{p.name} {p.productNumber ? <span style={{ color: '#94a3b8', fontSize: '12px' }}>({p.productNumber})</span> : ''}</span>
                                                            </label>
                                                        ))}
                                                    </div>
                                                )}

                                                {/* Group: Unassigned */}
                                                {unassignedProducts.length > 0 && (
                                                    <div style={{ marginBottom: '8px' }}>
                                                        <div style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8', padding: '4px 8px' }}>FREIE PRODUKTE</div>
                                                        {unassignedProducts.map(p => (
                                                            <label key={p.id} style={{ display: 'flex', alignItems: 'center', padding: '8px', borderRadius: '6px', cursor: 'pointer', transition: 'background-color 0.2s', backgroundColor: selectedProductIds.includes(p.id) ? '#eff6ff' : 'transparent' }} onMouseOver={e => {if(!selectedProductIds.includes(p.id)) e.currentTarget.style.backgroundColor = '#f1f5f9'}} onMouseOut={e => {if(!selectedProductIds.includes(p.id)) e.currentTarget.style.backgroundColor = 'transparent'}}>
                                                                {selectedProductIds.includes(p.id) ? <CheckSquare size={18} color="var(--color-primary)" style={{ marginRight: '12px' }} /> : <Square size={18} color="#cbd5e1" style={{ marginRight: '12px' }} />}
                                                                <input type="checkbox" checked={selectedProductIds.includes(p.id)} onChange={() => toggleProductSelection(p.id)} style={{ display: 'none' }} />
                                                                <span style={{ fontSize: '14px', fontWeight: 400, color: 'var(--color-text-main)' }}>{p.name}</span>
                                                            </label>
                                                        ))}
                                                    </div>
                                                )}

                                                {/* Group: Assigned to Others */}
                                                {assignedToOthersProducts.length > 0 && (
                                                    <div>
                                                        <div style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8', padding: '4px 8px' }}>ANDEREN LIEFERANTEN ZUGEORDNET</div>
                                                        {assignedToOthersProducts.map(p => {
                                                            const otherSupplier = suppliers.find(s => s.id === p.supplierId);
                                                            return (
                                                            <label key={p.id} style={{ display: 'flex', alignItems: 'center', padding: '8px', borderRadius: '6px', cursor: 'pointer', transition: 'background-color 0.2s', backgroundColor: selectedProductIds.includes(p.id) ? '#eff6ff' : 'transparent' }} onMouseOver={e => {if(!selectedProductIds.includes(p.id)) e.currentTarget.style.backgroundColor = '#f1f5f9'}} onMouseOut={e => {if(!selectedProductIds.includes(p.id)) e.currentTarget.style.backgroundColor = 'transparent'}}>
                                                                {selectedProductIds.includes(p.id) ? <CheckSquare size={18} color="var(--color-primary)" style={{ marginRight: '12px' }} /> : <Square size={18} color="#cbd5e1" style={{ marginRight: '12px' }} />}
                                                                <input type="checkbox" checked={selectedProductIds.includes(p.id)} onChange={() => toggleProductSelection(p.id)} style={{ display: 'none' }} />
                                                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                                    <span style={{ fontSize: '14px', fontWeight: 400, color: 'var(--color-text-main)' }}>{p.name}</span>
                                                                    <span style={{ fontSize: '12px', color: '#f59e0b', fontWeight: 500 }}>
                                                                        ⚠️ Aktuell bei: {otherSupplier?.name || 'Unbekannt'}
                                                                    </span>
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

                        <div style={{ padding: '20px 24px', borderTop: '1px solid var(--color-border)', backgroundColor: '#f8fafc', borderBottomLeftRadius: 'var(--radius-xl)', borderBottomRightRadius: 'var(--radius-xl)', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                            <button type="button" onClick={() => setIsModalOpen(false)} disabled={isSubmitting} style={{ padding: '10px 20px', borderRadius: '8px', border: '1px solid #cbd5e1', backgroundColor: 'white', cursor: 'pointer', fontSize: '15px', color: '#475569', fontWeight: 500 }}>Abbrechen</button>
                            <button type="submit" form="supplierForm" disabled={isSubmitting} style={{ padding: '10px 24px', borderRadius: '8px', border: 'none', backgroundColor: 'var(--color-primary)', color: 'white', cursor: 'pointer', fontWeight: 600, fontSize: '15px', opacity: isSubmitting ? 0.7 : 1 }}>
                                {isSubmitting ? 'Speichert...' : 'Speichern'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {supplierToDelete && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(4px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1100, padding: '20px' }}>
                    <div style={{ backgroundColor: 'white', padding: '32px', borderRadius: 'var(--radius-xl)', maxWidth: '400px', width: '100%', boxShadow: '0 25px 50px -12px rgb(0 0 0 / 0.25)', textAlign: 'center' }}>
                        <div style={{ backgroundColor: '#fef2f2', width: '64px', height: '64px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px auto', color: '#ef4444' }}>
                            <AlertTriangle size={32} />
                        </div>
                        <h3 style={{ margin: '0 0 12px 0', fontSize: '20px', color: 'var(--color-text-main)' }}>Lieferant löschen?</h3>
                        <p style={{ color: '#64748b', marginBottom: '24px', fontSize: '15px', lineHeight: '1.5' }}>Möchtest du <strong>{supplierToDelete.name}</strong> wirklich löschen? Zugeordnete Produkte verlieren dadurch ihren Lieferanten, bleiben aber im Inventar erhalten.</p>
                        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                            <button onClick={() => setSupplierToDelete(null)} style={{ padding: '10px 20px', borderRadius: '8px', border: '1px solid #cbd5e1', backgroundColor: 'white', cursor: 'pointer', fontWeight: 500, flex: 1 }}>Abbrechen</button>
                            <button onClick={() => handleDelete(supplierToDelete.id)} style={{ padding: '10px 20px', borderRadius: '8px', border: 'none', backgroundColor: '#ef4444', color: 'white', cursor: 'pointer', fontWeight: 600, flex: 1 }}>Löschen</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
