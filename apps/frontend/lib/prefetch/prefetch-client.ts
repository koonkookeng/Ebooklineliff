// SSOT Phase 029 §6 / BDD Scenario 2 — Predictive prefetch edge client
// Canonical: apps/frontend/lib/prefetch/prefetch-client.ts
// (legacy src/frontend/lib/prefetch/prefetch-client.ts)
// - Dwell tracking (pure, testable): dwellReady(startedAt, now) ≥ 1500ms.
// - Chunk URL builder for the R2/CDN origins the SW allowlists (pointer shape
//   matches PredictivePrefetchService EBOOK_PAGE payload: storagePathR2 + page).
// - SW postMessage fan-out (PREFETCH_URLS, ≤5) + /api/v1/performance/prefetch
//   trigger + sendBeacon RUM (LCP/FID/CLS via PerformanceObserver, zero deps).
// - Zero new deps (fetch/PerformanceObserver/navigator only).
import { PREFETCH_DWELL_MS, velocityPrefetchCount } from '@repo/shared';

export const SW_PATH = '/sw-prefetch.js';
export const SW_MESSAGE_TYPE = 'PREFETCH_URLS';

export function dwellReady(startedAtMs: number, nowMs: number = Date.now()): boolean {
  return nowMs - startedAtMs >= PREFETCH_DWELL_MS;
}

/** Next page ids after the current one, capped at the velocity depth. */
export function nextResourceIds(current: number, secondsPerPage: number, total?: number): number[] {
  const depth = velocityPrefetchCount(secondsPerPage);
  const ids: number[] = [];
  for (let i = 1; i <= depth; i++) {
    const page = current + i;
    if (total !== undefined && page > total) break;
    ids.push(page);
  }
  return ids;
}

/** CDN chunk URL for an ebook page (must stay inside the SW allowlist). */
export function chunkUrl(cdnOrigin: string, storagePathR2: string, pageNumber: number): string {
  const base = cdnOrigin.replace(/\/$/, '');
  const path = storagePathR2.replace(/^\//, '').replace(/\/$/, '');
  return `${base}/${path}/page-${pageNumber}.svg`;
}

async function ensureServiceWorker(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) return true;
    await navigator.serviceWorker.register(SW_PATH);
    return true;
  } catch {
    return false;
  }
}

export async function fanoutToServiceWorker(urls: string[]): Promise<boolean> {
  try {
    if (!(await ensureServiceWorker())) return false;
    const reg = await navigator.serviceWorker.ready;
    const target = reg.active ?? (await navigator.serviceWorker.getRegistration().then((r) => r?.active));
    if (!target) return false;
    target.postMessage({ type: SW_MESSAGE_TYPE, urls: urls.slice(0, 5) });
    return true;
  } catch {
    return false;
  }
}

export interface PrefetchTriggerInput {
  productId: string;
  currentResourceType: 'EBOOK_PAGE' | 'COURSE_LESSON' | 'PRODUCT_PDP';
  currentResourceId: string;
  predictedNextResourceIds: string[];
}

/** Fire-and-forget edge warm (never throws the reader hot path). */
export async function triggerEdgePrefetch(input: PrefetchTriggerInput): Promise<boolean> {
  try {
    const res = await fetch('/api/v1/performance/prefetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      keepalive: true,
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface RumPoint {
  metricType: 'LARGEST_CONTENTFUL_PAINT' | 'FIRST_INPUT_DELAY' | 'CUMULATIVE_LAYOUT_SHIFT' | 'INITIAL_BUNDLE_SIZE' | 'PREFETCH_CACHE_HIT' | 'PREFETCH_CACHE_MISS';
  value: number;
  route: string;
}

/** Non-blocking RUM beacon (sendBeacon → fetch keepalive fallback). */
export function beaconRum(point: RumPoint): boolean {
  try {
    const body = JSON.stringify(point);
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      return navigator.sendBeacon('/api/v1/performance/telemetry', body);
    }
    void fetch('/api/v1/performance/telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    });
    return true;
  } catch {
    return false;
  }
}
