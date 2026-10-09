// SSOT Phase 093 BDD-1 — Adaptive quiz hook (5-state, response-time meter)
// Canonical: apps/frontend/hooks/useAdaptiveQuiz.ts
// - LIFF_INIT warm -> IDLE question -> LOADING submit (<200ms server) ->
//   SUCCESS next/completion / ERROR + retry. Measures responseTimeMs
//   per question for the IRT ledger.
// - Zero-dep beyond the adaptive client.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { adaptiveApi, type AdaptiveQuestion, type AdaptiveStatus } from '../lib/adaptive/adaptive-client';

export function useAdaptiveQuiz(lessonId: string | null) {
  const [status, setStatus] = useState<AdaptiveStatus>('LIFF_INIT');
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState<AdaptiveQuestion | null>(null);
  const [completed, setCompleted] = useState<{ theta: number; mastery: number } | null>(null);
  const startedAt = useRef<number>(Date.now());

  const load = useCallback(async () => {
    if (!lessonId) {
      setStatus('ERROR');
      setError('ลิงก์แบบทดสอบไม่ถูกต้อง');
      return;
    }
    setStatus('LOADING');
    setError(null);
    try {
      const q = await adaptiveApi().next(lessonId);
      startedAt.current = Date.now();
      if (q.isTestCompleted) {
        setCompleted({ theta: q.currentTheta, mastery: q.estimatedMasteryPercent });
        setStatus('SUCCESS');
      } else {
        setQuestion(q);
        setStatus('IDLE');
      }
    } catch (e) {
      setStatus('ERROR');
      setError((e as Error).message);
    }
  }, [lessonId]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  async function submit(selectedOptionId: string): Promise<void> {
    if (!lessonId || !question) return;
    const responseTimeMs = Date.now() - startedAt.current;
    setStatus('LOADING');
    try {
      const q = await adaptiveApi().submit({
        lessonId,
        questionId: question.questionId,
        selectedOptionId,
        responseTimeMs,
      });
      startedAt.current = Date.now();
      if (q.isTestCompleted) {
        setCompleted({ theta: q.currentTheta, mastery: q.estimatedMasteryPercent });
        setQuestion(null);
        setStatus('SUCCESS');
      } else {
        setQuestion(q);
        setStatus('IDLE');
      }
    } catch (e) {
      setStatus('ERROR');
      setError((e as Error).message);
    }
  }

  return { status, error, question, completed, submit, retry: () => void load() };
}
