// SSOT Phase 062 §6.2 — IndexedDBEngine (native zene_pwa_db, no `idb` dep)
// Canonical: apps/frontend/lib/pwa/indexeddb-engine.ts
// (legacy src/frontend/lib/pwa/indexeddb-engine.ts)
// - RISK_CALL deviation: native IndexedDB wrapper instead of the `idb`
//   package (zero-new-dep LIFF policy, same store contract as §4.2).
// - Stores: ebook_chunks_store [productId+pageNumber], video_meta_store,
//   sync_queue_store. Chunk-cell writes stay small (single SVG/page) so the
//   volatile window keeps RAM <30MB.
// - Zero new deps.
import {
  PWA_CHUNK_STORE,
  PWA_DB_NAME,
  PWA_SYNC_STORE,
  PWA_VIDEO_STORE,
  chunkCellId,
  type OfflineSyncQueueItem,
} from '@repo/shared';

const DB_VERSION = 1;

export interface ChunkCell {
  id: string;
  productId: string;
  pageNumber: number;
  vectorSvgContent: string;
  cachedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(PWA_DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(PWA_CHUNK_STORE)) {
          const store = db.createObjectStore(PWA_CHUNK_STORE, { keyPath: 'id' });
          store.createIndex('by_product_page', ['productId', 'pageNumber'], { unique: true });
        }
        if (!db.objectStoreNames.contains(PWA_VIDEO_STORE)) {
          db.createObjectStore(PWA_VIDEO_STORE, { keyPath: 'lessonId' });
        }
        if (!db.objectStoreNames.contains(PWA_SYNC_STORE)) {
          const sync = db.createObjectStore(PWA_SYNC_STORE, { keyPath: 'id' });
          sync.createIndex('by_timestamp', 'timestamp', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('idb open failed'));
    } catch (e) {
      reject(e instanceof Error ? e : new Error('idb unavailable'));
    }
  });
}

function tx<T>(db: IDBDatabase, store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      const t = db.transaction(store, mode);
      const req = run(t.objectStore(store));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('idb request failed'));
    } catch (e) {
      reject(e instanceof Error ? e : new Error('idb transaction failed'));
    }
  });
}

export class IndexedDBEngine {
  private db: Promise<IDBDatabase> | null = null;

  private conn(): Promise<IDBDatabase> {
    if (typeof indexedDB === 'undefined') return Promise.reject(new Error('indexedDB unavailable'));
    if (!this.db) this.db = openDb();
    return this.db;
  }

  async cacheEbookChunk(productId: string, pageNumber: number, vectorSvgContent: string): Promise<void> {
    const db = await this.conn();
    const cell: ChunkCell = { id: chunkCellId(productId, pageNumber), productId, pageNumber, vectorSvgContent, cachedAt: Date.now() };
    await tx(db, PWA_CHUNK_STORE, 'readwrite', (s) => s.put(cell));
  }

  async getEbookChunk(productId: string, pageNumber: number): Promise<string | null> {
    const db = await this.conn();
    const cell = await tx<ChunkCell | undefined>(db, PWA_CHUNK_STORE, 'readonly', (s) => s.get(chunkCellId(productId, pageNumber)));
    return cell ? cell.vectorSvgContent : null;
  }

  async enqueueOfflineSync(item: OfflineSyncQueueItem): Promise<void> {
    const db = await this.conn();
    await tx(db, PWA_SYNC_STORE, 'readwrite', (s) => s.put(item));
  }

  async getPendingSyncItems(): Promise<OfflineSyncQueueItem[]> {
    const db = await this.conn();
    return tx<OfflineSyncQueueItem[]>(db, PWA_SYNC_STORE, 'readonly', (s) => s.getAll());
  }

  async clearSyncItems(ids: string[]): Promise<void> {
    const db = await this.conn();
    await new Promise<void>((resolve, reject) => {
      try {
        const t = db.transaction(PWA_SYNC_STORE, 'readwrite');
        const store = t.objectStore(PWA_SYNC_STORE);
        for (const id of ids) store.delete(id);
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error ?? new Error('clear failed'));
      } catch (e) {
        reject(e instanceof Error ? e : new Error('clear failed'));
      }
    });
  }
}

export const indexedDBEngine = new IndexedDBEngine();
