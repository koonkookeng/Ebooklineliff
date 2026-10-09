// SSOT Phase 092 BDD-1 — AI companion hook (5-state, DOM-capped, offline fallback)
// Canonical: apps/frontend/hooks/useAiCompanion.ts
// - Streams via SSE with JSON-POST fallback; keeps max 5 messages in DOM
//   (Gate 5); caches the last answer per product in localStorage for the
//   offline-fallback engine (§2.1).
// - Zero-dep beyond the ai client.
'use client';

import { useCallback, useState } from 'react';
import { aiClient, readSseStream, type AiCitation, type AiCompanionStatus } from '../lib/ai/ai-client';

export interface CompanionEntry {
  sender: 'USER' | 'AI';
  text: string;
}

const MAX_DOM_MESSAGES = 5;

function offlineKey(productId: string): string {
  return `ai-offline:${productId}`;
}

export function useAiCompanion(productId: string, currentPage?: number) {
  const [status, setStatus] = useState<AiCompanionStatus>('LIFF_INIT');
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<CompanionEntry[]>([]);
  const [citations, setCitations] = useState<AiCitation[]>([]);
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);

  const warmed = useCallback(() => {
    setStatus((s) => (s === 'LIFF_INIT' ? 'IDLE' : s));
  }, []);

  const ask = useCallback(
    async (question: string): Promise<void> => {
      const q = question.trim();
      if (!q) return;
      setStatus('LOADING');
      setError(null);
      setMessages((prev) => [...prev.slice(-(MAX_DOM_MESSAGES - 1)), { sender: 'USER', text: q }]);
      // SSE first; JSON fallback on stream failure (offline cache last).
      try {
        let streamed = '';
        setMessages((prev) => [...prev, { sender: 'AI', text: '' }]);
        const meta = await readSseStream(
          `/api/v1/ai/chat-stream?productId=${encodeURIComponent(productId)}&q=${encodeURIComponent(q)}`,
          (batch) => {
            streamed += `${batch} `;
            const text = streamed.trim();
            setMessages((prev) => {
              const next = [...prev];
              next[next.length - 1] = { sender: 'AI', text };
              return next;
            });
          },
        );
        if (meta.sessionId) setSessionId(meta.sessionId);
        if (meta.citations) setCitations(meta.citations);
        const finalText = streamed.trim();
        if (finalText) {
          try {
            localStorage.setItem(offlineKey(productId), JSON.stringify({ q, a: finalText }));
          } catch {
            /* storage unavailable — non-fatal */
          }
        }
        setStatus('SUCCESS');
        return;
      } catch {
        /* fall through to JSON */
      }
      try {
        const r = await aiClient().chat({ productId, userQuestion: q, currentPage, sessionId });
        setSessionId(r.sessionId);
        setCitations(r.citations);
        setMessages((prev) => {
          const next = [...prev];
          if (next.length > 0 && next[next.length - 1]?.sender === 'AI' && next[next.length - 1]?.text === '') {
            next[next.length - 1] = { sender: 'AI', text: r.answerMarkdown };
          } else {
            next.push({ sender: 'AI', text: r.answerMarkdown });
          }
          return next.slice(-MAX_DOM_MESSAGES);
        });
        setStatus('SUCCESS');
      } catch (e) {
        let cached: { q: string; a: string } | null = null;
        try {
          const raw: unknown = JSON.parse(localStorage.getItem(offlineKey(productId)) ?? 'null');
          if (raw && typeof raw === 'object' && 'a' in raw) {
            cached = raw as { q: string; a: string };
          }
        } catch {
          cached = null;
        }
        if (cached) {
          setMessages((prev) => [...prev.slice(-(MAX_DOM_MESSAGES - 1)), { sender: 'AI', text: `(ออฟไลน์) ${cached.a}` }]);
          setStatus('SUCCESS');
        } else {
          setStatus('ERROR');
          setError('AI ไม่สามารถประมวลผลได้ในขณะนี้');
        }
      }
    },
    [productId, currentPage, sessionId],
  );

  return { status, error, messages, citations, sessionId, warmed, ask, retry: () => setStatus('IDLE') };
}
