import { Link, useLocation } from 'react-router-dom';
import { Package, ShoppingCart, Settings, Users, BarChart3, ClipboardList } from 'lucide-react';
import logo from '../assets/logo.png';
import { StorageService } from '../services/storage';

interface LayoutProps {
    children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
    const location = useLocation();
    const isActive = (path: string) => location.pathname === path;

    return (
        <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--color-background)' }}>
            {/* Sidebar */}
            <aside style={{
                width: '250px',
                backgroundColor: 'var(--color-surface)',
                borderRight: '1px solid var(--color-border)',
                padding: 'var(--spacing-lg)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--spacing-xl)'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)', color: 'var(--color-primary)' }}>
                    <img src={logo} alt="Hotel Logo" style={{ height: '40px', objectFit: 'contain' }} />
                    <h1 style={{ margin: 0, fontSize: 'var(--font-size-xl)' }}>Hotel</h1>
                </div>

                <nav style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-sm)' }}>
                    <Link
                        to="/orders"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 'var(--spacing-sm)',
                            padding: 'var(--spacing-md)',
                            border: 'none',
                            borderRadius: 'var(--radius-md)',
                            backgroundColor: isActive('/orders') ? 'var(--color-primary)' : 'transparent',
                            color: isActive('/orders') ? 'white' : 'var(--color-text-muted)',
                            textDecoration: 'none',
                            fontSize: 'var(--font-size-base)',
                            transition: 'all 0.2s'
                        }}
                    >
                        <ShoppingCart size={20} />
                        Bestellungen
                    </Link>

                    {StorageService.getSettings().inventoryMode && location.pathname !== '/inventory' && (
                        <Link
                            to="/inventory"
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 'var(--spacing-sm)',
                                padding: 'var(--spacing-md)',
                                border: 'none',
                                borderRadius: 'var(--radius-md)',
                                backgroundColor: isActive('/inventory') ? 'var(--color-primary)' : 'transparent',
                                color: isActive('/inventory') ? 'white' : 'var(--color-text-muted)',
                                textDecoration: 'none',
                                fontSize: 'var(--font-size-base)',
                                transition: 'all 0.2s',
                                fontWeight: 600
                            }}
                        >
                            <ClipboardList size={20} />
                            Inventur
                        </Link>
                    )}

                    <Link
                        to="/products"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 'var(--spacing-sm)',
                            padding: 'var(--spacing-md)',
                            border: 'none',
                            borderRadius: 'var(--radius-md)',
                            backgroundColor: isActive('/products') ? 'var(--color-primary)' : 'transparent',
                            color: isActive('/products') ? 'white' : 'var(--color-text-muted)',
                            textDecoration: 'none',
                            fontSize: 'var(--font-size-base)',
                            transition: 'all 0.2s'
                        }}
                    >
                        <Package size={20} />
                        Produkte
                    </Link>

                    <Link
                        to="/suppliers"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 'var(--spacing-sm)',
                            padding: 'var(--spacing-md)',
                            border: 'none',
                            borderRadius: 'var(--radius-md)',
                            backgroundColor: isActive('/suppliers') ? 'var(--color-primary)' : 'transparent',
                            color: isActive('/suppliers') ? 'white' : 'var(--color-text-muted)',
                            textDecoration: 'none',
                            fontSize: 'var(--font-size-base)',
                            transition: 'all 0.2s'
                        }}
                    >
                        <Users size={20} />
                        Lieferanten
                    </Link>

                    <Link
                        to="/statistics"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 'var(--spacing-sm)',
                            padding: 'var(--spacing-md)',
                            border: 'none',
                            borderRadius: 'var(--radius-md)',
                            backgroundColor: isActive('/statistics') ? 'var(--color-primary)' : 'transparent',
                            color: isActive('/statistics') ? 'white' : 'var(--color-text-muted)',
                            textDecoration: 'none',
                            fontSize: 'var(--font-size-base)',
                            transition: 'all 0.2s'
                        }}
                    >
                        <BarChart3 size={20} />
                        Statistiken
                    </Link>

                    <Link
                        to="/settings"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 'var(--spacing-sm)',
                            padding: 'var(--spacing-md)',
                            border: 'none',
                            borderRadius: 'var(--radius-md)',
                            backgroundColor: isActive('/settings') ? 'var(--color-primary)' : 'transparent',
                            color: isActive('/settings') ? 'white' : 'var(--color-text-muted)',
                            textDecoration: 'none',
                            fontSize: 'var(--font-size-base)',
                            transition: 'all 0.2s'
                        }}
                    >
                        <Settings size={20} />
                        Einstellungen
                    </Link>
                </nav>
            </aside>

            {/* Main Content */}
            <main style={{ flex: 1, padding: 'var(--spacing-xl)', overflowY: 'auto' }}>
                
                <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
                    {StorageService.getSettings().inventoryMode && (
                        <div style={{ backgroundColor: '#fff7ed', border: '1px solid #fdba74', padding: '16px', borderRadius: '8px', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                            <div style={{ fontSize: '24px', flexShrink: 0 }}>🚨</div>
                            <div>
                                <div style={{ color: '#c2410c', fontWeight: 700, fontSize: '15px', marginBottom: '4px' }}>Zähl-Assistent (Inventur-Modus) aktiv</div>
                                <div style={{ color: '#ea580c', fontSize: '14px' }}>Der automatische System-Verbrauch ist temporär angehalten, um das Zählergebnis nicht zu verfälschen. Vergiss nicht, ihn nach der Inventur wieder zu deaktivieren!</div>
                            </div>
                        </div>
                    )}
                    {children}

                </div>
            </main>
        </div>
    );
};
