import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import './styles/variables.css'
import { isChunkLoadError } from './lib/lazyWithRetry'

// Handle Vite dynamic import chunk preload failures (typically occurs after a new deployment)
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  const lastReload = sessionStorage.getItem('vite_preload_ts');
  const now = Date.now();
  if (!lastReload || now - Number(lastReload) > 10000) {
    sessionStorage.setItem('vite_preload_ts', String(now));
    window.location.reload();
  }
});

// O3: Vollständiger Error Boundary mit UX-freundlicher Fehleranzeige
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    if (isChunkLoadError(error)) {
      const lastReload = sessionStorage.getItem('chunk_root_eb_reload_ts');
      const now = Date.now();
      if (!lastReload || now - Number(lastReload) > 10000) {
        sessionStorage.setItem('chunk_root_eb_reload_ts', String(now));
        window.location.reload();
        return;
      }
    }
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      const isChunk = isChunkLoadError(this.state.error);

      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', minHeight: '100vh',
          backgroundColor: '#f8fafc', padding: '40px', textAlign: 'center'
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>{isChunk ? '🔄' : '⚠️'}</div>
          <h1 style={{ color: '#1e293b', fontSize: '24px', marginBottom: '8px' }}>
            {isChunk ? 'Neue Version verfügbar' : 'Ein unerwarteter Fehler ist aufgetreten'}
          </h1>
          <p style={{ color: '#64748b', marginBottom: '24px', maxWidth: '500px', lineHeight: 1.5 }}>
            {isChunk
              ? 'Die Anwendung wurde aktualisiert. Bitte lade die Seite neu, um die neueste Version zu verwenden.'
              : 'Bitte lade die Seite neu. Sollte das Problem bestehen bleiben, wende dich an den Support.'}
          </p>
          <button
            onClick={() => {
              try {
                sessionStorage.clear();
              } catch {
                // ignore
              }
              window.location.reload();
            }}
            style={{
              backgroundColor: '#2563eb', color: 'white', border: 'none',
              padding: '12px 24px', borderRadius: '8px', cursor: 'pointer',
              fontSize: '16px', fontWeight: 600, marginBottom: '16px'
            }}
          >
            {isChunk ? 'Jetzt aktualisieren' : 'Seite neu laden'}
          </button>
          {!isChunk && (
            <details style={{ color: '#94a3b8', fontSize: '12px', maxWidth: '600px', textAlign: 'left' }}>
              <summary style={{ cursor: 'pointer', marginBottom: '8px' }}>Technische Details</summary>
              <pre style={{ overflow: 'auto', padding: '12px', backgroundColor: '#f1f5f9', borderRadius: '4px' }}>
                {this.state.error?.toString()}
              </pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}


ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
