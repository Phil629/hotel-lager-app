import { useState, useEffect, useLayoutEffect, useRef, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { Layout } from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ProtectedRoute } from './components/ProtectedRoute';
import { supabase } from './services/supabase';
import { StorageService } from './services/storage';
import { AppContext } from './contexts/AppContext';

// Lazy-loaded pages for fast initial bundle and optimal code splitting
const Products = lazy(() => import('./pages/Products').then(m => ({ default: m.Products })));
const Orders = lazy(() => import('./pages/Orders').then(m => ({ default: m.Orders })));
const Settings = lazy(() => import('./pages/Settings').then(m => ({ default: m.Settings })));
const Suppliers = lazy(() => import('./pages/Suppliers').then(m => ({ default: m.Suppliers })));
const Pricing = lazy(() => import('./pages/Pricing').then(m => ({ default: m.Pricing })));
const Consumption = lazy(() => import('./pages/Consumption').then(m => ({ default: m.Consumption })));
const Inventory = lazy(() => import('./pages/Inventory').then(m => ({ default: m.Inventory })));
const Auth = lazy(() => import('./pages/Auth').then(m => ({ default: m.Auth })));
const Admin = lazy(() => import('./pages/Admin').then(m => ({ default: m.Admin })));
const Setup = lazy(() => import('./pages/Setup').then(m => ({ default: m.Setup })));
const UpdatePassword = lazy(() => import('./pages/UpdatePassword').then(m => ({ default: m.UpdatePassword })));

const PageLoading = () => (
  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh', color: 'var(--color-text-muted)', fontSize: '15px' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <div style={{
        width: '24px',
        height: '24px',
        border: '3px solid var(--color-border)',
        borderTopColor: 'var(--color-primary)',
        borderRadius: '50%',
        animation: 'spin 0.8s linear infinite'
      }} />
      <span>Lade Bereich...</span>
    </div>
  </div>
);

const AuthRedirect = () => {
  const location = useLocation();
  const from = location.state?.from || localStorage.getItem('lastRoute') || '/products';
  return <Navigate to={from} replace />;
};

const RouteTracker = () => {
  const location = useLocation();
  useEffect(() => {
    const p = location.pathname;
    if (p !== '/' && p !== '/auth' && p !== '/setup') {
      localStorage.setItem('lastRoute', p);
    }
  }, [location]);
  return null;
};

