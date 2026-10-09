// SSOT Phase 094 Task 5 — Co-pilot outline studio (dep-free tree editor)
// Canonical: apps/frontend/components/co-pilot/OutlineStudio.tsx
// - RISK_CALL: no shadcn DnD (spec asks it) — native list with up/down
//   reorder keeps dashboard light. SSE streams sections live.
// - Zero-dep (React only).
'use client';

import React, { useEffect, useState } from 'react';
import { useCoPilot } from '../../hooks/useCoPilot';

export function OutlineStudio() {
  const { status, error, sections, progress, warmed, generateOutline, retry } = useCoPilot();
  const [topic, setTopic] = useState('');
  const [audience, setAudience] = useState('นักเรียนมัธยม');
  const [level, setLevel] = useState('BEGINNER');
  const [items, setItems] = useState<typeof sections>([]);

  useEffect(() => {
    warmed();
  }, [warmed]);

  useEffect(() => {
    setItems(sections);
  }, [sections]);

  function move(sectionIdx: number, lessonIdx: number, dir: -1 | 1): void {
    setItems((prev) => {
      const next = prev.map((s) => ({ ...s, lessons: [...s.lessons] }));
      const sec = next[sectionIdx];
      if (!sec) return prev;
      const j = lessonIdx + dir;
      if (j < 0 || j >= sec.lessons.length) return prev;
      const tmp = sec.lessons[lessonIdx];
      const other = sec.lessons[j];
      if (tmp === undefined || other === undefined) return prev;
      sec.lessons[lessonIdx] = other;
      sec.lessons[j] = tmp;
      return next;
    });
  }

  return (
    <div>
      <h2>Co-Pilot Studio: ร่างโครงสร้างคอร์สใน 30 วินาที</h2>
      {status === 'INIT' && <p>กำลังโหลด Studio…</p>}
      <div>
        <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="หัวข้อคอร์ส เช่น การเงินส่วนบุคคล" maxLength={200} aria-label="หัวข้อคอร์ส" />
        <input value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="กลุ่มเป้าหมาย" maxLength={200} aria-label="กลุ่มเป้าหมาย" />
        <select value={level} onChange={(e) => setLevel(e.target.value)} aria-label="ระดับความยาก">
          <option value="BEGINNER">BEGINNER</option>
          <option value="INTERMEDIATE">INTERMEDIATE</option>
          <option value="ADVANCED">ADVANCED</option>
        </select>
        <button
          type="button"
          onClick={() => void generateOutline(topic, audience, level)}
          disabled={status === 'LOADING' || !topic.trim()}
        >
          {status === 'LOADING' ? `กำลังเจน… ${progress}%` : '✦ Generate Course Outline'}
        </button>
      </div>
      {status === 'ERROR' && (
        <div>
          <p role="alert">{error ?? 'AI ประมวลผลไม่สำเร็จ'}</p>
          <button type="button" onClick={retry}>
            ลองใหม่
          </button>
        </div>
      )}
      {(status === 'SUCCESS' || items.length > 0) && (
        <div>
          <p role="status">ได้โครงสร้าง {items.length} ส่วน — จัดลำดับได้เลย</p>
          {items.map((s, si) => (
            <div key={si}>
              <h3>{s.sectionTitle}</h3>
              <ul>
                {s.lessons.map((l, li) => (
                  <li key={li}>
                    <span>{l.lessonTitle}</span>
                    <button type="button" onClick={() => move(si, li, -1)} aria-label="ขึ้น">
                      ↑
                    </button>
                    <button type="button" onClick={() => move(si, li, 1)} aria-label="ลง">
                      ↓
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default OutlineStudio;
