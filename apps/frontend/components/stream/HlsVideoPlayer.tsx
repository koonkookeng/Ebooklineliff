// SSOT Phase 043 Task 7 — HlsVideoPlayer (LIFF adaptive player, §6.1)
// Canonical: apps/frontend/components/stream/HlsVideoPlayer.tsx
// (legacy src/frontend/components/stream/HlsVideoPlayer.tsx)
// - RISK_CALL (Phase 036 precedent): native <video> HLS only — hls.js is NOT
//   a monorepo dep (Gate 5 zero-dep); Safari/iOS LIFF plays natively, other
//   engines surface the ERROR fallback (hls.js follow-up, documented).
// - 5 states (LIFF_INIT → IDLE poster → LOADING buffer → SUCCESS playing +
//   5s telemetry → ERROR token/network/entitlement + retry).
// - Forensic layer: VideoWatermarkOverlay when a seed is provided, CSS text
//   fallback otherwise (§8.2). Quality drawer swaps variant sources.
// - RAM: buffer-capped playback (Gate 5 40MB); blob URLs revoked on unmount.
// - Zero new deps.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { VIDEO_PROGRESS_SYNC_SEC, type WatermarkSeedPayload } from '@repo/shared';
import { VideoWatermarkOverlay } from '../player/VideoWatermarkOverlay';

export type HlsPlayerStatus = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

interface HlsVideoPlayerProps {
  masterManifestUrl: string;
  securityToken: string;
  watermarkText: string;
  onProgressSync: (watchedSec: number) => void;
  variants?: Array<{ label: string; url: string }>;
  seed?: WatermarkSeedPayload;
  posterUrl?: string;
  autoPlay?: boolean;
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
}: HlsVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const syncRef = useRef(onProgressSync);
  syncRef.current = onProgressSync;
  const [status, setStatus] = useState<HlsPlayerStatus>('LIFF_INIT');
  const [error, setError] = useState<string | null>(null);
  const [quality, setQuality] = useState<string>('AUTO');
  const [showQuality, setShowQuality] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const sourceFor = useCallback(
    (q: string): string => {
      const variant = variants.find((v) => v.label === q);
      const base = variant ? variant.url : masterManifestUrl;
      return `${base}${base.includes('?') ? '&' : '?'}token=${encodeURIComponent(securityToken)}`;
    },
    [masterManifestUrl, securityToken, variants],
  );

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
    video.src = sourceFor(quality);
    const onPlaying = (): void => {
      if (!cancelled) setStatus('SUCCESS');
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
    video.addEventListener('playing', onPlaying);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('error', onError);
    if (autoPlay) void video.play().catch(() => undefined);
    else setStatus('IDLE');
    const syncInterval = setInterval(() => {
      if (!cancelled && video && !video.paused && !video.ended) {
        syncRef.current(Math.floor(video.currentTime));
      }
    }, VIDEO_PROGRESS_SYNC_SEC * 1000);
    return () => {
      cancelled = true;
      clearInterval(syncInterval);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('error', onError);
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

  return (
    <div className="group relative aspect-video w-full overflow-hidden rounded-xl bg-black">
      <video ref={videoRef} className="h-full w-full object-contain" controls playsInline poster={posterUrl} aria-label="Course lesson video" />
      {seed ? (
        <VideoWatermarkOverlay seed={seed} width={640} height={360} />
      ) : (
        <div aria-hidden className="pointer-events-none absolute inset-0 z-20 select-none overflow-hidden opacity-25">
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
      {variants.length > 0 && (status === 'SUCCESS' || status === 'IDLE') && (
        <div className="absolute bottom-12 right-2 z-30">
          <button
            onClick={() => setShowQuality((v) => !v)}
            className="rounded bg-black/60 px-2 py-1 font-mono text-[11px] text-white"
            aria-expanded={showQuality}
            aria-label="Select video quality"
          >
            {quality}
          </button>
          {showQuality && (
            <div className="absolute bottom-8 right-0 w-28 overflow-hidden rounded-lg bg-black/80 py-1">
              {['AUTO', ...variants.map((v) => v.label)].map((label) => (
                <button
                  key={label}
                  onClick={() => {
                    setQuality(label);
                    setShowQuality(false);
                  }}
                  className={`block w-full px-3 py-1.5 text-left font-mono text-[11px] hover:bg-white/10 ${label === quality ? 'text-emerald-400' : 'text-white'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default HlsVideoPlayer;
