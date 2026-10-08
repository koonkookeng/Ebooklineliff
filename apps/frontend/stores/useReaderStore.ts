// SSOT Phase 041 Task 4 — useReaderStore (zero-dep external store, §6.1)
// Canonical: apps/frontend/stores/useReaderStore.ts
// (legacy src/frontend/stores/useReaderStore.ts)
// NOTE: spec §6.1 shows zustand; this is a dependency-free equivalent (same
// state shape + getState/selector API) per the zero-new-deps LIFF policy
// (Phase 011/023 precedent). RAM budget: annotations + prefs JSON (<0.5MB).
// - 5-state machine surfaced as uiState (LIFF_INIT → IDLE → LOADING →
//   SUCCESS / ERROR) for the control overlay fetch lifecycle.
// - Theme prefs hydrate from localStorage on LIFF_INIT (SSR-safe guards);
//   server truth arrives via the preferences proxy afterwards.
'use client';

import { useSyncExternalStore } from 'react';
import type { ThemeMode } from '@repo/shared';

export type { ThemeMode };
export type ReaderUiState = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

export interface ReaderBookmark {
  id: string;
  pageNumber: number;
  chapterTitle?: string | null;
}

export interface ReaderHighlight {
  id: string;
  pageNumber: number;
  colorHex: string;
  boundingRectsJson: string;
  selectedText: string;
  noteText?: string | null;
}

interface ReaderState {
  currentPage: number;
  totalPages: number;
  showControls: boolean;
  theme: ThemeMode;
  fontSizePx: number;
  fontFamily: string;
  lineSpacing: number;
  autoHideControls: boolean;
  bookmarks: ReaderBookmark[];
  highlights: ReaderHighlight[];
  uiState: ReaderUiState;
  error: string | null;
}

const INITIAL: ReaderState = {
  currentPage: 1,
  totalPages: 1,
  showControls: true,
  theme: 'LIGHT',
  fontSizePx: 18,
  fontFamily: 'Prompt',
  lineSpacing: 1.5,
  autoHideControls: true,
  bookmarks: [],
  highlights: [],
  uiState: 'LIFF_INIT',
  error: null,
};

let snapshot: ReaderState = { ...INITIAL };
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function getSnapshot(): ReaderState {
  return snapshot;
}

function getServerSnapshot(): ReaderState {
  return INITIAL;
}

function patch(next: Partial<ReaderState>): void {
  snapshot = { ...snapshot, ...next };
  emit();
}

const PREF_KEY = 'ebook-reader-preferences-v1';

function readPersisted(): Partial<Pick<ReaderState, 'theme' | 'fontSizePx' | 'fontFamily' | 'lineSpacing' | 'autoHideControls'>> {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return {};
    const raw = window.localStorage.getItem(PREF_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<ReaderState>;
    const out: Partial<ReaderState> = {};
    if (parsed.theme === 'LIGHT' || parsed.theme === 'DARK' || parsed.theme === 'SEPIA' || parsed.theme === 'OLED_BLACK') {
      out.theme = parsed.theme;
    }
    if (typeof parsed.fontSizePx === 'number' && Number.isInteger(parsed.fontSizePx) && parsed.fontSizePx >= 12 && parsed.fontSizePx <= 36) {
      out.fontSizePx = parsed.fontSizePx;
    }
    if (typeof parsed.fontFamily === 'string' && parsed.fontFamily.length > 0) out.fontFamily = parsed.fontFamily;
    if (typeof parsed.lineSpacing === 'number' && parsed.lineSpacing >= 1.0 && parsed.lineSpacing <= 2.5) {
      out.lineSpacing = parsed.lineSpacing;
    }
    if (typeof parsed.autoHideControls === 'boolean') out.autoHideControls = parsed.autoHideControls;
    return out;
  } catch {
    return {};
  }
}

function persist(): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(
      PREF_KEY,
      JSON.stringify({
        theme: snapshot.theme,
        fontSizePx: snapshot.fontSizePx,
        fontFamily: snapshot.fontFamily,
        lineSpacing: snapshot.lineSpacing,
        autoHideControls: snapshot.autoHideControls,
      }),
    );
  } catch {
    // Persistence is best-effort (private mode quota) — never break reading.
  }
}

export function hydrateReaderPreferences(): void {
  const saved = readPersisted();
  if (Object.keys(saved).length === 0) {
    patch({ uiState: 'IDLE' });
    return;
  }
  patch({ ...saved, uiState: 'IDLE' });
}

function setCurrentPage(page: number): void {
  if (!Number.isInteger(page) || page < 1) return;
  patch({ currentPage: Math.max(1, Math.min(page, Math.max(snapshot.totalPages, 1))) });
}

// Atomic Phase 059: exact page write for gesture/keyboard turns when the
// catalogue total is still the 1-page placeholder. Lower bound pinned at 1;
// the upper end is guarded by the canvas 404 → ERROR retry path.
function setCurrentPageExact(page: number): void {
  if (!Number.isInteger(page) || page < 1) return;
  patch({ currentPage: page });
}

