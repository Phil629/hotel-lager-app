import React, { useState, useEffect, useRef } from 'react';
import { StorageService } from '../services/storage';
import { DataService } from '../services/data';
import { Save, Database, ArrowRight, Upload, Building2, Mail, Settings as SettingsIcon, Check } from 'lucide-react';
import { getSupabaseClient } from '../services/supabase';
import { Notification, type NotificationType } from '../components/Notification';
import type { AppSettings } from '../types';

export const Settings: React.FC = () => {
    const [settings, setSettings] = useState<AppSettings>({
        serviceId: '',
        templateId: '',
        publicKey: '',
        supabaseUrl: '',
        supabaseKey: '',
        enableStockManagement: true,
        inventoryMode: false,
        hotelName: 'Mein Hotel',
        currency: 'EUR',
        currentPlan: 'pro',
        developerMode: false,
        logoUrl: ''
    });
    const [isMigrating, setIsMigrating] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [notification, setNotification] = useState<{ message: string, type: NotificationType } | null>(null);
    const devClickCount = useRef(0);
    const devTimeout = useRef<number | null>(null);

    useEffect(() => {
        const stored = StorageService.getSettings();
        setSettings({
            serviceId: stored.serviceId || '',
            templateId: stored.templateId || '',
            publicKey: stored.publicKey || '',
            supabaseUrl: stored.supabaseUrl || '',
            supabaseKey: stored.supabaseKey || '',
            enableStockManagement: stored.enableStockManagement ?? true,
            inventoryMode: stored.inventoryMode ?? false,
            hotelName: stored.hotelName || 'Mein Hotel',
            currency: stored.currency || 'EUR',
            currentPlan: stored.currentPlan || 'pro',
            developerMode: stored.developerMode || false,
            logoUrl: stored.logoUrl || ''
        });
    }, []);

    const handleSave = (e: React.FormEvent) => {
        e.preventDefault();
        StorageService.saveSettings(settings);
        setNotification({ message: 'Einstellungen erfolgreich gespeichert!', type: 'success' });
        // Give time for toast before reload
        setTimeout(() => window.location.reload(), 1500);
    };

    const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || e.target.files.length === 0) return;
        const file = e.target.files[0];
        setIsUploading(true);

        try {
            // First try uploading to Supabase (using existing supplier-documents bucket for now to avoid RLS/Bucket missing errors)
            const publicUrl = await DataService.uploadFile(file, 'supplier-documents');
            if (publicUrl) {
                setSettings({ ...settings, logoUrl: publicUrl });
                setNotification({ message: 'Logo erfolgreich hochgeladen.', type: 'success' });
                return;
            }
        } catch (uploadError) {
            console.log("Supabase upload failed, falling back to local base64", uploadError);
        } finally {
            setIsUploading(false);
        }

        // Fallback to Base64 if no Supabase or bucket missing
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64String = reader.result as string;
            setSettings({ ...settings, logoUrl: base64String });
            setIsUploading(false);
            setNotification({ message: 'Logo lokal gespeichert.', type: 'success' });
        };
        reader.readAsDataURL(file);
    };

    const triggerDevMode = () => {
        devClickCount.current += 1;
        if (devTimeout.current) clearTimeout(devTimeout.current);
        
        devTimeout.current = window.setTimeout(() => {
            devClickCount.current = 0;
        }, 3000);

        if (devClickCount.current >= 5) {
            setSettings(s => ({ ...s, developerMode: !s.developerMode }));
            setNotification({ message: settings.developerMode ? 'Developer Mode deaktiviert' : 'Developer Mode aktiviert!', type: 'success' });
            devClickCount.current = 0;
        }
    };

    const handleMigration = async () => {
        if (!settings.supabaseUrl || !settings.supabaseKey) {
            setNotification({ message: 'Bitte zuerst Supabase konfigurieren und speichern.', type: 'error' });
            return;
        }

        if (!window.confirm('Möchten Sie wirklich alle lokalen Daten in die Cloud kopieren?')) {
            return;
        }

        setIsMigrating(true);
        const supabase = getSupabaseClient();

        if (!supabase) {
            setNotification({ message: 'Fehler: Supabase Client konnte nicht initialisiert werden.', type: 'error' });
            setIsMigrating(false);
            return;
        }

        try {
            const localSuppliers = StorageService.getSuppliers();
            const localProducts = StorageService.getProducts();
            const localOrders = StorageService.getOrders();

            const suppliersToUpload = localSuppliers.map(s => DataService.toSupabaseSupplier(s));
            if (suppliersToUpload.length > 0) {
                const { error: sError } = await supabase.from('suppliers').upsert(suppliersToUpload);
                if (sError) throw sError;
            }

            const productsToUpload = localProducts.map(p => {
                const dbProduct = DataService.toSupabaseProduct(p);
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

            setNotification({ message: 'Daten erfolgreich migriert!', type: 'success' });
        } catch (error: any) {
            console.error('Migration error:', error);
            setNotification({ message: `Fehler bei der Migration: ${error.message}`, type: 'error' });
        } finally {
            setIsMigrating(false);
        }
    };

    const SectionCard = ({ children }: { children: React.ReactNode }) => (
        <div style={{
            backgroundColor: 'var(--color-surface)',
            padding: 'var(--spacing-xl)',
            borderRadius: 'var(--radius-xl)',
            boxShadow: 'var(--shadow-md)',
            border: '1px solid var(--color-border)',
            marginBottom: 'var(--spacing-lg)'
        }}>
            {children}
        </div>
    );

    return (
        <div style={{ maxWidth: '800px', margin: '0 auto', paddingBottom: '40px' }}>
            {notification && (
                <Notification
                    message={notification.message}
                    type={notification.type}
                    onClose={() => setNotification(null)}
                />
            )}
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-xl)' }}>
                <div>
                    <h2 style={{ fontSize: 'var(--font-size-3xl)', margin: 0, color: 'var(--color-text)' }}>Einstellungen</h2>
                    <p style={{ color: 'var(--color-text-muted)', marginTop: '4px' }}>Verwalten Sie Ihr Profil und Ihre Hotel-App Konfiguration.</p>
                </div>
                <button 
                    onClick={handleSave}
                    style={{ 
                        backgroundColor: 'var(--color-primary)', 
                        color: 'white', 
                        border: 'none', 
                        padding: '12px 24px', 
                        borderRadius: 'var(--radius-md)', 
                        cursor: 'pointer', 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '8px', 
                        fontWeight: 600,
                        boxShadow: 'var(--shadow-sm)',
                        transition: '0.2s transform'
                    }}
                >
                    <Save size={18} /> Speichern
                </button>
            </div>

            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column' }}>
                
                {/* 1. Unternehmensprofil */}
                <SectionCard>
                    <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-text)' }}>
                        <Building2 size={22} color="var(--color-primary)" /> Unternehmensprofil
                    </h3>
                    
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 'var(--spacing-xl)', marginTop: 'var(--spacing-lg)' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontWeight: 600 }}>Hotel Name</label>
                            <input
                                type="text"
                                value={settings.hotelName}
                                onChange={e => setSettings({ ...settings, hotelName: e.target.value })}
                                style={{ width: '100%', padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-background)' }}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontWeight: 600 }}>Währung</label>
                            <select
                                value={settings.currency}
                                onChange={e => setSettings({ ...settings, currency: e.target.value })}
                                style={{ width: '100%', padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-background)' }}
                            >
                                <option value="EUR">Euro (€)</option>
                                <option value="CHF">Schweizer Franken (CHF)</option>
                                <option value="USD">US Dollar ($)</option>
                            </select>
                        </div>
                    </div>

                    <div style={{ marginTop: 'var(--spacing-xl)' }}>
                        <label style={{ display: 'block', marginBottom: 'var(--spacing-sm)', fontWeight: 600 }}>Hotel Logo</label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-lg)' }}>
                            <div style={{ 
                                width: '120px', 
                                height: '120px', 
                                border: '2px dashed var(--color-border)', 
                                borderRadius: 'var(--radius-md)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                backgroundColor: 'var(--color-background)',
                                overflow: 'hidden'
                            }}>
                                {settings.logoUrl ? (
                                    <img src={settings.logoUrl} alt="Logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                                ) : (
                                    <Building2 size={40} color="var(--color-text-muted)" />
                                )}
                            </div>
                            <div>
                                <label style={{
                                    backgroundColor: 'white',
                                    border: '1px solid var(--color-border)',
                                    padding: '8px 16px',
                                    borderRadius: 'var(--radius-md)',
                                    cursor: 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    fontWeight: 500,
                                    color: 'var(--color-text)'
                                }}>
                                    <Upload size={18} /> {isUploading ? 'Lädt...' : 'Logo vom PC auswählen'}
                                    <input 
                                        type="file" 
                                        accept="image/*" 
                                        onChange={handleLogoUpload} 
                                        style={{ display: 'none' }} 
                                        disabled={isUploading}
                                    />
                                </label>
                                <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '8px' }}>
                                    Empfohlen: Quadratisch, max. 2MB. Wird im Menü angezeigt.
                                </p>
                            </div>
                        </div>
                    </div>
                </SectionCard>

                {/* 2. Abo & Funktionen */}
                <SectionCard>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-text)' }}>
                            <SettingsIcon size={22} color="var(--color-primary)" /> Funktionen & Tarife
                        </h3>
                        <div style={{ backgroundColor: '#f0fdf4', color: '#166534', padding: '6px 12px', borderRadius: '20px', fontWeight: 600, fontSize: '14px', border: '1px solid #bbf7d0' }}>
                            Aktiver Plan: {settings.currentPlan?.toUpperCase() || 'PRO'}
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--spacing-md)', marginTop: 'var(--spacing-lg)' }}>
                        {/* Basic Plan */}
                        <div style={{ padding: 'var(--spacing-md)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', opacity: settings.currentPlan === 'basic' ? 1 : 0.6 }}>
                            <div style={{ fontWeight: 700, fontSize: '18px', marginBottom: '8px' }}>Basic</div>
                            <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: '14px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                <li style={{ display: 'flex', gap: '6px' }}><Check size={16} color="#22c55e" /> Bestellwesen manuell</li>
                                <li style={{ display: 'flex', gap: '6px' }}><Check size={16} color="#22c55e" /> Lieferanten-DB</li>
                            </ul>
                        </div>
                        {/* Standard Plan */}
                        <div style={{ padding: 'var(--spacing-md)', border: '1px solid', borderColor: settings.currentPlan === 'standard' ? 'var(--color-primary)' : 'var(--color-border)', borderRadius: 'var(--radius-md)', opacity: settings.currentPlan === 'basic' ? 0.4 : (settings.currentPlan === 'standard' ? 1 : 0.6) }}>
                            <div style={{ fontWeight: 700, fontSize: '18px', marginBottom: '8px' }}>Standard</div>
                            <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: '14px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                <li style={{ display: 'flex', gap: '6px' }}><Check size={16} color="#22c55e" /> Basic Funktionen</li>
                                <li style={{ display: 'flex', gap: '6px' }}><Check size={16} color="var(--color-primary)" /> Inventur-Modus</li>
                                <li style={{ display: 'flex', gap: '6px' }}><Check size={16} color="var(--color-primary)" /> Automatische Warnungen</li>
                                <li style={{ display: 'flex', gap: '6px' }}><Check size={16} color="var(--color-primary)" /> Statistiken</li>
                            </ul>
                        </div>
                        {/* Pro Plan */}
                        <div style={{ padding: 'var(--spacing-md)', border: '2px solid', borderColor: settings.currentPlan === 'pro' ? 'var(--color-primary)' : 'var(--color-border)', borderRadius: 'var(--radius-md)', opacity: settings.currentPlan === 'pro' ? 1 : 0.4, backgroundColor: settings.currentPlan === 'pro' ? '#f8fafc' : 'transparent' }}>
                            <div style={{ fontWeight: 700, fontSize: '18px', marginBottom: '8px', color: 'var(--color-primary)' }}>Pro</div>
                            <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: '14px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                <li style={{ display: 'flex', gap: '6px' }}><Check size={16} color="#22c55e" /> Standard Funktionen</li>
                                <li style={{ display: 'flex', gap: '6px' }}><Check size={16} color="var(--color-primary)" /> Autom. KI-Verbrauch</li>
                                <li style={{ display: 'flex', gap: '6px' }}><Check size={16} color="var(--color-primary)" /> Personalisierte E-Mails</li>
                            </ul>
                        </div>
                    </div>

                    <div style={{ marginTop: 'var(--spacing-xl)', paddingTop: 'var(--spacing-xl)', borderTop: '1px solid var(--color-border)' }}>
                        <h4 style={{ margin: '0 0 var(--spacing-lg) 0' }}>Manuelle Overrides</h4>
                        
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--spacing-lg)' }}>
                            <div>
                                <div style={{ fontWeight: 600, marginBottom: '4px' }}>Lagerbestand & Warnungen</div>
                                <div style={{ fontSize: '14px', color: 'var(--color-text-muted)' }}>Schaltet die Bestandsanzeigen und farbigen Markierungen aktiv.</div>
                            </div>
                            <label style={{ position: 'relative', display: 'inline-block', width: '48px', height: '24px' }}>
                                <input
                                    type="checkbox"
                                    checked={settings.enableStockManagement}
                                    onChange={e => setSettings({ ...settings, enableStockManagement: e.target.checked })}
                                    style={{ opacity: 0, width: 0, height: 0 }}
                                />
                                <span style={{ position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: settings.enableStockManagement ? 'var(--color-primary)' : '#ccc', borderRadius: '24px', transition: '.4s' }}>
                                    <span style={{ position: 'absolute', content: '""', height: '18px', width: '18px', left: settings.enableStockManagement ? '26px' : '4px', bottom: '3px', backgroundColor: 'white', borderRadius: '50%', transition: '.4s' }}></span>
                                </span>
                            </label>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div>
                                <div style={{ fontWeight: 600, marginBottom: '4px', color: '#ea580c' }}>Inventur-Modus (Pausiert)</div>
                                <div style={{ fontSize: '14px', color: 'var(--color-text-muted)' }}>Der automatische KI-Verbrauch wird temporär pausiert, z.B. für eine Zählung.</div>
                            </div>
                            <label style={{ position: 'relative', display: 'inline-block', width: '48px', height: '24px' }}>
                                <input
                                    type="checkbox"
                                    checked={settings.inventoryMode}
                                    onChange={e => setSettings({ ...settings, inventoryMode: e.target.checked })}
                                    style={{ opacity: 0, width: 0, height: 0 }}
                                />
                                <span style={{ position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: settings.inventoryMode ? '#ea580c' : '#ccc', borderRadius: '24px', transition: '.4s' }}>
                                    <span style={{ position: 'absolute', content: '""', height: '18px', width: '18px', left: settings.inventoryMode ? '26px' : '4px', bottom: '3px', backgroundColor: 'white', borderRadius: '50%', transition: '.4s' }}></span>
                                </span>
                            </label>
                        </div>
                    </div>
                </SectionCard>

                {/* 3. E-Mail API */}
                <SectionCard>
                    <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-text)' }}>
                        <Mail size={22} color="var(--color-primary)" /> E-Mail Automatisierung
                    </h3>
                    <div style={{ backgroundColor: '#f8fafc', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--spacing-lg)', textAlign: 'center', marginTop: 'var(--spacing-md)' }}>
                        <Check size={32} color="#0284c7" style={{ marginBottom: '8px' }} />
                        <h4 style={{ margin: '0 0 8px 0', color: '#0284c7' }}>Zentrale API Aktiviert</h4>
                        <p style={{ margin: 0, fontSize: '14px', color: 'var(--color-text-muted)', lineHeight: '1.5' }}>
                            Ihr Account nutzt die verschlüsselte SaaS E-Mail Schnittstelle. <br />
                            Dokumente und Bestellungen werden sicher über unsere Server im Hintergrund versendet.
                        </p>
                    </div>
                </SectionCard>

                {/* Secret Developer Mode Toggle */}
                <div style={{ textAlign: 'center', marginTop: '40px' }}>
                    <span 
                        onClick={triggerDevMode} 
                        style={{ color: '#cbd5e1', fontSize: '12px', cursor: 'default', userSelect: 'none' }}
                    >
                        App Version 1.0.0
                    </span>
                </div>

                {/* 4. Developer Options (Hidden globally unless unlocked) */}
                {settings.developerMode && (
                    <div style={{
                        backgroundColor: '#1e293b',
                        padding: 'var(--spacing-xl)',
                        borderRadius: 'var(--radius-xl)',
                        marginTop: '20px',
                        border: '1px solid #334155',
                        color: 'white'
                    }}>
                        <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: 0, color: '#38bdf8' }}>
                            <Database size={20} /> Developer Backend (Supabase)
                        </h3>
                        <p style={{ fontSize: '14px', color: '#94a3b8', marginBottom: 'var(--spacing-lg)' }}>
                            ACHTUNG: Änderungen hier verändern den Haupt-Konnektor zur Datenbank.
                        </p>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                            <div>
                                <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500, color: '#e2e8f0' }}>Project URL</label>
                                <input
                                    type="text"
                                    value={settings.supabaseUrl}
                                    onChange={e => setSettings({ ...settings, supabaseUrl: e.target.value })}
                                    style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #475569', backgroundColor: '#0f172a', color: 'white' }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500, color: '#e2e8f0' }}>Anon Key</label>
                                <input
                                    type="password"
                                    value={settings.supabaseKey}
                                    onChange={e => setSettings({ ...settings, supabaseKey: e.target.value })}
                                    style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #475569', backgroundColor: '#0f172a', color: 'white' }}
                                />
                            </div>
                        </div>

                        <div style={{ marginTop: '24px', paddingTop: '24px', borderTop: '1px solid #334155' }}>
                            <h4 style={{ margin: '0 0 8px 0', color: '#e2e8f0' }}>Forced Migration Routine</h4>
                            <p style={{ fontSize: '14px', color: '#94a3b8', marginBottom: '16px' }}>Schiebt den kompletten LocalStorage payload ins konfigurierte Backend.</p>
                            <button
                                type="button"
                                onClick={handleMigration}
                                disabled={isMigrating}
                                style={{
                                    backgroundColor: '#ea580c',
                                    color: 'white',
                                    border: 'none',
                                    padding: '10px 16px',
                                    borderRadius: '4px',
                                    cursor: isMigrating ? 'wait' : 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    fontWeight: 600
                                }}
                            >
                                {isMigrating ? 'Puffering...' : <><ArrowRight size={18} /> Run Migration Script</>}
                            </button>
                        </div>
                    </div>
                )}
            </form>
        </div>
    );
};
