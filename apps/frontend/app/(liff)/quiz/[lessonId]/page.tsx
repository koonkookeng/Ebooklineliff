// SSOT Phase 093 — LIFF adaptive quiz page
// Canonical: apps/frontend/app/(liff)/quiz/[lessonId]/page.tsx
'use client';

import React, { Suspense, useState } from 'react';
import { useParams } from 'next/navigation';
import { AdaptiveQuizRunner } from '../../../../components/quiz/AdaptiveQuizRunner';

function QuizInner() {
  const params = useParams<{ lessonId: string }>();
  const [mastery, setMastery] = useState<number | null>(null);
  return (
    <div>
      <h1>แบบทดสอบปรับระดับ AI</h1>
      <AdaptiveQuizRunner lessonId={params.lessonId} onCompleted={setMastery} />
      {mastery != null && <p role="status">บันทึกความเข้าใจ {mastery.toFixed(1)}% แล้ว</p>}
    </div>
  );
}

export default function LiffQuizPage() {
  return (
    <Suspense fallback={<p>กำลังเตรียมข้อสอบ…</p>}>
      <QuizInner />
    </Suspense>
  );
}
