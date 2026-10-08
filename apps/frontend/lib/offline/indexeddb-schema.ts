// SSOT Phase 063 §4.2 — Offline IDB schema (native, no Dexie.js dep)
// Canonical: apps/frontend/lib/offline/indexeddb-schema.ts
// (legacy src/frontend/lib/offline/indexeddb-schema.ts)
// - RISK_CALL deviation: native IndexedDB (AhongOfflineOmniCacheDB) instead
//   of Dexie.js (zero-new-dep LIFF policy, same store contract as §4.2).
// - Stores: ebookChunks [productId+pageNumber], videoSegments
//   [lessonId+segmentName], drmLeases &productId, pendingSyncRecords.
// - Zero new deps.
import {
  OFFLINE_DB_NAME,
  type OfflineEbookChunk,
  type OfflineVideoSegment,
} from '@repo/shared';

export interface LocalEbookChunk extends OfflineEbookChunk {
  id: string;
}

export interface LocalVideoSegment {
  id: string;
  courseId: string;
  lessonId: string;
  segmentName: string;
  encryptedBuffer: ArrayBuffer;
  segmentIndex: number;
  updatedAt: number;
}

export interface LocalDrmLease {
  productId: string;
  leaseToken: string;
  cryptoKeyHash: string;
  expiresAt: number;
}

export interface PendingSyncRecord {
  id: string;
  type: 'EBOOK_PROGRESS' | 'COURSE_PROGRESS';
  targetId: string;
  payload: Record<string, unknown>;
  createdAt: number;
}

export const OFFLINE_STORES = {
  ebookChunks: 'ebookChunks',
  videoSegments: 'videoSegments',
  drmLeases: 'drmLeases',
  pendingSyncRecords: 'pendingSyncRecords',
} as const;

export function offlineChunkId(productId: string, pageNumber: number): string {
  return `${productId}_p${pageNumber}`;
}

export function offlineSegmentId(lessonId: string, segmentName: string): string {
  return `${lessonId}/${segmentName}`;
}

export function openOfflineDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('indexedDB unavailable'));
        return;
      }
      const req = indexedDB.open(OFFLINE_DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(OFFLINE_STORES.ebookChunks)) {
          const chunks = db.createObjectStore(OFFLINE_STORES.ebookChunks, { keyPath: 'id' });
          chunks.createIndex('by_product_page', ['productId', 'pageNumber'], { unique: true });
        }
        if (!db.objectStoreNames.contains(OFFLINE_STORES.videoSegments)) {
          const segs = db.createObjectStore(OFFLINE_STORES.videoSegments, { keyPath: 'id' });
          segs.createIndex('by_lesson_segment', ['lessonId', 'segmentName'], { unique: true });
          segs.createIndex('by_lesson', 'lessonId', { unique: false });
        }
        if (!db.objectStoreNames.contains(OFFLINE_STORES.drmLeases)) {
          const leases = db.createObjectStore(OFFLINE_STORES.drmLeases, { keyPath: 'productId' });
          leases.createIndex('by_expiry', 'expiresAt', { unique: false });
        }
        if (!db.objectStoreNames.contains(OFFLINE_STORES.pendingSyncRecords)) {
          const pending = db.createObjectStore(OFFLINE_STORES.pendingSyncRecords, { keyPath: 'id' });
          pending.createIndex('by_created', 'createdAt', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('offline db open failed'));
    } catch (e) {
      reject(e instanceof Error ? e : new Error('offline db unavailable'));
    }
  });
}

export type { OfflineEbookChunk, OfflineVideoSegment };
