import React from 'react';
import { logError } from '../services/errors';
import { isChunkLoadError } from '../lib/lazyWithRetry';

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
    if (isChunkLoadError(error)) {
      // Chunk load error typically means a new build was deployed.
      // Auto-reload once to fetch fresh HTML and chunk hashes.
      const lastReload = sessionStorage.getItem('chunk_eb_reload_ts');
      const now = Date.now();
      if (!lastReload || now - Number(lastReload) > 10000) {
        sessionStorage.setItem('chunk_eb_reload_ts', String(now));
        window.location.reload();
        return;
      }
      console.warn('ErrorBoundary: ChunkLoadError after reload, showing update prompt:', error);
      return;
    }

    console.error('ErrorBoundary caught:', error, info);
    logError(`UI-Absturz: ${error.message}`, {
      stack: error.stack?.slice(0, 1000),
      componentStack: info.componentStack?.slice(0, 1000),
    });
  }

  render() {
    if (this.state.hasError) {
      const isChunk = isChunkLoadError(this.state.error);

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
          <div style={{ fontSize: '48px' }}>{isChunk ? '🔄' : '⚠️'}</div>
          <h2 style={{ margin: 0, color: 'var(--color-text-main)' }}>
            {isChunk ? 'Neue Version verfügbar' : 'Hoppla, ein Fehler ist aufgetreten'}
          </h2>
          <p style={{ margin: 0, color: 'var(--color-text-muted)', maxWidth: '420px', lineHeight: 1.5 }}>
            {isChunk
              ? 'Die Anwendung wurde aktualisiert. Bitte lade die Seite neu, um die neueste Version zu laden.'
              : 'Ein unerwarteter Fehler hat diese Seite zum Absturz gebracht. Bitte lade die Seite neu.'}
          </p>
          {this.state.error && !isChunk && (
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
            onClick={() => {
              try {
                sessionStorage.clear();
              } catch {
                // ignore
              }
              window.location.reload();
            }}
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
            {isChunk ? 'Jetzt aktualisieren' : 'Seite neu laden'}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

