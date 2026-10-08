// SSOT Phase 069 Task 4 — Offline action queue (native IndexedDB, §6.1)
// Canonical: apps/frontend/lib/offline-queue-db.ts
// (legacy src/frontend/lib/offline-queue-db.ts)
// - RISK_CALL deviation: native IndexedDB (`omni-network-offline-db`,
//   store `offline-actions` keyed by uuid + `by-actionType` index) instead
//   of the `idb` package (zero-new-dep LIFF policy; same contract as §6.1).
// - Enqueue stamps SHA-256 integrity (Gate 4); flush removes only
//   server-acked ids (failed stay queued with retryCount++).
// - Zero new deps.
import { queueItemIntegrity, type OfflineQueueActionType } from '@repo/shared';

export interface QueuedOfflineAction {
  id: string;
  actionType: OfflineQueueActionType;
  payload: Record<string, unknown>;
  integrity: string;
  createdAt: string;
  retryCount: number;
}

const DB_NAME = 'omni-network-offline-db';
const DB_VERSION = 1;
const STORE = 'offline-actions';

function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  } catch {
    // fall through
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          const store = req.result.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('by-actionType', 'actionType', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function enqueueOfflineAction(
  actionType: OfflineQueueActionType,
  payload: Record<string, unknown>,
): Promise<string> {
  const id = newId();
  const createdAt = new Date().toISOString();
  const payloadJson = JSON.stringify(payload);
  let integrity = '';
  try {
    integrity = await queueItemIntegrity(actionType, payloadJson, createdAt);
  } catch {
    // integrity best-effort; server re-validates shape + ownership
  }
  const db = await openDb();
  if (!db) return id;
  try {
    await new Promise<void>((resolve, reject) => {
      try {
        const t = db.transaction(STORE, 'readwrite');
        t.objectStore(STORE).put({ id, actionType, payload, integrity, createdAt, retryCount: 0 });
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error ?? new Error('enqueue failed'));
      } catch (e) {
        reject(e instanceof Error ? e : new Error('enqueue failed'));
      }
    });
  } catch {
    // queue best-effort
  } finally {
    db.close();
  }
  return id;
}

export async function getQueuedActions(): Promise<QueuedOfflineAction[]> {
  const db = await openDb();
  if (!db) return [];
  try {
    return await new Promise<QueuedOfflineAction[]>((resolve) => {
      try {
        const t = db.transaction(STORE, 'readonly');
        const req = t.objectStore(STORE).getAll();
        req.onsuccess = () => resolve((req.result as QueuedOfflineAction[]) ?? []);
        req.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
  } finally {
    db.close();
  }
}

export async function removeQueuedActions(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await openDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      try {
        const t = db.transaction(STORE, 'readwrite');
        const store = t.objectStore(STORE);
        for (const id of ids) store.delete(id);
        t.oncomplete = () => resolve();
        t.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  } finally {
    db.close();
  }
}

export async function bumpRetryCounts(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await openDb();
  if (!db) return;
  try {
    const rows = await new Promise<QueuedOfflineAction[]>((resolve) => {
      try {
        const t = db.transaction(STORE, 'readonly');
        const req = t.objectStore(STORE).getAll();
        req.onsuccess = () => resolve((req.result as QueuedOfflineAction[]) ?? []);
        req.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
    await new Promise<void>((resolve) => {
      try {
        const t = db.transaction(STORE, 'readwrite');
        const store = t.objectStore(STORE);
        for (const row of rows) {
          if (ids.includes(row.id)) store.put({ ...row, retryCount: (row.retryCount ?? 0) + 1 });
        }
        t.oncomplete = () => resolve();
        t.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  } finally {
    db.close();
  }
}
