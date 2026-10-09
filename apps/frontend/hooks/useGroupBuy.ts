// SSOT Phase 090 Task 5 — Group room hook (5-state, completion redirect)
// Canonical: apps/frontend/hooks/useGroupBuy.ts
// - LIFF_INIT room check -> LOADING preview+join -> SUCCESS (reader link
//   when COMPLETED) / ERROR (full/expired + new-room link).
// - Zero-dep beyond the group-buy client.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { groupBuyApi, type GroupBuyStatus, type GroupRoomDetail } from '../lib/group-buy/group-buy-client';

export function useGroupBuy(roomId: string | null) {
  const [status, setStatus] = useState<GroupBuyStatus>('LIFF_INIT');
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<GroupRoomDetail | null>(null);
  const [completedProductId, setCompletedProductId] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const load = useCallback(async () => {
    if (!roomId) {
      setStatus('ERROR');
      setError('ลิงก์ห้อง Group Buy ไม่ถูกต้อง');
      return;
    }
    setStatus('LOADING');
    setError(null);
    try {
      const d = await groupBuyApi().detail(roomId);
      setDetail(d);
      if (d.status === 'COMPLETED') {
        setCompletedProductId(d.productId);
        setStatus('SUCCESS');
      } else {
        setStatus('IDLE');
      }
    } catch (e) {
      setStatus('ERROR');
      setError((e as Error).message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, nonce]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  async function join(orderId: string): Promise<string | null> {
    if (!roomId) return null;
    setStatus('LOADING');
    try {
      const r = await groupBuyApi().join({ roomId, orderId });
      if (!r.success) {
        setStatus('ERROR');
        setError(r.message);
        return null;
      }
      if (r.isCompleted && r.productId) {
        setCompletedProductId(r.productId);
        setStatus('SUCCESS');
        return r.productId;
      }
      await load();
      return null;
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
    completedProductId,
    join,
    retry: () => {
      setError(null);
      setNonce((n) => n + 1);
    },
  };
}
