// SSOT Phase 094 Task 6 — Subtitle timeline editor (dep-free cue list)
// Canonical: apps/frontend/components/co-pilot/SubtitleTimelineEditor.tsx
// - Editable cue rows (text + times) with overlap warning (§10 checker
//   client-side). Zero-dep (React only).
'use client';

import React, { useState } from 'react';
import type { SubtitleCue } from '../../lib/co-pilot/co-pilot-client';

function overlaps(cues: SubtitleCue[]): boolean {
  const sorted = [...cues].sort((a, b) => a.startTimeSec - b.startTimeSec);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (prev && cur && cur.startTimeSec < prev.endTimeSec) return true;
  }
  return false;
}

export function SubtitleTimelineEditor(props: { initial: SubtitleCue[]; onSave: (cues: SubtitleCue[]) => void }) {
  const [cues, setCues] = useState<SubtitleCue[]>(props.initial);
  const bad = overlaps(cues);

  function patch(i: number, field: keyof SubtitleCue, value: string): void {
    setCues((prev) =>
      prev.map((c, j) =>
        j === i
          ? { ...c, [field]: field === 'text' ? value : Number(value) || 0 }
          : c,
      ),
    );
  }

  return (
    <div>
      <h3>Subtitle Timeline Editor ({cues.length} cues)</h3>
      {bad && <p role="alert">ช่วงเวลาซ้อนทับกัน — โปรดแก้ไขก่อนบันทึก</p>}
      <ul>
        {cues.map((c, i) => (
          <li key={i}>
            <input type="number" step="0.1" min={0} value={c.startTimeSec} onChange={(e) => patch(i, 'startTimeSec', e.target.value)} aria-label={`เริ่ม cue ${i + 1}`} />
            <input type="number" step="0.1" min={0} value={c.endTimeSec} onChange={(e) => patch(i, 'endTimeSec', e.target.value)} aria-label={`จบ cue ${i + 1}`} />
            <input value={c.text} onChange={(e) => patch(i, 'text', e.target.value)} aria-label={`ข้อความ cue ${i + 1}`} />
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => props.onSave(cues)} disabled={bad}>
        บันทึกซับไตเติล
      </button>
    </div>
  );
}

export default SubtitleTimelineEditor;
