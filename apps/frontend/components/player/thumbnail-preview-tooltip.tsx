// SSOT Phase 058 §6.1 — ThumbnailPreviewTooltip (160x90 Canvas + watermark)
// Canonical: apps/frontend/components/player/thumbnail-preview-tooltip.tsx
// (legacy src/frontend/components/player/thumbnail-preview-tooltip.tsx)
// - Renders the active sprite tile cropped into a 160x90 canvas with the
//   dynamic forensic watermark overlay (§8.2) + clock label (e.g. 08:42).
// - ERROR fallback: timestamp-only box (no canvas) so video never janks.
// - Positioning is parent-driven via leftPercent; pointer-events-none.
// - Zero new deps.
'use client';

import { formatScrubTime } from '@repo/shared';

interface ThumbnailPreviewTooltipProps {
  leftPercent: number;
  hoverTimeSec: number;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  hasTile: boolean;
  tenantVars?: React.CSSProperties;
}

export function ThumbnailPreviewTooltip({ leftPercent, hoverTimeSec, canvasRef, hasTile, tenantVars }: ThumbnailPreviewTooltipProps) {
  const clamped = Math.max(0, Math.min(100, leftPercent));
  return (
    <div
      className="absolute bottom-10 z-50 flex -translate-x-1/2 flex-col items-center pointer-events-none transition-opacity duration-150"
      style={{ left: `${clamped}%` }}
    >
      <div className="overflow-hidden rounded-lg border border-white/20 bg-black/90 p-1 shadow-2xl" style={tenantVars}>
        {hasTile ? (
          <canvas ref={canvasRef} width={160} height={90} className="rounded bg-slate-900" aria-hidden />
        ) : (
          <div className="flex h-[90px] w-[160px] items-center justify-center rounded bg-slate-900" aria-hidden>
            <span className="font-mono text-lg font-bold text-white">{formatScrubTime(hoverTimeSec)}</span>
          </div>
        )}
        <div className="mt-1 text-center font-mono text-xs font-bold text-white">{formatScrubTime(hoverTimeSec)}</div>
      </div>
    </div>
  );
}

export default ThumbnailPreviewTooltip;
