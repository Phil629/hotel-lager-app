import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { Building2, UserPlus, ArrowRight, LogOut } from 'lucide-react';
import { Notification, type NotificationType } from '../components/Notification';
import { StorageService } from '../services/storage';

export const Setup: React.FC = () => {
    const [mode, setMode] = useState<'choose' | 'create' | 'join'>('choose');
    const [companyName, setCompanyName] = useState('');
    const [joinCode, setJoinCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [notification, setNotification] = useState<{ message: string, type: NotificationType } | null>(null);

    // If they somehow have a company already, redirect them away
    useEffect(() => {
        const checkCompany = async () => {
            const { data: { user } } = await supabase!.auth.getUser();
            if (user) {
                const { data } = await supabase!.from('profiles').select('company_id').eq('id', user.id).single();
                if (data && data.company_id) {
                    window.location.href = '/';
                }
            }
        };
        checkCompany();
    }, []);

    const handleCreateCompany = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!companyName.trim()) return;
        setLoading(true);
        try {
            const { data: { user } } = await supabase!.auth.getUser();
            if (!user) throw new Error("Nicht eingeloggt");

            // 1. Create company
            const join_code = Math.random().toString(36).substring(2, 10);
            const { data: newCompany, error: createError } = await supabase!
                .from('companies')
                .insert([{ name: companyName, join_code }])
                .select()
                .single();
            
            if (createError) throw createError;

            // 2. Update profile
            const { error: profileError } = await supabase!
                .from('profiles')
                .update({ company_id: newCompany.id, role: 'owner' })
                .eq('id', user.id);

            if (profileError) throw profileError;

            // Save hotel name locally for UI consistency
            const settings = StorageService.getSettings();
            settings.hotelName = companyName;
            StorageService.saveSettings(settings);

            setNotification({ message: 'Unternehmen erfolgreich erstellt!', type: 'success' });
            setTimeout(() => window.location.href = '/', 1000);
        } catch (error: any) {
            console.error(error);
            setNotification({ message: 'Fehler beim Erstellen: ' + error.message, type: 'error' });
            setLoading(false);
        }
    };

    const handleJoinCompany = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!joinCode.trim()) return;
        setLoading(true);
        try {
            const { data: { user } } = await supabase!.auth.getUser();
            if (!user) throw new Error("Nicht eingeloggt");

            // 1. Find company by code
            const { data: company, error: searchError } = await supabase!
                .from('companies')
                .select('id, name')
                .eq('join_code', joinCode)
                .single();

            if (searchError || !company) {
                throw new Error("Einladungs-Code ungültig oder Unternehmen nicht gefunden.");
            }

            // 2. Update profile
            const { error: profileError } = await supabase!
                .from('profiles')
                .update({ company_id: company.id, role: 'employee' })
                .eq('id', user.id);

            if (profileError) throw profileError;

            // Save hotel name locally
            const settings = StorageService.getSettings();
            settings.hotelName = company.name;
            StorageService.saveSettings(settings);

            setNotification({ message: `Erfolgreich dem Unternehmen ${company.name} beigetreten!`, type: 'success' });
            setTimeout(() => window.location.href = '/', 1000);
        } catch (error: any) {
            console.error(error);
            setNotification({ message: error.message, type: 'error' });
            setLoading(false);
        }
    };

    const handleLogout = async () => {
        await supabase!.auth.signOut();
        window.location.href = '/';
    };

    return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', width: '100vw', backgroundColor: 'var(--color-background)', position: 'fixed', top: 0, left: 0, zIndex: 9999 }}>
            
            {notification && (
                <Notification
                    message={notification.message}
                    type={notification.type}
                    onClose={() => setNotification(null)}
                />
            )}

            <div style={{ width: '100%', maxWidth: '500px', backgroundColor: 'var(--color-surface)', padding: 'var(--spacing-2xl)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-md)', border: '1px solid var(--color-border)' }}>
                <div style={{ textAlign: 'center', marginBottom: 'var(--spacing-xl)' }}>
                    <div style={{ width: '60px', height: '60px', backgroundColor: 'var(--color-primary)', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto var(--spacing-md)' }}>
                        <Building2 size={30} color="white" />
                    </div>
                    <h2 style={{ margin: 0, fontSize: 'var(--font-size-2xl)', color: 'var(--color-text-main)' }}>
                        Willkommen beim Bestellwesen
                    </h2>
                    <p style={{ color: 'var(--color-text-muted)', marginTop: '8px' }}>
                        Bevor du startest, richte bitte deinen Arbeitsbereich ein.
                    </p>
                </div>

                {mode === 'choose' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                        <button
                            onClick={() => setMode('create')}
                            style={{ padding: '20px', display: 'flex', alignItems: 'center', gap: '16px', backgroundColor: 'var(--color-background)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', transition: '0.2s', textAlign: 'left' }}
                            onMouseOver={e => e.currentTarget.style.borderColor = 'var(--color-primary)'}
                            onMouseOut={e => e.currentTarget.style.borderColor = 'var(--color-border)'}
                        >
                            <div style={{ backgroundColor: '#eff6ff', padding: '12px', borderRadius: '50%' }}>
                                <Building2 size={24} color="var(--color-primary)" />
                            </div>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 'bold', fontSize: '16px', color: 'var(--color-text-main)' }}>Neues Unternehmen registrieren</div>
                                <div style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginTop: '4px' }}>Ich bin Inhaber und möchte einen neuen Account für mein Unternehmen anlegen.</div>
                            </div>
                            <ArrowRight color="var(--color-text-muted)" />
                        </button>

                        <button
                            onClick={() => setMode('join')}
                            style={{ padding: '20px', display: 'flex', alignItems: 'center', gap: '16px', backgroundColor: 'var(--color-background)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', transition: '0.2s', textAlign: 'left' }}
                            onMouseOver={e => e.currentTarget.style.borderColor = 'var(--color-primary)'}
                            onMouseOut={e => e.currentTarget.style.borderColor = 'var(--color-border)'}
                        >
                            <div style={{ backgroundColor: '#f0fdf4', padding: '12px', borderRadius: '50%' }}>
                                <UserPlus size={24} color="#16a34a" />
                            </div>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 'bold', fontSize: '16px', color: 'var(--color-text-main)' }}>Einem Unternehmen beitreten</div>
                                <div style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginTop: '4px' }}>Ich bin Mitarbeiter und habe einen Einladungs-Code von meinem Chef erhalten.</div>
                            </div>
                            <ArrowRight color="var(--color-text-muted)" />
                        </button>
                        
                        <div style={{ textAlign: 'center', marginTop: 'var(--spacing-lg)' }}>
                            <button onClick={handleLogout} style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', margin: '0 auto' }}>
                                <LogOut size={16} /> Abmelden
                            </button>
                        </div>
                    </div>
                )}

                {mode === 'create' && (
                    <form onSubmit={handleCreateCompany} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-lg)' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontWeight: 600 }}>Name deines Unternehmens</label>
                            <input
                                type="text"
                                required
                                value={companyName}
                                onChange={(e) => setCompanyName(e.target.value)}
                                style={{ width: '100%', padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', fontSize: '15px' }}
                                placeholder="z.B. Hotel Sonnenschein GmbH"
                            />
                        </div>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button type="button" onClick={() => setMode('choose')} style={{ padding: '12px 20px', backgroundColor: 'var(--color-background)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>
                                Zurück
                            </button>
                            <button type="submit" disabled={loading} style={{ flex: 1, padding: '12px 20px', backgroundColor: 'var(--color-primary)', color: 'white', border: 'none', borderRadius: 'var(--radius-md)', fontWeight: 'bold', cursor: loading ? 'not-allowed' : 'pointer' }}>
                                {loading ? 'Erstelle...' : 'Unternehmen anlegen'}
                            </button>
                        </div>
                    </form>
                )}

                {mode === 'join' && (
                    <form onSubmit={handleJoinCompany} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-lg)' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontWeight: 600 }}>Einladungs-Code</label>
                            <input
                                type="text"
                                required
                                value={joinCode}
                                onChange={(e) => setJoinCode(e.target.value)}
                                style={{ width: '100%', padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', fontSize: '15px', letterSpacing: '2px' }}
                                placeholder="z.B. a1b2c3d4"
                            />
                        </div>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button type="button" onClick={() => setMode('choose')} style={{ padding: '12px 20px', backgroundColor: 'var(--color-background)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>
                                Zurück
                            </button>
                            <button type="submit" disabled={loading} style={{ flex: 1, padding: '12px 20px', backgroundColor: '#16a34a', color: 'white', border: 'none', borderRadius: 'var(--radius-md)', fontWeight: 'bold', cursor: loading ? 'not-allowed' : 'pointer' }}>
                                {loading ? 'Prüfe...' : 'Beitreten'}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
};
