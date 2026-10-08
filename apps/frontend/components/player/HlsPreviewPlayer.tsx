'use client';
// SSOT Phase 051 §6.2 — HLS preview player (120s cutoff + buffer destroy + paywall)
// Canonical: apps/frontend/components/player/HlsPreviewPlayer.tsx
// (legacy src/frontend/components/player/HlsPreviewPlayer.tsx)
// - Fetches the trimmed preview playlist (server-fenced 120s window, §8.1);
//   the CLIENT cutoff is the second layer: at maxPreviewSec ⇒ pause +
//   destroy buffer + revoke src + paywall overlay (BDD Scenario 4).
// - Zero new deps: optional hls.js via non-literal dynamic import, native
//   HLS fallback (LIFF RAM < 25MB). Countdown badge + 5s analytics ticks.
// - 6 states: LIFF_INIT → IDLE → PREVIEW_ACTIVE → PREVIEW_LIMIT_REACHED /
//   CHECKOUT_PAYWALL / ERROR.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PREVIEW_ANALYTICS_TICK_SEC, PREVIEW_VIDEO_DEFAULT_SEC, remainingQuotaLabel } from '@repo/shared';
import { PaywallModal } from '../checkout/PaywallModal';

export type PreviewPlayerUiState =
  | 'LIFF_INIT'
  | 'IDLE'
  | 'PREVIEW_ACTIVE'
  | 'PREVIEW_LIMIT_REACHED'
  | 'CHECKOUT_PAYWALL'
  | 'ERROR';

interface HlsPreviewPlayerProps {
  lessonId: string;
  productId: string;
  productTitle: string;
  price: number;
  discountPrice?: number;
  coverImageUrl: string;
  maxPreviewSec?: number;
}

type PreviewHlsCtor = new (config: Record<string, unknown>) => {
  loadSource: (url: string) => void;
  attachMedia: (el: HTMLVideoElement) => void;
  destroy: () => void;
};

async function loadPreviewHls(): Promise<PreviewHlsCtor | null> {
  try {
    const moduleName = 'hls.js';
    const mod = (await import(moduleName)) as unknown as {
      default: PreviewHlsCtor & { isSupported: () => boolean };
    };
    return mod.default?.isSupported() ? mod.default : null;
  } catch {
    return null;
  }
}

