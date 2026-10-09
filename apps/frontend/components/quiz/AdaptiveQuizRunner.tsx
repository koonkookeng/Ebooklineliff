// SSOT Phase 093 §6.2 — Adaptive quiz runner (dep-free, LIFF-first)
// Canonical: apps/frontend/components/quiz/AdaptiveQuizRunner.tsx
// - RISK_CALL: no shadcn (spec asks it) — native buttons keep LIFF RAM
//   <30MB (Gate 5). Single-question viewport (no list virtualization
//   needed); mastery readout on completion.
// - Zero-dep (React only).
'use client';

import React, { useState } from 'react';
import { useAdaptiveQuiz } from '../../hooks/useAdaptiveQuiz';

export function AdaptiveQuizRunner(props: { lessonId: string; onCompleted?: (mastery: number) => void }) {
  const { status, error, question, completed, submit, retry } = useAdaptiveQuiz(props.lessonId);
  const [selected, setSelected] = useState<string | null>(null);

  async function onSubmit() {
    if (!selected) return;
    setSelected(null);
    await submit(selected);
    if (completed) props.onCompleted?.(completed.mastery);
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
