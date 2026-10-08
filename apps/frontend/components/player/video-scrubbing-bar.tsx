// SSOT Phase 058 §6.1 — VideoScrubbingBar (high-perf thumbnail scrubbing engine)
// Canonical: apps/frontend/components/player/video-scrubbing-bar.tsx
// (legacy src/frontend/components/player/video-scrubbing-bar.tsx)
// - 5 states: LIFF_INIT (skeleton) → IDLE → LOADING (blur/timestamp) →
//   SUCCESS (160x90 canvas tile + watermark) / ERROR (timestamp-only).
// - Perf: cue binary-scan per pointermove (<50ms), ≤2 sprites in RAM,
//   LRU eviction + unmount revoke discipline (LIFF <30MB strict).
// - Multi-tenant: --scrub-indicator-color / --thumbnail-border-radius.
// - Touch-first: pointer events + click-to-seek + keyboard arrows.
// - Zero new deps.
'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SCRUB_SPRITE_CACHE_LIMIT, cueForTime, type ThumbnailCue, type VideoSpriteManifest } from '@repo/shared';
import { ThumbnailPreviewTooltip } from './thumbnail-preview-tooltip';
import { reportScrubSeek } from '../../lib/stream/scrubbing-client';

export type ScrubBarStatus = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

interface VideoScrubbingBarProps {
  durationSec: number;
  currentTimeSec: number;
  manifest: VideoSpriteManifest | null;
  watermarkText: string;
  lessonId?: string;
  onSeek: (targetTimeSec: number) => void;
}

export const VideoScrubbingBar: React.FC<VideoScrubbingBarProps> = ({
  durationSec,
  currentTimeSec,
  manifest,
  watermarkText,
  lessonId,
  onSeek,
}) => {
  const [isHovering, setIsHovering] = useState(false);
  const [hoverTime, setHoverTime] = useState(0);
  const [hoverPosPercent, setHoverPosPercent] = useState(0);
  const [activeCue, setActiveCue] = useState<ThumbnailCue | null>(null);
  const [status, setStatus] = useState<ScrubBarStatus>(manifest ? 'IDLE' : 'LIFF_INIT');

  const progressBarRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const lruRef = useRef<string[]>([]);

  useEffect(() => {
    setStatus(!manifest ? 'ERROR' : manifest.cues.length > 0 ? 'IDLE' : 'ERROR');
  }, [manifest]);

  // Memory safety: LRU ≤2 sprites + unmount GC (<30MB RAM, BDD contract).
  useEffect(() => {
    const cache = imageCacheRef.current;
    return () => {
      cache.forEach((img) => {
        img.src = '';
      });
      cache.clear();
      lruRef.current = [];
    };
  }, []);

  const touchImage = useCallback((url: string) => {
    const lru = lruRef.current.filter((u) => u !== url);
    lru.push(url);
    while (lru.length > SCRUB_SPRITE_CACHE_LIMIT) {
      const evict = lru.shift();
      if (evict) {
        const img = imageCacheRef.current.get(evict);
        if (img) img.src = '';
        imageCacheRef.current.delete(evict);
      }
    }
    lruRef.current = lru;
  }, []);

  const renderThumbnailTile = useCallback(
    (cue: ThumbnailCue) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const drawFrame = (image: HTMLImageElement) => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, cue.x, cue.y, cue.width, cue.height, 0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.font = '10px sans-serif';
        ctx.fillText(watermarkText, 8, canvas.height - 8);
      };
      const cached = imageCacheRef.current.get(cue.spriteUrl);
      if (cached && cached.complete && cached.naturalWidth > 0) {
        touchImage(cue.spriteUrl);
        drawFrame(cached);
        setStatus('SUCCESS');
        return;
      }
      setStatus('LOADING');
      const fresh = new Image();
      fresh.crossOrigin = 'anonymous';
      fresh.decoding = 'async';
      fresh.onload = () => {
        imageCacheRef.current.set(cue.spriteUrl, fresh);
        touchImage(cue.spriteUrl);
        drawFrame(fresh);
        setStatus('SUCCESS');
      };
      fresh.onerror = () => setStatus('ERROR');
      fresh.src = cue.spriteUrl;
    },
    [touchImage, watermarkText],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!progressBarRef.current || durationSec <= 0) return;
      const rect = progressBarRef.current.getBoundingClientRect();
      const offsetX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      const percent = rect.width > 0 ? offsetX / rect.width : 0;
      const targetTime = percent * durationSec;
      setHoverPosPercent(percent * 100);
      setHoverTime(targetTime);
      if (manifest && manifest.cues.length > 0) {
        const cue = cueForTime(manifest.cues, targetTime);
        setActiveCue(cue);
        if (cue) renderThumbnailTile(cue);
      } else {
        setActiveCue(null);
        setStatus('ERROR');
      }
    },
    [durationSec, manifest, renderThumbnailTile],
  );

  const commitSeek = useCallback(() => {
    onSeek(hoverTime);
    if (lessonId) reportScrubSeek(lessonId, hoverTime);
  }, [hoverTime, lessonId, onSeek]);

  const progressPct = durationSec > 0 ? (currentTimeSec / durationSec) * 100 : 0;

  if (status === 'LIFF_INIT') {
    return <div className="h-2 w-full animate-pulse rounded-full bg-slate-700/60" aria-busy />;
  }

  return (
    <div className="relative w-full py-3 touch-none select-none">
      {isHovering && (
        <ThumbnailPreviewTooltip
          leftPercent={hoverPosPercent}
          hoverTimeSec={hoverTime}
          canvasRef={canvasRef}
          hasTile={status !== 'ERROR' && activeCue !== null}
        />
      )}
      <div
        ref={progressBarRef}
        role="slider"
        tabIndex={0}
        aria-label="Video seek bar with thumbnail preview"
        aria-valuemin={0}
        aria-valuemax={Math.round(durationSec)}
        aria-valuenow={Math.round(hoverTime)}
        onPointerEnter={() => setIsHovering(true)}
        onPointerLeave={() => setIsHovering(false)}
        onPointerMove={handlePointerMove}
        onClick={commitSeek}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            const step = durationSec * 0.02;
            const next = e.key === 'ArrowRight' ? currentTimeSec + step : currentTimeSec - step;
            onSeek(Math.max(0, Math.min(durationSec, next)));
          }
        }}
        className="relative h-2 w-full cursor-pointer overflow-hidden rounded-full bg-slate-700/60 transition-all hover:h-3"
        style={{ borderRadius: 'var(--thumbnail-border-radius, 9999px)' }}
      >
        <div
          className="h-full rounded-full bg-emerald-500 transition-all"
          style={{ width: `${Math.max(0, Math.min(100, progressPct))}%`, background: 'var(--scrub-indicator-color, var(--brand-primary, #10b981))' }}
        />
      </div>
    </div>
  );
};

export default VideoScrubbingBar;
