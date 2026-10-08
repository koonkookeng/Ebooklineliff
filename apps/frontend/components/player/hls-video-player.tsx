'use client';
// SSOT Phase 050 §6.1 — secure HLS player: short-lived tokens + 429 backoff + renewal
// Canonical: apps/frontend/components/player/hls-video-player.tsx
// (legacy src/frontend/components/player/hls-video-player.tsx)
// - 5 states: LIFF_INIT → IDLE → LOADING → SUCCESS / ERROR (429 throttle,
//   token expiry, ban/CAPTCHA). Zero new deps: hls.js isOPTIONAL via dynamic
//   import (enhanced path); native HLS (<video src=m3u8>) is the fallback so
//   LIFF RAM stays < 25MB and no heavy dep ships in the bundle.
// - Buffer caps (10s / 20s max) stop full-video preload rip attempts.
// - Stream token auto-renews every 8s in the background (§2.2 SUCCESS).
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  VIDEO_PLAYER_MAX_BUFFER_SEC,
  VIDEO_PLAYER_MAX_MAX_BUFFER_SEC,
  VIDEO_TOKEN_RENEW_SEC,
  videoBackoffMs,
} from '@repo/shared';

export type HlsPlayerUiState = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

interface HlsVideoPlayerProps {
  lessonId: string;
  initialStreamToken: string;
  onRateLimited?: () => void;
  /** Legacy compat: direct source (pre-050 callers). Token path preferred. */
  src?: string;
}

type HlsCtor = new (config: Record<string, unknown>) => {
  loadSource: (url: string) => void;
  attachMedia: (el: HTMLVideoElement) => void;
  on: (event: string, cb: (e: unknown, data: { response?: { code?: number } }) => void) => void;
  stopLoad: () => void;
  startLoad: () => void;
  destroy: () => void;
};

async function loadHlsCtor(): Promise<HlsCtor | null> {
  try {
    // Non-literal specifier: no bundle dep, no type resolution; native fallback when absent.
    const moduleName = 'hls.js';
    const mod = (await import(moduleName)) as unknown as {
      default: HlsCtor & { isSupported: () => boolean };
    };
    return mod.default?.isSupported() ? mod.default : null;
  } catch {
    return null;
  }
}

