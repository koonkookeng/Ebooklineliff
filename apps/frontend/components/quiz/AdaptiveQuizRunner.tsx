// SSOT Phase 093 §6.2 — Adaptive quiz runner (dep-free, LIFF-first)
// Canonical: apps/frontend/components/quiz/AdaptiveQuizRunner.tsx
// - RISK_CALL: no shadcn (spec asks it) — native buttons keep LIFF RAM
//   <30MB (Gate 5). Single-question viewport (no list virtualization
//   needed); mastery readout on completion.
// - Zero-dep (React only).
'use client';

import React, { useEffect, useState } from 'react';
import { useAdaptiveQuiz } from '../../hooks/useAdaptiveQuiz';

export function AdaptiveQuizRunner(props: { lessonId: string; onCompleted?: (mastery: number) => void }) {
  const { lessonId, onCompleted } = props;
  const { status, error, question, completed, submit, retry } = useAdaptiveQuiz(lessonId);
  const [selected, setSelected] = useState<string | null>(null);

  // Fire completion callback from state (not post-await closure — React
  // state updates are async, so `completed` read after `await submit()`
  // would still hold the pre-submit value and the callback never fires).
  useEffect(() => {
    if (completed) onCompleted?.(completed.mastery);
  }, [completed, onCompleted]);

  async function onSubmit() {
    if (!selected) return;
    setSelected(null);
    await submit(selected);
  }

  if (status === 'LIFF_INIT' || (status === 'LOADING' && !question)) {
    return (
      <div aria-busy="true">
        <p>AI กำลังเลือกข้อสอบที่เหมาะกับคุณ…</p>
      </div>
    );
  }

  if (status === 'SUCCESS' && completed) {
    return (
      <div>
        <p role="status">การประเมินผลเสร็จสิ้น! ระดับความเข้าใจของคุณ: {completed.mastery.toFixed(1)}%</p>
      </div>
    );
  }

  if (status === 'ERROR' || !question) {
    return (
      <div>
        <p role="alert">{error ?? 'โหลดข้อสอบไม่สำเร็จ'}</p>
        <button type="button" onClick={retry}>
          ลองใหม่
        </button>
      </div>
    );
  }

  return (
    <div>
      <h3>{question.questionText}</h3>
      <p>
        θ {question.currentTheta.toFixed(2)} · เข้าใจ ~{question.estimatedMasteryPercent.toFixed(1)}%
      </p>
      <div>
        {question.options.map((opt) => (
          <button key={opt.id} type="button" onClick={() => setSelected(opt.id)} aria-pressed={selected === opt.id}>
            {opt.text}
          </button>
        ))}
      </div>
      <button type="button" onClick={() => void onSubmit()} disabled={!selected || status === 'LOADING'}>
        {status === 'LOADING' ? 'กำลังประมวลผล AI...' : 'ส่งคำตอบ'}
      </button>
    </div>
  );
}

export default AdaptiveQuizRunner;
