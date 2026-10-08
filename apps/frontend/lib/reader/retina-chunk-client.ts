// SSOT Phase 060 §6.2/§2.1 — Retina chunk client (DPR fetch + IDB cache)
// Canonical: apps/frontend/lib/reader/retina-chunk-client.ts
// - fetchRetinaChunk: Next proxy (deviceDpr + CSS box) → backend variant.
// - IndexedDB DPR-tier cache (1x/2x/3x cells) for offline-first Retina
//   reads (§2.1); render telemetry via sendBeacon (§7.1, best-effort).
// - Zero new deps.
import { EbookMultiResChunkPayloadSchema, type EbookMultiResChunkPayload } from '@repo/shared';

const IDB_DB = 'zene-retina-chunks';
const IDB_STORE = 'dpr-cells';

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

function cellKey(productId: string, page: number, dpr: number): string {
  return `${productId}:${page}:${dpr}`;
}

export async function fetchRetinaChunk(input: {
  productId: string;
  page: number;
  deviceDpr: number;
  cssWidth: number;
  cssHeight: number;
}): Promise<EbookMultiResChunkPayload> {
  const key = cellKey(input.productId, input.page, input.deviceDpr);
  try {
    const res = await fetch(
      `/api/v1/reader/retina-chunk?productId=${encodeURIComponent(input.productId)}&page=${input.page}&deviceDpr=${input.deviceDpr}&cssWidth=${Math.round(input.cssWidth)}&cssHeight=${Math.round(input.cssHeight)}`,
    );
    const data = (await res.json().catch(() => null)) as unknown;
    const parsed = EbookMultiResChunkPayloadSchema.safeParse(data);
    if (!parsed.success || !res.ok) throw new Error(`retina chunk ${input.page}: ${res.status}`);
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
      const cached: EbookMultiResChunkPayload | null = await new Promise((resolve) => {
        try {
          const tx = db.transaction(IDB_STORE, 'readonly');
          const get = tx.objectStore(IDB_STORE).get(key);
          get.onsuccess = () => {
            const parsed = EbookMultiResChunkPayloadSchema.safeParse(get.result);
            resolve(parsed.success ? parsed.data : null);
          };
          get.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
      if (cached) return cached;
    }
    throw e instanceof Error ? e : new Error('Retina chunk unavailable');
  }
}

export function reportRenderMetrics(metrics: { productId: string; page: number; latencyMs: number; ramMb: number; dpr: number }): void {
  try {
    const body = JSON.stringify({ ...metrics, event: 'canvas_render', at: new Date().toISOString() });
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      if (navigator.sendBeacon('/api/v1/analytics/pulse', new Blob([body], { type: 'application/json' }))) return;
    }
    void fetch('/api/v1/analytics/pulse', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // telemetry never breaks rendering
  }
}
