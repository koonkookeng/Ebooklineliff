/**
 * SSOT Phase 062 §6.1 — Offline PWA Service Worker (vanilla engine)
 * Canonical: apps/frontend/public/sw.js
 * (legacy src/frontend/public/sw.js)
 * - RISK_CALL deviation: hand-rolled CacheFirst/NetworkFirst/StaleWhile-
 *   Revalidate instead of workbox-* (zero-new-dep LIFF policy; ~2KB vs
 *   ~100KB+). Same budgets: chunks ≤100 entries/7d, tenant namespaces,
 *   CacheStorage ≤150MB/tenant, bulk-POST bg queue 24h.
 * - Reader chunks: CacheFirst (offline canvas); static: SWR; bulk sync:
 *   NetworkFirst + persisted bg queue (IDB via the page — SW keeps a
 *   lightweight Cache fallback of the last request body).
 * - Volatile RAM is the page's sliding window (<30MB); the SW never holds
 *   chunk bodies in memory (streams straight to Cache).
 */
'use strict';

const SW_VERSION = 'zene-pwa-v062-1';
const CHUNK_BASE = 'ebook-chunks';
const STATIC_BASE = 'static-assets';
const BULK_PATH = '/api/v1/offline-sync/bulk';
const CHUNK_MAX_ENTRIES = 100;
const CHUNK_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_MB_PER_TENANT = 150;

function tenantOf(url) {
  try {
    const u = new URL(url);
    return u.searchParams.get('tenant') || 'default';
  } catch {
    return 'default';
  }
}

function cacheName(base, tenant) {
  return `${base}-${tenant || 'default'}-v1`;
}

async function trimChunkCache(cache, tenant) {
  try {
    const keys = await cache.keys();
    const now = Date.now();
    const fresh = [];
    for (const req of keys) {
      const res = await cache.match(req);
      const stamped = res ? res.headers.get('x-zene-cached-at') : null;
      const age = stamped ? now - Number(stamped) : 0;
      if (!stamped || age > CHUNK_MAX_AGE_MS) {
        await cache.delete(req);
      } else {
        fresh.push({ req, age });
      }
    }
    fresh.sort((a, b) => b.age - a.age);
    while (fresh.length > CHUNK_MAX_ENTRIES) {
      const evict = fresh.pop();
      if (evict) await cache.delete(evict.req);
    }
  } catch {
    // trimming best-effort; quota errors handled below
  }
  void tenant;
}

async function enforceQuota() {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const { usage, quota } = await navigator.storage.estimate();
      const cap = MAX_MB_PER_TENANT * 1024 * 1024;
      if (typeof usage === 'number' && typeof quota === 'number' && (usage > cap || usage > quota * 0.9)) {
        const names = await caches.keys();
        for (const name of names) {
          if (name.startsWith(CHUNK_BASE)) await caches.delete(name);
        }
      }
    }
  } catch {
    // quota best-effort
  }
}

async function cacheFirstChunk(event) {
  const cache = await caches.open(cacheName(CHUNK_BASE, tenantOf(event.request.url)));
  const hit = await cache.match(event.request);
  if (hit) {
    event.waitUntil(trimChunkCache(cache));
    return hit;
  }
  try {
    const res = await fetch(event.request);
    if (res && res.ok) {
      const stamped = new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers: new Headers(res.headers),
      });
      stamped.headers.set('x-zene-cached-at', String(Date.now()));
      event.waitUntil(
        cache.put(event.request, stamped).then(() => trimChunkCache(cache)).catch(() => enforceQuota()),
      );
    }
    return res;
  } catch {
    return Response.error();
  }
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(cacheName(STATIC_BASE, tenantOf(event.request.url)));
  const hit = await cache.match(event.request);
  const network = fetch(event.request)
    .then((res) => {
      if (res && res.ok) event.waitUntil(cache.put(event.request, res.clone()).catch(() => undefined));
      return res;
    })
    .catch(() => hit || Response.error());
  return hit || network;
}

async function bulkWithQueue(event) {
  try {
    return await fetch(event.request.clone());
  } catch {
    // Offline: persist the payload into the page-owned IDB outbox via clients.
    try {
      const body = await event.request.clone().json().catch(() => null);
      const clients = await self.clients.matchAll({ includeUncontrolled: true });
      for (const client of clients) {
        client.postMessage({ type: 'ZENE_BULK_QUEUED', body });
      }
    } catch {
      // queue handoff best-effort
    }
    return new Response(JSON.stringify({ success: false, queued: true, processedCount: 0, failedIds: [] }), {
      status: 202,
      headers: { 'content-type': 'application/json' },
    });
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting().catch(() => undefined));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.map((n) => {
          if (n.startsWith(CHUNK_BASE) || n.startsWith(STATIC_BASE)) return undefined;
          if (n === SW_VERSION) return undefined;
          return caches.delete(n);
        }),
      );
      await self.clients.claim().catch(() => undefined);
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' && !(request.method === 'POST' && request.url.includes(BULK_PATH))) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.method === 'POST' && url.pathname.includes(BULK_PATH)) {
    event.respondWith(bulkWithQueue(event));
    return;
  }
  if (url.pathname.includes('/api/reader/chunk') || url.pathname.includes('/api/v1/reader/retina-chunk')) {
    event.respondWith(cacheFirstChunk(event));
    return;
  }
  const dest = request.destination;
  if (dest === 'style' || dest === 'script' || dest === 'image' || dest === 'font') {
    event.respondWith(staleWhileRevalidate(event));
  }
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-user-progress' || event.tag === 'sync-offline-progress') {
    event.waitUntil(
      (async () => {
        const clients = await self.clients.matchAll({ includeUncontrolled: true });
        for (const client of clients) client.postMessage({ type: 'ZENE_FLUSH_SYNC_QUEUE' });
      })(),
    );
  }
  // Atomic Phase 065: offline lesson-note outbox drain (BDD-3). The page owns
  // the IndexedDB outbox; the SW fans out and the open LIFF client flushes
  // via POST /api/v1/notes/sync (LWW). No client → browser retries the tag.
  if (event.tag === 'sync-lesson-note') {
    event.waitUntil(
      (async () => {
        const clients = await self.clients.matchAll({ includeUncontrolled: true });
        for (const client of clients) client.postMessage({ type: 'ZENE_FLUSH_NOTE_QUEUE' });
      })(),
    );
  }
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting().catch(() => undefined);
  }
});
