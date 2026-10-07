// SSOT Phase 040 Task 40.6 — Offline chunk cache (IndexedDB, BDD-3)
// Canonical: apps/frontend/lib/reader/offline-chunk-cache.ts
// - Zero-dep raw IndexedDB (no idb wrapper in LIFF bundle): stores entitled
//   vector-SVG chunks per book + queues progress syncs for replay on reconnect.
// - Fail-open everywhere (private mode / no IDB → null, reader falls back to
//   network). Never throws to callers.
// - Follows the Phase 031 keep-alive-client vault pattern (versioned DB,
//   single shared connection).
import type { EbookChunkPayload } from '@repo/shared';

const DB_NAME = 'ebook-reader-offline';
const DB_VERSION = 1;
const CHUNK_STORE = 'chunks';
const PROGRESS_QUEUE = 'progress-queue';

export interface QueuedProgress {
  productId: string;
  lastPage: number;
  readDurationSec: number;
  queuedAt: string;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(CHUNK_STORE)) db.createObjectStore(CHUNK_STORE);
        if (!db.objectStoreNames.contains(PROGRESS_QUEUE)) db.createObjectStore(PROGRESS_QUEUE, { autoIncrement: true });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function chunkKey(productId: string, page: number): string {
  return `${productId}::${page}`;
}

function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return openDb().then((db) => {
    if (!db) return null;
    return new Promise<T | null>((resolve) => {
      try {
        const request = run(db.transaction(store, mode).objectStore(store));
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  });
}

/** Persist one entitled chunk for offline reads (BDD-3 warm path). */
export function saveChunkForOffline(chunk: EbookChunkPayload): Promise<void> {
  return tx(CHUNK_STORE, 'readwrite', (s) => s.put(chunk, chunkKey(chunk.productId, chunk.pageNumber))).then(() => undefined);
}

/** Offline read: chunk previously saved via saveChunkForOffline. */
export function loadChunkOffline(productId: string, page: number): Promise<EbookChunkPayload | null> {
  return tx<EbookChunkPayload>(CHUNK_STORE, 'readonly', (s) => s.get(chunkKey(productId, page)));
}

/** Drop every cached page except the live window (mirrors RAM GC on disk). */
export function pruneOfflineOutside(productId: string, keepPages: number[]): Promise<void> {
  return openDb().then((db) => {
    if (!db) return;
    const keep = new Set(keepPages.map((p) => chunkKey(productId, p)));
    try {
      const store = db.transaction(CHUNK_STORE, 'readwrite').objectStore(CHUNK_STORE);
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c) return;
        if (typeof c.key === 'string' && c.key.startsWith(`${productId}::`) && !keep.has(c.key)) c.delete();
        c.continue();
      };
    } catch {
      // Prune is hygiene — never fail the reader.
    }
  });
}

/** Queue a progress sync while offline; replayed on reconnect (BDD-3). */
export function queueProgressOffline(entry: QueuedProgress): Promise<void> {
  return tx(PROGRESS_QUEUE, 'readwrite', (s) => s.add(entry)).then(() => undefined);
}

/** Drain the queued progress entries (caller POSTs each, then clears). */
export function peekQueuedProgress(): Promise<QueuedProgress[]> {
  return tx<QueuedProgress[]>(PROGRESS_QUEUE, 'readonly', (s) => s.getAll()).then((rows) => rows ?? []);
}

export function clearQueuedProgress(): Promise<void> {
  return tx(PROGRESS_QUEUE, 'readwrite', (s) => s.clear()).then(() => undefined);
}
