// SSOT Phase 066 Task 5 — useThemeStore (zero-dep external store, §6.1)
// Canonical: apps/frontend/stores/use-theme-store.ts
// (legacy src/frontend/stores/use-theme-store.ts)
// NOTE: spec §6.1 shows zustand; this is the dependency-free equivalent
// (same shape + getState/selector API) per the zero-new-deps LIFF policy
// (Phase 011/023/041/065 precedent). RAM budget: scalar-only (<1KB).
// - 5-state machine: LIFF_INIT → IDLE → LOADING → SUCCESS / ERROR.
'use client';

import { useSyncExternalStore } from 'react';
import type { ReadingFontFamily, ReadingThemeMode } from '@repo/shared';

export type ThemeUiState = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

interface ThemeState {
  themeMode: ReadingThemeMode;
  fontSizePx: number;
  fontFamily: ReadingFontFamily;
  lineHeightRatio: number;
  brightnessLevel: number;
  autoSyncWithSystem: boolean;
  uiState: ThemeUiState;
  error: string | null;
}

const INITIAL: ThemeState = {
  themeMode: 'SYSTEM',
  fontSizePx: 16,
  fontFamily: 'PROMPT',
  lineHeightRatio: 1.5,
  brightnessLevel: 100,
  autoSyncWithSystem: true,
  uiState: 'LIFF_INIT',
  error: null,
};

let snapshot: ThemeState = INITIAL;
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

function set(partial: Partial<ThemeState>): void {
  snapshot = { ...snapshot, ...partial };
  emit();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function useThemeStore<T>(selector: (s: ThemeState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(snapshot));
}

export const themeStore = {
  getState: (): ThemeState => snapshot,
  hydrate: (prefs: Partial<ThemeState>): void =>
    set({
      themeMode: prefs.themeMode ?? INITIAL.themeMode,
      fontSizePx: prefs.fontSizePx ?? INITIAL.fontSizePx,
      fontFamily: prefs.fontFamily ?? INITIAL.fontFamily,
      lineHeightRatio: prefs.lineHeightRatio ?? INITIAL.lineHeightRatio,
      brightnessLevel: prefs.brightnessLevel ?? INITIAL.brightnessLevel,
      autoSyncWithSystem: prefs.autoSyncWithSystem ?? INITIAL.autoSyncWithSystem,
      uiState: 'IDLE',
      error: null,
    }),
  setSaving: (): void => set({ uiState: 'LOADING', error: null }),
  setSaved: (): void => set({ uiState: 'SUCCESS' }),
  setIdle: (): void => set({ uiState: 'IDLE' }),
  setError: (error: string): void => set({ uiState: 'ERROR', error }),
  patchLocal: (prefs: Partial<ThemeState>): void => set({ ...prefs, error: null }),
  reset: (): void => {
    snapshot = INITIAL;
    emit();
  },
};

export { useThemeStore };
export default useThemeStore;
