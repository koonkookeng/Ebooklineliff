// SSOT Phase 045 Task 5 — LIFF lesson route (stream state + player composition)
// Canonical: apps/frontend/app/(liff)/course/[courseId]/lesson/[lessonId]/page.tsx
// - 5-state machine: LIFF_INIT (splash) → LOADING (lesson-state) →
//   IDLE/SUCCESS (player + resume + watermark) / ERROR (entitlement/network
//   + retry). Heartbeat posts watchedSec + isCompleted every 5s.
// - Tenant accent/logo arrive via query params (library-page precedent).
// - Zero new deps.
'use client';

import { Suspense, use, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { HlsVideoPlayer } from '../../../../../../components/stream/HlsVideoPlayer';
import { fetchLessonState, reportLessonHeartbeat } from '../../../../../../lib/stream/lesson-stream-client';
import type { LessonStreamPayload } from '@repo/shared';

type LessonPageState = 'LIFF_INIT' | 'LOADING' | 'IDLE' | 'SUCCESS' | 'ERROR';

function LessonInner({ lessonId }: { lessonId: string }) {
  const params = useSearchParams();
  const accent = params.get('color') ?? '#059669';
  const [state, setState] = useState<LessonPageState>('LIFF_INIT');
  const [payload, setPayload] = useState<LessonStreamPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState('LOADING');
    setError(null);
    fetchLessonState(lessonId)
      .then((data) => {
        if (cancelled) return;
        setPayload(data);
        setState('IDLE');
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'โหลดบทเรียนไม่สำเร็จ');
        setState('ERROR');
      });
    return () => {
      cancelled = true;
    };
  }, [lessonId, attempt]);

  const handleProgress = useCallback(
    (watchedSec: number, isCompleted: boolean = false) => {
      if (!payload) return;
      reportLessonHeartbeat({ lessonId: payload.lessonId, watchedSec, durationSec: payload.durationSec, isCompleted }).catch(() => undefined);
    },
    [payload],
  );

  if (state === 'LIFF_INIT' || state === 'LOADING') {
    return (
      <div className="flex aspect-video w-full items-center justify-center rounded-xl bg-black" aria-busy style={{ borderTop: `3px solid ${accent}` }}>
        <div className="h-8 w-8 animate-spin rounded-full border-t-2 border-emerald-500" />
      </div>
    );
  }

  if (state === 'ERROR' || !payload) {
    return (
      <div role="alert" className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-xl bg-black px-6 text-center">
        <p className="text-sm text-white">{error ?? 'ไม่พบสิทธิ์การเข้าถึงหรือการเชื่อมต่อขัดข้อง'}</p>
        <button onClick={() => setAttempt((a) => a + 1)} className="rounded-full bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-500">
          ลองอีกครั้ง
        </button>
      </div>
    );
  }

  return (
    <HlsVideoPlayer
      masterManifestUrl={payload.hlsManifestUrl}
      securityToken={payload.signedEdgeToken}
      watermarkText={`${payload.forensicWatermark.displayName} | ${payload.forensicWatermark.userIdHash.slice(0, 12)}`}
      onProgressSync={handleProgress}
      initialTime={payload.lastWatchedSec}
      durationSec={payload.durationSec}
      autoPlay={false}
    />
  );
}

export default function LiffLessonPage({ params }: { params: Promise<{ courseId: string; lessonId: string }> }) {
  const { lessonId } = use(params);
  return (
    <Suspense fallback={<div className="flex aspect-video w-full items-center justify-center rounded-xl bg-black" aria-busy><div className="h-8 w-8 animate-spin rounded-full border-t-2 border-emerald-500" /></div>}>
      <main className="mx-auto w-full max-w-3xl px-4 py-4">
        <LessonInner lessonId={lessonId} />
      </main>
    </Suspense>
  );
}
