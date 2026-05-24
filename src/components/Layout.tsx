import { Link, useLocation } from 'react-router-dom';
import { Package, ShoppingCart, Settings, Users, TrendingUp, Activity, ClipboardList, ShieldAlert, WifiOff } from 'lucide-react';
import logo from '../assets/logo.png';
import { StorageService } from '../services/storage';
import { supabase } from '../services/supabase';
import { useState, useEffect } from 'react';

function useOnlineStatus() {
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    useEffect(() => {
        const on = () => setIsOnline(true);
        const off = () => setIsOnline(false);
        window.addEventListener('online', on);
        window.addEventListener('offline', off);
        return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
    }, []);
    return isOnline;
}

interface LayoutProps {
    children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
    const location = useLocation();
    const isOnline = useOnlineStatus();

    const settings = StorageService.getSettings();
    const [isAdmin, setIsAdmin] = useState(false);
    const [userRole, setUserRole] = useState<string>('');
    const [userEmail, setUserEmail] = useState<string>('');

    useEffect(() => {
        const checkAdmin = async () => {
            if (!supabase) return;
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                setUserEmail(user.email || '');
                const { data } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
                setUserRole(data?.role || '');
                if (user.email?.toLowerCase() === 'phdehos@gmail.com') setIsAdmin(true);
            }
        };
        checkAdmin();
    }, []);

    const displayLogo = settings.logoUrl || logo;
    const displayHotelName = settings.hotelName || 'Unternehmen';

    const navLink = (path: string, variant?: 'inventory' | 'admin') => {
        const active = location.pathname === path;
        const base = 'sidebar-nav-link';
        const variantClass = variant ? ` ${variant}` : '';
        const activeClass = active ? ' active' : '';
        return `${base}${variantClass}${activeClass}`;
    };

    const roleBadge = isAdmin
        ? { label: 'System-Admin', bg: 'rgba(239,68,68,0.18)', color: '#fca5a5' }
        : userRole === 'owner'
            ? { label: 'Inhaber', bg: 'rgba(59,130,246,0.18)', color: '#93c5fd' }
            : null;

    return (
        <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--color-background)' }}>
            {/* ── Dark Sidebar ── */}
            <aside style={{
                width: 'var(--sidebar-width)',
                flexShrink: 0,
                backgroundColor: 'var(--sidebar-bg)',
                display: 'flex',
                flexDirection: 'column',
                boxShadow: '2px 0 8px rgba(0,0,0,0.25)',
            }}>
                {/* Logo + Company + User */}
                <div style={{
                    padding: '20px 16px',
                    borderBottom: '1px solid var(--sidebar-border)',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: userEmail ? '10px' : 0 }}>
                        <img
                            src={displayLogo}
                            alt="Logo"
                            style={{ height: '34px', width: '34px', objectFit: 'contain', borderRadius: '8px', flexShrink: 0 }}
                        />
                        <span style={{
                            color: 'var(--sidebar-text-active)',
                            fontWeight: 700,
                            fontSize: '15px',
                            lineHeight: 1.3,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                        }}>
                            {displayHotelName}
                        </span>
                    </div>

                    {userEmail && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                            <span style={{
                                fontSize: '11.5px',
                                color: 'var(--sidebar-text)',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                maxWidth: '150px',
                            }}>
                                {userEmail}
                            </span>
                            {roleBadge && (
                                <span style={{
                                    backgroundColor: roleBadge.bg,
                                    color: roleBadge.color,
                                    fontSize: '10px',
                                    fontWeight: 700,
                                    padding: '2px 7px',
                                    borderRadius: 'var(--radius-full)',
                                    flexShrink: 0,
                                    letterSpacing: '0.02em',
                                }}>
                                    {roleBadge.label}
                                </span>
                            )}
                        </div>
                    )}
                </div>

                {/* Navigation */}
                <nav style={{
                    flex: 1,
                    padding: '10px 8px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px',
                    overflowY: 'auto',
                }}>
                    {StorageService.getSettings().inventoryMode && (
                        <Link to="/inventory" className={navLink('/inventory', 'inventory')}>
                            <ClipboardList size={17} style={{ flexShrink: 0 }} />
                            Inventur
                        </Link>
                    )}

                    <Link to="/orders" className={navLink('/orders')}>
                        <ShoppingCart size={17} style={{ flexShrink: 0 }} />
                        Bestellungen
                    </Link>

                    <Link to="/products" className={navLink('/products')}>
                        <Package size={17} style={{ flexShrink: 0 }} />
                        Produkte
                    </Link>

                    <Link to="/suppliers" className={navLink('/suppliers')}>
                        <Users size={17} style={{ flexShrink: 0 }} />
                        Lieferanten
                    </Link>

                    <Link to="/pricing" className={navLink('/pricing')}>
                        <TrendingUp size={17} style={{ flexShrink: 0 }} />
                        Finanzen
                    </Link>

                    <Link to="/consumption" className={navLink('/consumption')}>
                        <Activity size={17} style={{ flexShrink: 0 }} />
                        Verbrauch
                    </Link>

                    <Link to="/settings" className={navLink('/settings')}>
                        <Settings size={17} style={{ flexShrink: 0 }} />
                        Einstellungen
                    </Link>
                </nav>

                {/* Admin — pinned to bottom */}
                {isAdmin && (
                    <div style={{ padding: '8px', borderTop: '1px solid var(--sidebar-border)' }}>
                        <Link to="/admin" className={navLink('/admin', 'admin')}>
                            <ShieldAlert size={17} style={{ flexShrink: 0 }} />
                            SaaS Admin
                        </Link>
                    </div>
                )}
            </aside>

            {/* ── Main Content ── */}
            <main style={{ flex: 1, padding: 'var(--spacing-xl)', overflowY: 'auto', minWidth: 0 }}>
                <div style={{ maxWidth: '1280px', margin: '0 auto' }}>
                    {!isOnline && (
                        <div style={{
                            backgroundColor: 'var(--color-surface-elevated)',
                            border: '1px solid var(--color-border-strong)',
                            padding: '10px 20px',
                            borderRadius: 'var(--radius-lg)',
                            marginBottom: '16px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            boxShadow: 'var(--shadow-sm)',
                        }}>
                            <WifiOff size={16} color="var(--color-text-muted)" style={{ flexShrink: 0 }} />
                            <span style={{ fontSize: '13px', color: 'var(--color-text-muted)', fontWeight: 500 }}>
                                Keine Internetverbindung — die App läuft im Offline-Modus. Änderungen werden nicht synchronisiert.
                            </span>
                        </div>
                    )}
                    {StorageService.getSettings().inventoryMode && location.pathname !== '/inventory' && (
                        <div style={{
                            backgroundColor: 'var(--color-warning-bg)',
                            border: '1px solid #fdba74',
                            padding: '14px 20px',
                            borderRadius: 'var(--radius-lg)',
                            marginBottom: '24px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '14px',
                            boxShadow: 'var(--shadow-sm)',
                        }}>
                            <div style={{ fontSize: '22px', flexShrink: 0 }}>🚨</div>
                            <div>
                                <div style={{ color: '#c2410c', fontWeight: 700, fontSize: '14px', marginBottom: '3px' }}>
                                    Zähl-Assistent (Inventur-Modus) aktiv
                                </div>
                                <div style={{ color: '#ea580c', fontSize: '13px' }}>
                                    Der automatische System-Verbrauch ist temporär angehalten. Bitte nach der Inventur deaktivieren.
                                </div>
                            </div>
                        </div>
                    )}
                    {children}
                </div>
            </main>
        </div>
    );
};
