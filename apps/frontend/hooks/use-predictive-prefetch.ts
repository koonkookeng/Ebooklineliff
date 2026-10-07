// SSOT Phase 029 Task 6 — usePredictivePrefetch (dwell → edge warm + SW fan-out)
// Canonical: apps/frontend/hooks/use-predictive-prefetch.ts
// (legacy src/frontend/hooks/usePredictivePrefetch.ts)
// - BDD Scenario 2: dwell ≥ 1.5s on resource N → warm N+1..N+depth (velocity depth
//   3/2/1) via the edge trigger AND the Service Worker cache (0ms next-page).
// - 5 states: LIFF_INIT (SW probe) → IDLE (armed) → LOADING (warming) →
//   SUCCESS (warmed) / ERROR (soft, reader unaffected — prefetch never blocks).
// - RAM guard: timers cleaned on unmount/arg change; payloads ≤5 ids (Gate 5).
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { PREFETCH_DWELL_MS } from '@repo/shared';
import {
  dwellReady,
  fanoutToServiceWorker,
  nextResourceIds,
  triggerEdgePrefetch,
  type PrefetchTriggerInput,
} from '../lib/prefetch/prefetch-client';

export type PrefetchStatus = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

export interface PredictivePrefetchOptions {
  productId: string | null;
  resourceType: PrefetchTriggerInput['currentResourceType'];
  currentResourceId: string | null;
  /** Seconds per page (reading velocity); depth 3/2/1 per §7.1. */
  secondsPerPage?: number;
  /** Total pages (ebook) — stops prediction at the end. */
  totalPages?: number;
  /** Extra chunk URLs to fan out (resolved CDN URLs, same order as ids). */
  chunkUrls?: string[];
  enabled?: boolean;
}

export function usePredictivePrefetch(options: PredictivePrefetchOptions) {
  const { productId, resourceType, currentResourceId, secondsPerPage = 20, totalPages, chunkUrls = [], enabled = true } = options;
  // Array identity changes every render — depend on the joined key instead so
  // the dwell timer is not reset by unrelated parent re-renders.
  const chunkKey = chunkUrls.join('|');
  const [status, setStatus] = useState<PrefetchStatus>('LIFF_INIT');
  const [warmed, setWarmed] = useState<string[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef<string | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    firedRef.current = null;
    clearTimer();
    if (!enabled || !productId || !currentResourceId) {
      setStatus('IDLE');
      return;
    }
    setStatus('IDLE');
    const startedAt = Date.now();
    timerRef.current = setTimeout(() => {
      if (!dwellReady(startedAt)) return;
      const key = `${productId}:${resourceType}:${currentResourceId}`;
      if (firedRef.current === key) return;
      firedRef.current = key;
      void (async () => {
        setStatus('LOADING');
        try {
          const numeric = Number.parseInt(currentResourceId, 10);
          const ids = Number.isInteger(numeric)
            ? nextResourceIds(numeric, secondsPerPage, totalPages).map(String)
            : [currentResourceId];
          const ok = await triggerEdgePrefetch({
            productId,
            currentResourceType: resourceType,
            currentResourceId,
            predictedNextResourceIds: ids.slice(0, 5),
          });
          if (chunkUrls.length > 0) await fanoutToServiceWorker(chunkUrls);
          setWarmed(ids);
          setStatus(ok ? 'SUCCESS' : 'ERROR');
        } catch {
          setStatus('ERROR');
        }
      })();
    }, PREFETCH_DWELL_MS);
    return clearTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, productId, resourceType, currentResourceId, secondsPerPage, totalPages, chunkKey, clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  return { status, warmed };
}
