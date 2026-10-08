// SSOT Phase 061 §6.1 — DRM chunk client (session fetch + IDB + beacons)
// Canonical: apps/frontend/lib/reader/drm-chunk-client.ts
// - fetchDrmChunk: Next proxy → 60s scrambled blob URL + matrix + watermark.
// - Scrambled cells cached in IndexedDB (AES-GCM envelope is a follow-up;
//   pixels unscramble from ephemeral RAM keys only — §2.1).
// - Zero new deps.
import { EncryptedDrmChunkPayloadSchema, type EncryptedDrmChunkPayload } from '@repo/shared';
import { reportDrmViolationBeacon } from '../../components/reader/forensic-watermark';

const IDB_DB = 'zene-drm-chunks';
const IDB_STORE = 'scrambled-cells';

function idb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(IDB_DB, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(IDB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function fetchDrmChunk(productId: string, page: number): Promise<EncryptedDrmChunkPayload> {
  const key = `${productId}:${page}`;
  try {
    const res = await fetch(`/api/v1/reader/drm-chunk?productId=${encodeURIComponent(productId)}&page=${page}`);
    const data = (await res.json().catch(() => null)) as unknown;
    const parsed = EncryptedDrmChunkPayloadSchema.safeParse(data);
    if (!parsed.success || !res.ok) throw new Error(`drm chunk ${page}: ${res.status}`);
    const db = await idb().catch(() => null);
    if (db) {
      try {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(JSON.parse(JSON.stringify(parsed.data)), key);
      } catch {
        // offline cache best-effort
      }
    }
    return parsed.data;
  } catch (e) {
    const db = await idb().catch(() => null);
    if (db) {
      const cached: EncryptedDrmChunkPayload | null = await new Promise((resolve) => {
        try {
          const tx = db.transaction(IDB_STORE, 'readonly');
          const get = tx.objectStore(IDB_STORE).get(key);
          get.onsuccess = () => {
            const parsed = EncryptedDrmChunkPayloadSchema.safeParse(get.result);
            resolve(parsed.success ? parsed.data : null);
          };
          get.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
      if (cached) return cached;
    }
    throw e instanceof Error ? e : new Error('DRM chunk unavailable');
  }
}

export { reportDrmViolationBeacon };
