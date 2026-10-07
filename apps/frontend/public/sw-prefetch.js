/* SSOT Phase 029 §6.2 — Service Worker prefetch guard for LINE LIFF
 * Canonical: apps/frontend/public/sw-prefetch.js
 * (legacy src/frontend/public/sw-prefetch.js)
 * - Stale-while-revalidate ONLY for R2/CDN chunk + HLS metadata URLs under the
 *   allowlist (zero-egress origins); navigations pass through untouched.
 * - Client directives arrive via postMessage { type: 'PREFETCH_URLS', urls }.
 * - RAM discipline: single cache version, old versions purged on activate.
 */
var PREFETCH_CACHE_NAME = 'zene-prefetch-v1';
var ALLOWED_PREFETCH_ORIGINS = [
  'https://cdn.omnichannel.com',
  'https://videocdn.omnichannel.com',
];

function isPrefetchable(url) {
  for (var i = 0; i < ALLOWED_PREFETCH_ORIGINS.length; i++) {
    if (url.indexOf(ALLOWED_PREFETCH_ORIGINS[i] + '/') === 0) return true;
  }
  return url.indexOf('/api/reader/chunk') !== -1 || url.indexOf('/api/library') !== -1;
}

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys.map(function (key) {
            if (key !== PREFETCH_CACHE_NAME && key.indexOf('zene-prefetch-') === 0) {
              return caches.delete(key);
            }
            return Promise.resolve(false);
          }),
        );
      })
      .then(function () {
        return clients.claim();
      }),
  );
});

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;
  var url = event.request.url;
  if (!isPrefetchable(url)) return;
  event.respondWith(
    caches.open(PREFETCH_CACHE_NAME).then(function (cache) {
      return cache.match(event.request).then(function (cached) {
        var network = fetch(event.request).then(function (response) {
          if (response && response.status === 200) cache.put(event.request, response.clone());
          return response;
        });
        if (cached) {
          // 0ms latency on hit; revalidate in background (errors stay silent).
          network.catch(function () {
            /* offline: keep existing cache */
          });
          return cached;
        }
        // Miss: network is the response (rejection surfaces as network error).
        return network;
      });
    }),
  );
});

self.addEventListener('message', function (event) {
  var data = event.data;
  if (!data || data.type !== 'PREFETCH_URLS' || !Array.isArray(data.urls)) return;
  event.waitUntil(
    caches.open(PREFETCH_CACHE_NAME).then(function (cache) {
      return Promise.all(
        data.urls
          .filter(function (u) {
            return typeof u === 'string' && isPrefetchable(u);
          })
          .slice(0, 5)
          .map(function (u) {
            return fetch(u, { mode: 'cors' })
              .then(function (response) {
                if (response && response.status === 200) return cache.put(u, response);
                return Promise.resolve();
              })
              .catch(function () {
                /* offline: keep existing cache */
              });
          }),
      );
    }),
  );
});
