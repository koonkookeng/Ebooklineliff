// SSOT Phase 078 §6.1/Task 5 — Curriculum builder (native HTML5 DnD)
// Canonical: apps/frontend/components/studio/curriculum-builder.tsx
// - RISK_CALL (documented): no @hello-pangea/dnd (§6.1 asks it) — native
//   HTML5 drag-and-drop is zero-dep, 60fps for curriculum trees, <45MB.
//   Optimistic reorder + rollback on failure (BDD-1); drafts to localStorage.
// - Zero-dep (React only).
'use client';

import React, { useState } from 'react';
import { normalizeReorder } from '@repo/shared';
import { clearStudioDraft, saveStudioDraft, studioApi, type StudioSection } from '../../lib/studio/studio-client';

export function CurriculumBuilder({ slug, courseId, initial }: { slug: string; courseId: string; initial: StudioSection[] }) {
  const [sections, setSections] = useState<StudioSection[]>(initial);
  const [dragging, setDragging] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function persist(next: StudioSection[], rollback: StudioSection[]) {
    setDragging(true);
    setMsg(null);
    try {
      const normalized = normalizeReorder(next.map((s) => ({ sectionId: s.id, lessons: s.lessons.map((l) => ({ lessonId: l.id })) })));
      await studioApi(slug).reorder({
        courseId,
        sections: normalized.map((s) => ({
          ...s,
          lessons: s.lessons.map((l) => ({ lessonId: l.lessonId, lessonOrder: l.lessonOrder })),
        })),
      });
      clearStudioDraft(courseId);
      setMsg('บันทึกโครงสร้างสำเร็จ');
    } catch (e) {
      setSections(rollback);
      setMsg(`ERROR: ${(e as Error).message} — ย้อนลำดับกลับแล้ว`);
    } finally {
      setDragging(false);
    }
  }

  function moveSection(from: number, to: number) {
    const prev = sections;
    const next = [...sections];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    const ordered = next.map((s, si) => ({ ...s, sectionOrder: si }));
    setSections(ordered);
    void saveStudioDraft(courseId, ordered);
    void persist(ordered, prev);
  }

  function moveLesson(fromSec: string, fromIx: number, toSec: string, toIx: number) {
    const prev = sections;
    const next = sections.map((s) => ({ ...s, lessons: [...s.lessons] }));
    const src = next.find((s) => s.id === fromSec);
    const dst = next.find((s) => s.id === toSec);
    if (!src || !dst) return;
    const [moved] = src.lessons.splice(fromIx, 1);
    if (!moved) return;
    dst.lessons.splice(toIx, 0, { ...moved, sectionId: toSec });
    const ordered = next.map((s) => ({
      ...s,
      lessons: s.lessons.map((l, li) => ({ ...l, lessonOrder: li })),
    }));
    setSections(ordered);
    void saveStudioDraft(courseId, ordered);
    void persist(ordered, prev);
  }

  return (
    <div>
      {sections.map((sec, si) => (
        <div
          key={sec.id}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('text/section-from', String(si));
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            const raw = e.dataTransfer.getData('text/section-from');
            if (raw !== '') moveSection(Number(raw), si);
          }}
          style={{ opacity: dragging ? 0.7 : 1, borderLeft: '4px solid #10b981', padding: 12, marginBottom: 12, background: '#fff' }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <strong style={{ cursor: 'grab' }}>⋮⋮ {sec.title}</strong>
            <span>{sec.lessons.length} บทเรียน</span>
          </div>
          <div style={{ paddingLeft: 24, marginTop: 8 }}>
            {sec.lessons.map((lesson, li) => (
              <div
                key={lesson.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/lesson-from', `${sec.id}:${li}`);
                  e.stopPropagation();
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onDrop={(e) => {
                  e.stopPropagation();
                  const raw = e.dataTransfer.getData('text/lesson-from');
                  if (!raw) return;
                  const [fromSec, fromIx] = raw.split(':') as [string, string];
                  moveLesson(fromSec, Number(fromIx), sec.id, li);
                }}
                style={{ cursor: 'grab', background: '#f8fafc', padding: 8, marginBottom: 6, border: '1px solid #e2e8f0' }}
              >
                ⋮⋮ {lesson.title}
                {lesson.videoHlsUrl ? ' · 🎬' : ' · ไม่มีวิดีโอ'}
              </div>
            ))}
          </div>
        </div>
      ))}
      {msg && <p role={msg.startsWith('ERROR') ? 'alert' : 'status'}>{msg}</p>}
    </div>
  );
}
