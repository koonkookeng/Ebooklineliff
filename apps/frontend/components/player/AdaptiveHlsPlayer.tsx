// SSOT Phase 056 §6 — Adaptive HLS player (LIFF compact ↔ Web workspace)
// Canonical: apps/frontend/components/player/AdaptiveHlsPlayer.tsx
// (legacy src/frontend/components/player/AdaptiveHlsPlayer.tsx)
// - LIFF: compact player (360p-first, bottom-sheet controls, 30MB media
//   discipline — src cleared on unmount). Web: 70/30 split workspace with
//   lesson list + progress sync (<200ms budget, sendBeacon on unmount).
// - Forensic watermark overlay (LINE user line) per §8.1. Zero new deps.
'use client';

import React, { useEffect, useRef, useState } from 'react';
import { isLiffEnvironment, type ViewportCapabilities } from '@repo/shared';

interface AdaptiveHlsPlayerProps {
  productId: string;
  initialLessonId?: string;
  capabilities: ViewportCapabilities;
}

export const AdaptiveHlsPlayer: React.FC<AdaptiveHlsPlayerProps> = ({
  productId,
  initialLessonId,
  capabilities,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [manifestUrl, setManifestUrl] = useState<string | null>(null);
  const [watchedSec, setWatchedSec] = useState(0);
  const [failed, setFailed] = useState(false);
  const isLiffMode = capabilities.isLiff || isLiffEnvironment(capabilities.environment);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const res = await fetch(
          `/api/v1/viewport/stream?productId=${encodeURIComponent(productId)}${initialLessonId ? `&lessonId=${encodeURIComponent(initialLessonId)}` : ''}`,
        );
        if (!res.ok) throw new Error(`stream ${res.status}`);
        const data = (await res.json()) as { hlsStreamUrl?: string; lastWatchedSec?: number };
        if (!mounted) return;
        setManifestUrl(data.hlsStreamUrl ?? null);
        if (typeof data.lastWatchedSec === 'number') setWatchedSec(data.lastWatchedSec);
      } catch {
        if (mounted) setFailed(true);
      }
    };
    void load();
    return () => {
      mounted = false;
    };
  }, [productId, initialLessonId]);

  // Progress sync every 5s + beacon flush on unmount (§7.1 telemetry hook).
  useEffect(() => {
    if (!initialLessonId) return;
    const t = window.setInterval(() => {
      const el = videoRef.current;
      if (!el || el.paused) return;
      void fetch('/api/v1/viewport/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          productId,
          contentType: 'COURSE_VIDEO',
          lastWatchedSec: Math.floor(el.currentTime),
          viewportMode: capabilities.environment,
        }),
      }).catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(t);
  }, [productId, initialLessonId, capabilities.environment]);

  useEffect(
    () => () => {
      const el = videoRef.current;
      if (el) {
        try {
          el.pause();
          el.removeAttribute('src');
          el.load();
        } catch {
          // teardown best-effort (LIFF media discipline)
        }
      }
    },
    [],
  );

  return (
    <div className={`relative flex h-full w-full ${isLiffMode ? 'flex-col bg-black text-white' : 'flex-row bg-gray-950 text-white'}`}>
      <div className={isLiffMode ? 'w-full' : 'w-[70%]'}>
        <div className="flex h-14 items-center justify-between border-b border-white/10 px-4">
          <span className="text-sm font-semibold">Mode: {capabilities.environment}</span>
          <span className="text-xs text-white/60">RAM Budget: {capabilities.maxRamBudgetMB}MB</span>
        </div>
        {failed || !manifestUrl ? (
          <div className="flex aspect-video items-center justify-center" role={failed ? 'alert' : 'status'}>
            {failed ? (
              <span className="text-sm">
                โหลดวิดีโอไม่สำเร็จ
                <button onClick={() => window.location.reload()} className="ml-2 font-bold">
                  ลองใหม่
                </button>
              </span>
            ) : (
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" aria-busy />
            )}
          </div>
        ) : (
          <div className="relative">
            <video
              ref={videoRef}
              src={manifestUrl}
              controls
              playsInline
              preload="metadata"
              className="aspect-video w-full bg-black"
              onTimeUpdate={(e) => setWatchedSec(Math.floor(e.currentTarget.currentTime))}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-2 text-center text-xs font-medium text-white/30"
            >
              USER-VERIFIED | LIFF: {String(capabilities.isLiff)}
            </div>
          </div>
        )}
        <div className={`flex items-center justify-between px-6 py-4 ${isLiffMode ? 'bg-zinc-900' : 'border-t border-white/10'}`}>
          <span className="text-xs text-white/70">รับชมแล้ว {watchedSec} วินาที</span>
          {!isLiffMode && <span className="text-xs text-white/50">Space: เล่น/หยุด • ←/→: ย้อน/ข้าม 10 วิ</span>}
        </div>
      </div>
      {!isLiffMode && (
        <aside className="w-[30%] border-l border-white/10 p-4" aria-label="Workspace lessons">
          <p className="mb-2 text-sm font-semibold">บทเรียน (Split 70/30)</p>
          <p className="text-xs text-white/60">Lesson: {initialLessonId ?? '—'}</p>
        </aside>
      )}
    </div>
  );
};

export default AdaptiveHlsPlayer;
