// SSOT Phase 091 BDD-1 — Semantic search hook (5-state, debounced)
// Canonical: apps/frontend/hooks/useSemanticSearch.ts
// - LIFF_INIT token warm -> IDLE bar -> LOADING embed+query -> SUCCESS cards
//   / ERROR (fallback keyword hint + retry).
// - Zero-dep beyond the vector-search client.
'use client';

import { useCallback, useRef, useState } from 'react';
import { vectorSearchApi, type VectorSearchItem, type VectorSearchStatus } from '../lib/vector-search/vector-search-client';

export function useSemanticSearch() {
  const [status, setStatus] = useState<VectorSearchStatus>('LIFF_INIT');
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<VectorSearchItem[]>([]);
  const [tookMs, setTookMs] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ready = useCallback(() => {
    setStatus((s) => (s === 'LIFF_INIT' ? 'IDLE' : s));
  }, []);

  const search = useCallback((queryText: string, productIdFilter?: string) => {
    if (timer.current) clearTimeout(timer.current);
    if (queryText.trim().length < 2) {
      setItems([]);
      setStatus('IDLE');
      return;
    }
    setStatus('LOADING');
    setError(null);
    timer.current = setTimeout(() => {
      void vectorSearchApi()
        .search({ queryText: queryText.trim(), productIdFilter, limit: 10 })
        .then((r) => {
          setItems(r.items);
          setTookMs(r.tookMs);
          setStatus('SUCCESS');
        })
        .catch((e) => {
          setStatus('ERROR');
          setError((e as Error).message);
        });
    }, 350);
  }, []);

  return { status, error, items, tookMs, ready, search, retry: () => setStatus('IDLE') };
}
