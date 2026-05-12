import React, { useState } from 'react';
import { supabase } from '../services/supabase';
import { Key, Save, CheckCircle } from 'lucide-react';

interface UpdatePasswordProps {
    onSuccess: () => void;
}

export const UpdatePassword: React.FC<UpdatePasswordProps> = ({ onSuccess }) => {
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    const handleUpdate = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        if (password !== confirmPassword) {
            setError('Die Passwörter stimmen nicht überein.');
            setLoading(false);
            return;
        }

        if (password.length < 6) {
            setError('Das Passwort muss mindestens 6 Zeichen lang sein.');
            setLoading(false);
            return;
        }

        try {
            if (!supabase) throw new Error("Keine Datenbankverbindung");
            
            const { error } = await supabase.auth.updateUser({ password });
            if (error) throw error;
            
            setSuccess(true);
            setTimeout(() => {
                onSuccess();
            }, 3000);
        } catch (err: any) {
            console.error("Password update error:", err);
            setError(err.message || 'Ein Fehler ist aufgetreten.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', width: '100vw', position: 'fixed', top: 0, left: 0, backgroundColor: 'var(--color-background)', zIndex: 9999 }}>
            <div style={{ width: '100%', maxWidth: '400px', backgroundColor: 'var(--color-surface)', padding: 'var(--spacing-2xl)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-md)', border: '1px solid var(--color-border)' }}>
                <div style={{ textAlign: 'center', marginBottom: 'var(--spacing-xl)' }}>
                    <div style={{ width: '60px', height: '60px', backgroundColor: 'var(--color-primary)', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto var(--spacing-md)' }}>
                        <Key size={30} color="white" />
                    </div>
                    <h2 style={{ margin: 0, fontSize: 'var(--font-size-2xl)', color: 'var(--color-text-main)' }}>
                        Neues Passwort festlegen
                    </h2>
                    <p style={{ color: 'var(--color-text-muted)', marginTop: '8px' }}>
                        Bitte gib ein neues Passwort für dein Konto ein.
                    </p>
                </div>

                {error && (
                    <div style={{ padding: '12px', backgroundColor: 'var(--color-danger-bg)', color: '#b91c1c', borderRadius: 'var(--radius-md)', marginBottom: 'var(--spacing-md)', fontSize: 'var(--font-size-sm)', border: '1px solid #fca5a5' }}>
                        {error}
                    </div>
                )}

                {success ? (
                    <div style={{ textAlign: 'center', padding: 'var(--spacing-xl) 0' }}>
                        <CheckCircle size={48} color="var(--color-success)" style={{ margin: '0 auto var(--spacing-md)' }} />
                        <h3 style={{ color: '#166534', margin: '0 0 8px 0' }}>Passwort erfolgreich geändert!</h3>
                        <p style={{ color: 'var(--color-text-muted)', margin: 0 }}>Du wirst in Kürze weitergeleitet...</p>
                    </div>
                ) : (
                    <form onSubmit={handleUpdate} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-lg)' }}>
                        <div>
                            <label htmlFor="new-password" style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>Neues Passwort</label>
                            <input
                                id="new-password"
                                name="new-password"
                                type="password"
                                required
                                autoComplete="new-password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="input-field"
                                style={{ padding: '12px' }}
                                placeholder="Mindestens 6 Zeichen"
                            />
                        </div>
                        
                        <div>
                            <label htmlFor="confirm-password" style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>Passwort bestätigen</label>
                            <input
                                id="confirm-password"
                                name="confirm-password"
                                type="password"
                                required
                                autoComplete="new-password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                className="input-field"
                                style={{ padding: '12px' }}
                                placeholder="Passwort wiederholen"
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="btn btn-primary"
                            style={{ width: '100%', padding: '14px', fontSize: '16px' }}
                        >
                            <Save size={20} />
                            {loading ? 'Wird gespeichert...' : 'Passwort speichern'}
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
};
