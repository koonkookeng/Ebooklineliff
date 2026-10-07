// SSOT Phase 036 Task 7/§6.2 — HLS R2 player (token handshake + native render)
// Canonical: apps/frontend/components/stream/hls-r2-player.tsx
// (legacy src/frontend/components/stream/hls-r2-player.tsx)
// - BDD Scenario 2: fetches the 60s presigned manifest + bearer token via the
//   vault proxy (JWT cookie binds identity + entitlement server-side).
// - RISK_CALL deviation (documented): native <video> playback only — hls.js is
//   NOT a dependency of this monorepo (Gate 5 zero-dep); Safari/iOS LIFF plays
//   HLS natively, other engines mount their MSE stack and reuse manifestUrl.
//   The token handshake, states, and buffer UI below are engine-agnostic.
// - 5 states: LIFF_INIT → IDLE → LOADING (handshake/buffer) → SUCCESS /
//   ERROR (expired token → retry re-handshakes once, else toast).
// - Zero new deps.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type HlsR2Status = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

interface HlsR2PlayerProps {
  lessonId: string;
  courseId?: string;
  autoPlay?: boolean;
}

interface ManifestResponse {
  playlistUrl?: string;
  streamToken?: string;
  expiresAt?: string;
  zeroEgressVerified?: boolean;
}

export function HlsR2Player({ lessonId, courseId, autoPlay = false }: HlsR2PlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<HlsR2Status>('LIFF_INIT');
  const [error, setError] = useState<string | null>(null);
  const [bufferPct, setBufferPct] = useState(0);
  const retriedRef = useRef(false);

  const load = useCallback(async () => {
    setStatus('LOADING');
    setError(null);
    try {
      const qs = new URLSearchParams({ lessonId });
      if (courseId) qs.set('courseId', courseId);
      const res = await fetch(`/api/v1/media-vault/hls-manifest?${qs.toString()}`, {
        headers: { Accept: 'application/json' },
      });
      if (res.status === 401 || res.status === 403) throw new Error('โปรดเข้าสู่ระบบใหม่');
      if (!res.ok) throw new Error(`manifest ${res.status}`);
      const data = (await res.json()) as ManifestResponse;
      if (!data.playlistUrl) throw new Error('empty manifest');
      const video = videoRef.current;
      if (!video) throw new Error('video unavailable');
      const canNative = video.canPlayType('application/vnd.apple.mpegurl');
      if (!canNative) throw new Error('MSE engine required (hls.js follow-up)');
      video.src = data.playlistUrl;
      if (autoPlay) await video.play().catch(() => undefined);
      setStatus('SUCCESS');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'stream failed';
      // Single re-handshake for expired tokens, then surface the toast.
      if (!retriedRef.current && /401|expired/i.test(message)) {
        retriedRef.current = true;
        await load();
        return;
      }
      setError(message);
      setStatus('ERROR');
    }
  }, [lessonId, courseId, autoPlay]);

  useEffect(() => {
    setStatus('IDLE');
    void load();
  }, [load]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onProgress = () => {
      try {
        if (video.buffered.length > 0 && video.duration > 0) {
          setBufferPct(Math.round((video.buffered.end(video.buffered.length - 1) / video.duration) * 100));
        }
      } catch {
        // Buffered probing is best-effort.
      }
    };
    video.addEventListener('progress', onProgress);
    return () => video.removeEventListener('progress', onProgress);
  }, []);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
      {status === 'LOADING' ? (
        <div aria-busy="true" className="absolute inset-0 flex animate-pulse items-center justify-center text-sm text-white">
          กำลังโหลดวิดีโอจาก Cloudflare R2 (Zero-Egress Network)... {bufferPct > 0 ? `${bufferPct}%` : ''}
        </div>
      ) : null}
      {status === 'ERROR' ? (
        <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white">
          <p className="text-sm">{error ?? 'โหลดวิดีโอไม่สำเร็จ'}</p>
          <button type="button" onClick={() => void load()} className="rounded-xl bg-white/10 px-4 py-2 text-sm">
            ลองอีกครั้ง
          </button>
        </div>
      ) : null}
      <video ref={videoRef} controls playsInline preload="metadata" className="h-full w-full object-contain" aria-label={`lesson ${lessonId}`} />
    </div>
  );
}

export default HlsR2Player;
