// SSOT Phase 045 Task 5 + Phase 047 Task 5 — LIFF lesson route
// Canonical: apps/frontend/app/(liff)/course/[courseId]/lesson/[lessonId]/page.tsx
// - 5-state machine: LIFF_INIT (splash) → LOADING (lesson-state) →
//   IDLE/SUCCESS (player + resume + watermark) / ERROR (entitlement/network
//   + retry). Heartbeat posts watchedSec + isCompleted every 5s.
// - Phase 047: checkpoints load with state; lessons carrying quizzes render
//   the pause-lock HlsQuizPlayer, others keep the standard player.
// - Tenant accent/logo arrive via query params (library-page precedent).
// - Zero new deps.
'use client';

import { Suspense, use, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { HlsVideoPlayer } from '../../../../../../components/stream/HlsVideoPlayer';
import { HlsQuizPlayer, type QuizCheckpointProp } from '../../../../../../components/player/HlsQuizPlayer';
import { VideoScrubbingBar } from '../../../../../../components/player/video-scrubbing-bar';
import { fetchLessonState, reportLessonHeartbeat } from '../../../../../../lib/stream/lesson-stream-client';
import { fetchScrubbingManifest } from '../../../../../../lib/stream/scrubbing-client';
import type { VideoSpriteManifest } from '@repo/shared';
import { useReadWatchTracker } from '../../../../../../hooks/useReadWatchTracker';
import { fetchCheckpoints } from '../../../../../../lib/quiz/quiz-client';
import type { LessonStreamPayload } from '@repo/shared';

type LessonPageState = 'LIFF_INIT' | 'LOADING' | 'IDLE' | 'SUCCESS' | 'ERROR';

function LessonInner({ lessonId }: { lessonId: string }) {
  const params = useSearchParams();
  const accent = params.get('color') ?? '#059669';
  const [state, setState] = useState<LessonPageState>('LIFF_INIT');
  const [payload, setPayload] = useState<LessonStreamPayload | null>(null);
  const [quizzes, setQuizzes] = useState<QuizCheckpointProp[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Atomic Phase 058: thumbnail scrubbing manifest (offline-cached <15KB VTT).
  const [scrubManifest, setScrubManifest] = useState<VideoSpriteManifest | null>(null);
  const [scrubWatermark, setScrubWatermark] = useState('');
  const [scrubNow, setScrubNow] = useState(0);
  // Atomic Phase 052: watch telemetry (5s pulse cadence mirrors the heartbeat;
  // product omitted — hook falls back to lessonId and the batch writer resolves
  // the real product via lesson → section → course; server stamps identity).
  const { trackVideoPulse } = useReadWatchTracker({ userId: null, contentId: lessonId, contentType: 'WATCH' });

  useEffect(() => {
    let cancelled = false;
    setState('LOADING');
    setError(null);
    fetchScrubbingManifest(lessonId)
      .then((s) => {
        if (cancelled) return;
        setScrubManifest(s.manifest);
        setScrubWatermark(s.watermarkText);
      })
      .catch(() => undefined);
    Promise.all([fetchLessonState(lessonId), fetchCheckpoints(lessonId).catch(() => [])])
      .then(([data, checkpoints]) => {
        if (cancelled) return;
        setPayload(data);
        setQuizzes(
          (checkpoints as Array<{ id: string; timestampSec: number; question: string; quizType: string; options: Array<{ id: string; optionText: string; optionOrder: number }> }>).map((q) => ({
            id: q.id,
            timestampSec: q.timestampSec,
            question: q.question,
            quizType: q.quizType,
            options: q.options,
          })),
        );
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
      trackVideoPulse(watchedSec, payload.durationSec);
      reportLessonHeartbeat({ lessonId: payload.lessonId, watchedSec, durationSec: payload.durationSec, isCompleted }).catch(() => undefined);
    },
    [payload, trackVideoPulse],
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

  if (quizzes.length > 0) {
    const authed = `${payload.hlsManifestUrl}${payload.hlsManifestUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(payload.signedEdgeToken)}`;
    return <HlsQuizPlayer hlsStreamUrl={authed} lessonId={payload.lessonId} quizzes={quizzes} />;
  }

  const handleScrubSeek = useCallback((targetTimeSec: number) => {
    setScrubNow(targetTimeSec);
    const video = document.querySelector('video');
    if (video) {
      try {
        video.currentTime = Math.max(0, Math.min(payload.durationSec, targetTimeSec));
      } catch {
        // seek is best-effort; tooltip preview already rendered
      }
    }
  }, [payload.durationSec]);

  return (
    <div className="flex w-full flex-col gap-1">
      <HlsVideoPlayer
        masterManifestUrl={payload.hlsManifestUrl}
        securityToken={payload.signedEdgeToken}
        watermarkText={`${payload.forensicWatermark.displayName} | ${payload.forensicWatermark.userIdHash.slice(0, 12)}`}
        onProgressSync={handleProgress}
        initialTime={payload.lastWatchedSec}
        durationSec={payload.durationSec}
        autoPlay={false}
      />
      <VideoScrubbingBar
        durationSec={payload.durationSec}
        currentTimeSec={scrubNow}
        manifest={scrubManifest}
        watermarkText={scrubWatermark || `${payload.forensicWatermark.displayName} | ${payload.forensicWatermark.userIdHash.slice(0, 12)}`}
        lessonId={payload.lessonId}
        onSeek={handleScrubSeek}
      />
    </div>
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
