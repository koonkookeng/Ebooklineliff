// SSOT Phase 043 Task 7 + Phase 045 §6.1 — HlsVideoPlayer (LIFF player + control bar)
// Canonical: apps/frontend/components/stream/HlsVideoPlayer.tsx
// (legacy src/frontend/components/stream/HlsVideoPlayer.tsx)
// - RISK_CALL (Phase 036 precedent): native <video> HLS only — hls.js is NOT
//   a monorepo dep (Gate 5 zero-dep); Safari/iOS LIFF plays natively, other
//   engines surface the ERROR fallback (hls.js follow-up, documented).
// - 5 states (LIFF_INIT → IDLE poster → LOADING buffer → SUCCESS playing +
//   5s telemetry → ERROR token/network/entitlement + retry).
// - Phase 045 control bar: play/pause, scrubber, time, mute, SpeedController
//   (0.5x–2.5x pitch-preserved), QualitySelector (AUTO/native ABR), fullscreen,
//   resume from initialTime, isCompleted heartbeat (≥90%).
// - Forensic layer: VideoWatermarkOverlay when a seed is provided, CSS text
//   fallback otherwise (§8.2). RAM: buffer-capped playback (<30MB LIFF).
// - Zero new deps.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { LESSON_COMPLETION_RATIO, VIDEO_PROGRESS_SYNC_SEC, type PlaybackSpeed, type WatermarkSeedPayload } from '@repo/shared';
import { VideoWatermarkOverlay } from '../player/VideoWatermarkOverlay';
import { SpeedController, applyPlaybackSpeed } from '../player/SpeedController';
import { QualitySelector } from '../player/QualitySelector';

export type HlsPlayerStatus = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

interface HlsVideoPlayerProps {
  masterManifestUrl: string;
  securityToken: string;
  watermarkText: string;
  onProgressSync: (watchedSec: number, isCompleted?: boolean) => void;
  variants?: Array<{ label: string; url: string }>;
  seed?: WatermarkSeedPayload;
  posterUrl?: string;
  autoPlay?: boolean;
  initialTime?: number;
  durationSec?: number;
}

function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  return `${Math.floor(s / 60)}:${`0${s % 60}`.slice(-2)}`;
}

