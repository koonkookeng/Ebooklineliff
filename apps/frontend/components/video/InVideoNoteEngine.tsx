// SSOT Phase 065 Task 4 — InVideoNoteEngine (timestamp capture + seek)
// Canonical: apps/frontend/components/video/InVideoNoteEngine.tsx
// (legacy src/frontend/components/video/InVideoNoteEngine.tsx)
// - RISK_CALL deviation: fetch-based note-client instead of @apollo/client
//   (zero-new-dep + LIFF bundle; same GQL field contract server-side).
// - "N" shortcut + Add-note button capture current time, auto-pause, open
//   drawer; clicking a note seeks the player (no segment reload — parent
//   owns the video element). Debounced autosave 500ms; offline → IDB queue.
// - Tenant accent via CSS var --primary-color; drawer uses translate3d.
// - Zero new deps.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { NOTE_AUTOSAVE_DEBOUNCE_MS, formatNoteTimestamp, type LessonNote } from '@repo/shared';
import { noteStore, useNoteStore } from '../../stores/useNoteStore';

const EMPTY_NOTES: LessonNote[] = [];
import {
  createLessonNote,
  fetchLessonNotes,
  flushOfflineNotes,
  queueOfflineNote,
} from '../../lib/video/note-client';
import { NoteListDrawer } from './NoteListDrawer';

interface InVideoNoteEngineProps {
  lessonId: string;
  getCurrentTimeSec: () => number;
  seekToSeconds: (seconds: number) => void;
  pauseVideo: () => void;
}

export function InVideoNoteEngine({ lessonId, getCurrentTimeSec, seekToSeconds, pauseVideo }: InVideoNoteEngineProps) {
  const storeLessonId = useNoteStore((s) => s.lessonId);
  const storeNotes = useNoteStore((s) => s.notes);
  const notes = storeLessonId === lessonId ? storeNotes : EMPTY_NOTES;
  const editorOpen = useNoteStore((s) => s.editorOpen);
  const activeTimestamp = useNoteStore((s) => s.activeTimestamp);
  const uiState = useNoteStore((s) => s.uiState);
  const pendingOffline = useNoteStore((s) => s.pendingOffline);
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(async () => {
    noteStore.setLoading();
    try {
      const list = await fetchLessonNotes(lessonId);
      noteStore.setNotes(lessonId, list);
    } catch (e) {
      noteStore.setError(e instanceof Error ? e.message : 'โหลดโน้ตล้มเหลว');
    }
  }, [lessonId]);

  useEffect(() => {
    void reload();
    const onOnline = () => {
      void flushOfflineNotes().then(() => void reload());
    };
    const onSwMessage = (event: MessageEvent) => {
      if ((event.data as { type?: string } | null)?.type === 'ZENE_FLUSH_NOTE_QUEUE') {
        void flushOfflineNotes().then(() => void reload());
      }
    };
    window.addEventListener('online', onOnline);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', onSwMessage as EventListener);
    }
    return () => {
      window.removeEventListener('online', onOnline);
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', onSwMessage as EventListener);
      }
    };
  }, [reload]);

  const openEditor = useCallback(() => {
    const sec = Math.floor(getCurrentTimeSec());
    pauseVideo();
    noteStore.openEditor(lessonId, sec);
    setContent('');
  }, [getCurrentTimeSec, lessonId, pauseVideo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'n' || e.key === 'N') && !editorOpen && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLInputElement)) {
        openEditor();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editorOpen, openEditor]);

  const saveNow = useCallback(
    async (text: string, silent = false) => {
      // Manual save wins over a pending autosave tick (no duplicate notes).
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      const ts = noteStore.getState().activeTimestamp;
      if (!text.trim() || ts === null) return;
      setSaving(true);
      try {
        const note = await createLessonNote({ lessonId, timestampSec: ts, content: text.trim(), visibility: 'PRIVATE' });
        if (silent) {
          noteStore.setNotes(lessonId, [...noteStore.getState().notes, note]);
        } else {
          noteStore.setSaved([...noteStore.getState().notes, note]);
          setToast('บันทึกโน้ตเรียบร้อย');
        }
      } catch {
        await queueOfflineNote({ lessonId, timestampSec: ts, content: text.trim() });
        noteStore.setPendingOffline(noteStore.getState().pendingOffline + 1);
        setToast('ออฟไลน์ — บันทึกลงเครื่องแล้ว');
      } finally {
        setSaving(false);
      }
    },
    [lessonId],
  );

  const onChange = useCallback(
    (text: string) => {
      setContent(text);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        if (text.trim()) void saveNow(text, true);
      }, NOTE_AUTOSAVE_DEBOUNCE_MS);
    },
    [saveNow],
  );

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  return (
    <div className="flex flex-col h-full bg-background border-l border-border w-full max-w-md p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-lg">โน้ตย่อของบทเรียน</h3>
        <button
          onClick={openEditor}
          className="bg-primary text-primary-foreground px-3 py-1.5 rounded-md text-sm font-medium hover:opacity-90 transition"
        >
          + บันทึกโน้ต
        </button>
      </div>

      {editorOpen && (
        <div className="mb-4 p-3 bg-muted/50 rounded-lg border border-border">
          <div className="text-xs font-semibold text-muted-foreground mb-1">
            บันทึกที่ Timestamp: <span className="text-primary">{formatNoteTimestamp(activeTimestamp ?? 0)}</span>
          </div>
          <textarea
            value={content}
            onChange={(e) => onChange(e.target.value)}
            placeholder="พิมพ์โน้ตสรุปความเข้าใจของคุณที่นี่..."
            className="w-full h-24 p-2 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <div className="flex justify-end gap-2 mt-2">
            <button onClick={() => noteStore.closeEditor()} className="px-3 py-1 text-xs text-muted-foreground hover:underline">
              ยกเลิก
            </button>
            <button
              onClick={() => void saveNow(content)}
              disabled={saving}
              className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded-md disabled:opacity-50"
            >
              {saving ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </div>
      )}

      {uiState === 'LOADING' && <div className="text-xs text-muted-foreground animate-pulse">กำลังโหลดโน้ต...</div>}
      {pendingOffline > 0 && <div className="text-xs text-amber-500 mb-2">{pendingOffline} โน้ตรอซิงก์ (ออฟไลน์)</div>}
      {toast && <div className="text-xs text-emerald-500 mb-2">{toast}</div>}

      <NoteListDrawer lessonId={lessonId} notes={notes} onSeek={seekToSeconds} onChanged={reload} />
    </div>
  );
}

export default InVideoNoteEngine;
