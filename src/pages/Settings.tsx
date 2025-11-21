import React, { useState, useEffect } from 'react';
import { StorageService } from '../services/storage';
import { DataService } from '../services/data';
import { Save, Database, ArrowRight } from 'lucide-react';
import { getSupabaseClient } from '../services/supabase';

export const Settings: React.FC = () => {
    const [settings, setSettings] = useState({
        serviceId: '',
        templateId: '',
        publicKey: '',
        supabaseUrl: '',
        supabaseKey: ''
    });
    const [isMigrating, setIsMigrating] = useState(false);

    useEffect(() => {
        const stored = StorageService.getSettings();
        setSettings({
            serviceId: stored.serviceId,
            templateId: stored.templateId,
            publicKey: stored.publicKey,
            supabaseUrl: stored.supabaseUrl || '',
            supabaseKey: stored.supabaseKey || ''
        });
    }, []);

    const handleSave = (e: React.FormEvent) => {
        e.preventDefault();
        StorageService.saveSettings(settings);
        alert('Einstellungen gespeichert!');
        // Force reload to apply new Supabase settings to DataService
        window.location.reload();
    };

    const handleMigration = async () => {
        if (!settings.supabaseUrl || !settings.supabaseKey) {
            alert('Bitte zuerst Supabase konfigurieren und speichern.');
            return;
        }

        if (!window.confirm('Möchten Sie wirklich alle lokalen Daten in die Cloud (Supabase) kopieren?')) {
            return;
        }

        setIsMigrating(true);
        const supabase = getSupabaseClient();

        if (!supabase) {
            alert('Fehler: Supabase Client konnte nicht initialisiert werden.');
            setIsMigrating(false);
            return;
        }

        try {
            // 1. Get local data
            const localProducts = StorageService.getProducts();
            const localOrders = StorageService.getOrders();

            console.log(`Migrating ${localProducts.length} products and ${localOrders.length} orders...`);

            // 2. Upload Products
            const productsToUpload = localProducts.map(p => {
                // Map to DB format
                const dbProduct = DataService.toSupabaseProduct(p);
                // Handle ID: if it's a simple number (mock data), let Supabase generate a UUID.
                // If it's already a UUID (from previous edits), keep it.
                if (dbProduct.id.length < 10) {
                    const { id, ...rest } = dbProduct;
                    return rest;
                }
                return dbProduct;
            });

            if (productsToUpload.length > 0) {
                const { error: pError } = await supabase.from('products').upsert(productsToUpload);
                if (pError) throw pError;
            }

            // 3. Upload Orders
            const ordersToUpload = localOrders.map(o => {
                const dbOrder = DataService.toSupabaseOrder(o);
                if (dbOrder.id.length < 10) {
                    const { id, ...rest } = dbOrder;
                    return rest;
                }
                return dbOrder;
            });

            if (ordersToUpload.length > 0) {
                const { error: oError } = await supabase.from('orders').upsert(ordersToUpload);
                if (oError) throw oError;
            }

            alert('Daten erfolgreich migriert! Sie sind nun in der Cloud verfügbar.');
        } catch (error: any) {
            console.error('Migration error:', error);
            alert(`Fehler bei der Migration: ${error.message}`);
        } finally {
            setIsMigrating(false);
        }
    };

    return (
        <div style={{ maxWidth: '600px', margin: '0 auto' }}>
            <h2 style={{ fontSize: 'var(--font-size-2xl)', marginBottom: 'var(--spacing-xl)' }}>Einstellungen</h2>

            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-xl)' }}>

                {/* Supabase Section */}
                <div style={{
                    backgroundColor: 'var(--color-surface)',
                    padding: 'var(--spacing-lg)',
                    borderRadius: 'var(--radius-lg)',
                    boxShadow: 'var(--shadow-sm)',
                    border: '1px solid var(--color-primary)'
                }}>
                    <h3 style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)', marginTop: 0, color: 'var(--color-primary)' }}>
                        <Database size={20} />
                        Cloud Datenbank (Supabase)
                    </h3>
                    <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--spacing-md)' }}>
                        Verbinden Sie die App mit Supabase, um Daten online zu speichern und IoT Buttons zu nutzen.
                    </p>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontWeight: 500 }}>Project URL</label>
                            <input
                                type="text"
                                value={settings.supabaseUrl}
                                onChange={e => setSettings({ ...settings, supabaseUrl: e.target.value })}
                                placeholder="https://your-project.supabase.co"
                                style={{ width: '100%', padding: 'var(--spacing-sm)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontWeight: 500 }}>Anon Key</label>
                            <input
                                type="password"
                                value={settings.supabaseKey}
                                onChange={e => setSettings({ ...settings, supabaseKey: e.target.value })}
                                placeholder="your-anon-key"
                                style={{ width: '100%', padding: 'var(--spacing-sm)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}
                            />
                        </div>
                    </div>

                    {/* Migration Button */}
                    <div style={{ marginTop: 'var(--spacing-lg)', paddingTop: 'var(--spacing-lg)', borderTop: '1px solid var(--color-border)' }}>
                        <h4 style={{ margin: '0 0 var(--spacing-sm) 0' }}>Daten wiederherstellen / Migrieren</h4>
                        <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--spacing-md)' }}>
                            Kopieren Sie Ihre lokalen Produkte und Bestellungen in die Cloud. Nutzen Sie dies, wenn Ihre Liste nach der Verbindung leer ist.
                        </p>
                        <button
                            type="button"
                            onClick={handleMigration}
                            disabled={isMigrating}
                            style={{
                                backgroundColor: 'var(--color-secondary)',
                                color: 'white',
                                border: 'none',
                                padding: 'var(--spacing-sm) var(--spacing-md)',
                                borderRadius: 'var(--radius-md)',
                                cursor: isMigrating ? 'wait' : 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 'var(--spacing-sm)',
                                fontWeight: 500
                            }}
                        >
                            {isMigrating ? 'Kopiere...' : (
                                <>
                                    <ArrowRight size={18} />
                                    Lokale Daten nach Supabase kopieren
                                </>
                            )}
                        </button>
                    </div>
                </div>

                {/* EmailJS Section */}
                <div style={{
                    backgroundColor: 'var(--color-surface)',
                    padding: 'var(--spacing-lg)',
                    borderRadius: 'var(--radius-lg)',
                    boxShadow: 'var(--shadow-sm)'
                }}>
                    <h3 style={{ marginTop: 0 }}>EmailJS Konfiguration</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontWeight: 500 }}>Service ID</label>
                            <input
                                value={settings.serviceId}
                                onChange={e => setSettings({ ...settings, serviceId: e.target.value })}
                                style={{ width: '100%', padding: 'var(--spacing-sm)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontWeight: 500 }}>Template ID</label>
                            <input
                                value={settings.templateId}
                                onChange={e => setSettings({ ...settings, templateId: e.target.value })}
                                style={{ width: '100%', padding: 'var(--spacing-sm)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontWeight: 500 }}>Public Key</label>
                            <input
                                type="password"
                                value={settings.publicKey}
                                onChange={e => setSettings({ ...settings, publicKey: e.target.value })}
                                style={{ width: '100%', padding: 'var(--spacing-sm)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}
                            />
                        </div>
                    </div>
                </div>

                <button
                    type="submit"
                    style={{
                        backgroundColor: 'var(--color-primary)',
                        color: 'white',
                        border: 'none',
                        padding: 'var(--spacing-md)',
                        borderRadius: 'var(--radius-md)',
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        gap: 'var(--spacing-sm)',
                        fontWeight: 600,
                        fontSize: 'var(--font-size-lg)'
                    }}
                >
                    <Save size={20} />
                    Einstellungen speichern
                </button>
            </form>
        </div>
    );
};
