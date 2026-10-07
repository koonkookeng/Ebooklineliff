// SSOT Phase 041 Task 5 — HighlightAnnotationOverlay (SVG vector mask, BDD)
// Canonical: apps/frontend/components/reader/HighlightAnnotationOverlay.tsx
// (legacy src/frontend/components/reader/HighlightAnnotationOverlay.tsx)
// - Renders per-page highlights as an SVG mask over the canvas layer using
//   relative 0..1 bounding boxes (viewBox 0 0 100 100, preserveAspectRatio
//   none) — resolution-independent, zero canvas reflow (Gate 5).
// - Zero new deps.
'use client';

import type { ReaderHighlight } from '../../stores/useReaderStore';

interface HighlightAnnotationOverlayProps {
  highlights: ReaderHighlight[];
  pageNumber: number;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export function HighlightAnnotationOverlay({ highlights, pageNumber }: HighlightAnnotationOverlayProps) {
  const visible = highlights.filter((h) => h.pageNumber === pageNumber);
  if (visible.length === 0) return null;
  return (
    <svg
      aria-hidden
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 h-full w-full"
    >
      {visible.map((h) => {
        let rects: Array<{ x: number; y: number; width: number; height: number }> = [];
        try {
          const parsed: unknown = JSON.parse(h.boundingRectsJson);
          if (Array.isArray(parsed)) rects = parsed as typeof rects;
        } catch {
          rects = [];
        }
        return rects.map((r, i) => (
          <rect
            key={`${h.id}-${i}`}
            x={clamp01(r.x) * 100}
            y={clamp01(r.y) * 100}
            width={Math.max(0.5, clamp01(r.width) * 100)}
            height={Math.max(0.5, clamp01(r.height) * 100)}
            fill={h.colorHex}
            fillOpacity={0.35}
          />
        ));
      })}
    </svg>
  );
}

export default HighlightAnnotationOverlay;
