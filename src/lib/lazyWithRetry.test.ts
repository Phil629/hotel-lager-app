// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isChunkLoadError, lazyWithRetry } from './lazyWithRetry';

describe('lazyWithRetry', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  describe('isChunkLoadError', () => {
    it('detects standard Vite/browser dynamic import failure messages', () => {
      expect(
        isChunkLoadError(
          new Error('Failed to fetch dynamically imported module: https://kunden.bestellwesen.com/assets/Suppliers-pgrb-rCz.js')
        )
      ).toBe(true);

      expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true);
      expect(isChunkLoadError(new Error('error loading dynamically imported module'))).toBe(true);
      expect(isChunkLoadError(new Error('Loading chunk 42 failed.'))).toBe(true);

      const chunkErr = new Error('Chunk error');
      chunkErr.name = 'ChunkLoadError';
      expect(isChunkLoadError(chunkErr)).toBe(true);
    });

    it('returns false for unrelated errors or null', () => {
      expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
      expect(isChunkLoadError(new Error('Network error 500'))).toBe(false);
      expect(isChunkLoadError(null)).toBe(false);
      expect(isChunkLoadError(undefined)).toBe(false);
    });
  });

  describe('lazyWithRetry component wrapper', () => {
    it('loads component successfully on first try', async () => {
      const MockComponent = () => null;
      const factory = vi.fn().mockResolvedValue({ default: MockComponent });

      const LazyComp = lazyWithRetry(factory, 'test_page');
      expect(LazyComp).toBeDefined();

      const res = await factory();
      expect(res.default).toBe(MockComponent);
      expect(sessionStorage.getItem('chunk_retry_test_page')).toBeNull();
    });
  });
});
