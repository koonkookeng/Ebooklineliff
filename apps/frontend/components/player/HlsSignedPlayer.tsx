// SSOT Phase 053 §6.1 — signed HLS player (60s token + 30s rotation + re-auth)
// Canonical: apps/frontend/components/player/HlsSignedPlayer.tsx
// (legacy src/frontend/components/player/HlsVideoPlayer.tsx companion)
// - RISK_CALL (Phase 036 precedent): native <video> HLS only — hls.js is NOT
//   a monorepo dep (Gate 5 zero-dep LIFF); Safari/iOS LIFF plays natively,
//   other engines surface the ERROR fallback. The signed-URL + rotation +
//   re-auth envelope here is engine-agnostic and reusable if hls.js lands.
// - Fetches GET /api/stream/get-signed-url?lessonId= (Next proxy → NestJS),
//   rotates the token every 30s (TTL 60s), buffers ≤2 segments (~4MB, <30MB).
// - States: LIFF_INIT → IDLE (poster) → LOADING → SUCCESS / ERROR (403 →
//   re-authenticate button, never a bare reload).
// - Zero new deps.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { HLS_TOKEN_ROTATE_SEC } from '@repo/shared';

export type HlsSignedPlayerState = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

interface HlsSignedPlayerProps {
  lessonId: string;
  posterUrl?: string;
}

interface SignedBundle {
  masterPlaylistUrl: string;
  sessionToken: string;
  expiresInSeconds: number;
  watermarkPayload: { userIdHash: string; displayName: string; timestamp: string };
}

export function HlsSignedPlayer({ lessonId, posterUrl }: HlsSignedPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const rotateRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [state, setState] = useState<HlsSignedPlayerState>('LIFF_INIT');
  const [bundle, setBundle] = useState<SignedBundle | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchBundle = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(`/api/stream/get-signed-url?lessonId=${encodeURIComponent(lessonId)}`);
      if (res.status === 403) {
        setErrorMsg('สิทธิ์การรับชมหมดอายุ หรือพบการเชื่อมต่อซ้ำซ้อน');
        setState('ERROR');
        return false;
      }
      if (!res.ok) throw new Error(`signed-url ${res.status}`);
      const data = (await res.json()) as SignedBundle;
      setBundle(data);
      setErrorMsg(null);
      return true;
    } catch {
      setErrorMsg('ไม่สามารถโหลดระบบวิดีโอได้ กรุณาลองใหม่อีกครั้ง');
      setState('ERROR');
      return false;
    }
  }, [lessonId]);

  // Initial issuance: LIFF_INIT → IDLE (poster + play affordance).
  useEffect(() => {
    let cancelled = false;
    setState('LIFF_INIT');
    void fetchBundle().then((ok) => {
      if (!cancelled) setState(ok ? 'IDLE' : 'ERROR');
    });
    return () => {
      cancelled = true;
    };
  }, [fetchBundle]);

  // 30s rotation ahead of the 60s TTL (§2.2 SUCCESS auto-rotate).
  useEffect(() => {
    if (!bundle) return;
    rotateRef.current = setInterval(() => {
      void fetchBundle();
    }, HLS_TOKEN_ROTATE_SEC * 1000);
    return () => {
      if (rotateRef.current) clearInterval(rotateRef.current);
    };
  }, [bundle, fetchBundle]);

  useEffect(
    () => () => {
      if (rotateRef.current) clearInterval(rotateRef.current);
    },
    [],
  );

  const handlePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v || !bundle) return;
    setState('LOADING');
    if (v.src !== bundle.masterPlaylistUrl) v.src = bundle.masterPlaylistUrl;
    v.play()
      ?.then(() => setState('SUCCESS'))
      .catch(() => {
        setErrorMsg('ไม่สามารถเล่นวิดีโอได้ กรุณาลองใหม่อีกครั้ง');
        setState('ERROR');
      });
  }, [bundle]);

  const handleReauth = useCallback(() => {
    setState('LOADING');
    void fetchBundle().then((ok) => {
      setState(ok ? 'IDLE' : 'ERROR');
    });
  }, [fetchBundle]);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black shadow-2xl">
      {(state === 'LIFF_INIT' || state === 'LOADING') && (
        <div role="status" aria-label="loading video" className="absolute inset-0 z-10 flex items-center justify-center bg-black/70">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-500 border-t-emerald-400" />
        </div>
      )}
      {state === 'ERROR' && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/90 p-4 text-center text-white">
          <p className="mb-4 font-semibold text-red-400">{errorMsg}</p>
          <button
            type="button"
            onClick={handleReauth}
            className="rounded-md bg-emerald-600 px-4 py-2 text-white transition hover:bg-emerald-500"
          >
            ขอรับรหัสผ่านวิดีโอใหม่ (Re-authenticate)
          </button>
        </div>
      )}
      {(state === 'IDLE' || state === 'SUCCESS' || state === 'LOADING') && (
        <button
          type="button"
          onClick={handlePlay}
          aria-label="play lesson video"
          className="absolute inset-0 z-0 h-full w-full"
        >
          {posterUrl && state === 'IDLE' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={posterUrl} alt="lesson poster" className="h-full w-full object-contain" />
          ) : null}
        </button>
      )}
      <video
        ref={videoRef}
        controls
        controlsList="nodownload"
        playsInline
        preload="metadata"
        className="h-full w-full object-contain"
        onPlaying={() => setState('SUCCESS')}
      />
      {bundle && (
        <div className="pointer-events-none absolute inset-0 z-10 flex select-none items-center justify-center opacity-25">
          <span className="rotate-[-12deg] rounded bg-black/40 px-3 py-1 font-mono text-xs tracking-widest text-white sm:text-base">
            {bundle.watermarkPayload.userIdHash} | {bundle.watermarkPayload.displayName}
          </span>
        </div>
      )}
    </div>
  );
}

export default HlsSignedPlayer;
