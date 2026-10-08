// SSOT Phase 077 §2.2 — LIFF tracking hook (5-state machine)
// Canonical: apps/frontend/hooks/useShipmentTracking.ts
// - LIFF_INIT on mount (brand splash) -> LOADING -> SUCCESS / ERROR + retry.
// - Zero-dep beyond the logistics client.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { logisticsApi, type ShipmentTracking, type TrackingStatus } from '../lib/logistics/logistics-client';

export function useShipmentTracking(slug: string, orderId: string) {
  const [status, setStatus] = useState<TrackingStatus>('LIFF_INIT');
  const [error, setError] = useState<string | null>(null);
  const [tracking, setTracking] = useState<ShipmentTracking | null>(null);
  const [nonce, setNonce] = useState(0);

  const load = useCallback(async () => {
    if (!orderId) {
      setStatus('IDLE');
      return;
    }
    setStatus((s) => (s === 'LIFF_INIT' ? 'LOADING' : s));
    setError(null);
    try {
      const data = await logisticsApi(slug).tracking(orderId);
      setTracking(data);
      setStatus('SUCCESS');
    } catch (e) {
      setError((e as Error).message);
      setStatus('ERROR');
    }
  }, [slug, orderId, nonce]);

  useEffect(() => {
    void load();
  }, [load]);

  return { status, error, tracking, retry: () => setNonce((n) => n + 1) };
}
