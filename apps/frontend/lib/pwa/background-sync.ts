// SSOT Phase 062 §6.2/§7.1 — BackgroundSyncEngine (offline queue flush)
// Canonical: apps/frontend/lib/pwa/background-sync.ts
// (legacy src/frontend/lib/pwa/background-sync.ts)
// - enqueueProgress: IDB sync_queue_store write (offline-safe reads/watches).
// - flushSyncQueue: online transition → bulk POST → clear acked ids
//   (server failedIds stay queued for the next flush). best-effort, never
//   throws into the reader loop. Zero new deps.
import { BulkOfflineSyncResponseSchema, type OfflineSyncQueueItem } from '@repo/shared';
import { indexedDBEngine } from './indexeddb-engine';

function deviceId(): string {
  try {
    const key = 'zene-device-id';
    let id = localStorage.getItem(key);
    if (!id) {
      id = `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return 'web-unknown';
  }
}

export async function enqueueProgress(item: OfflineSyncQueueItem): Promise<void> {
  try {
    await indexedDBEngine.enqueueOfflineSync(item);
  } catch {
    // queue best-effort; the live path already synced
  }
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    void flushSyncQueue();
  }
}

export async function flushSyncQueue(): Promise<{ flushed: number }> {
  try {
    const pending = await indexedDBEngine.getPendingSyncItems();
    if (pending.length === 0) return { flushed: 0 };
    const res = await fetch('/api/v1/offline-sync/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-device-id': deviceId() },
      body: JSON.stringify({ deviceId: deviceId(), syncItems: pending }),
    });
    const data = (await res.json().catch(() => null)) as unknown;
    const parsed = BulkOfflineSyncResponseSchema.safeParse(data);
    if (!res.ok || !parsed.success) return { flushed: 0 };
    const acked = new Set(pending.map((i) => i.id)) ;
    for (const id of parsed.data.failedIds) acked.delete(id);
    await indexedDBEngine.clearSyncItems([...acked]).catch(() => undefined);
    return { flushed: acked.size };
  } catch {
    return { flushed: 0 };
  }
}

export function getDeviceId(): string {
  return deviceId();
}
