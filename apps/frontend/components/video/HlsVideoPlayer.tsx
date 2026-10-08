// SSOT Phase 046 Task 5 — video/ HlsVideoPlayer (sync-wired lesson player)
// Canonical: apps/frontend/components/video/HlsVideoPlayer.tsx
// (legacy src/frontend/components/video/HlsVideoPlayer.tsx)
// - Lesson-integrated wrapper over the stream/ engine (Phase 043/045 —
//   single playback implementation, §9 zero-redundancy): binds
//   useVideoProgressSync (5s heartbeat + beacon flush + offline retry) and
//   renders the §2.1 sync pulse dot over the controls.
// - Props mirror the engine plus identity for sync; engine props pass
//   through untouched.
// - Zero new deps.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { HlsVideoPlayer as StreamPlayer } from '../stream/HlsVideoPlayer';
import { useVideoProgressSync } from './hooks/useVideoProgressSync';
import { VideoResumeToast } from './VideoResumeToast';
import { fetchLessonState } from '../../lib/stream/lesson-stream-client';
import { shouldShowResumeToast } from '@repo/shared';
import type { WatermarkSeedPayload } from '@repo/shared';

interface VideoHlsPlayerProps {
  lessonId: string;
  userId: string;
  token: string;
  masterManifestUrl: string;
  securityToken: string;
  watermarkText: string;
  initialTime?: number;
  durationSec?: number;
  seed?: WatermarkSeedPayload;
  posterUrl?: string;
  autoPlay?: boolean;
  /** Phase 054 opt-in: offer cross-device resume toast (default off — zero behavior change). */
  enableResumeToast?: boolean;
}

export function HlsVideoPlayer({
  lessonId,
  userId,
  token,
  masterManifestUrl,
  securityToken,
  watermarkText,
  initialTime = 0,
  durationSec = 0,
  seed,
  posterUrl,
  autoPlay = false,
  enableResumeToast = false,
}: VideoHlsPlayerProps) {
  const [pulse, setPulse] = useState(false);
  const lastKnownRef = useRef({ time: initialTime, duration: durationSec });
  const { executeSync } = useVideoProgressSync({ lessonId, userId, token });
  // Phase 054: cross-device resume offer (opt-in). The engine remounts with
  // key={startAt} on explicit resume so no engine seeking API is needed.
  const [resumeOffer, setResumeOffer] = useState<number | null>(null);
  const [startAt, setStartAt] = useState(initialTime);

  const handleProgress = useCallback(
    (watchedSec: number, isCompleted: boolean = false) => {
      void isCompleted;
      lastKnownRef.current = { time: watchedSec, duration: durationSec > 0 ? durationSec : watchedSec };
      void executeSync(watchedSec, lastKnownRef.current.duration, false).then(() => {
        setPulse(true);
        setTimeout(() => setPulse(false), 500);
      });
    },
    [durationSec, executeSync],
  );

  useEffect(() => {
    if (!enableResumeToast) return;
    let cancelled = false;
    void fetchLessonState(lessonId)
      .then((state) => {
        if (cancelled) return;
        if (shouldShowResumeToast(state.lastWatchedSec, state.durationSec)) {
          setResumeOffer(state.lastWatchedSec);
        }
      })
      .catch(() => undefined); // ERROR state: silent, play from 00:00 (§2.2).
    return () => {
      cancelled = true;
    };
  }, [enableResumeToast, lessonId]);

  const handleResume = useCallback(() => {
    if (resumeOffer !== null) setStartAt(resumeOffer);
    setResumeOffer(null);
  }, [resumeOffer]);

  const handleRestart = useCallback(() => {
    setResumeOffer(null);
  }, []);

  useEffect(() => {
    const flush = (beacon: boolean): void => {
      const { time, duration } = lastKnownRef.current;
      if (duration > 0 && time > 0) void executeSync(time, duration, beacon);
    };
    const onHide = (): void => {
      if (document.visibilityState === 'hidden') flush(true);
    };
    const onUnload = (): void => flush(true);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onUnload);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onUnload);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [executeSync]);

  return (
    <div className="relative">
      <StreamPlayer
        key={startAt}
        masterManifestUrl={masterManifestUrl}
        securityToken={securityToken}
        watermarkText={watermarkText}
        onProgressSync={handleProgress}
        initialTime={startAt}
        durationSec={durationSec}
        seed={seed}
        posterUrl={posterUrl}
        autoPlay={startAt > 0 ? true : autoPlay}
      />
      {resumeOffer !== null && (
        <VideoResumeToast savedTimeSec={resumeOffer} onResume={handleResume} onRestart={handleRestart} />
      )}
      <span
        aria-hidden
        title={pulse ? 'Progress synced' : 'Sync idle'}
        className={`pointer-events-none absolute right-3 top-3 z-40 h-2 w-2 rounded-full transition-colors ${pulse ? 'bg-emerald-400' : 'bg-white/30'}`}
      />
    </div>
  );
}

export default HlsVideoPlayer;
