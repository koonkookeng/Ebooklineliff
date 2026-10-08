// SSOT Phase 076 §2.2 — Fulfillment queue hook (5-state machine)
// Canonical: apps/frontend/hooks/useFulfillmentQueue.ts
// - QUEUE_INIT on mount -> IDLE -> PROCESSING -> SUCCESS / ERROR + retry.
// - Zero-dep beyond the fulfillment client.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { fulfillmentApi, type FulfillmentStatus, type QueueRow } from '../lib/fulfillment/fulfillment-client';

export function useFulfillmentQueue(slug: string) {
  const [status, setStatus] = useState<FulfillmentStatus>('QUEUE_INIT');
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const [nonce, setNonce] = useState(0);

  const load = useCallback(async () => {
    setStatus((s) => (s === 'QUEUE_INIT' ? s : 'PROCESSING'));
    setError(null);
    try {
      const data = await fulfillmentApi(slug).queue(filter, page);
      setRows(data.rows);
      setTotal(data.total);
      setStatus('SUCCESS');
    } catch (e) {
      setError((e as Error).message);
      setStatus('ERROR');
    }
  }, [slug, filter, page, nonce]);

  useEffect(() => {
    void load();
  }, [load]);

  return { status, error, rows, total, filter, setFilter, page, setPage, retry: () => setNonce((n) => n + 1), reload: load };
}