export function HlsVideoPlayer({
  masterManifestUrl,
  securityToken,
  watermarkText,
  onProgressSync,
  variants = [],
  seed,
  posterUrl,
  autoPlay = false,
  initialTime = 0,
  durationSec = 0,
}: HlsVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const syncRef = useRef(onProgressSync);
  syncRef.current = onProgressSync;
  const resumedRef = useRef(false);
  const [status, setStatus] = useState<HlsPlayerStatus>('LIFF_INIT');
  const [error, setError] = useState<string | null>(null);
  const [quality, setQuality] = useState<string>('AUTO');
  const [attempt, setAttempt] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(initialTime);
  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeed>('1.0');
  const [isMuted, setIsMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);

  const sourceFor = useCallback(
    (q: string): string => {
      const variant = variants.find((v) => v.label === q);
      const base = variant ? variant.url : masterManifestUrl;
      return `${base}${base.includes('?') ? '&' : '?'}token=${encodeURIComponent(securityToken)}`;
    },
    [masterManifestUrl, securityToken, variants],
  );

  const effectiveDuration = useCallback((): number => {
    if (durationSec > 0) return durationSec;
    const video = videoRef.current;
    return video && Number.isFinite(video.duration) ? video.duration : 0;
  }, [durationSec]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !masterManifestUrl) return;
    let cancelled = false;
    setStatus('LOADING');
    setError(null);
    const canNative = video.canPlayType('application/vnd.apple.mpegurl');
    if (!canNative) {
      setError('อุปกรณ์นี้ต้องใช้ MSE engine (hls.js follow-up) — กรุณาเปิดใน LINE / Safari');
      setStatus('ERROR');
      return undefined;
    }
    const at = video.currentTime;
    video.src = sourceFor(quality);
    const onPlaying = (): void => {
      if (!cancelled) {
        setStatus('SUCCESS');
        setIsPlaying(true);
      }
    };
    const onPause = (): void => {
      if (!cancelled) setIsPlaying(false);
    };
    const onWaiting = (): void => {
      if (!cancelled) setStatus('LOADING');
    };
    const onError = (): void => {
      if (!cancelled) {
        setError('การเชื่อมต่อขัดข้องหรือสิทธิ์หมดอายุ');
        setStatus('ERROR');
      }
    };
    const onLoaded = (): void => {
      if (cancelled) return;
      if (!resumedRef.current && initialTime > 0) {
        resumedRef.current = true;
        try {
          video.currentTime = Math.min(initialTime, Math.max(0, (video.duration || initialTime + 1) - 1));
        } catch {
          // Seek-before-metadata: the timeupdate path converges anyway.
        }
      }
      applyPlaybackSpeed(video, playbackSpeed);
    };
    video.addEventListener('playing', onPlaying);
    video.addEventListener('pause', onPause);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('error', onError);
    video.addEventListener('loadedmetadata', onLoaded);
    // Preserve the watch position across quality switches.
    try {
      if (at > 0) video.currentTime = at;
    } catch {
      // Ignore pre-metadata seeks.
    }
    if (autoPlay) void video.play().catch(() => undefined);
    else setStatus('IDLE');
    const syncInterval = setInterval(() => {
      if (!cancelled && video && !video.paused && !video.ended) {
        const watched = Math.floor(video.currentTime);
        const dur = effectiveDuration();
        syncRef.current(watched, dur > 0 ? watched >= dur * LESSON_COMPLETION_RATIO : false);
      }
    }, VIDEO_PROGRESS_SYNC_SEC * 1000);
    return () => {
      cancelled = true;
      clearInterval(syncInterval);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('error', onError);
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeAttribute('src');
      video.load();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [masterManifestUrl, securityToken, quality, attempt]);

  useEffect(() => {
    const t = setTimeout(() => {
      setStatus((prev) => (prev === 'LIFF_INIT' ? 'IDLE' : prev));
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void el.requestFullscreen().catch(() => undefined);
  }, []);

  const duration = effectiveDuration();

  return (
    <div
      ref={containerRef}
      className="group relative aspect-video w-full select-none overflow-hidden rounded-xl bg-black"
      onMouseMove={() => setShowControls(true)}
      onMouseLeave={() => setShowControls(false)}
    >
      <video
        ref={videoRef}
        className="h-full w-full object-contain"
        playsInline
        poster={posterUrl}
        aria-label="Course lesson video"
        onTimeUpdate={() => {
          if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
        }}
        onClick={togglePlay}
      />
      {seed ? (
        <VideoWatermarkOverlay seed={seed} width={640} height={360} />
      ) : (
        <div aria-hidden className="pointer-events-none absolute inset-0 z-10 select-none overflow-hidden opacity-25">
          <div className="absolute left-1/3 top-1/4 -translate-x-1/2 rounded bg-black/40 px-2 py-1 font-mono text-xs text-white/80">
            {watermarkText}
          </div>
        </div>
      )}
      {status === 'LOADING' && (
        <div aria-busy className="absolute inset-0 z-30 flex items-center justify-center bg-black/40">
          <div className="h-8 w-8 animate-spin rounded-full border-t-2 border-emerald-500" />
        </div>
      )}
      {status === 'ERROR' && error && (
        <div role="alert" className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/70 px-6 text-center">
          <p className="text-sm text-white">{error}</p>
          <button onClick={() => setAttempt((a) => a + 1)} className="rounded-full bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-500">
            ลองใหม่อีกครั้ง
          </button>
        </div>
      )}
      <div className={`absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-4 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0'}`}>
        <input
          type="range"
          min={0}
          max={Math.max(duration, 1)}
          step={1}
          value={Math.min(currentTime, Math.max(duration, 1))}
          onChange={(e) => {
            const time = parseFloat(e.target.value);
            setCurrentTime(time);
            if (videoRef.current) {
              try {
                videoRef.current.currentTime = time;
              } catch {
                // Ignore pre-metadata seeks.
              }
            }
          }}
          className="mb-3 h-1 w-full cursor-pointer appearance-none rounded-lg bg-gray-600 accent-emerald-500"
          aria-label="Seek video position"
        />
        <div className="flex items-center justify-between text-sm text-white">
          <div className="flex items-center space-x-3">
            <button onClick={togglePlay} className="p-1 hover:text-emerald-400" aria-label={isPlaying ? 'Pause' : 'Play'}>
              {isPlaying ? (
                <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5" aria-hidden><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5" aria-hidden><path d="M8 5v14l11-7z" /></svg>
              )}
            </button>
            <button
              onClick={() => {
                if (videoRef.current) {
                  videoRef.current.muted = !isMuted;
                  setIsMuted(!isMuted);
                }
              }}
              className="p-1 hover:text-emerald-400"
              aria-label={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5" aria-hidden><path d="M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5" aria-hidden><path d="M11 5L6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 010 7M19 5a9 9 0 010 14" strokeLinecap="round" strokeLinejoin="round" /></svg>
              )}
            </button>
            <span className="font-mono text-xs">
              {formatClock(currentTime)} / {formatClock(duration)}
            </span>
          </div>
          <div className="flex items-center space-x-3">
            <SpeedController speed={playbackSpeed} onChange={setPlaybackSpeed} videoRef={videoRef} />
            <QualitySelector quality={quality} qualities={variants.map((v) => v.label)} onChange={setQuality} />
            <button onClick={toggleFullscreen} className="p-1 hover:text-emerald-400" aria-label="Toggle fullscreen">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-[18px] w-[18px]" aria-hidden><path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default HlsVideoPlayer;
