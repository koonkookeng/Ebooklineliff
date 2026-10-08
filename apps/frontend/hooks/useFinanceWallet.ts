// SSOT Phase 081 §2.2/§6.1 — Finance wallet hook (5-state + SSE live balance)
// Canonical: apps/frontend/hooks/useFinanceWallet.ts
// - LIFF_INIT splash -> IDLE overview -> LOADING payout -> SUCCESS toast /
//   ERROR|FRAUD alert modal content. SSE pushes live balances; 15s polling
//   fallback keeps LIFF Webview honest when streams drop.
// - Zero-dep beyond the finance client.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { financeApi, type FinancialOverview, type FinanceStatus } from '../lib/finance/finance-client';

export function useFinanceWallet(slug: string) {
  const [status, setStatus] = useState<FinanceStatus>('LIFF_INIT');
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<FinancialOverview | null>(null);
  const [nonce, setNonce] = useState(0);
  const esRef = useRef<EventSource | null>(null);
  const firstRef = useRef(true);

  const load = useCallback(async () => {
    const first = firstRef.current;
    setStatus(first ? 'LIFF_INIT' : 'LOADING');
    setError(null);
    try {
      const data = await financeApi(slug).overview();
      setOverview(data);
      firstRef.current = false;
      setStatus(first ? 'IDLE' : 'SUCCESS');
    } catch (e) {
      setError((e as Error).message);
      setStatus('ERROR');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, nonce]);

  useEffect(() => {
    void load();
  }, [load]);

  // SSE live balance (polling fallback every 15s).
  useEffect(() => {
    let stopped = false;
    let es: EventSource | null = null;
    try {
      es = new EventSource(financeApi(slug).streamUrl());
      esRef.current = es;
      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data) as Partial<FinancialOverview>;
          if (stopped || typeof data.withdrawableBalance !== 'number') return;
          setOverview((prev) => (prev ? { ...prev, ...data } : (data as FinancialOverview)));
        } catch {
          // Malformed frame — polling covers it.
        }
      };
    } catch {
      // EventSource unsupported — polling covers it.
    }
    const poll = setInterval(() => {
      if (!stopped) void financeApi(slug).overview().then(setOverview).catch(() => undefined);
    }, 15000);
    return () => {
      stopped = true;
      clearInterval(poll);
      es?.close();
      esRef.current = null;
    };
  }, [slug]);

  return {
    status,
    error,
    overview,
    retry: () => {
      setError(null);
      setNonce((n) => n + 1);
    },
  };
}
