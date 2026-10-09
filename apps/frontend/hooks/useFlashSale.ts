// SSOT Phase 087 §2.2 — Flash sale hook (5-state: upcoming→reserve→lock)
// Canonical: apps/frontend/hooks/useFlashSale.ts
// - LIFF_INIT splash -> IDLE campaign -> LOADING reserve -> SUCCESS lock
//   timer / ERROR sold-out|expired. Server UTC is truth (no client clock).
// - Zero-dep beyond the flash client.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { flashApi, type FlashCampaign, type FlashStatus } from '../lib/flash-sale/flash-client';

export function useFlashSale(slug: string) {
  const [status, setStatus] = useState<FlashStatus>('LIFF_INIT');
  const [error, setError] = useState<string | null>(null);
  const [campaign, setCampaign] = useState<FlashCampaign | null>(null);
  const [lock, setLock] = useState<{ productId: string; reservationToken: string; expiresAt: string } | null>(null);
  const [nonce, setNonce] = useState(0);

  const load = useCallback(async () => {
    setStatus((s) => (s === 'LIFF_INIT' ? s : 'LOADING'));
    setError(null);
    try {
      const data = await flashApi(slug).campaign();
      setCampaign(data);
      setStatus('IDLE');
    } catch (e) {
      setError((e as Error).message);
      setStatus('ERROR');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, nonce]);

  useEffect(() => {
    void load();
  }, [load]);

  async function reserve(productId: string): Promise<{ reservationToken: string | null; expiresAt: string | null }> {
    if (!campaign) throw new Error('No active campaign');
    setStatus('LOADING');
    try {
      const r = await flashApi(slug).reserve(campaign.id, productId, 1);
      if (r.success && r.reservationToken && r.expiresAt) {
        setLock({ productId, reservationToken: r.reservationToken, expiresAt: r.expiresAt });
        setStatus('SUCCESS');
        return { reservationToken: r.reservationToken, expiresAt: r.expiresAt };
      }
      setStatus('ERROR');
      setError(r.message);
      return { reservationToken: null, expiresAt: null };
    } catch (e) {
      setStatus('ERROR');
      setError((e as Error).message);
      throw e;
    }
  }

  return {
    status,
    error,
    campaign,
    lock,
    reserve,
    retry: () => {
      setError(null);
      setNonce((n) => n + 1);
    },
  };
}
