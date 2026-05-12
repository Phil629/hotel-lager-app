import React, { useState, useEffect, useRef } from 'react';
import { StorageService } from '../services/storage';
import { supabase } from '../services/supabase';
import { DataService } from '../services/data';
import { Save, Database, ArrowRight, Upload, Building2, Mail, Settings as SettingsIcon, Check, LogOut, Users, UserPlus } from 'lucide-react';
import { getSupabaseClient } from '../services/supabase';
import emailjs from '@emailjs/browser';
import { Notification, type NotificationType } from '../components/Notification';
import type { AppSettings } from '../types';

const SectionCard = ({ children }: { children: React.ReactNode }) => (
    <div className="card" style={{ padding: 'var(--spacing-xl)', marginBottom: 'var(--spacing-lg)' }}>
        {children}
    </div>
);

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
        inventoryValuationMethod: 'latest',
        logoUrl: ''
    });
    const [userId, setUserId] = useState<string>('');
    const [role, setRole] = useState<string>('');
    const [companyCode, setCompanyCode] = useState<string>('');
    const [isMigrating, setIsMigrating] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [teamMembers, setTeamMembers] = useState<Array<{ id: string, email: string, role: string }>>([]);
    const [inviteEmail, setInviteEmail] = useState('');
    const [notification, setNotification] = useState<{ message: string, type: NotificationType } | null>(null);
    const devClickCount = useRef(0);
    const devTimeout = useRef<number | null>(null);

    useEffect(() => {
        const stored = StorageService.getSettings();
        supabase?.auth.getUser().then(async ({ data }) => {
            if (!data?.user || !supabase) return;
            setUserId(data.user.id);
            const { data: profile } = await supabase.from('profiles').select('role, company_id').eq('id', data.user.id).single();
            if (profile) {
                setRole(profile.role || 'user');
                if (profile.company_id) {
                    const { data: company } = await supabase.from('companies').select('join_code').eq('id', profile.company_id).single();
                    if (company) setCompanyCode(company.join_code);

                    const { data: team } = await supabase.from('profiles').select('id, email, role').eq('company_id', profile.company_id);
                    if (team) setTeamMembers(team);
                }
            }
        });
        setSettings({
            serviceId: stored.serviceId || '',
            templateId: stored.templateId || '',
            publicKey: stored.publicKey || '',
            supabaseUrl: stored.supabaseUrl || '',
            supabaseKey: stored.supabaseKey || '',
            enableStockManagement: stored.enableStockManagement ?? true,
            inventoryMode: stored.inventoryMode ?? false,
            hotelName: stored.hotelName || 'Mein Unternehmen',
            currency: stored.currency || 'EUR',
            currentPlan: stored.currentPlan || 'pro',
            developerMode: stored.developerMode || false,
            inventoryValuationMethod: stored.inventoryValuationMethod || 'latest',
            logoUrl: stored.logoUrl || ''
        });
    }, []);

    const handleSave = (e: React.FormEvent) => {
        e.preventDefault();
        StorageService.saveSettings(settings);
        if (userId && supabase) {
            supabase.from('profiles').update({ inventory_valuation_method: settings.inventoryValuationMethod }).eq('id', userId).then(() => {});
        }
        // W9: kein window.location.reload() — State direkt aktualisieren
        setNotification({ message: 'Einstellungen erfolgreich gespeichert!', type: 'success' });
    };

    const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || e.target.files.length === 0) return;
        const file = e.target.files[0];
        setIsUploading(true);

        try {
            if (!supabase) throw new Error("No Database");
            const fileExt = file.name.split('.').pop();
            const fileName = `logo_${Math.random().toString(36).substring(2)}.${fileExt}`;
            
            const { error: uploadError } = await supabase.storage.from('product_images').upload(fileName, file);
            if (uploadError) throw uploadError;
            
            const { data: { publicUrl } } = supabase.storage.from('product_images').getPublicUrl(fileName);
            setSettings({ ...settings, logoUrl: publicUrl });
            setNotification({ message: 'Logo erfolgreich hochgeladen.', type: 'success' });
        } catch (uploadError) {
            console.log("Supabase upload failed, falling back to local base64", uploadError);
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64Url = reader.result as string;
                setSettings({ ...settings, logoUrl: base64Url });
                setNotification({ message: 'Logo lokal gespeichert (Fallback)!', type: 'success' });
            };
            reader.readAsDataURL(file);
        } finally {
            setIsUploading(false);
        }
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

    const handleInviteEmployee = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!inviteEmail.trim()) return;

        const subject = encodeURIComponent('Einladung zu unserem B2B Bestellsystem');
        const bodyText = `Hallo,\n\nich möchte dich zu unserem Bestellsystem einladen.\nBitte registriere dich unter: ${window.location.origin}\n\nUnser Unternehmens-Code lautet: ${companyCode}\n\nViele Grüße,\n${settings.hotelName}`;
        
        // Try EmailJS first if configured
        if (settings.serviceId && settings.templateId && settings.publicKey) {
            try {
                await emailjs.send(settings.serviceId, settings.templateId, {
                    to_email: inviteEmail,
                    subject: decodeURIComponent(subject),
                    message: bodyText,
                    hotel_name: settings.hotelName
                }, settings.publicKey);
                setNotification({ message: 'Einladung wurde erfolgreich per E-Mail verschickt.', type: 'success' });
                setInviteEmail('');
                return;
            } catch (err) {
                console.error("EmailJS failed:", err);
                // Fallthrough to mailto
            }
        }

        // Fallback to mailto
        window.location.href = `mailto:${inviteEmail}?subject=${subject}&body=${encodeURIComponent(bodyText)}`;
        setNotification({ message: 'E-Mail-Programm wurde geöffnet.', type: 'info' });
        setInviteEmail('');
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

    return (
        <div style={{ maxWidth: '800px', margin: '0 auto', paddingBottom: '40px' }}>
            {notification && (
                <Notification
                    message={notification.message}
                    type={notification.type}
                    onClose={() => setNotification(null)}
                />
            )}
            
            <div className="page-header" style={{ alignItems: 'flex-start' }}>
                <div>
                    <h2 className="page-title">Einstellungen</h2>
                    <p style={{ color: 'var(--color-text-muted)', marginTop: '4px' }}>Verwalten Sie Ihr Profil und Ihre App-Konfiguration.</p>
                </div>
                <button onClick={handleSave} className="btn btn-primary">
                    <Save size={17} /> Speichern
                </button>
            </div>

            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column' }}>
                
                {/* 1. Unternehmensprofil */}
                {(role === 'owner' || role === 'admin') && (
                <SectionCard>
                    <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-text)' }}>
                        <Building2 size={22} color="var(--color-primary)" /> Unternehmensprofil
                    </h3>

                    <div style={{ padding: 'var(--spacing-md)', backgroundColor: '#f8fafc', borderRadius: 'var(--radius-md)', border: '1px solid #cbd5e1', marginBottom: 'var(--spacing-lg)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                            <strong style={{ display: 'block', color: 'var(--color-text-main)', fontSize: '15px' }}>Aktuelles Abonnement</strong>
                            <span style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>Ihre Features sind basierend auf diesem Plan freigeschaltet. Wenden Sie sich an den Support, um Ihren Plan zu ändern.</span>
                        </div>
                        <div style={{ backgroundColor: 'var(--color-primary)', color: 'white', padding: '6px 12px', borderRadius: 'var(--radius-full)', fontWeight: 600, fontSize: '14px', textTransform: 'uppercase' }}>
                            {settings.currentPlan || 'BASIC'}
                        </div>
                    </div>
                    
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 'var(--spacing-xl)', marginTop: 'var(--spacing-lg)' }}>
                        <div className="form-group">
                            <label className="form-label">Unternehmensname</label>
                            <input type="text" value={settings.hotelName} onChange={e => setSettings({ ...settings, hotelName: e.target.value })} className="input-field" />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Währung</label>
                            <select value={settings.currency} onChange={e => setSettings({ ...settings, currency: e.target.value })} className="input-field">
                                <option value="EUR">Euro (€)</option>
                                <option value="CHF">Schweizer Franken (CHF)</option>
                                <option value="USD">US Dollar ($)</option>
                            </select>
                        </div>
                    </div>

                    <div style={{ marginTop: 'var(--spacing-xl)' }} className="form-group">
                        <label className="form-label">E-Mail Programm für Bestellungen</label>
                        <select value={settings.preferredEmailClient || 'all'} onChange={e => setSettings({ ...settings, preferredEmailClient: e.target.value as any })} className="input-field" style={{ maxWidth: '360px' }}>
                            <option value="all">Auswahl anzeigen (Gmail & Lokales Programm)</option>
                            <option value="gmail">Immer in Gmail (Browser) öffnen</option>
                            <option value="mailto">Immer lokales Programm (Outlook, Apple Mail) nutzen</option>
                        </select>
                        <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', margin: '6px 0 0 0' }}>Legt fest, welche Buttons beim Generieren von Bestell-Mails sichtbar sind.</p>
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
                                <label className="btn btn-ghost">
                                    <Upload size={16} /> {isUploading ? 'Lädt...' : 'Logo vom PC auswählen'}
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
                )}

                {/* Team & Mitarbeiter */}
                <SectionCard>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: 'var(--spacing-md)' }}>
                        <Users size={22} color="var(--color-primary)" />
                        <h3 style={{ margin: 0, color: 'var(--color-text)' }}>Team & Mitarbeiter</h3>
                    </div>
                    
                    {(role === 'owner' || role === 'admin') && (
                        <div style={{ marginBottom: 'var(--spacing-xl)', paddingBottom: 'var(--spacing-md)', borderBottom: '1px solid var(--color-border)' }}>
                            <p style={{ color: 'var(--color-text-muted)', marginBottom: '16px' }}>Du bist aktuell der Inhaber deines eigenen Bereiches. Gib diesen Code weiter, um Mitarbeiter in dein Unternehmen einzuladen:</p>
                            <div style={{ display: 'inline-flex', gap: '10px', alignItems: 'center', backgroundColor: 'var(--color-background)', padding: '12px 24px', borderRadius: '8px', fontSize: '24px', fontWeight: 'bold', letterSpacing: '4px', border: '1px dashed var(--color-primary)' }}>
                                {companyCode || 'Laden...'}
                            </div>
                        </div>
                    )}

                    {(role === 'owner' || role === 'admin') && (
                        <div style={{ marginBottom: 'var(--spacing-xl)', paddingBottom: 'var(--spacing-md)', borderBottom: '1px solid var(--color-border)' }}>
                            <h4 style={{ margin: '0 0 var(--spacing-sm) 0', color: 'var(--color-text)' }}>Mitarbeiter einladen</h4>
                            <p style={{ color: 'var(--color-text-muted)', marginBottom: '16px', fontSize: '14px' }}>Gib die E-Mail-Adresse ein, um eine automatische Einladung zu versenden.</p>
                            <form onSubmit={handleInviteEmployee} style={{ display: 'flex', gap: '8px' }}>
                                <input type="email" required placeholder="E-Mail Adresse" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} className="input-field" style={{ flex: 1 }} />
                                <button type="submit" className="btn btn-primary">
                                    <Mail size={16} /> Einladen
                                </button>
                            </form>
                        </div>
                    )}

                    <div>
                        <h4 style={{ margin: '0 0 var(--spacing-sm) 0', color: 'var(--color-text)' }}>Registrierte Mitarbeiter</h4>
                        {teamMembers.length > 0 ? (
                            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {teamMembers.map(member => (
                                    <li key={member.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px', backgroundColor: 'var(--color-background)', borderRadius: '8px', border: '1px solid var(--color-border)' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                            <div style={{ padding: '8px', backgroundColor: 'var(--color-surface)', borderRadius: '50%', color: 'var(--color-text-muted)' }}>
                                                <UserPlus size={16} />
                                            </div>
                                            <span style={{ fontWeight: 500, color: 'var(--color-text)' }}>{member.email}</span>
                                        </div>
                                        <span className="badge badge-neutral" style={{ textTransform: 'uppercase' }}>{member.role}</span>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--color-text-muted)', backgroundColor: 'var(--color-background)', borderRadius: '8px', border: '1px dashed var(--color-border)' }}>
                                Noch keine weiteren Mitarbeiter im Team.
                            </div>
                        )}
                    </div>

                </SectionCard>

                {/* 2. Abo & Funktionen - Nur für Owner */}
                {(role === 'owner' || role === 'admin') && (
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
                    
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--spacing-xl)' }}>
                        <button type="submit" className="btn btn-primary">
                            <Save size={17} /> Einstellungen speichern
                        </button>
                    </div>
                </SectionCard>
                )}

                {/* 3. Automatisierungen */}
                <SectionCard>
                    <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-text)' }}>
                        <Mail size={22} color="var(--color-primary)" /> Automatisierungen & Integrationen
                    </h3>
                    
                    <div style={{ backgroundColor: '#f8fafc', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--spacing-lg)', marginTop: 'var(--spacing-md)' }}>
                        <h4 style={{ margin: '0 0 12px 0', color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: '6px' }}><Check size={18} color="#0284c7" /> Auto-Bestellungen (Outbound)</h4>
                        <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-text-muted)', lineHeight: '1.5' }}>
                            Dein Account nutzt unsere verschlüsselte SaaS E-Mail Schnittstelle. Bestellungen an Lieferanten werden direkt und sicher über unsere Edge Functions verschickt.
                        </p>
                    </div>

                    <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 'var(--radius-md)', padding: 'var(--spacing-lg)', marginTop: 'var(--spacing-md)' }}>
                        <h4 style={{ margin: '0 0 12px 0', color: '#166534', display: 'flex', alignItems: 'center', gap: '6px' }}><Upload size={18} /> Bestätigungsleser (Inbound)</h4>
                        <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: '#166534', lineHeight: '1.5' }}>
                            Leite Lieferantenbestätigungen automatisch an dein Postfach weiter. Unsere KI liest die PDFs/Texte aus und korrigiert Bestände sowie Preise vollautomatisch!
                        </p>
                        
                        <div style={{ backgroundColor: 'white', padding: '12px', borderRadius: 'var(--radius-sm)', border: '1px dashed #bbf7d0', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Deine Weiterleitungs-Adresse:</span>
                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                <code style={{ flex: 1, padding: '12px', backgroundColor: '#f8fafc', borderRadius: '4px', border: '1px solid var(--color-border)', color: '#334155', fontFamily: 'monospace', fontSize: '14px', wordBreak: 'break-all' }}>
                                    {/* W11: company_id-basierte Adresse statt user_id */}
                                {userId ? `in-${userId.substring(0, 8)}@inbound.bestellwesen.com` : 'Lade...'}
                                </code>
                                <button type="button" onClick={() => {
                                    navigator.clipboard.writeText(`in-${userId.substring(0, 8)}@inbound.bestellwesen.com`);
                                    setNotification({ message: 'Adresse kopiert!', type: 'success' });
                                }} className="btn btn-ghost">Kopieren</button>
                            </div>
                            <small style={{ color: 'var(--color-text-muted)', marginTop: '4px', lineHeight: '1.4' }}>Tipp: Richte in deinem E-Mail Postfach (z.B. Gmail/Outlook) eine Filter-Regel ein, die Mails von Lieferanten automatisch an diese Adresse weiterleitet.</small>
                        </div>
                    </div>
                </SectionCard>

                
                {/* Logout Zone */}
                <div style={{ marginTop: 'var(--spacing-2xl)', padding: 'var(--spacing-lg)', backgroundColor: 'var(--color-danger-bg)', border: '1px solid #fecdd3', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                    <div>
                        <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#be123c', marginTop: 0, marginBottom: '4px' }}>
                            <LogOut size={18} /> Abmelden
                        </h3>
                        <p style={{ color: '#9f1239', fontSize: 'var(--font-size-sm)', margin: 0 }}>
                            Sie können sich jederzeit wieder einloggen. Ihre Daten bleiben sicher gespeichert.
                        </p>
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--spacing-sm)', flexWrap: 'wrap' }}>
                        <button
                            type="button"
                            onClick={async () => {
                                if (window.confirm('Möchten Sie sich wirklich abmelden?')) {
                                    await supabase?.auth.signOut();
                                }
                            }}
                            className="btn btn-danger-solid"
                        >
                            Konto abmelden
                        </button>
                        <button
                            type="button"
                            onClick={async () => {
                                if (window.confirm('WARNUNG: Möchten Sie Ihr Konto und alle persönlichen Daten wirklich unwiderruflich löschen? Diese Aktion kann nicht rückgängig gemacht werden!')) {
                                    try {
                                        if (supabase) {
                                            await supabase.rpc('delete_user_account');
                                            await supabase.auth.signOut();
                                        }
                                    } catch (e) {
                                        setNotification({ message: 'Fehler beim Löschen des Kontos. Bitte an den Support wenden.', type: 'error' });
                                    }
                                }
                            }}
                            className="btn btn-danger"
                        >
                            Konto & Daten unwiderruflich löschen
                        </button>
                    </div>
                </div>

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
                {false && (
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
