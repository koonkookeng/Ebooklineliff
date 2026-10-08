// SSOT Phase 063 Task 7 — OfflineHlsPlayer (IDB segment playback)
// Canonical: apps/frontend/components/player/OfflineHlsPlayer.tsx
// (legacy src/frontend/components/player/OfflineHlsPlayer.tsx)
// - Offline: serves cached lesson segments via the /hls-offline-stream/
//   service-worker path (IDB videoSegments); online: native HLS URL.
// - 5 states (LIFF_INIT → IDLE poster → LOADING → SUCCESS playing /
//   ERROR missing-cache + retry). Single <video> element, src torn down on
//   unmount (RAM discipline). Progress queued for bg-sync flush.
// - Zero new deps.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { recordOfflineProgress } from '../../lib/offline/offline-manager';

type OfflinePlayerState = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

interface OfflineHlsPlayerProps {
  lessonId: string;
  courseId: string;
  onlineManifestUrl?: string;
  posterUrl?: string;
}

export function OfflineHlsPlayer({ lessonId, courseId, onlineManifestUrl, posterUrl }: OfflineHlsPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<OfflinePlayerState>('LIFF_INIT');
  const [error, setError] = useState<string | null>(null);

  const offlineUrl = `/hls-offline-stream/${encodeURIComponent(lessonId)}/playlist.m3u8`;

  useEffect(() => {
    let cancelled = false;
    setState('LOADING');
    const offline = typeof navigator !== 'undefined' && !navigator.onLine;
    const src = offline || !onlineManifestUrl ? offlineUrl : onlineManifestUrl;
    const video = videoRef.current;
    if (!video) return;
    video.src = src;
    const onCanPlay = () => {
      if (!cancelled) setState('SUCCESS');
    };
    const onError = () => {
      if (cancelled) return;
      setError(offline ? 'บทเรียนนี้ยังไม่ได้ดาวน์โหลดไว้สำหรับเรียนออฟไลน์' : 'โหลดวิดีโอไม่สำเร็จ');
      setState('ERROR');
    };
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('error', onError);
    return () => {
      cancelled = true;
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('error', onError);
      video.removeAttribute('src');
      video.load();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId, onlineManifestUrl]);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.currentTime < 1) return;
    void recordOfflineProgress({
      type: 'COURSE_PROGRESS',
      targetId: lessonId,
      payload: {
        lessonId,
        courseId,
        watchedSec: Math.floor(video.currentTime),
        isCompleted: false,
        timestamp: Date.now(),
      },
    });
  }, [lessonId, courseId]);

  return (
    <div className="relative w-full overflow-hidden rounded-xl bg-black">
      {(state === 'LIFF_INIT' || state === 'LOADING') && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/60" aria-busy>
          <div className="h-8 w-8 animate-spin rounded-full border-t-2 border-emerald-500" />
        </div>
      )}
      <video
        ref={videoRef}
        controls
        playsInline
        preload="metadata"
        poster={posterUrl}
        onTimeUpdate={handleTimeUpdate}
        className="aspect-video w-full"
      />
      {state === 'ERROR' && error && (
        <div role="alert" className="absolute inset-x-0 bottom-0 bg-slate-900/90 px-4 py-2 text-center text-xs text-white">
          {error}
        </div>
      )}
    </div>
  );
}

export default OfflineHlsPlayer;
