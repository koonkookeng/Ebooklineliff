// SSOT Phase 089 Task 6 — Gift claim hook (5-state, <1s redirect)
// Canonical: apps/frontend/hooks/useGiftClaim.ts
// - LIFF_INIT code check -> LOADING preview+claim -> SUCCESS (reader link)
//   / ERROR (used/expired + buy-new link).
// - Zero-dep beyond the gift client.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { giftApi, type GiftDetail, type GiftStatus } from '../lib/gift/gift-client';

export function useGiftClaim(code: string | null) {
  const [status, setStatus] = useState<GiftStatus>('LIFF_INIT');
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<GiftDetail | null>(null);
  const [claimedProductId, setClaimedProductId] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const load = useCallback(async () => {
    if (!code) {
      setStatus('ERROR');
      setError('ลิงก์ของขวัญไม่ถูกต้อง');
      return;
    }
    setStatus('LOADING');
    setError(null);
    try {
      setDetail(await giftApi().detail(code));
      setStatus('IDLE');
    } catch (e) {
      setStatus('ERROR');
      setError((e as Error).message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, nonce]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  async function claim(): Promise<string | null> {
    if (!code) return null;
    setStatus('LOADING');
    try {
      const r = await giftApi().claim(code);
      if (!r.success) {
        setStatus('ERROR');
        setError(r.message);
        return null;
      }
      setClaimedProductId(r.productId);
      setStatus('SUCCESS');
      return r.productId;
    } catch (e) {
      setStatus('ERROR');
      setError((e as Error).message);
      return null;
    }
  }

  return {
    status,
    error,
    detail,
    claimedProductId,
    claim,
    retry: () => {
      setError(null);
      setNonce((n) => n + 1);
    },
  };
}
