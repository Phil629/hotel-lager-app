import React from 'react';

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          gap: '16px',
          padding: '24px',
          textAlign: 'center',
          backgroundColor: 'var(--color-background)',
        }}>
          <div style={{ fontSize: '48px' }}>⚠️</div>
          <h2 style={{ margin: 0, color: 'var(--color-text-main)' }}>Hoppla, ein Fehler ist aufgetreten</h2>
          <p style={{ margin: 0, color: 'var(--color-text-muted)', maxWidth: '400px' }}>
            Ein unerwarteter Fehler hat diese Seite zum Absturz gebracht. Bitte lade die Seite neu.
          </p>
          {this.state.error && (
            <pre style={{
              fontSize: '12px',
              color: 'var(--color-text-muted)',
              backgroundColor: 'var(--color-surface)',
              padding: '12px',
              borderRadius: '8px',
              maxWidth: '600px',
              overflow: 'auto',
              textAlign: 'left',
            }}>
              {this.state.error.message}
            </pre>
          )}
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '10px 24px',
              backgroundColor: 'var(--color-primary)',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Seite neu laden
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
