// SSOT Phase 058 §6.1/§2.1 — Scrubbing client (manifest + IndexedDB + beacon)
// Canonical: apps/frontend/lib/stream/scrubbing-client.ts
// - fetchScrubbingManifest: Next proxy → backend (Redis 24h → Prisma).
// - IndexedDB offline cache for the WebVTT manifest (<15KB) so hover works
//   on flaky nets; sprites stay network-cached (≤2 in RAM, §2.1).
// - reportScrubSeek: sendBeacon-first heatmap pulse (scrub_seek_jump).
// - Zero new deps.
import { VideoScrubbingPayloadSchema, type VideoScrubbingPayload } from '@repo/shared';

const IDB_DB = 'zene-scrub-vtt';
const IDB_STORE = 'manifests';

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

export async function readCachedManifest(lessonId: string): Promise<VideoScrubbingPayload['manifest']> {
  const db = await idb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const get = tx.objectStore(IDB_STORE).get(lessonId);
      get.onsuccess = () => {
        const parsed = VideoScrubbingPayloadSchema.safeParse(get.result);
        resolve(parsed.success ? parsed.data.manifest : null);
      };
      get.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function writeCachedManifest(payload: VideoScrubbingPayload): Promise<void> {
  if (!payload.manifest) return;
  const db = await idb();
  if (!db) return;
  try {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(JSON.parse(JSON.stringify(payload)), payload.manifest.lessonId);
  } catch {
    // offline cache is best-effort
  }
}

export async function fetchScrubbingManifest(lessonId: string): Promise<VideoScrubbingPayload> {
  const offline = await readCachedManifest(lessonId).catch(() => null);
  try {
    const res = await fetch(`/api/v1/stream/scrubbing-manifest?lessonId=${encodeURIComponent(lessonId)}`);
    const data = (await res.json().catch(() => null)) as unknown;
    const parsed = VideoScrubbingPayloadSchema.safeParse(data);
    if (!parsed.success || !res.ok) throw new Error('Scrubbing manifest unavailable');
    await writeCachedManifest(parsed.data).catch(() => undefined);
    return parsed.data;
  } catch (e) {
    if (offline) {
      return { success: true, manifest: offline, watermarkText: '' };
    }
    throw e instanceof Error ? e : new Error('Scrubbing manifest unavailable');
  }
}

export function reportScrubSeek(lessonId: string, targetTimeSec: number): void {
  try {
    const body = JSON.stringify({ lessonId, targetTimeSec });
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'application/json' });
      if (navigator.sendBeacon('/api/v1/stream/scrubbing-analytics', blob)) return;
    }
    void fetch('/api/v1/stream/scrubbing-analytics', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // analytics never breaks scrubbing
  }
}
