// SSOT Phase 091 BDD-2 — Ask-AI hook (5-state, DOM-capped for <30MB RAM)
// Canonical: apps/frontend/hooks/useAiAsk.ts
// - Keeps max 5 messages in DOM (virtualized excerpt discipline, Gate 5).
// - Zero-dep beyond the vector-search client.
'use client';

import { useCallback, useState } from 'react';
import { vectorSearchApi, type VectorSearchStatus } from '../lib/vector-search/vector-search-client';

export interface AiChatEntry {
  role: 'user' | 'assistant';
  text: string;
}

const MAX_DOM_MESSAGES = 5;

export function useAiAsk(productId: string, currentPage?: number) {
  const [status, setStatus] = useState<VectorSearchStatus>('IDLE');
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<AiChatEntry[]>([]);
  const [referencedPages, setReferencedPages] = useState<number[]>([]);

  const ask = useCallback(
    async (question: string): Promise<void> => {
      const q = question.trim();
      if (!q || status === 'LOADING') return;
      setStatus('LOADING');
      setError(null);
      setHistory((prev) => [...prev.slice(-(MAX_DOM_MESSAGES - 1)), { role: 'user', text: q }]);
      try {
        const r = await vectorSearchApi().ask({ productId, userQuestion: q, currentPage });
        setHistory((prev) => [...prev.slice(-(MAX_DOM_MESSAGES - 1)), { role: 'assistant', text: r.answer }]);
        setReferencedPages(r.referencedPages);
        setStatus('SUCCESS');
      } catch (e) {
        setStatus('ERROR');
        setError((e as Error).message);
        setHistory((prev) => [
          ...prev.slice(-(MAX_DOM_MESSAGES - 1)),
          { role: 'assistant', text: 'เกิดข้อผิดพลาดในการเชื่อมต่อฐานข้อมูล Vector' },
        ]);
      }
    },
    [productId, currentPage, status],
  );

  return { status, error, history, referencedPages, ask, retry: () => setStatus('IDLE') };
}
