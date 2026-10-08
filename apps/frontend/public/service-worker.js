/**
 * SSOT Phase 063 §6.1 — Offline media interceptor (HLS + chunk fallback)
 * Canonical: apps/frontend/public/service-worker.js
 * (legacy src/frontend/public/service-worker.js)
 * - Complements the Phase 062 sw.js engine (general PWA cache): this worker
 *   owns OFFLINE media playback — /hls-offline-stream/<lesson>/<segment>
 *   served from the AhongOfflineOmniCacheDB videoSegments store, and
 *   /api/reader/chunk served from ebookChunks when navigator is offline.
 * - Native IndexedDB only (no Dexie.js — zero-new-dep LIFF policy).
 * - Encrypted buffers stream straight into the Response (no RAM hold).
 */
'use strict';

const OFFLINE_DB = 'AhongOfflineOmniCacheDB';
const CHUNK_STORE = 'ebookChunks';
const SEGMENT_STORE = 'videoSegments';

function openOfflineDb() {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(OFFLINE_DB, 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) {
      reject(e);
    }
  });
}

function storeGet(storeName, indexName, key) {
  return openOfflineDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        try {
          const tx = db.transaction(storeName, 'readonly');
          const store = tx.objectStore(store);
          const req = indexName ? store.index(indexName).get(key) : store.get(key);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => reject(req.error);
        } catch (e) {
          reject(e);
        }
      }),
    () => null,
  );
}

async function handleOfflineHlsStream(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  const segmentName = parts[parts.length - 1];
  const lessonId = parts[parts.length - 2];
  try {
    const record = await storeGet(SEGMENT_STORE, 'by_lesson_segment', [lessonId, segmentName]);
    if (record && record.encryptedBuffer) {
      return new Response(record.encryptedBuffer, {
        headers: { 'Content-Type': 'video/MP2T', 'Cache-Control': 'no-store' },
      });
    }
    return new Response('Segment Not Found Offline', { status: 404 });
  } catch {
    return new Response('Offline Storage Error', { status: 500 });
  }
}

async function handleOfflineEbookChunk(url) {
  try {
    const productId = url.searchParams.get('productId');
    const page = Number(url.searchParams.get('page'));
    if (!productId || !Number.isInteger(page)) return new Response('Bad chunk key', { status: 400 });
    const record = await storeGet(CHUNK_STORE, 'by_product_page', [productId, page]);
    if (record && record.encryptedSvgData) {
      return new Response(JSON.stringify({ vectorSvgContent: record.encryptedSvgData, offline: true }), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }
    return new Response('Chunk Not Downloaded', { status: 404 });
  } catch {
    return new Response('Offline Storage Error', { status: 500 });
  }
}

self.addEventListener('install', () => {
  self.skipWaiting().catch(() => undefined);
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim().catch(() => undefined));
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/hls-offline-stream/')) {
    event.respondWith(handleOfflineHlsStream(url.pathname));
  } else if (url.pathname.includes('/api/reader/chunk') && !navigator.onLine) {
    event.respondWith(handleOfflineEbookChunk(url));
  }
});
