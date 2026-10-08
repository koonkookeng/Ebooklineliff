// SSOT Phase 060 §6.2/§8.2 — ForensicWatermarkOverlay (dynamic sub-pixel)
// Canonical: apps/frontend/components/reader/ForensicWatermarkOverlay.tsx
// (legacy src/frontend/components/reader/ForensicWatermarkOverlay.tsx)
// - Canvas-tiled diagonal watermark rendered in CSS coordinate space AFTER
//   ctx.scale(dpr): crisp on Retina, opacity from --watermark-opacity.
// - pointer-events-none + aria-hidden (never traps gestures); re-renders on
//   text/size change so screen-recorded frames never go stale (Gate 4).
// - Zero new deps.
'use client';

import { useEffect, useRef } from 'react';
import { SCALER_WATERMARK_OPACITY } from '@repo/shared';

interface ForensicWatermarkOverlayProps {
  watermarkText: string;
  cssWidth: number;
  cssHeight: number;
  opacity?: number;
}

export function ForensicWatermarkOverlay({ watermarkText, cssWidth, cssHeight, opacity }: ForensicWatermarkOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !watermarkText) return;
    const w = Math.max(1, Math.round(cssWidth));
    const h = Math.max(1, Math.round(cssHeight));
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let alpha = SCALER_WATERMARK_OPACITY;
    if (typeof document !== 'undefined') {
      const raw = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--watermark-opacity'));
      if (Number.isFinite(raw) && raw > 0 && raw < 1) alpha = raw;
    }
    if (opacity !== undefined && opacity > 0 && opacity < 1) alpha = opacity;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.font = '12px Inter, sans-serif';
    ctx.fillStyle = `rgba(120, 120, 120, ${alpha})`;
    ctx.rotate((-25 * Math.PI) / 180);
    for (let x = -w; x < w * 2; x += 180) {
      for (let y = -h; y < h * 2; y += 120) {
        ctx.fillText(watermarkText, x, y);
      }
    }
    ctx.restore();
  }, [watermarkText, cssWidth, cssHeight, opacity]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
      style={{ opacity: 1 }}
    />
  );
}

export default ForensicWatermarkOverlay;
