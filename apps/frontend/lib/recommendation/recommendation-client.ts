// SSOT Phase 104 §2.1 — Recommendation client (REST transport + IDB offline slate)
// Canonical: apps/frontend/lib/recommendation/recommendation-client.ts
// - Slate cached offline-first (§2.1); events fire-and-forget (§7.1).
// - Zero-dep (fetch + IndexedDB only).
export type RecStatus = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

export interface RecItem {
  productId: string;
  title: string;
  coverImageUrl: string;
  productType: string;
  price: number;
  discountPrice: number | null;
  matchScore: number;
  reasonType: string;
  reasonText: string;
  algorithmUsed: string;
}

export interface RecSlate {
  tenantId: string;
  userId: string;
  slateTitle: string;
  items: RecItem[];
  generatedAt: string;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' }, ...init });
  if (!res.ok) throw new Error(`recommendation ${res.status}`);
  return (await res.json().catch(() => null)) as T;
}

const DB = 'rec-slate-db';

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('slates');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key: string, value: unknown): Promise<void> {
  try {
    const db = await idb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('slates', 'readwrite');
      tx.objectStore('slates').put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Best-effort cache.
  }
}

async function idbGet<T>(key: string): Promise<T | null> {
  try {
    const db = await idb();
    const out = await new Promise<T | null>((resolve) => {
      const tx = db.transaction('slates', 'readonly');
      const req = tx.objectStore('slates').get(key);
      req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
    db.close();
    return out;
  } catch {
    return null;
  }
}

/** Offline-first slate snapshot (§2.1 OFFLINE_FIRST). */
export function cacheSlate(tenant: string, slate: RecSlate): Promise<void> {
  return idbPut(`slate:${tenant}`, slate);
}

export function cachedSlate(tenant: string): Promise<RecSlate | null> {
  return idbGet<RecSlate>(`slate:${tenant}`);
}

/** Task 8 seam: reader/player dwell + progress beacons (§7.2). Fire-and-forget. */
export function trackDwell(
  tenant: string,
  productId: string,
  dwellTimeSec: number,
  kind: 'reading' | 'video' = 'reading',
  metadata?: Record<string, unknown>,
): void {
  if (dwellTimeSec < 30) return;
  void recApi(tenant)
    .track({
      productId,
      eventType: kind === 'reading' ? 'READING_DWELL_TIME' : 'VIDEO_WATCH_PROGRESS',
      dwellTimeSec: Math.floor(dwellTimeSec),
      metadata,
    })
    .catch(() => undefined);
}

export function recApi(tenant = 'default') {
  const qs = `tenant=${encodeURIComponent(tenant)}`;
  const post = (p: string, body: unknown) =>
    json(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return {
    slate: (limit = 6) => json<RecSlate>(`/api/v1/recommendations/slate?${qs}&limit=${limit}`),
    trending: (limit = 6) => json<{ items: RecItem[] }>(`/api/v1/recommendations/trending?${qs}&limit=${limit}`),
    track: (body: { productId: string; eventType: string; dwellTimeSec?: number; progressPercentage?: number; metadata?: Record<string, unknown> }) =>
      post(`/api/v1/recommendations/events?${qs}`, body) as Promise<{ logged: boolean }>,
    feedback: (productId: string, action: 'click' | 'purchase') =>
      post(`/api/v1/recommendations/feedback?${qs}`, { productId, action }) as Promise<{ recorded: boolean }>,
  };
}
