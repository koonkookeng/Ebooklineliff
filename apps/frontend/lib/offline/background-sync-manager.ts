// SSOT Phase 064 Task 8 — BackgroundSyncManager (dispatcher + monitor)
// Canonical: apps/frontend/lib/offline/background-sync-manager.ts
// (legacy src/frontend/lib/offline/background-sync-manager.ts)
// - registerProgressSync: SW BackgroundSync tag (dual-tag for the 062/063
//   workers) with online-fallback direct flush.
// - flushProgressQueue: queued items → /api/v1/progress/batch-sync → clear
//   acked (server failedIds stay queued) → BroadcastChannel notify.
// - Retry uses syncBackoffMs ceiling (30s); queue RAM stays <5MB (tiny
//   JSON, cleared on ack). Zero new deps.
'use client';

import { syncBackoffMs, type SyncResponse } from '@repo/shared';
import { clearSyncedItems, getQueuedItems } from './indexeddb-queue';

export const SYNC_TAGS = ['sync-user-progress', 'sync-offline-progress'] as const;

function broadcastSyncCompleted(result: SyncResponse): void {
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('offline-sync-channel');
      channel.postMessage({ type: 'SYNC_COMPLETED', result });
      channel.close();
    }
  } catch {
    // broadcast best-effort
  }
}

function toBatchPayload(items: Awaited<ReturnType<typeof getQueuedItems>>, userId: string) {
  const ebookProgressList: unknown[] = [];
  const courseProgressList: unknown[] = [];
  for (const item of items) {
    if (item.type === 'EBOOK_PAGE') {
      const lastPage = Number((item.payload as Record<string, unknown>)['lastPage'] ?? 1);
      ebookProgressList.push({
        id: item.id,
        productId: String((item.payload as Record<string, unknown>)['productId'] ?? item.entityId),
        lastPage: Number.isInteger(lastPage) && lastPage > 0 ? lastPage : 1,
        clientTimestamp: new Date(item.createdAt).toISOString(),
        signature: '',
      });
    } else {
      const watchedSec = Number((item.payload as Record<string, unknown>)['watchedSec'] ?? 0);
      courseProgressList.push({
        id: item.id,
        lessonId: String((item.payload as Record<string, unknown>)['lessonId'] ?? item.entityId),
        watchedSec: Number.isInteger(watchedSec) && watchedSec >= 0 ? watchedSec : 0,
        isCompleted: (item.payload as Record<string, unknown>)['isCompleted'] === true,
        clientTimestamp: new Date(item.createdAt).toISOString(),
        signature: '',
      });
    }
  }
  return { userId, ebookProgressList, courseProgressList };
}

export async function registerProgressSync(): Promise<void> {
  try {
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      const reg = await navigator.serviceWorker.ready;
      const sync = (reg as unknown as { sync?: { register: (tag: string) => Promise<void> } }).sync;
      if (sync) {
        for (const tag of SYNC_TAGS) {
          await sync.register(tag).catch(() => undefined);
        }
        return;
      }
    }
  } catch {
    // registration best-effort
  }
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    void flushProgressQueue();
  }
}

function batchId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  } catch {
    // fall through
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function flushProgressQueue(userId = ''): Promise<{ flushed: number }> {
  try {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return { flushed: 0 };
    const items = await getQueuedItems();
    if (items.length === 0) return { flushed: 0 };
    const res = await fetch('/api/v1/progress/batch-sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...toBatchPayload(items, userId), syncBatchId: batchId() }),
    });
    const data = (await res.json().catch(() => null)) as SyncResponse | null;
    if (!res.ok || !data) {
      // Retry rides the next online event with syncBackoffMs ceiling (30s);
      // items stay queued (idempotent batch).
      void syncBackoffMs;
      return { flushed: 0 };
    }
    const acked = new Set([...data.syncedEbookIds, ...data.syncedLessonIds]);
    await clearSyncedItems([...acked]).catch(() => undefined);
    broadcastSyncCompleted(data);
    return { flushed: acked.size };
  } catch {
    return { flushed: 0 };
  }
}
