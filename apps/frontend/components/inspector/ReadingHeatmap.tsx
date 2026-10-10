// SSOT Phase 110 §6 — CSS-bar reading heatmap (no chart lib)
// Canonical: apps/frontend/components/inspector/ReadingHeatmap.tsx
// - Per-page dwell bars (Phase 052 HeatmapViewer precedent). Zero new deps.
'use client';

import React, { useState } from 'react';
import { heatIntensity, heatColor, type HeatCell } from '@/lib/inspector';

interface ReadingHeatmapProps {
  cells: HeatCell[];
  bookTitle: string;
}

export const ReadingHeatmap: React.FC<ReadingHeatmapProps> = ({ cells, bookTitle }) => {
  const [selected, setSelected] = useState<HeatCell | null>(null);
  if (cells.length === 0) {
    return (
      <div role="status" className="rounded-xl bg-slate-900 p-4 text-center text-xs text-slate-400">
        ยังไม่มีข้อมูลการอ่านสำหรับหนังสือเล่มนี้
      </div>
    );
  }
  const peak = Math.max(...cells.map((c) => c.totalDwellTimeSec), 1);
  return (
    <div className="rounded-xl bg-slate-900 p-4">
      <p className="text-sm text-slate-300 mb-3">{bookTitle} · {cells.length} หน้า</p>
      <div className="flex h-24 items-end gap-[2px]" role="img" aria-label="reading dwell heatmap">
        {cells.map((c) => {
          const t = heatIntensity(c.totalDwellTimeSec, peak);
          return (
            <button
              key={c.pageNumber}
              type="button"
              title={`หน้า ${c.pageNumber}: ${c.totalDwellTimeSec}s · อ่าน ${c.readCount} ครั้ง`}
              onClick={() => setSelected(c)}
              className={`min-w-[3px] flex-1 rounded-sm ${heatColor(t)}`}
              style={{ height: `${Math.max(6, t * 100)}%` }}
            />
          );
        })}
      </div>
      {selected && (
        <p className="mt-2 text-xs text-slate-400">
          หน้า {selected.pageNumber} · dwell {selected.totalDwellTimeSec}s · อ่าน {selected.readCount} ครั้ง · ล่าสุด {new Date(selected.lastReadAt).toLocaleString('th-TH')}
        </p>
      )}
    </div>
  );
};

export default ReadingHeatmap;