function setTotalPages(total: number): void {
  if (!Number.isInteger(total) || total < 1) return;
  patch({ totalPages: total, currentPage: Math.min(snapshot.currentPage, total) });
}

function toggleControls(): void {
  patch({ showControls: !snapshot.showControls });
}

// Atomic Phase 059: HUD alias for the gesture/keyboard mapper (§6.1 hook
// uses toggleHud/isHudOpen vocabulary; same bit as showControls).
function toggleHud(): void {
  toggleControls();
}

function setShowControls(show: boolean): void {
  patch({ showControls: show });
}

function setTheme(theme: ThemeMode): void {
  patch({ theme });
  persist();
}

function setFontSizePx(fontSizePx: number): void {
  if (!Number.isInteger(fontSizePx)) return;
  patch({ fontSizePx: Math.max(12, Math.min(36, fontSizePx)) });
  persist();
}

function setTypography(fontFamily: string, lineSpacing: number): void {
  const next: Partial<ReaderState> = {};
  if (typeof fontFamily === 'string' && fontFamily.length > 0) next.fontFamily = fontFamily;
  if (typeof lineSpacing === 'number' && lineSpacing >= 1.0 && lineSpacing <= 2.5) next.lineSpacing = lineSpacing;
  if (Object.keys(next).length === 0) return;
  patch(next);
  persist();
}

function setAnnotations(bookmarks: ReaderBookmark[], highlights: ReaderHighlight[]): void {
  patch({ bookmarks: [...bookmarks], highlights: [...highlights], uiState: 'SUCCESS', error: null });
}

function setAnnotationsLoading(): void {
  patch({ uiState: 'LOADING', error: null });
}

function setAnnotationsError(message: string): void {
  patch({ uiState: 'ERROR', error: message });
}

function addBookmarkLocal(bookmark: ReaderBookmark): void {
  if (snapshot.bookmarks.some((b) => b.pageNumber === bookmark.pageNumber)) return;
  patch({ bookmarks: [...snapshot.bookmarks, bookmark] });
}

function removeBookmarkLocal(pageNumber: number): void {
  patch({ bookmarks: snapshot.bookmarks.filter((b) => b.pageNumber !== pageNumber) });
}

function addHighlightLocal(highlight: ReaderHighlight): void {
  patch({ highlights: [...snapshot.highlights, highlight] });
}

function removeHighlightLocal(highlightId: string): void {
  patch({ highlights: snapshot.highlights.filter((h) => h.id !== highlightId) });
}

function applyServerPreferences(prefs: Partial<Pick<ReaderState, 'theme' | 'fontSizePx' | 'fontFamily' | 'lineSpacing' | 'autoHideControls'>>): void {
  patch({ ...prefs });
  persist();
}

/** Test/SSR reset back to the LIFF_INIT snapshot. */
export function resetReaderStore(): void {
  snapshot = { ...INITIAL };
  emit();
}

const api = {
  setCurrentPage,
  setCurrentPageExact,
  setTotalPages,
  toggleControls,
  toggleHud,
  setShowControls,
  setTheme,
  setFontSizePx,
  setTypography,
  setAnnotations,
  setAnnotationsLoading,
  setAnnotationsError,
  addBookmarkLocal,
  removeBookmarkLocal,
  addHighlightLocal,
  removeHighlightLocal,
  applyServerPreferences,
  hydrateReaderPreferences,
  resetReaderStore,
  getState: (): ReaderState => snapshot,
};

/** Selector hook (zustand-compatible subset): useReaderStore() or useReaderStore(selector). */
export function useReaderStore(): ReaderState;
export function useReaderStore<T>(selector: (s: ReaderState) => T): T;
export function useReaderStore<T>(selector?: (s: ReaderState) => T): ReaderState | T {
  const selected = useSyncExternalStore(
    subscribe,
    () => (selector ? selector(getSnapshot()) : getSnapshot()),
    () => (selector ? selector(getServerSnapshot()) : getServerSnapshot()),
  );
  return selected;
}

useReaderStore.getState = api.getState;
useReaderStore.setCurrentPage = setCurrentPage;
useReaderStore.setCurrentPageExact = setCurrentPageExact;
useReaderStore.setTotalPages = setTotalPages;
useReaderStore.toggleControls = toggleControls;
useReaderStore.toggleHud = toggleHud;
useReaderStore.setShowControls = setShowControls;
useReaderStore.setTheme = setTheme;
useReaderStore.setFontSizePx = setFontSizePx;
useReaderStore.setTypography = setTypography;
useReaderStore.setAnnotations = setAnnotations;
useReaderStore.setAnnotationsLoading = setAnnotationsLoading;
useReaderStore.setAnnotationsError = setAnnotationsError;
useReaderStore.addBookmarkLocal = addBookmarkLocal;
useReaderStore.removeBookmarkLocal = removeBookmarkLocal;
useReaderStore.addHighlightLocal = addHighlightLocal;
useReaderStore.removeHighlightLocal = removeHighlightLocal;
useReaderStore.applyServerPreferences = applyServerPreferences;
useReaderStore.hydrateReaderPreferences = hydrateReaderPreferences;
useReaderStore.resetReaderStore = resetReaderStore;

export default useReaderStore;
