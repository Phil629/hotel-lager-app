import React, { useState } from 'react';
import { supabase } from '../services/supabase';
import { LogIn, UserPlus, Key } from 'lucide-react';

interface AuthProps {
    onAuthSuccess: () => void;
}

export const Auth: React.FC<AuthProps> = ({ onAuthSuccess }) => {
    const [isLogin, setIsLogin] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    const handleAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        setMessage(null);

        try {
            if (!supabase) throw new Error("Keine Datenbankverbindung! Bitte wende dich an den Support.");

            if (isLogin) {
                const { error } = await supabase.auth.signInWithPassword({ email, password });
                if (error) throw error;
                onAuthSuccess();
            } else {
                const { error } = await supabase.auth.signUp({ email, password });
                if (error) throw error;
                setMessage('Registrierung erfolgreich! Bitte überprüfe deine E-Mails.');
                setIsLogin(true); // Switch to login view
            }
        } catch (err: any) {
            console.error("Auth error:", err);
            setError(err.message || 'Ein unbekannter Fehler ist aufgetreten.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '80vh' }}>
            <div style={{ width: '100%', maxWidth: '400px', backgroundColor: 'var(--color-surface)', padding: 'var(--spacing-2xl)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-md)', border: '1px solid var(--color-border)' }}>
                <div style={{ textAlign: 'center', marginBottom: 'var(--spacing-xl)' }}>
                    <div style={{ width: '60px', height: '60px', backgroundColor: 'var(--color-primary)', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto var(--spacing-md)' }}>
                        <Key size={30} color="white" />
                    </div>
                    <h2 style={{ margin: 0, fontSize: 'var(--font-size-2xl)', color: 'var(--color-text-main)' }}>
                        {isLogin ? 'Willkommen zurück' : 'Konto erstellen'}
                    </h2>
                    <p style={{ color: 'var(--color-text-muted)', marginTop: '8px' }}>
                        Hotel Inventur- & Bestellsystem
                    </p>
                </div>

                {error && (
                    <div style={{ padding: '12px', backgroundColor: '#fee2e2', color: '#b91c1c', borderRadius: 'var(--radius-md)', marginBottom: 'var(--spacing-md)', fontSize: 'var(--font-size-sm)', border: '1px solid #fca5a5' }}>
                        {error}
                    </div>
                )}

                {message && (
                    <div style={{ padding: '12px', backgroundColor: '#dcfce3', color: '#166534', borderRadius: 'var(--radius-md)', marginBottom: 'var(--spacing-md)', fontSize: 'var(--font-size-sm)', border: '1px solid #bbf7d0' }}>
                        {message}
                    </div>
                )}

                <form onSubmit={handleAuth} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-lg)' }}>
                    <div>
                        <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>E-Mail Adresse</label>
                        <input
                            type="email"
                            required
                            autoComplete={isLogin ? "username" : "email"}
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            style={{ width: '100%', padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', fontSize: '15px' }}
                            placeholder="hotel@beispiel.de"
                        />
                    </div>
                    
                    <div>
                        <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>Passwort</label>
                        <input
                            type="password"
                            required
                            autoComplete={isLogin ? "current-password" : "new-password"}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            style={{ width: '100%', padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', fontSize: '15px' }}
                            placeholder="Mindestens 6 Zeichen"
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        style={{
                            width: '100%',
                            padding: '14px',
                            backgroundColor: 'var(--color-primary)',
                            color: 'white',
                            border: 'none',
                            borderRadius: 'var(--radius-md)',
                            fontSize: '16px',
                            fontWeight: 600,
                            cursor: loading ? 'not-allowed' : 'pointer',
                            opacity: loading ? 0.7 : 1,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '8px',
                            boxShadow: 'var(--shadow-sm)'
                        }}
                    >
                        {isLogin ? <LogIn size={20} /> : <UserPlus size={20} />}
                        {loading ? 'Wird verarbeitet...' : (isLogin ? 'Anmelden' : 'Registrieren')}
                    </button>
                </form>

                <div style={{ marginTop: 'var(--spacing-xl)', textAlign: 'center', borderTop: '1px solid var(--color-border)', paddingTop: 'var(--spacing-md)' }}>
                    <button
                        type="button"
                        onClick={() => setIsLogin(!isLogin)}
                        style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', textDecoration: 'underline' }}
                    >
                        {isLogin ? 'Noch kein Konto? Hier registrieren' : 'Bereits ein Konto? Hier anmelden'}
                    </button>
                </div>
            </div>
        </div>
    );
};
