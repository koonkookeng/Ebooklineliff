// SSOT Phase 018 §6 — Type-safe library fetcher + resume routing + offline snapshot
// Canonical: apps/frontend/lib/library.ts
// (legacy src/frontend/lib/library.ts)
import type { AssetType, DigitalAsset, MyLibraryPayload, MyLibraryQueryInput } from '@repo/shared';

export type { AssetType, DigitalAsset, MyLibraryPayload, MyLibraryQueryInput };

export interface LibraryQuery extends Partial<MyLibraryQueryInput> {
  assetType?: AssetType;
}

export async function fetchLibraryAssets(query?: LibraryQuery): Promise<MyLibraryPayload> {
  const params = new URLSearchParams();
  if (query?.assetType) params.set('assetType', query.assetType);
  if (query?.searchQuery) params.set('searchQuery', query.searchQuery);
  if (query?.sortBy) params.set('sortBy', query.sortBy);
  if (query?.page) params.set('page', String(query.page));
  if (query?.limit) params.set('limit', String(query.limit));
  const qs = params.toString();
  const res = await fetch(`/api/library/assets${qs ? `?${qs}` : ''}`, { headers: { 'Content-Type': 'application/json' } });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? 'โหลดคลังไม่สำเร็จ');
  }
  return (await res.json()) as MyLibraryPayload;
}

export async function checkLibraryGate(productId: string): Promise<boolean> {
  const res = await fetch(`/api/library/gate?productId=${encodeURIComponent(productId)}`);
  if (!res.ok) return false;
  const body = (await res.json().catch(() => null)) as { hasAccess?: boolean } | null;
  return body?.hasAccess === true;
}

/**
 * One-click resume routing (BDD scenario 2 — zero-latency deep links):
 * EBOOK → Canvas reader at page N; COURSE → HLS player at sec T;
 * BUNDLE/LIVE → catalog search surface (reader routes land in later phases).
 */
export function resumePath(asset: DigitalAsset): string {
  if (asset.assetType === 'EBOOK') return `/reader/${asset.productId}?page=${asset.lastAccessedPage ?? 1}`;
  if (asset.assetType === 'ELEARNING_COURSE') {
    const t = asset.lastAccessedTimeSec && asset.lastAccessedTimeSec > 0 ? `?t=${asset.lastAccessedTimeSec}` : '';
    return `/course/${asset.productId}/play${t}`;
  }
  return `/catalog?query=${encodeURIComponent(asset.title)}`;
}

// --- Offline-first snapshot (IndexedDB, dep-free, <30 lines) ---
const SNAPSHOT_KEY = 'library:snapshot:v1';

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open('liff-offline', 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveLibrarySnapshot(payload: MyLibraryPayload): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(JSON.stringify(payload), SNAPSHOT_KEY);
  } catch {
    // best-effort offline cache — never fail the UI path
  }
}

export async function loadLibrarySnapshot(): Promise<MyLibraryPayload | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('kv', 'readonly');
      const req = tx.objectStore('kv').get(SNAPSHOT_KEY);
      req.onsuccess = () => {
        try {
          resolve(req.result ? (JSON.parse(String(req.result)) as MyLibraryPayload) : null);
        } catch {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}
