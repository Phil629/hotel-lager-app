import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Mail, Phone, Search, X } from 'lucide-react';
import type { Supplier } from '../types';
import { DataService } from '../services/data';
import { Notification, type NotificationType } from '../components/Notification';

export const Suppliers: React.FC = () => {
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
    const [notification, setNotification] = useState<{ message: string, type: NotificationType } | null>(null);

    // Form State
    const [formData, setFormData] = useState<Partial<Supplier>>({
        name: '',
        contactName: '',
        email: '',
        phone: '',
        phone: '',
        url: '',
        notes: ''
    });

    useEffect(() => {
        loadSuppliers();
    }, []);

    useEffect(() => {
        if (notification) {
            const timer = setTimeout(() => setNotification(null), 3000);
            return () => clearTimeout(timer);
        }
    }, [notification]);

    const loadSuppliers = async () => {
        const data = await DataService.getSuppliers();
        setSuppliers(data);
    };

    const handleOpenModal = (supplier?: Supplier) => {
        if (supplier) {
            setEditingSupplier(supplier);
            setFormData(supplier);
        } else {
            setEditingSupplier(null);
            setFormData({
                name: '',
                contactName: '',
                email: '',
                phone: '',
                phone: '',
                url: '',
                notes: ''
            });
        }
        setIsModalOpen(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            if (!formData.name || !formData.email) {
                setNotification({ message: 'Name und Email sind Pflichtfelder.', type: 'error' });
                return;
            }

            const supplierToSave: Supplier = {
                id: editingSupplier ? editingSupplier.id : crypto.randomUUID(),
                name: formData.name,
                contactName: formData.contactName,
                email: formData.email,
                phone: formData.phone,
                phone: formData.phone,
                url: formData.url,
                notes: formData.notes
            } as Supplier;

            await DataService.saveSupplier(supplierToSave);
            setNotification({
                message: editingSupplier ? 'Lieferant aktualisiert!' : 'Lieferant erstellt!',
                type: 'success'
            });
            setIsModalOpen(false);
            loadSuppliers();
        } catch (error) {
            console.error(error);
            setNotification({ message: 'Fehler beim Speichern.', type: 'error' });
        }
    };

    const handleDelete = async (id: string) => {
        if (window.confirm('Soll dieser Lieferant wirklich gelöscht werden?')) {
            try {
                await DataService.deleteSupplier(id);
                setNotification({ message: 'Lieferant gelöscht.', type: 'success' });
                loadSuppliers();
            } catch (error) {
                console.error(error);
                setNotification({ message: 'Fehler beim Löschen.', type: 'error' });
            }
        }
    };

    const filteredSuppliers = suppliers.filter(s =>
        s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.email.toLowerCase().includes(searchTerm.toLowerCase())
    );

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
                <h2 style={{ fontSize: 'var(--font-size-2xl)', margin: 0 }}>Lieferanten</h2>
                <div style={{ display: 'flex', gap: 'var(--spacing-md)' }}>
                    <div style={{ position: 'relative' }}>
                        <Search size={20} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                        <input
                            type="text"
                            placeholder="Suchen..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            style={{
                                padding: '10px 10px 10px 40px',
                                borderRadius: 'var(--radius-md)',
                                border: '1px solid var(--color-border)',
                                width: '250px'
                            }}
                        />
                    </div>
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
                            fontWeight: 500,
                            boxShadow: 'var(--shadow-md)'
                        }}
                    >
                        <Plus size={20} /> Neuer Lieferant
                    </button>
                </div>
            </div>

            <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                {filteredSuppliers.map(supplier => (
                    <div key={supplier.id} style={{
                        backgroundColor: 'var(--color-surface)',
                        padding: 'var(--spacing-lg)',
                        borderRadius: 'var(--radius-lg)',
                        boxShadow: 'var(--shadow-sm)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                    }}>
                        <div>
                            <h3 style={{ margin: '0 0 var(--spacing-xs) 0', fontSize: 'var(--font-size-lg)' }}>{supplier.name}</h3>
                            <div style={{ display: 'flex', gap: 'var(--spacing-lg)', color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <Mail size={14} /> {supplier.email}
                                </span>
                                {supplier.phone && (
                                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <Phone size={14} /> {supplier.phone}
                                    </span>
                                )}
                                {supplier.contactName && (
                                    <span>Kontakt: {supplier.contactName}</span>
                                )}
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
                            <button
                                onClick={() => handleOpenModal(supplier)}
                                style={{
                                    padding: '8px',
                                    borderRadius: 'var(--radius-md)',
                                    border: '1px solid var(--color-border)',
                                    backgroundColor: 'transparent',
                                    cursor: 'pointer',
                                    color: 'var(--color-text-main)'
                                }}
                            >
                                <Edit2 size={16} />
                            </button>
                            <button
                                onClick={() => handleDelete(supplier.id)}
                                style={{
                                    padding: '8px',
                                    borderRadius: 'var(--radius-md)',
                                    border: '1px solid #ffe0e0',
                                    backgroundColor: '#fff5f5',
                                    cursor: 'pointer',
                                    color: '#e53935'
                                }}
                            >
                                <Trash2 size={16} />
                            </button>
                        </div>
                    </div>
                ))}

                {filteredSuppliers.length === 0 && (
                    <div style={{ textAlign: 'center', padding: 'var(--spacing-2xl)', color: 'var(--color-text-muted)' }}>
                        Keine Lieferanten gefunden.
                    </div>
                )}
            </div>

            {isModalOpen && (
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
                        maxWidth: '500px',
                        maxHeight: '90vh',
                        overflowY: 'auto',
                        boxShadow: 'var(--shadow-lg)'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-lg)' }}>
                            <h3 style={{ margin: 0 }}>{editingSupplier ? 'Lieferant bearbeiten' : 'Neuer Lieferant'}</h3>
                            <button onClick={() => setIsModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                                <X size={24} />
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                            <div>
                                <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontWeight: 500 }}>Firmenname *</label>
                                <input
                                    type="text"
                                    value={formData.name}
                                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                                    style={{ width: '100%', padding: '8px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}
                                    required
                                />
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                                <div>
                                    <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontWeight: 500 }}>Ansprechpartner</label>
                                    <input
                                        type="text"
                                        value={formData.contactName || ''}
                                        onChange={e => setFormData({ ...formData, contactName: e.target.value })}
                                        style={{ width: '100%', padding: '8px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontWeight: 500 }}>Telefon</label>
                                    <input
                                        type="tel"
                                        value={formData.phone || ''}
                                        onChange={e => setFormData({ ...formData, phone: e.target.value })}
                                        style={{ width: '100%', padding: '8px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}
                                    />
                                </div>
                            </div>

                            <div>
                                <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontWeight: 500 }}>Email Adresse (Bestellung) *</label>
                                <input
                                    type="email"
                                    value={formData.email}
                                    onChange={e => setFormData({ ...formData, email: e.target.value })}
                                    style={{ width: '100%', padding: '8px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}
                                    required
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontWeight: 500 }}>Webseite / Link</label>
                                <input
                                    type="url"
                                    value={formData.url || ''}
                                    onChange={e => setFormData({ ...formData, url: e.target.value })}
                                    style={{ width: '100%', padding: '8px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}
                                    placeholder="https://"
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontWeight: 500 }}>Notizen</label>
                                <textarea
                                    value={formData.notes || ''}
                                    onChange={e => setFormData({ ...formData, notes: e.target.value })}
                                    style={{ width: '100%', padding: '8px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', minHeight: '80px', fontFamily: 'inherit' }}
                                    placeholder="Interne Notizen zum Lieferanten..."
                                />
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--spacing-md)', marginTop: 'var(--spacing-lg)' }}>
                                <button
                                    type="button"
                                    onClick={() => setIsModalOpen(false)}
                                    style={{
                                        padding: '10px 20px',
                                        borderRadius: 'var(--radius-md)',
                                        border: '1px solid var(--color-border)',
                                        backgroundColor: 'white',
                                        cursor: 'pointer'
                                    }}
                                >
                                    Abbrechen
                                </button>
                                <button
                                    type="submit"
                                    style={{
                                        padding: '10px 20px',
                                        borderRadius: 'var(--radius-md)',
                                        border: 'none',
                                        backgroundColor: 'var(--color-primary)',
                                        color: 'white',
                                        cursor: 'pointer',
                                        fontWeight: 500
                                    }}
                                >
                                    Speichern
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};