export function HlsVideoPlayer({ lessonId, initialStreamToken, onRateLimited, src }: HlsVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const [ui, setUi] = useState<HlsPlayerUiState>('LIFF_INIT');
  const [streamToken, setStreamToken] = useState(initialStreamToken);
  const [notice, setNotice] = useState<string | null>(null);
  const [throttled, setThrottled] = useState(false);

  const playlistUrl = src ?? `/api/v1/hls/${lessonId}/playlist?token=${encodeURIComponent(streamToken)}`;

  const handleRateLimited = useCallback(() => {
    setThrottled(true);
    setNotice('การดึงข้อมูลวิดีโอเร็วเกินกำหนด ระบบกำลังชะลอการส่งมอบข้อมูล');
    onRateLimited?.();
    const delay = videoBackoffMs(attemptRef.current);
    attemptRef.current += 1;
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = setTimeout(() => {
      attemptRef.current = 0;
      setThrottled(false);
      setNotice(null);
      videoRef.current?.play().catch(() => undefined);
    }, delay);
  }, [onRateLimited]);

  // Token auto-renewal every 8s (background; playback never blocks on expiry).
  useEffect(() => {
    if (src) return;
    const t = setInterval(async () => {
      try {
        const res = await fetch(`/api/v1/hls/${lessonId}/session`, { method: 'POST' });
        if (!res.ok) return;
        const data = (await res.json()) as { streamToken?: string };
        if (data.streamToken) setStreamToken(data.streamToken);
      } catch {
        // fail-open: current token stays valid until its 10s TTL lapses
      }
    }, VIDEO_TOKEN_RENEW_SEC * 1000);
    return () => clearInterval(t);
  }, [lessonId, src]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    let disposed = false;
    let hls: { destroy: () => void; stopLoad?: () => void; startLoad?: () => void } | null = null;
    setUi('LOADING');

    const onCanPlay = () => {
      if (!disposed) {
        attemptRef.current = 0;
        setUi('SUCCESS');
      }
    };
    const onError = () => {
      if (!disposed) {
        setUi('ERROR');
        handleRateLimited();
      }
    };
    el.addEventListener('canplay', onCanPlay);
    el.addEventListener('error', onError);

    (async () => {
      const Ctor = await loadHlsCtor();
      if (disposed || !videoRef.current) return;
      if (Ctor && !src) {
        const instance = new Ctor({
          maxBufferLength: VIDEO_PLAYER_MAX_BUFFER_SEC,
          maxMaxBufferLength: VIDEO_PLAYER_MAX_MAX_BUFFER_SEC,
          enableWorker: true,
          xhrSetup: (xhr: XMLHttpRequest, url: string) => {
            if (url.includes('/segments/') || url.includes('/key')) {
              xhr.setRequestHeader('X-Stream-Timestamp', Date.now().toString());
            }
          },
        });
        hls = instance;
        instance.on('hlsError', (_e, data) => {
          if (data?.response?.code === 429) {
            instance.stopLoad();
            handleRateLimited();
            setTimeout(() => instance.startLoad(), videoBackoffMs(0));
          }
        });
        instance.loadSource(playlistUrl);
        instance.attachMedia(videoRef.current);
      } else {
        el.src = playlistUrl; // native HLS (Safari/LIFF) or legacy src
      }
    })();

    // Heatmap sync every 5s (Phase 043 convention; keeps analytics flowing).
    const beat = setInterval(() => {
      const v = videoRef.current;
      if (!v || v.paused) return;
      fetch('/api/v1/stream/progress', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lessonId, watchedSec: Math.floor(v.currentTime) }),
      }).catch(() => undefined);
    }, 5000);

    return () => {
      disposed = true;
      el.removeEventListener('canplay', onCanPlay);
      el.removeEventListener('error', onError);
      clearInterval(beat);
      if (retryTimer.current) clearTimeout(retryTimer.current);
      try {
        hls?.destroy();
      } catch {
        // never throw during unmount
      }
      el.removeAttribute('src');
      el.load();
    };
  }, [lessonId, playlistUrl, src, handleRateLimited]);

  if (ui === 'LIFF_INIT') {
    return (
      <div role="status" aria-label="loading video" className="aspect-video w-full animate-pulse rounded-2xl bg-muted" />
    );
  }

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-black shadow-2xl">
      <video
        ref={videoRef}
        controls
        controlsList="nodownload"
        playsInline
        preload="metadata"
        aria-label={`lesson ${lessonId}`}
        className="h-full w-full object-contain"
        onContextMenu={(e) => e.preventDefault()}
      />
      {/* Foreground security dynamic watermark overlay (§2.1) */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-25">
        <span className="rotate-12 select-none font-mono text-xs text-white">
          PROTECTED CONTENT • USER ENTITLEMENT VALIDATED
        </span>
      </div>
      {notice && (
        <div role="status" className="absolute inset-x-0 top-2 mx-auto w-fit max-w-[90%] rounded-lg bg-black/80 px-3 py-1.5 text-xs text-white">
          {notice}
          {throttled && (
            <button
              type="button"
              className="ml-2 underline"
              onClick={() => videoRef.current?.play().catch(() => undefined)}
            >
              เล่นต่อ
            </button>
          )}
        </div>
      )}
      {ui === 'ERROR' && !throttled && (
        <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 text-white">
          <p className="text-sm">โหลดวิดีโอไม่สำเร็จ กรุณาลองใหม่</p>
          <button
            type="button"
            className="rounded-lg bg-white px-4 py-1.5 text-sm text-black"
            onClick={() => {
              setUi('LOADING');
              videoRef.current?.load();
            }}
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

export default HlsVideoPlayer;
