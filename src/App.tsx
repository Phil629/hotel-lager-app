import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { Layout } from './components/Layout';
import { Products } from './pages/Products';
import { Orders } from './pages/Orders';
import { Settings } from './pages/Settings';
import { Suppliers } from './pages/Suppliers';
import { Statistics } from './pages/Statistics';
import { Inventory } from './pages/Inventory';
import { Auth } from './pages/Auth';
import { Admin } from './pages/Admin';
import { Setup } from './pages/Setup';
import { UpdatePassword } from './pages/UpdatePassword';
import { ProtectedRoute } from './components/ProtectedRoute';
import { supabase } from './services/supabase';
import { StorageService } from './services/storage';

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
  const [userRole, setUserRole] = useState<string>('');
  // K3: Ban-Meldung als State statt alert()
  const [isBanned, setIsBanned] = useState(false);
  // Verhindert Race Condition zwischen getSession und onAuthStateChange
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
          return;
        }

        const { data } = await supabase!
          .from('profiles')
          .select('is_banned, company_id, role')
          .eq('id', currentSession.user.id)
          .single();

        if (data?.is_banned) {
          await supabase!.auth.signOut();
          setSession(null);
          setIsBanned(true);
        } else {
          setSession(currentSession);
          setUserRole(data?.role || '');
          setNeedsSetup(!data?.company_id);
          setIsBanned(false);

          // K4: Plan aus der Datenbank laden und lokal cachen
          const { data: sub } = await supabase!
            .from('subscriptions')
            .select('plan')
            .eq('user_id', currentSession.user.id)
            .single();
          if (sub?.plan) {
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

  // K3: Schöne Ban-Meldung statt alert()
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

  return (
    <Router>
      {!session ? (
        <Routes>
          <Route path="/auth" element={<Auth onAuthSuccess={() => {}} />} />
          <Route path="*" element={<Navigate to="/auth" replace />} />
        </Routes>
      ) : needsSetup ? (
        <Routes>
          <Route path="/setup" element={<Setup />} />
          <Route path="*" element={<Navigate to="/setup" replace />} />
        </Routes>
      ) : (
        <Layout>
          <Routes>
            <Route path="/" element={<Navigate to="/products" replace />} />
            <Route path="/products"   element={<ProtectedRoute session={session}><Products /></ProtectedRoute>} />
            <Route path="/orders"     element={<ProtectedRoute session={session}><Orders /></ProtectedRoute>} />
            <Route path="/suppliers"  element={<ProtectedRoute session={session}><Suppliers /></ProtectedRoute>} />
            <Route path="/inventory"  element={<ProtectedRoute session={session}><Inventory /></ProtectedRoute>} />
            <Route path="/statistics" element={<ProtectedRoute session={session}><Statistics /></ProtectedRoute>} />
            {/* K2: Admin-Route nur für role='admin' */}
            <Route path="/admin" element={
              <ProtectedRoute session={session} requiredRole="admin" userRole={userRole}>
                <Admin />
              </ProtectedRoute>
            } />
            <Route path="/settings"   element={<ProtectedRoute session={session}><Settings /></ProtectedRoute>} />
            <Route path="*" element={<Navigate to="/products" replace />} />
          </Routes>
        </Layout>
      )}
    </Router>
  );
}

export default App;
