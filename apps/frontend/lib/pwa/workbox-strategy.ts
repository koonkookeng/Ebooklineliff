// SSOT Phase 062 §6.1 — Cache strategy descriptors (vanilla workbox parity)
// Canonical: apps/frontend/lib/pwa/workbox-strategy.ts
// (legacy src/frontend/lib/pwa/workbox-strategy.ts)
// - RISK_CALL deviation: plain route descriptors consumed by public/sw.js
//   instead of the workbox-* runtime (zero-new-dep LIFF policy). Budgets
//   mirror §6.1: chunks CacheFirst ≤100/7d, static SWR, bulk NetworkFirst +
//   24h bg queue. Zero new deps.
import {
  PWA_BGSYNC_RETENTION_MIN,
  PWA_CHUNK_MAX_AGE_SEC,
  PWA_CHUNK_MAX_ENTRIES,
  tenantCacheName,
} from '@repo/shared';

export type PwaStrategyKind = 'CacheFirst' | 'NetworkFirst' | 'StaleWhileRevalidate';

export interface PwaRouteDescriptor {
  match: (url: string, method: string) => boolean;
  strategy: PwaStrategyKind;
  cacheName: string;
  maxEntries?: number;
  maxAgeSeconds?: number;
}

export function pwaRoutesFor(tenantId: string): PwaRouteDescriptor[] {
  return [
    {
      match: (url) => url.includes('/api/reader/chunk') || url.includes('/api/v1/reader/retina-chunk'),
      strategy: 'CacheFirst',
      cacheName: tenantCacheName('ebook-chunks-cache', tenantId),
      maxEntries: PWA_CHUNK_MAX_ENTRIES,
      maxAgeSeconds: PWA_CHUNK_MAX_AGE_SEC,
    },
    {
      match: () => true,
      strategy: 'StaleWhileRevalidate',
      cacheName: tenantCacheName('static-assets-cache', tenantId),
    },
    {
      match: (url, method) => method === 'POST' && url.includes('/api/v1/offline-sync/bulk'),
      strategy: 'NetworkFirst',
      cacheName: tenantCacheName('progress-sync-queue', tenantId),
      maxAgeSeconds: PWA_BGSYNC_RETENTION_MIN * 60,
    },
  ];
}
