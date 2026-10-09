// SSOT Phase 104 §2.2 — Recommendation hook (5-state, offline-first slate)
// Canonical: apps/frontend/hooks/useRecommendations.ts
// - LIFF_INIT → IDLE → LOADING → SUCCESS / ERROR (bestseller fallback).
// - Render cap 6 cards (RAM < 15MB §2.1); IDB snapshot on SUCCESS.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { recApi, cacheSlate, cachedSlate, type RecItem, type RecStatus } from '../lib/recommendation/recommendation-client';

const RENDER_CAP = 6;

export function useRecommendations(tenant = 'default', limit = 6) {
  const [status, setStatus] = useState<RecStatus>('LIFF_INIT');
  const [items, setItems] = useState<RecItem[]>([]);
  const [slateTitle, setSlateTitle] = useState('แนะนำเฉพาะคุณ (AI Match)');
  const [error, setError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    setStatus('LOADING');
    (async () => {
      // Offline-first: paint cached slate instantly (§2.1).
      const cached = await cachedSlate(tenant).catch(() => null);
      if (cached && alive.current && cached.items.length > 0) {
        setItems(cached.items.slice(0, RENDER_CAP));
        setSlateTitle(cached.slateTitle);
        setStatus('IDLE');
      }
      try {
        const slate = await recApi(tenant).slate(limit);
        if (!alive.current) return;
        const capped = slate.items.slice(0, RENDER_CAP);
        setItems(capped);
        setSlateTitle(slate.slateTitle);
        setError(null);
        setStatus('SUCCESS');
        void cacheSlate(tenant, { ...slate, items: capped });
      } catch (e) {
        if (!alive.current) return;
        // ERROR → bestseller fallback slate (§2.2).
        const fallback = await recApi(tenant).trending(limit).catch(() => null);
        if (fallback && alive.current) {
          setItems(fallback.items.slice(0, RENDER_CAP));
          setSlateTitle('ยอดนิยมตอนนี้');
          setStatus('SUCCESS');
        } else if (alive.current) {
          setError((e as Error).message);
          setStatus(items.length > 0 ? 'IDLE' : 'ERROR');
        }
      }
    })();
    return () => { alive.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant, limit, retryTick]);

  const track = useCallback(
    (body: { productId: string; eventType: string; dwellTimeSec?: number; progressPercentage?: number; metadata?: Record<string, unknown> }) => {
      void recApi(tenant).track(body).catch(() => undefined);
    },
    [tenant],
  );

  const feedback = useCallback(
    (productId: string, action: 'click' | 'purchase') => {
      void recApi(tenant).feedback(productId, action).catch(() => undefined);
    },
    [tenant],
  );

  function retry() {
    setError(null);
    setRetryTick((n) => n + 1);
  }

  return { status, items, slateTitle, error, track, feedback, retry };
}