export function HlsPreviewPlayer({
  lessonId,
  productId,
  productTitle,
  price,
  discountPrice,
  coverImageUrl,
  maxPreviewSec = PREVIEW_VIDEO_DEFAULT_SEC,
}: HlsPreviewPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ui, setUi] = useState<PreviewPlayerUiState>('LIFF_INIT');
  const [watchedSec, setWatchedSec] = useState(0);
  const [isPaywallOpen, setIsPaywallOpen] = useState(false);
  const limitHitRef = useRef(false);

  const destroyStream = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    try {
      v.pause();
      v.removeAttribute('src');
      v.load(); // releases MSE/native buffer immediately
    } catch {
      // never throw during teardown
    }
  }, []);

  const openPaywall = useCallback(() => {
    if (limitHitRef.current) return;
    limitHitRef.current = true;
    destroyStream();
    setUi('PREVIEW_LIMIT_REACHED');
    setIsPaywallOpen(true);
  }, [destroyStream]);

  useEffect(() => {
    let disposed = false;
    let hls: { destroy: () => void } | null = null;
    setUi('IDLE');
    (async () => {
      try {
        const res = await fetch(`/api/v1/preview/video/stream?lessonId=${encodeURIComponent(lessonId)}`);
        if (disposed) return;
        if (!res.ok) {
          setUi('ERROR');
          return;
        }
        const data = (await res.json()) as { hlsPreviewPlaylistUrl?: string; previewToken?: string };
        if (!data.hlsPreviewPlaylistUrl || !videoRef.current) {
          setUi('ERROR');
          return;
        }
        const url = `${data.hlsPreviewPlaylistUrl}&token=${encodeURIComponent(data.previewToken ?? '')}`;
        const Ctor = await loadPreviewHls();
        if (disposed || !videoRef.current) return;
        if (Ctor) {
          const instance = new Ctor({ maxBufferLength: 10 });
          hls = instance;
          instance.loadSource(url);
          instance.attachMedia(videoRef.current);
        } else {
          videoRef.current.src = url;
        }
        setUi('PREVIEW_ACTIVE');
      } catch {
        if (!disposed) setUi('ERROR');
      }
    })();
    return () => {
      disposed = true;
      try {
        hls?.destroy();
      } catch {
        // never throw during unmount
      }
      destroyStream();
    };
  }, [lessonId, destroyStream]);

  // 5s analytics ticks (VIDEO_TICK / PAYWALL_TRIGGER funnel events, fail-open).
  useEffect(() => {
    if (ui !== 'PREVIEW_ACTIVE') return;
    const t = setInterval(() => {
      const v = videoRef.current;
      if (!v || v.paused) return;
      fetch('/api/v1/preview/ebook/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          productId,
          contentType: 'ELEARNING_LESSON',
          reachedValue: Math.floor(v.currentTime),
          action: 'VIDEO_TICK',
        }),
      }).catch(() => undefined);
    }, PREVIEW_ANALYTICS_TICK_SEC * 1000);
    return () => clearInterval(t);
  }, [ui, productId]);

  const handleTimeUpdate = () => {
    if (!videoRef.current || limitHitRef.current) return;
    const currentSec = Math.floor(videoRef.current.currentTime);
    setWatchedSec(currentSec);
    if (currentSec >= maxPreviewSec) {
      videoRef.current.currentTime = maxPreviewSec; // freeze frame at boundary
      fetch('/api/v1/preview/ebook/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          productId,
          contentType: 'ELEARNING_LESSON',
          reachedValue: maxPreviewSec,
          action: 'PAYWALL_TRIGGER',
        }),
      }).catch(() => undefined);
      openPaywall();
    }
  };

  if (ui === 'LIFF_INIT' || ui === 'IDLE') {
    return <div role="status" aria-label="loading preview video" className="aspect-video w-full animate-pulse rounded-2xl bg-black" />;
  }

  return (
    <div className="relative aspect-video w-full max-w-2xl overflow-hidden rounded-2xl bg-black shadow-2xl">
      <video
        ref={videoRef}
        onTimeUpdate={handleTimeUpdate}
        onCanPlay={() => setUi((s) => (s === 'PREVIEW_LIMIT_REACHED' ? s : 'PREVIEW_ACTIVE'))}
        onError={() => {
          if (!limitHitRef.current) setUi('ERROR');
        }}
        controls
        controlsList="nodownload"
        playsInline
        preload="metadata"
        aria-label={`preview lesson ${lessonId}`}
        className="h-full w-full object-cover"
        onContextMenu={(e) => e.preventDefault()}
      />
      <div className="absolute left-3 top-3 z-10 rounded-full bg-black/70 px-3 py-1.5 font-mono text-xs text-amber-300 backdrop-blur-md">
        {remainingQuotaLabel('ELEARNING_LESSON', watchedSec, maxPreviewSec)}
      </div>
      {ui === 'ERROR' && (
        <div role="alert" className="absolute inset-0 flex items-center justify-center bg-black/70 text-sm text-white">
          โหลดวิดีโอตัวอย่างไม่สำเร็จ
        </div>
      )}
      <PaywallModal
        isOpen={isPaywallOpen}
        onClose={() => {
          setIsPaywallOpen(false);
          setUi('CHECKOUT_PAYWALL');
        }}
        productTitle={productTitle}
        price={price}
        discountPrice={discountPrice}
        coverImageUrl={coverImageUrl}
        productId={productId}
        reachedMessage="คุณชมวิดีโอตัวอย่างฟรีครบ 2 นาทีแล้ว"
        shareContentType="COURSE_LESSON"
      />
    </div>
  );
}

export default HlsPreviewPlayer;
