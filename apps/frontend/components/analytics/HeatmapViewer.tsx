'use client';
// SSOT Phase 052 §7.2 — instructor heatmap viewer (drop-off bars, silent overlay)
// Canonical: apps/frontend/components/analytics/HeatmapViewer.tsx
// (legacy src/frontend/components/analytics/HeatmapViewer.tsx)
// - Renders per-segment viewer bars with drop-off intensity (no chart lib:
//   zero new deps, LIFF-safe). States: LIFF_INIT → IDLE → LOADING → SUCCESS / ERROR.
// - Pure presentational: data arrives via props from the dashboard query.
import React, { useState } from 'react';

export type HeatmapViewerState = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

export interface HeatmapBar {
  secondOffset: number;
  viewerCount: number;
  dropoffRate: number;
}

interface HeatmapViewerProps {
  lessonId: string;
  segments: HeatmapBar[];
  state?: HeatmapViewerState;
}

function barColor(dropoff: number): string {
  if (dropoff >= 0.5) return 'bg-red-500';
  if (dropoff >= 0.25) return 'bg-amber-400';
  return 'bg-emerald-500';
}

export function HeatmapViewer({ lessonId, segments, state = 'SUCCESS' }: HeatmapViewerProps) {
  const [selected, setSelected] = useState<HeatmapBar | null>(null);
  if (state === 'LIFF_INIT' || state === 'IDLE' || state === 'LOADING') {
    return <div role="status" aria-label="loading heatmap" className="h-24 w-full animate-pulse rounded-xl bg-slate-800" />;
  }
  if (state === 'ERROR' || segments.length === 0) {
    return (
      <div role="status" className="rounded-xl bg-slate-800 p-4 text-center text-xs text-slate-400">
        ยังไม่มีข้อมูลการรับชมสำหรับบทเรียนนี้
      </div>
    );
  }
  const peak = Math.max(...segments.map((s) => s.viewerCount), 1);
  return (
    <div aria-label={`heatmap lesson ${lessonId}`} className="rounded-xl bg-slate-900 p-4">
      <div className="flex h-24 items-end gap-[2px]" role="img" aria-label="drop-off heatmap">
        {segments.map((s) => (
          <button
            key={s.secondOffset}
            type="button"
            title={`วินาทีที่ ${s.secondOffset}: ${s.viewerCount} คน (ออก ${(s.dropoffRate * 100).toFixed(0)}%)`}
            onClick={() => setSelected(s)}
            className={`min-w-[3px] flex-1 rounded-sm ${barColor(s.dropoffRate)} opacity-90 hover:opacity-100`}
            style={{ height: `${Math.max(6, (s.viewerCount / peak) * 100)}%` }}
          />
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-slate-400">
        <span>0s</span>
        <span>{selected ? `วินาทีที่ ${selected.secondOffset} • ${selected.viewerCount} คน • ออก ${(selected.dropoffRate * 100).toFixed(1)}%` : 'แตะแท่งกราฟเพื่อดูจุด drop-off'}</span>
        <span>{segments[segments.length - 1]?.secondOffset}s</span>
      </div>
    </div>
  );
}

export default HeatmapViewer;
