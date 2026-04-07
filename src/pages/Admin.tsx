import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { Users, Ticket, CheckCircle, ShieldAlert } from 'lucide-react';

export const Admin = () => {
    const [activeTab, setActiveTab] = useState<'users' | 'tickets'>('users');
    const [profiles, setProfiles] = useState<any[]>([]);
    const [tickets, setTickets] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchAdminData();
    }, [activeTab]);

    const fetchAdminData = async () => {
        setLoading(true);
        try {
            if (activeTab === 'users') {
                const { data } = await supabase!.from('profiles').select('*').order('created_at', { ascending: false });
                setProfiles(data || []);
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
        if (!window.confirm(`Soll der Nutzer wirklich den Status \${currentRole === 'admin' ? 'user' : 'admin'} erhalten?`)) return;
        try {
            await supabase!.from('profiles').update({ role: currentRole === 'admin' ? 'user' : 'admin' }).eq('id', id);
            fetchAdminData();
        } catch (e) {
            alert('Fehler beim Ändern der Rolle.');
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-xl)' }}>
                <div>
                    <h2 style={{ fontSize: 'var(--font-size-3xl)', margin: 0, color: '#be123c', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <ShieldAlert size={28} /> SaaS Administration
                    </h2>
                    <p style={{ color: 'var(--color-text-muted)', marginTop: '4px' }}>Zentrale Verwaltung deiner Hotel-Kunden und Support-Tickets.</p>
                </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', marginBottom: 'var(--spacing-lg)' }}>
                <button 
                    onClick={() => setActiveTab('users')}
                    style={{ padding: '10px 20px', borderRadius: 'var(--radius-md)', border: 'none', backgroundColor: activeTab === 'users' ? '#be123c' : 'white', color: activeTab === 'users' ? 'white' : 'var(--color-text-main)', fontWeight: 600, cursor: 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}
                >
                    <Users size={18} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
                    Alle Kunden ({profiles.length})
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
                <div style={{ backgroundColor: 'white', borderRadius: 'var(--radius-lg)', padding: 'var(--spacing-lg)', border: '1px solid var(--color-border)' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ borderBottom: '2px solid var(--color-border)', textAlign: 'left', color: 'var(--color-text-muted)' }}>
                                <th style={{ padding: '12px' }}>E-Mail Address</th>
                                <th style={{ padding: '12px' }}>Mitglied seit</th>
                                <th style={{ padding: '12px' }}>Rolle</th>
                                <th style={{ padding: '12px', textAlign: 'right' }}>Aktionen</th>
                            </tr>
                        </thead>
                        <tbody>
                            {profiles.map(p => (
                                <tr key={p.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                    <td style={{ padding: '12px', fontWeight: 600 }}>{p.email}</td>
                                    <td style={{ padding: '12px', color: 'var(--color-text-muted)' }}>{new Date(p.created_at).toLocaleDateString('de-DE')}</td>
                                    <td style={{ padding: '12px' }}>
                                        <span style={{ backgroundColor: p.role === 'admin' ? '#be123c' : '#f1f5f9', color: p.role === 'admin' ? 'white' : '#475569', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600 }}>
                                            {p.role.toUpperCase()}
                                        </span>
                                    </td>
                                    <td style={{ padding: '12px', textAlign: 'right' }}>
                                        <button onClick={() => toggleRole(p.id, p.role)} style={{ background: 'none', border: 'none', color: '#0284c7', cursor: 'pointer', textDecoration: 'underline' }}>
                                            Rolle wechseln
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : (
                <div style={{ backgroundColor: 'white', borderRadius: 'var(--radius-lg)', padding: 'var(--spacing-lg)', border: '1px solid var(--color-border)' }}>
                    {tickets.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--color-text-muted)' }}>Keine Support-Tickets vorhanden.</div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                            {tickets.map(t => (
                                <div key={t.id} style={{ padding: '16px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
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
                                                <CheckCircle size={16} /> Mark as Solved
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
