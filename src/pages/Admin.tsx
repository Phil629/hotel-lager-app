import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { Users, Ticket, CheckCircle, ShieldAlert, Ban, TrendingUp, UserCheck } from 'lucide-react';

export const Admin = () => {
    const [activeTab, setActiveTab] = useState<'users' | 'tickets'>('users');
    const [profiles, setProfiles] = useState<any[]>([]);
    const [tickets, setTickets] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    
    // Stats
    const [mrr, setMrr] = useState(0);

    useEffect(() => {
        fetchAdminData();
    }, [activeTab]);

    const fetchAdminData = async () => {
        setLoading(true);
        try {
            if (activeTab === 'users') {
                const { data } = await supabase!.from('profiles').select('*').order('created_at', { ascending: false });
                const { data: subs } = await supabase!.from('subscriptions').select('*');
                
                const merged = (data || []).map(p => {
                    const s = subs?.find(x => x.user_id === p.id);
                    return { ...p, plan: s?.plan || 'free', subscription_id: s?.id };
                });
                
                // Calculate MRR
                let totalMrr = 0;
                merged.forEach(p => {
                    if (p.plan === 'basic') totalMrr += 19;
                    if (p.plan === 'pro') totalMrr += 39;
                });
                setMrr(totalMrr);
                
                setProfiles(merged);
            } else {
                const { data } = await supabase!.from('support_tickets').select('*').order('created_at', { ascending: false });
                setTickets(data || []);
            }
        } catch (err) {
            console.error("Admin fetch error", err);
        } finally {
            setLoading(false);
        }
    };

    const toggleRole = async (id: string, currentRole: string) => {
        const newRole = currentRole === 'admin' ? 'user' : 'admin';
        if (!window.confirm(`Soll der Nutzer wirklich den Status \${newRole.toUpperCase()} erhalten?`)) return;
        try {
            await supabase!.from('profiles').update({ role: newRole }).eq('id', id);
            fetchAdminData();
        } catch (e) {
            alert('Fehler beim Ändern der Rolle.');
        }
    };

    const toggleBan = async (id: string, is_banned: boolean) => {
        const confirmText = is_banned 
            ? "Möchtest du den Zugang für diesen Nutzer wieder FREIGEBEN?" 
            : "Möchtest du den Zugang für diesen Nutzer SPERREN? Der Nutzer wird sofort ausgeloggt.";
        if (!window.confirm(confirmText)) return;
        try {
            await supabase!.from('profiles').update({ is_banned: !is_banned }).eq('id', id);
            fetchAdminData();
        } catch (e) {
            alert('Fehler beim Sperren.');
        }
    };

    const updateNote = async (id: string, note: string) => {
        try {
            await supabase!.from('profiles').update({ admin_notes: note }).eq('id', id);
            // No full fetch to avoid losing focus, just flash success maybe?
        } catch (e) {
            console.error(e);
        }
    };

    const updatePlan = async (userId: string, newPlan: string) => {
        try {
            await supabase!.from('subscriptions').upsert(
                { user_id: userId, plan: newPlan }, 
                { onConflict: 'user_id' }
            );
            fetchAdminData();
        } catch (e) {
            alert('Fehler beim Abo-Wechsel.');
        }
    };

    const updateTicketStatus = async (id: string, newStatus: string) => {
        try {
            await supabase!.from('support_tickets').update({ status: newStatus }).eq('id', id);
            fetchAdminData();
        } catch (e) {
            alert('Fehler beim Ticket Update.');
        }
    };

    return (
        <div style={{ paddingBottom: '40px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--spacing-xl)', flexWrap: 'wrap', gap: '16px' }}>
                <div>
                    <h2 style={{ fontSize: 'var(--font-size-3xl)', margin: 0, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <ShieldAlert size={28} color="#be123c" /> SaaS Administration
                    </h2>
                    <p style={{ color: 'var(--color-text-muted)', marginTop: '4px' }}>Zentrale Verwaltung deiner Kunden und Abonnements.</p>
                </div>
                
                {/* Widgets */}
                <div style={{ display: 'flex', gap: '16px' }}>
                    <div style={{ backgroundColor: 'white', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', minWidth: '150px' }}>
                        <div style={{ color: 'var(--color-text-muted)', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <UserCheck size={16} /> AKTIVE KUNDEN
                        </div>
                        <div style={{ fontSize: '24px', fontWeight: 700, color: '#1e293b', marginTop: '4px' }}>
                            {profiles.filter(p => !p.is_banned).length}
                        </div>
                    </div>
                    <div style={{ backgroundColor: 'white', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', minWidth: '150px' }}>
                         <div style={{ color: 'var(--color-text-muted)', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <TrendingUp size={16} /> MONATIUMSATZ (MRR)
                        </div>
                        <div style={{ fontSize: '24px', fontWeight: 700, color: '#16a34a', marginTop: '4px' }}>
                            {mrr} €
                        </div>
                    </div>
                </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', marginBottom: 'var(--spacing-lg)' }}>
                <button 
                    onClick={() => setActiveTab('users')}
                    style={{ padding: '10px 20px', borderRadius: 'var(--radius-md)', border: 'none', backgroundColor: activeTab === 'users' ? '#be123c' : 'white', color: activeTab === 'users' ? 'white' : 'var(--color-text-main)', fontWeight: 600, cursor: 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}
                >
                    <Users size={18} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
                    Unternehmensprofile ({profiles.length})
                </button>
                <button 
                    onClick={() => setActiveTab('tickets')}
                    style={{ padding: '10px 20px', borderRadius: 'var(--radius-md)', border: 'none', backgroundColor: activeTab === 'tickets' ? '#be123c' : 'white', color: activeTab === 'tickets' ? 'white' : 'var(--color-text-main)', fontWeight: 600, cursor: 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}
                >
                    <Ticket size={18} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
                    Support-Anfragen
                </button>
            </div>

            {loading ? (
                <div>Lade Daten...</div>
            ) : activeTab === 'users' ? (
                <div style={{ display: 'grid', gap: '16px', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))' }}>
                    {profiles.map(p => (
                        <div key={p.id} style={{ backgroundColor: 'white', borderRadius: 'var(--radius-lg)', padding: '20px', border: p.is_banned ? '2px solid #ef4444' : '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: '12px', position: 'relative' }}>
                            
                            {p.is_banned && (
                                <div style={{ position: 'absolute', top: 12, right: 12, backgroundColor: '#fef2f2', color: '#ef4444', padding: '4px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <Ban size={12} /> GESPERRT
                                </div>
                            )}

                            <div>
                                <h3 style={{ margin: 0, fontSize: '16px', color: '#0f172a', paddingRight: '80px', wordBreak: 'break-all' }}>{p.email}</h3>
                                <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-text-muted)' }}>Mitglied seit: {new Date(p.created_at).toLocaleDateString('de-DE')}</p>
                            </div>

                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <select 
                                    value={p.plan || 'free'} 
                                    onChange={(e) => updatePlan(p.id, e.target.value)}
                                    style={{ padding: '6px 10px', borderRadius: '4px', border: '1px solid var(--color-border)', backgroundColor: '#f8fafc', fontWeight: 600, color: p.plan === 'pro' ? '#7e22ce' : '#334155', cursor: 'pointer' }}
                                >
                                    <option value="free">Free (0€)</option>
                                    <option value="basic">Basic (19€)</option>
                                    <option value="pro">Pro (39€)</option>
                                </select>
                                
                                <span style={{ backgroundColor: p.role === 'admin' ? '#be123c' : '#e2e8f0', color: p.role === 'admin' ? 'white' : '#475569', padding: '6px 10px', borderRadius: '4px', fontSize: '13px', fontWeight: 600 }}>
                                    {p.role.toUpperCase()}
                                </span>
                            </div>

                            <div style={{ marginTop: '8px' }}>
                                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-muted)', display: 'block', marginBottom: '4px' }}>Interne Notizen:</label>
                                <textarea 
                                    defaultValue={p.admin_notes || ''}
                                    onBlur={(e) => updateNote(p.id, e.target.value)}
                                    placeholder="Notizen zum Kunden (speichert beim Verlassen des Feldes)..."
                                    style={{ width: '100%', height: '60px', padding: '8px', borderRadius: '4px', border: '1px solid var(--color-border)', fontSize: '13px', resize: 'none', fontFamily: 'inherit' }}
                                />
                            </div>

                            <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto' }}>
                                <button onClick={() => toggleRole(p.id, p.role)} style={{ background: 'none', border: 'none', color: '#0284c7', cursor: 'pointer', textDecoration: 'underline', fontSize: '13px', padding: 0 }}>
                                    Admin-Rechte {p.role === 'admin' ? 'entziehen' : 'geben'}
                                </button>
                                
                                <button onClick={() => toggleBan(p.id, p.is_banned)} style={{ background: 'none', border: 'none', color: p.is_banned ? '#16a34a' : '#ef4444', cursor: 'pointer', fontSize: '13px', fontWeight: 600, padding: 0, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <Ban size={14} /> {p.is_banned ? 'Entsperren' : 'Sperren'}
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div style={{ backgroundColor: 'white', borderRadius: 'var(--radius-lg)', padding: 'var(--spacing-lg)', border: '1px solid var(--color-border)' }}>
                    {tickets.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--color-text-muted)' }}>Keine Support-Tickets vorhanden.</div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                            {tickets.map(t => (
                                <div key={t.id} style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
                                    <div style={{ padding: '12px 16px', backgroundColor: '#f8fafc', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <strong>{t.subject}</strong>
                                        <span style={{ backgroundColor: t.status === 'open' ? '#fef08a' : '#bbf7d0', color: t.status === 'open' ? '#854d0e' : '#166534', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600 }}>
                                            {t.status.toUpperCase()}
                                        </span>
                                    </div>
                                    <div style={{ padding: '16px', color: 'var(--color-text-main)' }}>
                                        {t.message}
                                    </div>
                                    <div style={{ padding: '12px 16px', backgroundColor: '#f8fafc', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'flex-end' }}>
                                        {t.status === 'open' && (
                                            <button onClick={() => updateTicketStatus(t.id, 'closed')} style={{ backgroundColor: '#22c55e', color: 'white', border: 'none', padding: '6px 12px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                                                <CheckCircle size={16} /> Als gelöst markieren
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
