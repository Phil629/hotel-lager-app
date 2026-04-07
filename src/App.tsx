import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Products } from './pages/Products';
import { Orders } from './pages/Orders';
import { Settings } from './pages/Settings';
import { Suppliers } from './pages/Suppliers';
import { Statistics } from './pages/Statistics';
import { Inventory } from './pages/Inventory';
import { Auth } from './pages/Auth';
import { ProtectedRoute } from './components/ProtectedRoute';
import { supabase } from './services/supabase';

function App() {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    
    // Check active session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: '#f1f5f9' }}>Lade Anwendung...</div>;
  }

  return (
    <Router>
      {!session ? (
        <Routes>
          <Route path="/auth" element={<Auth onAuthSuccess={() => {}} />} />
          <Route path="*" element={<Navigate to="/auth" replace />} />
        </Routes>
      ) : (
        <Layout>
          <Routes>
            <Route path="/" element={<Navigate to="/products" replace />} />
            <Route path="/products" element={<ProtectedRoute session={session}><Products /></ProtectedRoute>} />
            <Route path="/orders" element={<ProtectedRoute session={session}><Orders /></ProtectedRoute>} />
            <Route path="/suppliers" element={<ProtectedRoute session={session}><Suppliers /></ProtectedRoute>} />
            <Route path="/inventory" element={<ProtectedRoute session={session}><Inventory /></ProtectedRoute>} />
            <Route path="/statistics" element={<ProtectedRoute session={session}><Statistics /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute session={session}><Settings /></ProtectedRoute>} />
            <Route path="*" element={<Navigate to="/products" replace />} />
          </Routes>
        </Layout>
      )}
    </Router>
  );
}

export default App;
