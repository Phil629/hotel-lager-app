import { lazy, type ComponentType } from 'react';

const getSessionItem = (key: string): string | null => {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(key) : null;
  } catch {
    return null;
  }
};

const setSessionItem = (key: string, val: string): void => {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(key, val);
    }
  } catch {
    // ignore
  }
};

const removeSessionItem = (key: string): void => {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
};

/**
 * Checks whether an error is caused by a missing/outdated dynamic script chunk
 * (typically occurs after a new production deployment when the user still has an old tab open).
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  const msg = typeof error === 'string' ? error : (error as any)?.message || String(error);
  return (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    msg.includes('error loading dynamically imported module') ||
    msg.includes('Loading chunk') ||
    (error as any)?.name === 'ChunkLoadError'
  );
}

/**
 * Wraps dynamic React component imports with auto-reload retry logic.
 * When a new deployment renders an old chunk hash obsolete, this automatically
 * reloads the page once to pick up the new build, without showing a crash screen.
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
  chunkKey = 'app_chunk'
) {
  return lazy(async () => {
    const storageKey = `chunk_retry_${chunkKey}`;
    try {
      const module = await factory();
      // Reset retry flag upon successful load
      removeSessionItem(storageKey);
      return module;
    } catch (error) {
      if (isChunkLoadError(error)) {
        const hasRetried = getSessionItem(storageKey) === 'true';

        if (!hasRetried) {
          setSessionItem(storageKey, 'true');
          // Force a full reload to fetch the new HTML and new chunk hashes
          if (typeof window !== 'undefined') {
            window.location.reload();
          }
          // Return a hanging promise so React doesn't render an ErrorBoundary before reload executes
          return new Promise<{ default: T }>(() => {});
        }
      }
      throw error;
    }
  });
}
