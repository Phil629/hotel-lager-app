import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import './styles/variables.css'

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
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', minHeight: '100vh',
          backgroundColor: '#f8fafc', padding: '40px', textAlign: 'center'
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
          <h1 style={{ color: '#1e293b', fontSize: '24px', marginBottom: '8px' }}>
            Ein unerwarteter Fehler ist aufgetreten
          </h1>
          <p style={{ color: '#64748b', marginBottom: '24px', maxWidth: '500px' }}>
            Bitte lade die Seite neu. Sollte das Problem bestehen bleiben, wende dich an den Support.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              backgroundColor: '#2563eb', color: 'white', border: 'none',
              padding: '12px 24px', borderRadius: '8px', cursor: 'pointer',
              fontSize: '16px', fontWeight: 600, marginBottom: '16px'
            }}
          >
            Seite neu laden
          </button>
          <details style={{ color: '#94a3b8', fontSize: '12px', maxWidth: '600px', textAlign: 'left' }}>
            <summary style={{ cursor: 'pointer', marginBottom: '8px' }}>Technische Details</summary>
            <pre style={{ overflow: 'auto', padding: '12px', backgroundColor: '#f1f5f9', borderRadius: '4px' }}>
              {this.state.error?.toString()}
            </pre>
          </details>
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
