// SSOT Phase 031 Task 6 — Keep-alive HLS player shell (timestamp preservation)
// Canonical: apps/frontend/components/player/HlsVideoPlayer.tsx
// (legacy src/frontend/components/player/HlsVideoPlayer.tsx)
// - Playback engine stays in hls-video-player.tsx (untouched); this shell owns
//   the keep-alive track: timeupdate snapshots → hidden pause + commit →
//   visible resume at the exact timestamp (BDD Scenario 2, 12:45 → 765s).
// - Server progress convention (/api/stream/progress every 5s) is mirrored so
//   heatmaps keep flowing while this shell is mounted instead of the engine.
// - States: provider HYDRATING (skeleton) → ACTIVE → BACKGROUND_PRESERVED
//   (paused) → resume; ERROR_FALLBACK toasts the restore.
// - Zero new deps.
'use client';

import { useEffect, useRef, useState } from 'react';
import { useViewportKeepAlive } from '../keep-alive/useKeepAlive';

interface HlsVideoPlayerProps {
  lessonId: string;
  src: string;
  initialSeconds?: number;
}

export function HlsVideoPlayer({ lessonId, src, initialSeconds = 0 }: HlsVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playedRef = useRef(initialSeconds);
  const rateRef = useRef(1);
  const [resumed, setResumed] = useState(false);

  const keepAlive = useViewportKeepAlive({
    viewportType: 'VIDEO_PLAYER',
    resourceId: lessonId,
    snapshot: () => ({
      lessonId,
      playedSeconds: Math.floor(playedRef.current),
      playbackRate: rateRef.current,
      volume: videoRef.current?.volume ?? 1,
    }),
    rehydrate: (s) => {
      playedRef.current = s.playedSeconds;
      const v = videoRef.current;
      if (v) {
        v.playbackRate = s.playbackRate;
        v.volume = s.volume;
        if (Math.abs(v.currentTime - s.playedSeconds) > 1.5) v.currentTime = s.playedSeconds;
      }
      setResumed(true);
    },
    release: () => {
      videoRef.current?.pause();
    },
  });

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (playedRef.current > 0) {
      const applyInitial = () => {
        if (Math.abs(v.currentTime - playedRef.current) > 1.5) v.currentTime = playedRef.current;
      };
      v.addEventListener('loadedmetadata', applyInitial, { once: true });
    }
    const onTime = () => {
      playedRef.current = v.currentTime;
    };
    const onRate = () => {
      rateRef.current = v.playbackRate;
    };
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('ratechange', onRate);
    const t = setInterval(() => {
      fetch('/api/stream/progress', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lessonId, watchedSec: Math.floor(playedRef.current) }),
      }).catch(() => undefined);
    }, 5000);
    return () => {
      clearInterval(t);
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('ratechange', onRate);
    };
  }, [lessonId, src]);

  return (
    <div>
      {keepAlive.status === 'HYDRATING' && <div aria-busy>Skeleton restoring video…</div>}
      {keepAlive.status === 'ERROR_FALLBACK' && <div role="status">กู้คืนหน้าจอล่าสุดสำเร็จ</div>}
      <video
        ref={videoRef}
        src={src}
        controls
        playsInline
        preload="metadata"
        aria-label={`lesson ${lessonId}${resumed ? ' (resumed)' : ''}`}
      />
    </div>
  );
}

export default HlsVideoPlayer;
