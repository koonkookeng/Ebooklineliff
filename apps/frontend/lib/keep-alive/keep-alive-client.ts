// SSOT Phase 031 §2.1/§6.1 — Keep-alive vault client (IDB + session mirror + sync)
// Canonical: apps/frontend/lib/keep-alive/keep-alive-client.ts
// (legacy src/frontend/lib/keep-alive/keep-alive-client.ts)
// - IDB vault `zene-keepalive/viewport_states` (heavy assets, Sankey: E-Book
//   chunks survive OS purge better than memory); sessionStorage mirror
//   `KEEPALIVE_{key}` (form drafts + video timestamps, synchronous read).
// - Server sync binds identity from the JWT cookie (controller overrides any
//   client userId) — the client never handles user identity here (Gate 4).
// - Native IndexedDB only (no `idb` dep — zero-new-deps policy, Gate 5).
// - Every helper is best-effort and never throws (offline/private-mode safe).
import {
  KEEPALIVE_DB,
  KEEPALIVE_STORE,
  keepAliveKey,
  type ViewportType,
} from '@repo/shared';

export { keepAliveKey };

function vault(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(KEEPALIVE_DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(KEEPALIVE_STORE)) req.result.createObjectStore(KEEPALIVE_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

let vaultPromise: Promise<IDBDatabase | null> | null = null;
function sharedVault(): Promise<IDBDatabase | null> {
  if (!vaultPromise) vaultPromise = vault();
  return vaultPromise;
}

/** Max serialized viewport payload (bytes) — mirrors the entity gate (Gate 5). */
export const KEEPALIVE_STATE_MAX_BYTES = 32 * 1024;

/** Byte size of a snapshot (32KB budget gate, client-side pre-check). */
export function snapshotSizeBytes(data: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(data ?? null)).length;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

export async function saveViewportState(viewportType: ViewportType, resourceId: string, data: unknown): Promise<void> {
  const key = keepAliveKey(viewportType, resourceId);
  const row = { data, at: Date.now() };
  try {
    const db = await sharedVault();
    if (db) {
      await new Promise<void>((resolve) => {
        try {
          const tx = db.transaction(KEEPALIVE_STORE, 'readwrite');
          tx.objectStore(KEEPALIVE_STORE).put(row, key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        } catch {
          resolve();
        }
      });
    }
  } catch {
    // IDB unavailable: session mirror below still preserves the draft.
  }
  try {
    sessionStorage.setItem(`KEEPALIVE_${key}`, JSON.stringify(row));
  } catch {
    // Quota/private mode: IDB copy (when available) remains the fallback.
  }
}

export async function loadViewportState<T = unknown>(viewportType: ViewportType, resourceId: string): Promise<T | null> {
  const key = keepAliveKey(viewportType, resourceId);
  try {
    const db = await sharedVault();
    if (db) {
      const row = await new Promise<{ data: T } | null>((resolve) => {
        try {
          const tx = db.transaction(KEEPALIVE_STORE, 'readonly');
          const req = tx.objectStore(KEEPALIVE_STORE).get(key);
          req.onsuccess = () => resolve((req.result as { data: T } | undefined) ?? null);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
      if (row) return row.data;
    }
  } catch {
    // fall through to session mirror
  }
  try {
    const raw = sessionStorage.getItem(`KEEPALIVE_${key}`);
    if (!raw) return null;
    return (JSON.parse(raw) as { data: T }).data;
  } catch {
    return null;
  }
}

export async function clearViewportState(viewportType: ViewportType, resourceId: string): Promise<void> {
  const key = keepAliveKey(viewportType, resourceId);
  try {
    const db = await sharedVault();
    if (db) {
      await new Promise<void>((resolve) => {
        try {
          const tx = db.transaction(KEEPALIVE_STORE, 'readwrite');
          tx.objectStore(KEEPALIVE_STORE).delete(key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        } catch {
          resolve();
        }
      });
    }
  } catch {
    // ignore
  }
  try {
    sessionStorage.removeItem(`KEEPALIVE_${key}`);
  } catch {
    // ignore
  }
}

export interface ServerSyncInput {
  tenantId: string;
  viewportType: ViewportType;
  timestamp: number;
  ebookState?: unknown;
  videoState?: unknown;
  checkoutState?: unknown;
}

/** Fire-and-forget server sync (JWT cookie binds identity, keepalive: true). */
export async function syncViewportServer(input: ServerSyncInput): Promise<{ success: boolean; restoredTimestamp: string } | null> {
  try {
    const res = await fetch('/api/v1/keep-alive/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      keepalive: true,
    });
    if (!res.ok) return null;
    return (await res.json()) as { success: boolean; restoredTimestamp: string };
  } catch {
    return null;
  }
}

/** Server restore (ERROR_FALLBACK path — JWT cookie binds identity). */
export async function restoreViewportServer(
  tenantId: string,
  viewportType: ViewportType,
): Promise<{ success: boolean; restoredTimestamp: string; stateJson: unknown | null }> {
  try {
    const res = await fetch(
      `/api/v1/keep-alive/state?tenantId=${encodeURIComponent(tenantId)}&viewportType=${encodeURIComponent(viewportType)}`,
      { headers: { Accept: 'application/json' } },
    );
    if (!res.ok) return { success: false, restoredTimestamp: new Date(0).toISOString(), stateJson: null };
    return (await res.json()) as { success: boolean; restoredTimestamp: string; stateJson: unknown | null };
  } catch {
    return { success: false, restoredTimestamp: new Date(0).toISOString(), stateJson: null };
  }
}

/** Measure a rehydrate routine (Gate: < 150ms, §10 test 2). */
export async function measureRehydrate<T>(routine: () => Promise<T> | T): Promise<{ result: T; ms: number }> {
  const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const result = await routine();
  const end = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return { result, ms: Math.round((end - start) * 100) / 100 };
}

/** Revoke every blob URL in a registry (RAM release on hidden, Gate 5). */
export function releaseBlobUrls(registry: Map<unknown, string>): number {
  let released = 0;
  try {
    for (const [, url] of registry) {
      try {
        URL.revokeObjectURL(url);
        released++;
      } catch {
        // Already revoked: count the attempt, keep sweeping.
      }
    }
    registry.clear();
  } catch {
    // Non-DOM runtime (tests): nothing to revoke.
  }
  return released;
}
