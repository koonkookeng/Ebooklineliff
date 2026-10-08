// SSOT Phase 065 Task 4 — useNoteStore (zero-dep external store, §6.1)
// Canonical: apps/frontend/stores/useNoteStore.ts
// (legacy src/frontend/stores/useNoteStore.ts)
// NOTE: dependency-free useSyncExternalStore (same getState/selector API as
// zustand) per the zero-new-deps LIFF policy (Phase 011/023/041 precedent).
// RAM budget: note list JSON only (<0.5MB); editor text is component-local.
// - 5-state machine: LIFF_INIT → IDLE → LOADING → SUCCESS / ERROR.
'use client';

import { useSyncExternalStore } from 'react';
import type { LessonNote } from '@repo/shared';

export type NoteUiState = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

interface NoteState {
  lessonId: string | null;
  notes: LessonNote[];
  activeTimestamp: number | null;
  editorOpen: boolean;
  pendingOffline: number;
  uiState: NoteUiState;
  error: string | null;
}

const INITIAL: NoteState = {
  lessonId: null,
  notes: [],
  activeTimestamp: null,
  editorOpen: false,
  pendingOffline: 0,
  uiState: 'LIFF_INIT',
  error: null,
};

let snapshot: NoteState = INITIAL;
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // listener best-effort
    }
  }
}

function set(partial: Partial<NoteState>): void {
  snapshot = { ...snapshot, ...partial };
  emit();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function getSnapshot(): NoteState {
  return snapshot;
}

function useNoteStore<T>(selector: (s: NoteState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(getSnapshot()));
}

export const noteStore = {
  getState: (): NoteState => snapshot,
  openEditor: (lessonId: string, timestampSec: number): void =>
    set({ lessonId, activeTimestamp: Math.max(0, Math.floor(timestampSec)), editorOpen: true, error: null }),
  closeEditor: (): void => set({ editorOpen: false, activeTimestamp: null }),
  setNotes: (lessonId: string, notes: LessonNote[]): void =>
    set({ lessonId, notes, uiState: 'IDLE', error: null }),
  setLoading: (): void => set({ uiState: 'LOADING', error: null }),
  setSaved: (notes: LessonNote[]): void =>
    set({ notes, uiState: 'SUCCESS', editorOpen: false, activeTimestamp: null, error: null }),
  setError: (error: string): void => set({ uiState: 'ERROR', error }),
  setPendingOffline: (pendingOffline: number): void => set({ pendingOffline }),
  reset: (): void => {
    snapshot = INITIAL;
    emit();
  },
};

export { useNoteStore };
export default useNoteStore;
