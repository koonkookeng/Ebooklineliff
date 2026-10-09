// SSOT Phase 084 §6.1/Task 6 — Magic-link recovery hook (5-state)
// Canonical: apps/frontend/hooks/useAbandonedCartRecovery.ts
// - LIFF_INIT token check -> LOADING rehydrate (<500ms target) -> SUCCESS
//   (coupon auto-applied content) / ERROR (expired/stock + continue link).
// - Zero-dep beyond the recovery client (no zustand — local state).
'use client';

import { useCallback, useEffect, useState } from 'react';
import { recoveryApi, type RecoveryPayload, type RecoveryStatus } from '../lib/messaging/recovery-client';

export function useAbandonedCartRecovery(slug: string, token: string | null) {
  const [status, setStatus] = useState<RecoveryStatus>('LIFF_INIT');
  const [payload, setPayload] = useState<RecoveryPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const run = useCallback(async () => {
    if (!token) {
      setStatus('ERROR');
      setError('ลิงก์กู้คืนไม่ถูกต้อง');
      return;
    }
    setStatus('LOADING');
    setError(null);
    try {
      const data = await recoveryApi(slug).recover(token);
      setPayload(data);
      if (data.success && data.cartSession) setStatus('SUCCESS');
      else {
        setStatus('ERROR');
        setError(data.message);
      }
    } catch (e) {
      setStatus('ERROR');
      setError((e as Error).message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, token, nonce]);

  useEffect(() => {
    const t = setTimeout(() => void run(), 0);
    return () => clearTimeout(t);
  }, [run]);

  return {
    status,
    payload,
    error,
    retry: () => {
      setError(null);
      setNonce((n) => n + 1);
    },
  };
}
