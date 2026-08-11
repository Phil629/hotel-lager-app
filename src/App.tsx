import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { Layout } from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Products } from './pages/Products';
import { Orders } from './pages/Orders';
import { Settings } from './pages/Settings';
import { Suppliers } from './pages/Suppliers';
import { Pricing } from './pages/Pricing';
import { Consumption } from './pages/Consumption';
import { Inventory } from './pages/Inventory';
import { Auth } from './pages/Auth';
import { Admin } from './pages/Admin';
import { Setup } from './pages/Setup';
import { UpdatePassword } from './pages/UpdatePassword';
import { ProtectedRoute } from './components/ProtectedRoute';
import { supabase } from './services/supabase';
import { StorageService } from './services/storage';
import { AppContext } from './contexts/AppContext';

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

        const { data } = await supabase!
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
      checkBanStatus(session);
    });

    return () => subscription.unsubscribe();
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
    return <UpdatePassword onSuccess={() => setIsRecovery(false)} />;
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
  };

  return (
    <AppContext.Provider value={appContextValue}>
      <Router>
        <RouteTracker />
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
                    <Routes>
                      <Route path="/" element={<Navigate to={localStorage.getItem('lastRoute') || "/products"} replace />} />
                      <Route path="/products"    element={<Products />} />
                      <Route path="/orders"      element={<Orders />} />
                      <Route path="/suppliers"   element={<Suppliers />} />
                      <Route path="/inventory"   element={<Inventory />} />
                      <Route path="/pricing"     element={<Pricing />} />
                      <Route path="/consumption" element={<Consumption />} />
                      <Route path="/statistics"  element={<Navigate to="/pricing" replace />} />
                      <Route path="/admin"       element={userRole === 'admin' ? <Admin /> : <Navigate to={localStorage.getItem('lastRoute') || "/products"} replace />} />
                      <Route path="/settings"    element={<Settings />} />
                      <Route path="*"            element={<Navigate to={localStorage.getItem('lastRoute') || "/products"} replace />} />
                    </Routes>
                  </ErrorBoundary>
                </Layout>
              )}
            </ProtectedRoute>
          } />
        </Routes>
      </Router>
    </AppContext.Provider>
  );
}

export default App;
