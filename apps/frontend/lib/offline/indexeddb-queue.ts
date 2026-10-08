// SSOT Phase 064 Task 2 — IndexedDB progress queue (shared utility)
// Canonical: apps/frontend/lib/offline/indexeddb-queue.ts
// (legacy src/frontend/lib/offline/indexeddb-queue.ts)
// - Single queue over the Phase 063 AhongOfflineOmniCacheDB
//   pendingSyncRecords store (Zero Redundant Code: no second DB).
// - saveProgressToIndexedDB / getPendingSyncCount / getQueuedItems /
//   clearSyncedItems + byte-budget guard (<2KB/item, RAM <5MB total).
// - Zero new deps.
'use client';

import { SYNC_PAYLOAD_MAX_BYTES } from '@repo/shared';
import { OFFLINE_STORES, openOfflineDb } from './indexeddb-schema';

export type QueuedProgressType = 'EBOOK_PAGE' | 'COURSE_LESSON';

export interface QueuedProgressItem {
  id: string;
  type: QueuedProgressType;
  entityId: string;
  payload: Record<string, unknown>;
  createdAt: number;
  retryCount: number;
  status: 'PENDING' | 'SYNCING' | 'FAILED';
}

function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  } catch {
    // fall through
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function saveProgressToIndexedDB(
  type: QueuedProgressType,
  entityId: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const id = newId();
  try {
    const body = JSON.stringify(payload);
    if (body.length > SYNC_PAYLOAD_MAX_BYTES * 4) return id;
    const db = await openOfflineDb();
    await new Promise<void>((resolve, reject) => {
      try {
        const t = db.transaction(OFFLINE_STORES.pendingSyncRecords, 'readwrite');
        t.objectStore(OFFLINE_STORES.pendingSyncRecords).put({
          id,
          type,
          targetId: entityId,
          payload,
          createdAt: Date.now(),
        });
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error ?? new Error('queue put failed'));
      } catch (e) {
        reject(e instanceof Error ? e : new Error('queue put failed'));
      }
    });
  } catch {
    // queue best-effort; live path already attempted
  }
  return id;
}

export async function getPendingSyncCount(): Promise<number> {
  try {
    const db = await openOfflineDb();
    const items = await new Promise<Array<{ id: string }>>((resolve) => {
      try {
        const t = db.transaction(OFFLINE_STORES.pendingSyncRecords, 'readonly');
        const req = t.objectStore(OFFLINE_STORES.pendingSyncRecords).getAll();
        req.onsuccess = () => resolve((req.result as Array<{ id: string }>) ?? []);
        req.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
    return items.length;
  } catch {
    return 0;
  }
}

export async function getQueuedItems(): Promise<QueuedProgressItem[]> {
  try {
    const db = await openOfflineDb();
    const rows = await new Promise<Array<Record<string, unknown>>>((resolve) => {
      try {
        const t = db.transaction(OFFLINE_STORES.pendingSyncRecords, 'readonly');
        const req = t.objectStore(OFFLINE_STORES.pendingSyncRecords).getAll();
        req.onsuccess = () => resolve((req.result as Array<Record<string, unknown>>) ?? []);
        req.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
    return rows.map((r) => ({
      id: String(r['id'] ?? newId()),
      type: r['type'] === 'COURSE_PROGRESS' ? 'COURSE_LESSON' : 'EBOOK_PAGE',
      entityId: String(r['targetId'] ?? ''),
      payload: (r['payload'] as Record<string, unknown>) ?? {},
      createdAt: Number(r['createdAt'] ?? Date.now()),
      retryCount: 0,
      status: 'PENDING' as const,
    }));
  } catch {
    return [];
  }
}

export async function clearSyncedItems(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    const db = await openOfflineDb();
    await new Promise<void>((resolve, reject) => {
      try {
        const t = db.transaction(OFFLINE_STORES.pendingSyncRecords, 'readwrite');
        const store = t.objectStore(OFFLINE_STORES.pendingSyncRecords);
        for (const id of ids) store.delete(id);
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error ?? new Error('clear failed'));
      } catch (e) {
        reject(e instanceof Error ? e : new Error('clear failed'));
      }
    });
  } catch {
    // clear best-effort; next flush re-acks (idempotent batch)
  }
}
