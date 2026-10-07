// SSOT Phase 047 Task 6 — InVideoQuizOverlay (quiz machine UI, §2.2)
// Canonical: apps/frontend/components/quiz/InVideoQuizOverlay.tsx
// (legacy src/frontend/components/quiz/InVideoQuizOverlay.tsx)
// - QUIZ_TRIGGERED → QUIZ_EVALUATING (spinner, locked inputs) →
//   QUIZ_SUCCESS (green confirm, auto-close) / QUIZ_RETRY_LOCK (hint box +
//   shake, retry counter). GPU-only motion (translate3d), glassmorphism lite.
// - Tenant accents via CSS vars (--accent-correct/--accent-error fallbacks).
// - Zero new deps (react only).
'use client';

import { useEffect, useRef, useState } from 'react';
import type { QuizCheckpoint, QuizEvaluationResult } from '@repo/shared';

export type QuizOverlayState = 'QUIZ_TRIGGERED' | 'QUIZ_EVALUATING' | 'QUIZ_SUCCESS' | 'QUIZ_RETRY_LOCK';

interface InVideoQuizOverlayProps {
  quiz: QuizCheckpoint;
  lessonId: string;
  playbackTime: number;
  onSuccess: (result: QuizEvaluationResult) => void;
  onClose?: () => void;
}

async function submitAnswer(lessonId: string, quizId: string, selectedOptionIds: string[], shortAnswerText: string | undefined, playbackTime: number): Promise<QuizEvaluationResult> {
  const res = await fetch('/api/v1/quiz/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ quizId, lessonId, selectedOptionIds, shortAnswerText, playbackTimeSec: playbackTime }),
  });
  if (!res.ok) throw new Error(`submit ${res.status}`);
  return (await res.json()) as QuizEvaluationResult;
}

export function InVideoQuizOverlay({ quiz, lessonId, playbackTime, onSuccess, onClose }: InVideoQuizOverlayProps) {
  const [state, setState] = useState<QuizOverlayState>('QUIZ_TRIGGERED');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [shortAnswer, setShortAnswer] = useState('');
  const [result, setResult] = useState<QuizEvaluationResult | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (state !== 'QUIZ_SUCCESS') return;
    const t = setTimeout(() => {
      if (result) onSuccess(result);
    }, 900);
    return () => clearTimeout(t);
  }, [state, result, onSuccess]);

  const toggleOption = (id: string): void => {
    if (state !== 'QUIZ_TRIGGERED' && state !== 'QUIZ_RETRY_LOCK') return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (quiz.quizType === 'SINGLE_CHOICE' || quiz.quizType === 'TRUE_FALSE') {
        next.clear();
        next.add(id);
      } else if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const submit = async (): Promise<void> => {
    if (state === 'QUIZ_EVALUATING' || state === 'QUIZ_SUCCESS') return;
    setError(null);
    setState('QUIZ_EVALUATING');
    try {
      const out = await submitAnswer(lessonId, quiz.id, [...selected], shortAnswer || undefined, playbackTime);
      if (!mountedRef.current) return;
      setResult(out);
      setAttempts((a) => a + 1);
      setState(out.isCorrect ? 'QUIZ_SUCCESS' : 'QUIZ_RETRY_LOCK');
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e instanceof Error ? e.message : 'Submit failed');
      setState('QUIZ_RETRY_LOCK');
    }
  };

  const locked = state === 'QUIZ_EVALUATING' || state === 'QUIZ_SUCCESS';

  return (
    <div role="dialog" aria-modal aria-label={`Quiz: ${quiz.question}`} className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]">
      <div
        className={`w-full max-w-md rounded-2xl border border-white/10 bg-slate-900/95 p-5 text-white shadow-2xl will-change-transform ${
          state === 'QUIZ_RETRY_LOCK' && attempts > 0 ? 'animate-[quizshake_0.4s_ease]' : ''
        }`}
        style={{ transform: 'translate3d(0,0,0)' }}
      >
        <p className="font-mono text-[11px] uppercase tracking-wider text-white/50">Checkpoint · {Math.floor(quiz.timestampSec / 60)}:{`0${quiz.timestampSec % 60}`.slice(-2)}</p>
        <h3 className="mt-1 text-base font-semibold">{quiz.question}</h3>

        {quiz.quizType === 'SHORT_ANSWER' ? (
          <textarea
            value={shortAnswer}
            onChange={(e) => setShortAnswer(e.target.value)}
            disabled={locked}
            rows={2}
            placeholder="พิมพ์คำตอบ…"
            className="mt-3 w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none placeholder:text-white/30 focus:border-emerald-500 disabled:opacity-50"
          />
        ) : (
          <div className="mt-3 space-y-2">
            {quiz.options.map((opt) => {
              const active = selected.has(opt.id);
              return (
                <button
                  key={opt.id}
                  onClick={() => toggleOption(opt.id)}
                  disabled={locked}
                  aria-pressed={active}
                  className={`block w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:opacity-60 ${
                    active ? 'border-emerald-400 bg-emerald-400/10' : 'border-white/15 bg-white/5 hover:border-white/30'
                  }`}
                >
                  {opt.optionText}
                </button>
              );
            })}
          </div>
        )}

        {state === 'QUIZ_EVALUATING' && (
          <div aria-busy className="mt-4 flex items-center gap-2 text-xs text-white/60">
            <span className="h-4 w-4 animate-spin rounded-full border-t-2 border-emerald-400" /> กำลังตรวจคำตอบ…
          </div>
        )}

        {state === 'QUIZ_SUCCESS' && (
          <div role="status" className="mt-4 rounded-lg border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 text-sm" style={{ ['--accent-correct' as string]: '#34d399' }}>
            ถูกต้อง! +{result?.earnedScore ?? 0} คะแนน — เล่นต่อใน <span className="font-mono">0.1s</span>
          </div>
        )}

        {state === 'QUIZ_RETRY_LOCK' && (
          <div className="mt-4 space-y-2">
            {result?.aiHint && (
              <div role="status" className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs leading-relaxed">
                AI Hint · ครั้งที่ {attempts}: {result.aiHint}
              </div>
            )}
            {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
            {typeof quiz.maxRetries === 'number' && quiz.maxRetries > 0 && (
              <p className="font-mono text-[11px] text-white/50">เหลือโอกาส {Math.max(0, quiz.maxRetries - attempts)} ครั้ง</p>
            )}
          </div>
        )}

        <div className="mt-4 flex items-center justify-between">
          {onClose && state !== 'QUIZ_SUCCESS' ? (
            <button onClick={onClose} className="text-xs text-white/50 underline">
              ข้ามชั่วคราว
            </button>
          ) : (
            <span />
          )}
          {state !== 'QUIZ_SUCCESS' && (
            <button
              onClick={() => void submit()}
              disabled={locked}
              className="rounded-full bg-emerald-600 px-6 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              ส่งคำตอบ{attempts > 0 ? ` (ครั้งที่ ${attempts + 1})` : ''}
            </button>
          )}
        </div>
      </div>
      <style>{`@keyframes quizshake{0%,100%{transform:translate3d(0,0,0)}25%{transform:translate3d(-6px,0,0)}75%{transform:translate3d(6px,0,0)}}`}</style>
    </div>
  );
}

export default InVideoQuizOverlay;
