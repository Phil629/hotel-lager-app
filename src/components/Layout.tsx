import React from 'react';
import { Link } from 'react-router-dom';
import { Package, ShoppingCart, Settings } from 'lucide-react';

import logo from '../assets/logo.png';

interface LayoutProps {
    children: React.ReactNode;
    currentPage: 'products' | 'orders' | 'settings';
    onNavigate: (page: 'products' | 'orders' | 'settings') => void;
}

export const Layout: React.FC<LayoutProps> = ({ children, currentPage, onNavigate }) => {
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
                        onClick={() => onNavigate('orders')}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 'var(--spacing-sm)',
                            padding: 'var(--spacing-md)',
                            border: 'none',
                            borderRadius: 'var(--radius-md)',
                            backgroundColor: currentPage === 'orders' ? 'var(--color-primary)' : 'transparent',
                            color: currentPage === 'orders' ? 'white' : 'var(--color-text-muted)',
                            textDecoration: 'none',
                            fontSize: 'var(--font-size-base)',
                            transition: 'all 0.2s'
                        }}
                    >
                        <ShoppingCart size={20} />
                        Bestellungen
                    </Link>

                    <Link
                        to="/products"
                        onClick={() => onNavigate('products')}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 'var(--spacing-sm)',
                            padding: 'var(--spacing-md)',
                            border: 'none',
                            borderRadius: 'var(--radius-md)',
                            backgroundColor: currentPage === 'products' ? 'var(--color-primary)' : 'transparent',
                            color: currentPage === 'products' ? 'white' : 'var(--color-text-muted)',
                            textDecoration: 'none',
                            fontSize: 'var(--font-size-base)',
                            transition: 'all 0.2s'
                        }}
                    >
                        <Package size={20} />
                        Produkte
                    </Link>

                    <Link
                        to="/settings"
                        onClick={() => onNavigate('settings')}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 'var(--spacing-sm)',
                            padding: 'var(--spacing-md)',
                            border: 'none',
                            borderRadius: 'var(--radius-md)',
                            backgroundColor: currentPage === 'settings' ? 'var(--color-primary)' : 'transparent',
                            color: currentPage === 'settings' ? 'white' : 'var(--color-text-muted)',
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
                    {children}
                </div>
            </main>
        </div>
    );
};
