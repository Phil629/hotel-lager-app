import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { Users, Ticket, CheckCircle, ShieldAlert, Ban, TrendingUp, UserCheck, AlertTriangle } from 'lucide-react';
import { Notification, type NotificationType } from '../components/Notification';

interface AdminProfile {
    id: string;
    email: string;
    created_at: string;
    is_banned: boolean;
    role: string;
    company_id: string | null;
    admin_notes: string | null;
    plan: string;
    subscription_id: string | undefined;
}

interface SupportTicket {
    id: string;
    subject: string;
    message: string;
    status: string;
    created_at: string;
}

interface ConfirmState {
    message: string;
    confirmLabel: string;
    variant: 'danger' | 'success';
    onConfirm: () => Promise<void>;
}

export const Admin = () => {
    const [activeTab, setActiveTab] = useState<'users' | 'tickets'>('users');
    const [profiles, setProfiles] = useState<AdminProfile[]>([]);
    const [tickets, setTickets] = useState<SupportTicket[]>([]);
    const [loading, setLoading] = useState(true);
    const [notification, setNotification] = useState<{ message: string; type: NotificationType } | null>(null);
    const [mrr, setMrr] = useState(0);
    const [confirm, setConfirm] = useState<ConfirmState | null>(null);

    useEffect(() => {
        fetchAdminData();
    }, [activeTab]);

    const fetchAdminData = async () => {
        if (!supabase) return;
        setLoading(true);
        try {
            if (activeTab === 'users') {
                const { data, error } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
                if (error) throw error;

                const { data: subs } = await supabase.from('subscriptions').select('*');

                const merged: AdminProfile[] = (data || []).map(p => {
                    const s = subs?.find((x: any) => x.user_id === p.id);
                    return { ...p, plan: s?.plan || 'free', subscription_id: s?.id };
                });

                let totalMrr = 0;
                merged.forEach(p => {
                    if (p.plan === 'basic')    totalMrr += 19;
                    if (p.plan === 'standard') totalMrr += 29;
                    if (p.plan === 'pro')      totalMrr += 39;
                });
                setMrr(totalMrr);
                setProfiles(merged);
            } else {
                const { data, error } = await supabase.from('support_tickets').select('*').order('created_at', { ascending: false });
                if (error) throw error;
                setTickets(data || []);
            }
        } catch (err: any) {
            setNotification({ message: 'Ladefehler: ' + (err.message || 'Unbekannt'), type: 'error' });
        } finally {
            setLoading(false);
        }
    };

    const toggleRole = (id: string, currentRole: string) => {
        const newRole = currentRole === 'admin' ? 'user' : 'admin';
        setConfirm({
            message: `Soll der Nutzer wirklich den Status ${newRole.toUpperCase()} erhalten?`,
            confirmLabel: 'Ja, Rolle ändern',
            variant: 'danger',
            onConfirm: async () => {
                if (!supabase) return;
                const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', id);
                if (error) {
                    setNotification({ message: 'Fehler beim Ändern der Rolle: ' + error.message, type: 'error' });
                } else {
                    setNotification({ message: 'Rolle erfolgreich geändert.', type: 'success' });
                    fetchAdminData();
                }
            },
        });
    };

    const toggleBan = (id: string, is_banned: boolean) => {
        setConfirm({
            message: is_banned
                ? 'Möchtest du den Zugang für diesen Nutzer wieder FREIGEBEN?'
                : 'Möchtest du den Zugang für diesen Nutzer SPERREN? Der Nutzer wird beim nächsten Laden ausgeloggt.',
            confirmLabel: is_banned ? 'Freigeben' : 'Sperren',
            variant: is_banned ? 'success' : 'danger',
            onConfirm: async () => {
                if (!supabase) return;
                const { error } = await supabase.from('profiles').update({ is_banned: !is_banned }).eq('id', id);
                if (error) {
                    setNotification({ message: 'Fehler beim Sperren: ' + error.message, type: 'error' });
                } else {
                    setNotification({ message: is_banned ? 'Konto entsperrt.' : 'Konto gesperrt.', type: 'success' });
                    fetchAdminData();
                }
            },
        });
    };

    const updateNote = async (id: string, note: string) => {
        if (!supabase) return;
        const { error } = await supabase.from('profiles').update({ admin_notes: note }).eq('id', id);
        if (error) {
            setNotification({ message: 'Notiz konnte nicht gespeichert werden.', type: 'error' });
        }
    };

    const updatePlan = async (userId: string, newPlan: string) => {
        if (!supabase) return;
        const { error } = await supabase
            .from('subscriptions')
            .upsert({ user_id: userId, plan: newPlan }, { onConflict: 'user_id' });
        if (error) {
            setNotification({ message: 'Fehler beim Abo-Wechsel: ' + error.message, type: 'error' });
        } else {
            setNotification({ message: 'Abonnement aktualisiert.', type: 'success' });
            fetchAdminData();
        }
    };

    const updateTicketStatus = async (id: string, newStatus: string) => {
        if (!supabase) return;
        const { error } = await supabase.from('support_tickets').update({ status: newStatus }).eq('id', id);
        if (error) {
            setNotification({ message: 'Fehler beim Ticket Update.', type: 'error' });
        } else {
            fetchAdminData();
        }
    };

    return (
        <div style={{ paddingBottom: '40px' }}>
            {notification && (
                <Notification
                    message={notification.message}
                    type={notification.type}
                    onClose={() => setNotification(null)}
                />
            )}

            {/* Confirmation Modal */}
            {confirm && (
                <div className="modal-overlay" onClick={() => setConfirm(null)}>
                    <div className="modal-box" style={{ maxWidth: '420px' }} onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <AlertTriangle size={20} color={confirm.variant === 'danger' ? 'var(--color-danger)' : 'var(--color-success)'} />
                                <h3 style={{ margin: 0, fontSize: 'var(--font-size-lg)' }}>Bestätigung erforderlich</h3>
                            </div>
                        </div>
                        <div className="modal-body">
                            <p style={{ margin: 0, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>{confirm.message}</p>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-ghost" onClick={() => setConfirm(null)}>Abbrechen</button>
                            <button
                                className={`btn ${confirm.variant === 'danger' ? 'btn-danger-solid' : 'btn-success'}`}
                                onClick={async () => { await confirm.onConfirm(); setConfirm(null); }}
                            >
                                {confirm.confirmLabel}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="page-header" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div>
                    <h2 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <ShieldAlert size={28} color="#be123c" /> SaaS Administration
                    </h2>
                    <p style={{ color: 'var(--color-text-muted)', marginTop: '4px' }}>Zentrale Verwaltung deiner Kunden und Abonnements.</p>
                </div>

                <div style={{ display: 'flex', gap: '16px' }}>
                    <div style={{ backgroundColor: 'var(--color-surface)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', minWidth: '150px' }}>
                        <div style={{ color: 'var(--color-text-muted)', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <UserCheck size={16} /> AKTIVE KUNDEN
                        </div>
                        <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--color-text-main)', marginTop: '4px' }}>
                            {profiles.filter(p => !p.is_banned).length}
                        </div>
                    </div>
                    <div style={{ backgroundColor: 'var(--color-surface)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', minWidth: '150px' }}>
                        <div style={{ color: 'var(--color-text-muted)', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <TrendingUp size={16} /> MONATSUMSATZ (MRR)
                        </div>
                        <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--color-success)', marginTop: '4px' }}>
                            {mrr} €
                        </div>
                    </div>
                </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', marginBottom: 'var(--spacing-lg)' }}>
                <button
                    onClick={() => setActiveTab('users')}
                    style={{ padding: '10px 20px', borderRadius: 'var(--radius-md)', border: 'none', backgroundColor: activeTab === 'users' ? '#be123c' : 'var(--color-surface)', color: activeTab === 'users' ? 'white' : 'var(--color-text-main)', fontWeight: 600, cursor: 'pointer', boxShadow: 'var(--shadow-xs)' }}
                >
                    <Users size={18} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
                    Unternehmensprofile ({profiles.length})
                </button>
                <button
                    onClick={() => setActiveTab('tickets')}
                    style={{ padding: '10px 20px', borderRadius: 'var(--radius-md)', border: 'none', backgroundColor: activeTab === 'tickets' ? '#be123c' : 'var(--color-surface)', color: activeTab === 'tickets' ? 'white' : 'var(--color-text-main)', fontWeight: 600, cursor: 'pointer', boxShadow: 'var(--shadow-xs)' }}
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
                        <div key={p.id} style={{ backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', padding: '20px', border: p.is_banned ? `2px solid var(--color-danger)` : '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: '12px', position: 'relative' }}>

                            {p.is_banned && (
                                <div style={{ position: 'absolute', top: 12, right: 12, backgroundColor: 'var(--color-danger-bg)', color: 'var(--color-danger)', padding: '4px 8px', borderRadius: 'var(--radius-sm)', fontSize: '11px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <Ban size={12} /> GESPERRT
                                </div>
                            )}

                            <div>
                                <h3 style={{ margin: 0, fontSize: '16px', color: 'var(--color-text-main)', paddingRight: '80px', wordBreak: 'break-all' }}>{p.email}</h3>
                                <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-text-muted)' }}>
                                    Mitglied seit: {new Date(p.created_at).toLocaleDateString('de-DE')}
                                </p>
                                {p.company_id && (
                                    <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                                        Company-ID: <code style={{ fontSize: '11px' }}>{p.company_id}</code>
                                    </p>
                                )}
                            </div>

                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <select
                                    value={p.plan || 'free'}
                                    onChange={(e) => updatePlan(p.id, e.target.value)}
                                    style={{ padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface-elevated)', fontWeight: 600, color: p.plan === 'pro' ? '#7e22ce' : 'var(--color-text-secondary)', cursor: 'pointer' }}
                                >
                                    <option value="free">Free (0€)</option>
                                    <option value="basic">Basic (19€)</option>
                                    <option value="standard">Standard (29€)</option>
                                    <option value="pro">Pro (39€)</option>
                                </select>

                                <span style={{ backgroundColor: p.role === 'admin' ? '#be123c' : 'var(--color-border)', color: p.role === 'admin' ? 'white' : 'var(--color-text-muted)', padding: '6px 10px', borderRadius: 'var(--radius-sm)', fontSize: '13px', fontWeight: 600 }}>
                                    {(p.role || 'user').toUpperCase()}
                                </span>
                            </div>

                            <div style={{ marginTop: '8px' }}>
                                <label className="form-label">Interne Notizen:</label>
                                <textarea
                                    defaultValue={p.admin_notes || ''}
                                    onBlur={(e) => updateNote(p.id, e.target.value)}
                                    placeholder="Notizen zum Kunden (speichert beim Verlassen des Feldes)..."
                                    className="input-field"
                                    style={{ height: '60px', resize: 'none', fontSize: 'var(--font-size-sm)' }}
                                />
                            </div>

                            <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto' }}>
                                <button onClick={() => toggleRole(p.id, p.role)} style={{ background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', textDecoration: 'underline', fontSize: '13px', padding: 0 }}>
                                    Admin-Rechte {p.role === 'admin' ? 'entziehen' : 'geben'}
                                </button>

                                <button onClick={() => toggleBan(p.id, p.is_banned)} style={{ background: 'none', border: 'none', color: p.is_banned ? 'var(--color-success)' : 'var(--color-danger)', cursor: 'pointer', fontSize: '13px', fontWeight: 600, padding: 0, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <Ban size={14} /> {p.is_banned ? 'Entsperren' : 'Sperren'}
                                </button>
                            </div>
                        </div>
                    ))}
                    {profiles.length === 0 && (
                        <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '60px', color: 'var(--color-text-muted)' }}>
                            Keine Profile gefunden. Prüfe die Datenbankverbindung und deine Admin-Rolle.
                        </div>
                    )}
                </div>
            ) : (
                <div className="card" style={{ padding: 'var(--spacing-lg)' }}>
                    {tickets.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--color-text-muted)' }}>Keine Support-Tickets vorhanden.</div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                            {tickets.map(t => (
                                <div key={t.id} style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
                                    <div style={{ padding: '12px 16px', backgroundColor: 'var(--color-surface-elevated)', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <strong>{t.subject}</strong>
                                        <span className={`badge ${t.status === 'open' ? 'badge-warning' : 'badge-success'}`}>
                                            {t.status.toUpperCase()}
                                        </span>
                                    </div>
                                    <div style={{ padding: '16px', color: 'var(--color-text-main)' }}>{t.message}</div>
                                    <div style={{ padding: '12px 16px', backgroundColor: 'var(--color-surface-elevated)', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'flex-end' }}>
                                        {t.status === 'open' && (
                                            <button onClick={() => updateTicketStatus(t.id, 'closed')} className="btn btn-success btn-sm">
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
