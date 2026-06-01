import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import {
    Users, Ticket, CheckCircle, ShieldAlert, Ban, TrendingUp, UserCheck,
    AlertTriangle, Activity, RefreshCw, Edit2, Info, AlertCircle, Zap,
} from 'lucide-react';
import { Notification, type NotificationType } from '../components/Notification';

// ── Interfaces ────────────────────────────────────────────────────────────────

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

interface ShopPlaybook {
    domain: string;
    automation_status: 'none' | 'learning_auth' | 'learning_cart' | 'verified' | 'failed';
    playbook: object | null;
    playbook_previous: object | null;
    playbook_version: number;
    last_learning_run: string | null;
    learning_error: string | null;
    updated_at: string;
    // Aggregiert aus suppliers
    total_complaints: number;
}

interface ConfirmState {
    message: string;
    confirmLabel: string;
    variant: 'danger' | 'success';
    onConfirm: () => Promise<void>;
}

interface EditModalState {
    domain: string;
    playbookJson: string;
}

interface ErrorModalState {
    domain: string;
    error: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, { label: string; color: string; bg: string }> = {
    verified:      { label: 'AKTIV',      color: '#16a34a', bg: '#dcfce7' },
    learning_auth: { label: 'LERNT',      color: '#d97706', bg: '#fef3c7' },
    learning_cart: { label: 'LERNT',      color: '#d97706', bg: '#fef3c7' },
    failed:        { label: 'FEHLER',     color: '#dc2626', bg: '#fee2e2' },
    none:          { label: 'AUSSTEHEND', color: '#6b7280', bg: '#f3f4f6' },
};

function getStatusBadge(status: string, complaints: number) {
    if (complaints > 0 && status === 'verified') {
        return { label: 'BESCHWERDEN', color: '#c2410c', bg: '#ffedd5' };
    }
    return STATUS_BADGE[status] ?? STATUS_BADGE.none;
}

// ── Component ─────────────────────────────────────────────────────────────────

export const Admin = () => {
    const [activeTab, setActiveTab] = useState<'users' | 'tickets' | 'shops'>('users');
    const [profiles, setProfiles]   = useState<AdminProfile[]>([]);
    const [tickets, setTickets]     = useState<SupportTicket[]>([]);
    const [shops, setShops]         = useState<ShopPlaybook[]>([]);
    const [loading, setLoading]     = useState(true);
    const [notification, setNotification] = useState<{ message: string; type: NotificationType } | null>(null);
    const [mrr, setMrr]             = useState(0);
    const [confirm, setConfirm]     = useState<ConfirmState | null>(null);
    const [editModal, setEditModal] = useState<EditModalState | null>(null);
    const [errorModal, setErrorModal] = useState<ErrorModalState | null>(null);

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

            } else if (activeTab === 'tickets') {
                const { data, error } = await supabase.from('support_tickets').select('*').order('created_at', { ascending: false });
                if (error) throw error;
                setTickets(data || []);

            } else {
                // ── Shops tab: join shop_playbooks with aggregated complaints ──
                const { data: playbooksData, error: pbError } = await supabase
                    .from('shop_playbooks')
                    .select('*')
                    .order('updated_at', { ascending: false });
                if (pbError) throw pbError;

                const { data: complaintsData } = await supabase
                    .from('suppliers')
                    .select('playbook_domain, unsuccessful_clicks')
                    .not('playbook_domain', 'is', null);

                const complaintsByDomain: Record<string, number> = {};
                (complaintsData || []).forEach((s: any) => {
                    if (s.playbook_domain) {
                        complaintsByDomain[s.playbook_domain] =
                            (complaintsByDomain[s.playbook_domain] || 0) + (s.unsuccessful_clicks || 0);
                    }
                });

                setShops((playbooksData || []).map((p: any) => ({
                    ...p,
                    total_complaints: complaintsByDomain[p.domain] || 0,
                })));
            }
        } catch (err: any) {
            setNotification({ message: 'Ladefehler: ' + (err.message || 'Unbekannt'), type: 'error' });
        } finally {
            setLoading(false);
        }
    };

    // ── Users tab actions ─────────────────────────────────────────────────────

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
        if (error) setNotification({ message: 'Notiz konnte nicht gespeichert werden.', type: 'error' });
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

    // ── Shops tab actions ─────────────────────────────────────────────────────

    const triggerLearning = async (domain: string) => {
        if (!supabase) return;
        try {
            // Set status to learning_auth immediately for instant visual feedback
            await supabase.from('shop_playbooks')
                .update({ automation_status: 'learning_auth', learning_error: null })
                .eq('domain', domain);

            // Reset complaints for this domain so the trigger counter resets
            await supabase.from('suppliers')
                .update({ unsuccessful_clicks: 0 })
                .eq('playbook_domain', domain);

            // Call the cloud-worker Edge Function
            const { data: { session } } = await supabase.auth.getSession();
            const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/start-learning`;
            const res = await fetch(fnUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${session?.access_token}`,
                },
                body: JSON.stringify({ domain }),
            });

            if (!res.ok) {
                const errText = await res.text().catch(() => 'Unbekannt');
                // Edge Function existiert noch nicht → trotzdem OK, Status wurde gesetzt
                console.warn('[admin] start-learning Edge Function nicht erreichbar:', errText);
                setNotification({ message: `Status auf "Lernt" gesetzt. Edge Function antwortet noch nicht (${res.status}).`, type: 'success' });
            } else {
                setNotification({ message: `Lernprozess für ${domain} erfolgreich gestartet.`, type: 'success' });
            }

            fetchAdminData();
        } catch (err: any) {
            setNotification({ message: 'Fehler: ' + err.message, type: 'error' });
        }
    };

    const openEditModal = (shop: ShopPlaybook) => {
        setEditModal({
            domain: shop.domain,
            playbookJson: shop.playbook
                ? JSON.stringify(shop.playbook, null, 2)
                : JSON.stringify({ login_steps: [], item_steps: [], checkout_steps: [] }, null, 2),
        });
    };

    const savePlaybook = async () => {
        if (!supabase || !editModal) return;
        try {
            const parsed = JSON.parse(editModal.playbookJson);
            const current = shops.find(s => s.domain === editModal.domain);
            const { error } = await supabase.from('shop_playbooks').update({
                playbook_previous: current?.playbook ?? null,
                playbook:          parsed,
                playbook_version:  (current?.playbook_version ?? 0) + 1,
                automation_status: 'verified',
                learning_error:    null,
            }).eq('domain', editModal.domain);
            if (error) throw error;
            setNotification({ message: `Playbook für ${editModal.domain} gespeichert und als verified markiert.`, type: 'success' });
            setEditModal(null);
            fetchAdminData();
        } catch (err: any) {
            setNotification({ message: 'Fehler: ' + (err.message || 'Ungültiges JSON?'), type: 'error' });
        }
    };

    const rollbackPlaybook = async (domain: string) => {
        if (!supabase) return;
        const shop = shops.find(s => s.domain === domain);
        if (!shop?.playbook_previous) {
            setNotification({ message: 'Kein vorheriges Playbook vorhanden.', type: 'error' });
            return;
        }
        setConfirm({
            message: `Playbook für ${domain} auf Version ${(shop.playbook_version ?? 1) - 1} zurücksetzen?`,
            confirmLabel: 'Ja, zurücksetzen',
            variant: 'danger',
            onConfirm: async () => {
                if (!supabase) return;
                const { error } = await supabase.from('shop_playbooks').update({
                    playbook:         shop.playbook_previous,
                    playbook_previous: null,
                    playbook_version: Math.max(1, (shop.playbook_version ?? 1) - 1),
                    automation_status: 'verified',
                }).eq('domain', domain);
                if (error) {
                    setNotification({ message: 'Rollback fehlgeschlagen: ' + error.message, type: 'error' });
                } else {
                    setNotification({ message: `Rollback für ${domain} erfolgreich.`, type: 'success' });
                    fetchAdminData();
                }
            },
        });
    };

    // ── Shops metrics ─────────────────────────────────────────────────────────

    const learningShops  = shops.filter(s => s.automation_status === 'learning_auth' || s.automation_status === 'learning_cart');
    const verifiedShops  = shops.filter(s => s.automation_status === 'verified');
    const problematicShops = shops.filter(s => s.automation_status === 'failed' || s.total_complaints > 0);

    // ── Render ────────────────────────────────────────────────────────────────

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

            {/* Playbook Edit Modal */}
            {editModal && (
                <div className="modal-overlay" onClick={() => setEditModal(null)}>
                    <div className="modal-box" style={{ maxWidth: '720px', width: '95vw' }} onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <Edit2 size={18} />
                                <h3 style={{ margin: 0, fontSize: 'var(--font-size-lg)' }}>Playbook bearbeiten: {editModal.domain}</h3>
                            </div>
                        </div>
                        <div className="modal-body">
                            <p style={{ marginBottom: '8px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
                                Struktur: <code>{'{"login_steps":[...], "item_steps":[...], "checkout_steps":[...]}'}</code>
                            </p>
                            <textarea
                                value={editModal.playbookJson}
                                onChange={e => setEditModal(prev => prev ? { ...prev, playbookJson: e.target.value } : null)}
                                className="input-field"
                                style={{ fontFamily: 'monospace', fontSize: '12px', height: '400px', resize: 'vertical' }}
                                spellCheck={false}
                            />
                        </div>
                        <div className="modal-footer">
                            {shops.find(s => s.domain === editModal.domain)?.playbook_previous && (
                                <button className="btn btn-ghost" onClick={() => { setEditModal(null); rollbackPlaybook(editModal.domain); }}>
                                    Rollback
                                </button>
                            )}
                            <button className="btn btn-ghost" onClick={() => setEditModal(null)}>Abbrechen</button>
                            <button className="btn btn-primary" onClick={savePlaybook}>
                                <CheckCircle size={16} /> Speichern & als Verified markieren
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Error Log Modal */}
            {errorModal && (
                <div className="modal-overlay" onClick={() => setErrorModal(null)}>
                    <div className="modal-box" style={{ maxWidth: '640px', width: '95vw' }} onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <AlertCircle size={18} color="var(--color-danger)" />
                                <h3 style={{ margin: 0, fontSize: 'var(--font-size-lg)' }}>Fehlerprotokoll: {errorModal.domain}</h3>
                            </div>
                        </div>
                        <div className="modal-body">
                            <pre style={{
                                backgroundColor: 'var(--color-surface-elevated)',
                                border: '1px solid var(--color-border)',
                                borderRadius: 'var(--radius-md)',
                                padding: '16px',
                                fontSize: '12px',
                                fontFamily: 'monospace',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-all',
                                maxHeight: '400px',
                                overflowY: 'auto',
                                color: 'var(--color-danger)',
                            }}>
                                {errorModal.error}
                            </pre>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-ghost" onClick={() => setErrorModal(null)}>Schließen</button>
                            <button className="btn btn-primary" onClick={() => { setErrorModal(null); triggerLearning(errorModal.domain); }}>
                                <RefreshCw size={16} /> Neu lernen
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Page Header */}
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

            {/* Tab Navigation */}
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
                <button
                    onClick={() => setActiveTab('shops')}
                    style={{ padding: '10px 20px', borderRadius: 'var(--radius-md)', border: 'none', backgroundColor: activeTab === 'shops' ? '#be123c' : 'var(--color-surface)', color: activeTab === 'shops' ? 'white' : 'var(--color-text-main)', fontWeight: 600, cursor: 'pointer', boxShadow: 'var(--shadow-xs)', display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                    <Activity size={18} />
                    Webshop-Automatisierung
                    {problematicShops.length > 0 && (
                        <span style={{ backgroundColor: '#fee2e2', color: '#dc2626', borderRadius: '10px', padding: '1px 7px', fontSize: '11px', fontWeight: 700 }}>
                            {problematicShops.length}
                        </span>
                    )}
                </button>
            </div>

            {/* Tab Content */}
            {loading ? (
                <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-muted)' }}>Lade Daten...</div>
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

            ) : activeTab === 'tickets' ? (
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

            ) : (
                /* ── Shops Tab ────────────────────────────────────────────── */
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-lg)' }}>

                    {/* Metrics Grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px' }}>
                        {[
                            { icon: <Zap size={18} />, label: 'SHOPS GESAMT', value: shops.length, color: 'var(--color-text-main)' },
                            {
                                icon: <Activity size={18} style={{ color: '#d97706' }} />,
                                label: 'AM LERNEN',
                                value: learningShops.length,
                                color: '#d97706',
                                pulse: learningShops.length > 0,
                            },
                            { icon: <CheckCircle size={18} style={{ color: '#16a34a' }} />, label: 'VERIFIZIERT', value: verifiedShops.length, color: '#16a34a' },
                            { icon: <AlertCircle size={18} style={{ color: '#dc2626' }} />, label: 'PROBLEME', value: problematicShops.length, color: '#dc2626' },
                        ].map((m, i) => (
                            <div key={i} style={{ backgroundColor: 'var(--color-surface)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                                <div style={{ color: 'var(--color-text-muted)', fontSize: '11px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    {m.icon} {m.label}
                                </div>
                                <div style={{ fontSize: '28px', fontWeight: 700, color: m.color, marginTop: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    {m.value}
                                    {(m as any).pulse && m.value > 0 && (
                                        <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#f59e0b', display: 'inline-block', animation: 'pulse 1.2s infinite' }} />
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Shops Table */}
                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                        {shops.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '60px', color: 'var(--color-text-muted)' }}>
                                Noch keine Shops in der Datenbank. Sobald ein Lieferant mit "webshop"-Methode angelegt wird, erscheint er hier.
                            </div>
                        ) : (
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                                <thead>
                                    <tr style={{ backgroundColor: 'var(--color-surface-elevated)', borderBottom: '1px solid var(--color-border)' }}>
                                        {['Lieferant (Domain)', 'Status', 'Kunden-Tickets', 'Letzter Prüflauf', 'Version', 'Aktionen'].map(h => (
                                            <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: 'var(--color-text-muted)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {shops.map(shop => {
                                        const badge = getStatusBadge(shop.automation_status, shop.total_complaints);
                                        return (
                                            <tr key={shop.domain} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                                <td style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text-main)' }}>
                                                    {shop.domain}
                                                </td>
                                                <td style={{ padding: '12px 16px' }}>
                                                    <span style={{ backgroundColor: badge.bg, color: badge.color, padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700 }}>
                                                        {badge.label}
                                                    </span>
                                                </td>
                                                <td style={{ padding: '12px 16px', color: shop.total_complaints > 0 ? '#dc2626' : 'var(--color-text-muted)' }}>
                                                    {shop.total_complaints > 0 ? `${shop.total_complaints}x gemeldet` : '—'}
                                                </td>
                                                <td style={{ padding: '12px 16px', color: 'var(--color-text-muted)', fontSize: '12px' }}>
                                                    {shop.last_learning_run
                                                        ? new Date(shop.last_learning_run).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
                                                        : '—'}
                                                </td>
                                                <td style={{ padding: '12px 16px', color: 'var(--color-text-muted)', fontSize: '12px' }}>
                                                    {shop.playbook ? `v${shop.playbook_version}` : '—'}
                                                </td>
                                                <td style={{ padding: '12px 16px' }}>
                                                    <div style={{ display: 'flex', gap: '6px' }}>
                                                        <button
                                                            title="Lernprozess neu starten"
                                                            onClick={() => triggerLearning(shop.domain)}
                                                            style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '5px 8px', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center' }}
                                                        >
                                                            <RefreshCw size={14} />
                                                        </button>
                                                        <button
                                                            title="Playbook bearbeiten"
                                                            onClick={() => openEditModal(shop)}
                                                            style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '5px 8px', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center' }}
                                                        >
                                                            <Edit2 size={14} />
                                                        </button>
                                                        {shop.learning_error && (
                                                            <button
                                                                title="Fehlerprotokoll anzeigen"
                                                                onClick={() => setErrorModal({ domain: shop.domain, error: shop.learning_error! })}
                                                                style={{ background: 'none', border: '1px solid #fca5a5', borderRadius: 'var(--radius-sm)', padding: '5px 8px', cursor: 'pointer', color: '#dc2626', display: 'flex', alignItems: 'center' }}
                                                            >
                                                                <Info size={14} />
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
