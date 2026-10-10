// SSOT Phase 110 §6 — video progress list (drop-off bars, no chart lib)
// Canonical: apps/frontend/components/inspector/VideoProgressList.tsx
// - Zero new deps.
'use client';

import React from 'react';
import type { VideoAnalytics } from '@/lib/inspector';

export const VideoProgressList: React.FC<{ analytics: VideoAnalytics | null }> = ({ analytics }) => {
  if (!analytics || analytics.lessonBreakdown.length === 0) {
    return (
      <div role="status" className="rounded-xl bg-slate-900 p-4 text-center text-xs text-slate-400">
        ยังไม่มีข้อมูลการรับชมสำหรับคอร์สนี้
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-300">
        รวม {analytics.totalWatchedSeconds.toLocaleString('th-TH')} วินาที · ความคืบหน้า {analytics.overallCompletionPercentage}%
      </p>
      {analytics.lessonBreakdown.map((l) => {
        const pct = l.durationSec > 0 ? Math.min(100, Math.round((l.watchedSec / l.durationSec) * 100)) : 0;
        return (
          <div key={l.lessonId} className="rounded-lg bg-slate-900 p-3">
            <div className="flex justify-between text-sm">
              <span className="text-slate-200 truncate">{l.lessonTitle}</span>
              <span className={`text-xs ${l.isCompleted ? 'text-emerald-400' : 'text-slate-400'}`}>
                {l.isCompleted ? 'เรียนจบ' : `${pct}%`}
              </span>
            </div>
            <div className="mt-2 h-2 rounded bg-slate-700" role="img" aria-label={`${l.lessonTitle} ${pct}%`}>
              <div className={`h-2 rounded ${pct >= 90 ? 'bg-emerald-500' : pct >= 40 ? 'bg-amber-400' : 'bg-red-500'}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default VideoProgressList;
