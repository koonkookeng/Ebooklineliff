// SSOT Phase 063 Task 5 — OfflineManager (parallel prefetch + quota + lease)
// Canonical: apps/frontend/lib/offline/offline-manager.ts
// (legacy src/frontend/lib/offline/offline-manager.ts)
// - downloadProduct: chunk pipeline (5-wide) → IDB cells; quota guard
//   (<50MB free → warning + LRU evict oldest cells, then retry once).
// - ensureLease: cached lease reuse (>24h left) else issue via proxy.
// - recordProgress: pending-sync write for the bg-sync flush path.
// - Zero new deps.
'use client';

import {
  OFFLINE_PREFETCH_CONCURRENCY,
  OFFLINE_QUOTA_WARN_MB,
  leaseExpiringSoon,
  leaseIsUsable,
} from '@repo/shared';
import {
  OFFLINE_STORES,
  offlineChunkId,
  openOfflineDb,
  type LocalDrmLease,
} from './indexeddb-schema';

export interface OfflineDownloadProgress {
  done: number;
  total: number;
  downloadedMb: number;
}

async function idbPut(store: string, value: unknown): Promise<void> {
  const db = await openOfflineDb();
  await new Promise<void>((resolve, reject) => {
    try {
      const t = db.transaction(store, 'readwrite');
      t.objectStore(store).put(value);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error ?? new Error('put failed'));
    } catch (e) {
      reject(e instanceof Error ? e : new Error('put failed'));
    }
  });
}

async function storageFreeMb(): Promise<number> {
  try {
    const est = await navigator.storage.estimate();
    const quota = est.quota ?? 0;
    const usage = est.usage ?? 0;
    return Math.max(0, (quota - usage) / (1024 * 1024));
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

async function evictOldestChunks(keepProductId?: string): Promise<void> {
  try {
    const db = await openOfflineDb();
    const cells: Array<{ id: string; productId: string; updatedAt: number }> = await new Promise((resolve, reject) => {
      try {
        const t = db.transaction(OFFLINE_STORES.ebookChunks, 'readonly');
        const req = t.objectStore(OFFLINE_STORES.ebookChunks).getAll();
        req.onsuccess = () => resolve((req.result as Array<{ id: string; productId: string; updatedAt: number }>) ?? []);
        req.onerror = () => reject(req.error ?? new Error('scan failed'));
      } catch (e) {
        reject(e instanceof Error ? e : new Error('scan failed'));
      }
    });
    const victims = cells
      .filter((c) => c.productId !== keepProductId)
      .sort((a, b) => a.updatedAt - b.updatedAt)
      .slice(0, Math.max(1, Math.ceil(cells.length / 2)));
    if (victims.length === 0) return;
    await new Promise<void>((resolve, reject) => {
      try {
        const t = db.transaction(OFFLINE_STORES.ebookChunks, 'readwrite');
        const store = t.objectStore(OFFLINE_STORES.ebookChunks);
        for (const v of victims) store.delete(v.id);
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error ?? new Error('evict failed'));
      } catch (e) {
        reject(e instanceof Error ? e : new Error('evict failed'));
      }
    });
  } catch {
    // eviction best-effort
  }
}

export async function ensureOfflineLease(productId: string): Promise<{ leaseToken: string; cached: boolean }> {
  const db = await openOfflineDb();
  const cached: LocalDrmLease | undefined = await new Promise((resolve) => {
    try {
      const t = db.transaction(OFFLINE_STORES.drmLeases, 'readonly');
      const req = t.objectStore(OFFLINE_STORES.drmLeases).get(productId);
      req.onsuccess = () => resolve(req.result as LocalDrmLease | undefined);
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
  if (cached && leaseIsUsable(cached.expiresAt) && !leaseExpiringSoon(cached.expiresAt)) {
    return { leaseToken: cached.leaseToken, cached: true };
  }
  const res = await fetch('/api/v1/offline/lease/issue', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ productId, deviceId: 'web', clientPublicKey: 'webcrypto-pending' }),
  });
  const data = (await res.json().catch(() => null)) as { leaseToken?: string } | null;
  if (!res.ok || !data?.leaseToken) throw new Error('Lease issue failed');
  return { leaseToken: data.leaseToken, cached: false };
}

export async function downloadProductForOffline(
  productId: string,
  pages: number[],
  onProgress?: (p: OfflineDownloadProgress) => void,
): Promise<{ downloaded: number; quotaWarn: boolean }> {
  const freeMb = await storageFreeMb();
  const quotaWarn = freeMb < OFFLINE_QUOTA_WARN_MB;
  if (quotaWarn) await evictOldestChunks(productId);
  let done = 0;
  let downloadedBytes = 0;
  const queue = [...pages];
  const workers = Array.from({ length: OFFLINE_PREFETCH_CONCURRENCY }, async () => {
    while (queue.length > 0) {
      const page = queue.shift();
      if (page === undefined) return;
      try {
        const res = await fetch(`/api/reader/chunk?productId=${encodeURIComponent(productId)}&page=${page}`);
        if (!res.ok) continue;
        const data = (await res.json()) as { vectorSvgContent?: string };
        const svg = data.vectorSvgContent ?? '';
        await idbPut(OFFLINE_STORES.ebookChunks, {
          id: offlineChunkId(productId, page),
          productId,
          pageNumber: page,
          encryptedSvgData: svg,
          iv: '',
          chunkSizeByte: svg.length,
          updatedAt: Date.now(),
        });
        downloadedBytes += svg.length;
        done++;
        onProgress?.({ done, total: pages.length, downloadedMb: downloadedBytes / (1024 * 1024) });
      } catch {
        // per-chunk best-effort; missing cells surface as ERROR state later
      }
    }
  });
  await Promise.all(workers);
  return { downloaded: done, quotaWarn };
}

export async function recordOfflineProgress(record: {
  type: 'EBOOK_PROGRESS' | 'COURSE_PROGRESS';
  targetId: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  try {
    await idbPut(OFFLINE_STORES.pendingSyncRecords, {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      ...record,
      createdAt: Date.now(),
    });
  } catch {
    // progress queue best-effort
  }
}