function App() {
  useLayoutEffect(() => {
    const theme = localStorage.getItem('theme') || 'light';
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }, []);

  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRecovery, setIsRecovery] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [isBanned, setIsBanned] = useState(false);

  const [userRole, setUserRole] = useState('');
  const [currentPlan, setCurrentPlan] = useState<'basic' | 'standard' | 'pro'>('basic');
  const [canSeePrices, setCanSeePrices] = useState(false);
  const [canManageSuppliers, setCanManageSuppliers] = useState(false);
  const [canSeePasswords, setCanSeePasswords] = useState(false);
  const [isAiCartEnabled, setIsAiCartEnabled] = useState(true);
  const [overwriteStockOnReceipt, setOverwriteStockOnReceipt] = useState(false);
  const [permissionsLoaded, setPermissionsLoaded] = useState(false);

  // Prevents race condition between getSession and onAuthStateChange
  const checkInProgress = useRef(false);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    const checkBanStatus = async (currentSession: Session | null) => {
      if (checkInProgress.current) return;
      checkInProgress.current = true;

      try {
        if (!currentSession) {
          setSession(null);
          setIsBanned(false);
          setUserRole('');
          setPermissionsLoaded(true);
          return;
        }

        const { data, error } = await supabase!
          .from('profiles')
          .select(`
            is_banned,
            company_id,
            role,
            companies (
              name,
              settings
            )
          `)
          .eq('id', currentSession.user.id)
          .single();

        if (error) {
          console.error("Error fetching profile on auth state change:", error);
          setSession(currentSession);
          return;
        }

        if (data?.is_banned) {
          await supabase!.auth.signOut();
          setSession(null);
          setIsBanned(true);
        } else {
          const role = data?.role || '';
          setSession(currentSession);
          setNeedsSetup(!data?.company_id);
          setIsBanned(false);
          setUserRole(role);

          // Compute permissions from role + company settings
          const companySettings = (data?.companies as any)?.settings || {};
          const isOwnerOrAdmin = role === 'owner' || role === 'admin';
          setCanSeePrices(isOwnerOrAdmin || !!companySettings.staffCanSeePrices);
          setCanManageSuppliers(isOwnerOrAdmin || !!companySettings.staffCanManageSuppliers);
          setCanSeePasswords(isOwnerOrAdmin || !!companySettings.staffCanSeePasswords);
          setIsAiCartEnabled(companySettings.enableAiCart !== false);
          setOverwriteStockOnReceipt(!!companySettings.overwriteStockOnReceipt);
          setPermissionsLoaded(true);

          // Sync company name to local storage
          if (data?.companies && typeof data.companies === 'object' && 'name' in data.companies) {
            const settings = StorageService.getSettings();
            if (settings.hotelName !== (data.companies as any).name) {
              settings.hotelName = (data.companies as any).name as string;
              StorageService.saveSettings(settings);
            }
          }

          // Load plan from DB and cache locally
          const { data: sub } = await supabase!
            .from('subscriptions')
            .select('plan')
            .eq('user_id', currentSession.user.id)
            .single();
          if (sub?.plan) {
            setCurrentPlan(sub.plan as 'basic' | 'standard' | 'pro');
            const settings = StorageService.getSettings();
            if (settings.currentPlan !== sub.plan) {
              settings.currentPlan = sub.plan as any;
              StorageService.saveSettings(settings);
            }
          }
        }
      } finally {
        checkInProgress.current = false;
      }
    };

    supabase!.auth.getSession().then(({ data: { session } }) => {
      checkBanStatus(session).then(() => setLoading(false));
    });

    const { data: { subscription } } = supabase!.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsRecovery(true);
        return;
      }
      
      // If we already have a session for the same user, and this is just a token refresh or update,
      // we don't need to re-fetch the entire profile and permissions.
      // This prevents the app from "jumping around" or resetting state on tab focus.
      if ((event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') && session) {
        setSession(session);
        return;
      }
      
      checkBanStatus(session);
    });

    const handleSettingsUpdate = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail) {
        const newSettings = customEvent.detail;
        setIsAiCartEnabled(newSettings.enableAiCart !== false);
        setOverwriteStockOnReceipt(!!newSettings.overwriteStockOnReceipt);
        // Note: other settings like canSeePrices depend on role, which might be stale in this closure, 
        // but enableAiCart is global so we can safely update it here.
      }
    };
    window.addEventListener('companySettingsUpdated', handleSettingsUpdate);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener('companySettingsUpdated', handleSettingsUpdate);
    };
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: 'var(--color-background)' }}>
        Lade Anwendung...
      </div>
    );
  }

  if (isBanned) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: 'var(--color-danger-bg)', flexDirection: 'column', gap: '16px' }}>
        <div style={{ fontSize: '48px' }}>🚫</div>
        <h2 style={{ color: '#be123c', margin: 0 }}>Konto gesperrt</h2>
        <p style={{ color: '#9f1239', maxWidth: '400px', textAlign: 'center' }}>
          Dein Account wurde vorübergehend gesperrt. Bitte wende dich an den Support, um mehr Informationen zu erhalten.
        </p>
        <a href="mailto:support@bestell-app.de" style={{ color: '#be123c' }}>support@bestell-app.de</a>
      </div>
    );
  }

  if (isRecovery) {
    return (
      <Suspense fallback={<PageLoading />}>
        <UpdatePassword onSuccess={() => setIsRecovery(false)} />
      </Suspense>
    );
  }

  const appContextValue = {
    userRole,
    currentPlan,
    isAdmin: userRole === 'admin',
    canSeePrices,
    canManageSuppliers,
    canSeePasswords,
    permissionsLoaded,
    isAiCartEnabled,
    overwriteStockOnReceipt,
  };

  return (
    <AppContext.Provider value={appContextValue}>
      <Router>
        <RouteTracker />
        <Suspense fallback={<PageLoading />}>
          <Routes>
            {/* Public Route */}
            <Route path="/auth" element={!session ? <Auth onAuthSuccess={() => {}} /> : <AuthRedirect />} />

            {/* Setup Route */}
            <Route path="/setup" element={session && needsSetup ? <Setup onSetupComplete={() => setNeedsSetup(false)} /> : <Navigate to="/products" replace />} />

            {/* Protected App Routes */}
            <Route path="/*" element={
              <ProtectedRoute session={session}>
                {needsSetup ? (
                  <Navigate to="/setup" replace />
                ) : (
                  <Layout>
                    <ErrorBoundary>
                      <Suspense fallback={<PageLoading />}>
                        <Routes>
                          <Route path="/" element={<Navigate to={localStorage.getItem('lastRoute') || "/products"} replace />} />
                          <Route path="/products"    element={<Products />} />
                          <Route path="/orders"      element={<Orders />} />
                          <Route path="/suppliers"   element={<Suppliers />} />
                          <Route path="/inventory"   element={<Inventory />} />
                          <Route path="/pricing"     element={<Pricing />} />
                          <Route path="/consumption" element={<Consumption />} />
                          <Route path="/statistics"  element={<Navigate to="/pricing" replace />} />
                          <Route path="/admin"       element={
                            <ProtectedRoute session={session} requiredRole="admin" userRole={userRole}>
                              <Admin />
                            </ProtectedRoute>
                          } />
                          <Route path="/settings"    element={<Settings />} />
                          <Route path="*"            element={<Navigate to={localStorage.getItem('lastRoute') || "/products"} replace />} />
                        </Routes>
                      </Suspense>
                    </ErrorBoundary>
                  </Layout>
                )}
              </ProtectedRoute>
            } />
          </Routes>
        </Suspense>
      </Router>
    </AppContext.Provider>
  );
}

export default App;
