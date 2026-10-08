// SSOT Phase 065 Task 4 — NoteListDrawer (seek + search + delete)
// Canonical: apps/frontend/components/video/NoteListDrawer.tsx
// (legacy src/frontend/components/video/NoteListDrawer.tsx)
// - translate3d drawer; click note → seek; delete with ownership (server
//   403 otherwise); AI summary + PDF export actions.
// - Zero new deps.
'use client';

import { useState } from 'react';
import type { LessonNote } from '@repo/shared';
import { formatNoteTimestamp } from '@repo/shared';
import { deleteLessonNote, exportNotesPdf, fetchAiSummary } from '../../lib/video/note-client';

interface NoteListDrawerProps {
  lessonId: string;
  notes: LessonNote[];
  onSeek: (seconds: number) => void;
  onChanged: () => void;
}

export function NoteListDrawer({ lessonId, notes, onSeek, onChanged }: NoteListDrawerProps) {
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  const remove = async (noteId: string) => {
    setBusy(true);
    try {
      await deleteLessonNote(noteId);
      onChanged();
    } catch {
      // delete best-effort; server guards ownership
    } finally {
      setBusy(false);
    }
  };

  const summarize = async () => {
    setBusy(true);
    try {
      const res = await fetchAiSummary(lessonId);
      setSummary(`${res.summaryText}\n• ${res.keyTakeaways.join('\n• ')}`);
    } catch {
      setSummary(null);
    } finally {
      setBusy(false);
    }
  };

  const exportPdf = async () => {
    setBusy(true);
    try {
      const res = await exportNotesPdf(lessonId);
      window.open(res.url, '_blank', 'noopener');
    } catch {
      // export best-effort
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto space-y-2" style={{ transform: 'translate3d(0,0,0)' }}>
      <div className="flex gap-2 mb-2">
        <button onClick={() => void summarize()} disabled={busy || notes.length === 0} className="px-2 py-1 text-xs rounded-md border border-border hover:border-primary/50 disabled:opacity-50">
          สรุปโน้ตด้วย AI
        </button>
        <button onClick={() => void exportPdf()} disabled={busy || notes.length === 0} className="px-2 py-1 text-xs rounded-md border border-border hover:border-primary/50 disabled:opacity-50">
          ส่งออก PDF
        </button>
      </div>

      {summary && <div className="p-3 text-xs whitespace-pre-wrap bg-primary/10 rounded-lg border border-primary/30">{summary}</div>}

      {notes.map((note) => (
        <div
          key={note.id}
          onClick={() => onSeek(Number(note.timestampSec ?? 0))}
          className="p-3 bg-card border border-border/60 hover:border-primary/50 rounded-lg cursor-pointer transition group"
        >
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span className="font-mono bg-primary/10 text-primary px-1.5 py-0.5 rounded group-hover:bg-primary group-hover:text-primary-foreground transition">
              ⏱ {note.timestampFormatted ?? formatNoteTimestamp(Number(note.timestampSec ?? 0))}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                void remove(note.id);
              }}
              disabled={busy}
              className="hover:text-red-500 disabled:opacity-50"
              aria-label="ลบโน้ต"
            >
              ลบ
            </button>
          </div>
          <p className="text-sm text-foreground whitespace-pre-wrap">{note.content}</p>
        </div>
      ))}

      {notes.length === 0 && <div className="text-xs text-muted-foreground">ยังไม่มีโน้ต — กด “+ บันทึกโน้ต” หรือปุ่ม N</div>}
    </div>
  );
}

export default NoteListDrawer;
