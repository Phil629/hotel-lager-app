import { DataService } from './data';

/**
 * Offline-first sync queue for inventory counts.
 *
 * - Every count change is written to localStorage immediately (survives
 *   tablet crashes, reloads and dead WiFi in cellars / cold rooms).
 * - Rapid taps on +/- are coalesced per product (last value wins) and sent
 *   after a short debounce instead of one request per tap.
 * - When offline, entries stay queued and are flushed automatically when the
 *   connection returns (online event + periodic retry).
 * - Only `stock` + `last_counted_at` are written (partial update), so a late
 *   sync never overwrites other product fields edited by colleagues.
 */

export interface PendingCount {
    productId: string;
    productName: string;
    stock: number;
    lastCountedAt: string;
    attempts: number;
    lastError?: string;
}

export type SyncState = 'idle' | 'pending' | 'syncing' | 'offline' | 'error';

export interface SyncStatus {
    state: SyncState;
    pendingCount: number;
    lastSyncedAt: string | null;
    failed: PendingCount[];
}

const QUEUE_KEY = 'inventory_sync_queue_v1';
const DEBOUNCE_MS = 600;
const RETRY_INTERVAL_MS = 15_000;
const MAX_ATTEMPTS = 5;

type Listener = (status: SyncStatus) => void;

const isNetworkError = (err: unknown): boolean => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
    const msg = err instanceof Error ? err.message : String(err);
    return /fetch|network|timeout|load failed|ECONN|Failed to fetch/i.test(msg);
};

class InventorySyncQueue {
    private queue: Record<string, PendingCount> = {};
    private failed: Record<string, PendingCount> = {};
    private listeners = new Set<Listener>();
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    private retryTimer: ReturnType<typeof setInterval> | null = null;
    private flushing = false;
    private lastSyncedAt: string | null = null;
    private started = false;

    constructor() {
        this.queue = this.readQueue();
    }

    /** Starts listeners (idempotent). Called by the Inventory page / hook. */
    start(): void {
        if (this.started || typeof window === 'undefined') return;
        this.started = true;
        window.addEventListener('online', this.handleOnline);
        window.addEventListener('offline', this.emit);
        this.retryTimer = setInterval(() => {
            if (this.size() > 0) void this.flush();
        }, RETRY_INTERVAL_MS);
        if (this.size() > 0) void this.flush();
    }

    stop(): void {
        if (!this.started) return;
        this.started = false;
        window.removeEventListener('online', this.handleOnline);
        window.removeEventListener('offline', this.emit);
        if (this.retryTimer) clearInterval(this.retryTimer);
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.retryTimer = null;
        this.debounceTimer = null;
    }

    /** Queues a count (persisted immediately) and schedules a debounced sync. */
    enqueue(entry: Omit<PendingCount, 'attempts' | 'lastError'>): void {
        this.queue[entry.productId] = { ...entry, attempts: 0 };
        delete this.failed[entry.productId];
        this.persist();
        this.emit();
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => void this.flush(), DEBOUNCE_MS);
    }

    /** Pending (not yet synced) values, used to overlay server data after reload. */
    getPending(): Record<string, PendingCount> {
        return { ...this.queue };
    }

    size(): number {
        return Object.keys(this.queue).length;
    }

    /** Re-queues entries that failed permanently (user pressed "retry"). */
    retryFailed(): void {
        for (const [id, entry] of Object.entries(this.failed)) {
            this.queue[id] = { ...entry, attempts: 0, lastError: undefined };
        }
        this.failed = {};
        this.persist();
        this.emit();
        void this.flush();
    }

    /** Discards entries that failed permanently. */
    discardFailed(): void {
        this.failed = {};
        this.emit();
    }

    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        listener(this.getStatus());
        return () => { this.listeners.delete(listener); };
    }

    getStatus(): SyncStatus {
        const pendingCount = this.size();
        const failed = Object.values(this.failed);
        const offline = typeof navigator !== 'undefined' && !navigator.onLine;
        let state: SyncState = 'idle';
        if (failed.length > 0) state = 'error';
        else if (offline && pendingCount > 0) state = 'offline';
        else if (offline) state = 'offline';
        else if (this.flushing) state = 'syncing';
        else if (pendingCount > 0) state = 'pending';
        return { state, pendingCount, lastSyncedAt: this.lastSyncedAt, failed };
    }

    /** Sends all queued counts. Safe to call repeatedly. */
    async flush(): Promise<void> {
        if (this.flushing || this.size() === 0) return;
        if (typeof navigator !== 'undefined' && !navigator.onLine) { this.emit(); return; }

        this.flushing = true;
        this.emit();
        try {
            // Snapshot: entries changed during the flush are kept for the next round
            const batch = Object.values(this.queue);
            for (const entry of batch) {
                try {
                    await DataService.updateProductStock(entry.productId, entry.stock, entry.lastCountedAt);
                    const current = this.queue[entry.productId];
                    if (current && current.stock === entry.stock && current.lastCountedAt === entry.lastCountedAt) {
                        delete this.queue[entry.productId];
                    }
                    this.lastSyncedAt = new Date().toISOString();
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    if (isNetworkError(err)) {
                        // Connection problem: keep everything queued, stop this round
                        break;
                    }
                    const current = this.queue[entry.productId];
                    if (!current) continue;
                    current.attempts += 1;
                    current.lastError = message;
                    if (current.attempts >= MAX_ATTEMPTS) {
                        this.failed[entry.productId] = current;
                        delete this.queue[entry.productId];
                    }
                }
            }
        } finally {
            this.flushing = false;
            this.persist();
            this.emit();
        }
    }

    // ── internals ────────────────────────────────────────────────────────────

    private handleOnline = () => {
        this.emit();
        void this.flush();
    };

    private emit = () => {
        const status = this.getStatus();
        this.listeners.forEach(l => l(status));
    };

    private readQueue(): Record<string, PendingCount> {
        try {
            const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(QUEUE_KEY) : null;
            const parsed = raw ? JSON.parse(raw) : {};
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
            return {};
        }
    }

    private persist(): void {
        try {
            localStorage.setItem(QUEUE_KEY, JSON.stringify(this.queue));
        } catch {
            // Storage full / unavailable — in-memory queue still works for this session
        }
    }
}

export const inventorySync = new InventorySyncQueue();
