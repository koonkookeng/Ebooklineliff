// SSOT Phase 041 Task 5 — LIFF reader route (controls + canvas composition)
// Canonical: apps/frontend/app/(liff)/reader/[productId]/page.tsx
// (legacy src/frontend/app/(liff)/reader/[productId]/page.tsx)
// - 5-state machine: LIFF_INIT (prefs hydrate + splash) → IDLE → LOADING
//   (annotations) → SUCCESS (controls + canvas + bookmarks) / ERROR
//   (offline toast + retry; bookmarks stay usable from the store).
// - Tenant accent/logo arrive via query params (library-page precedent).
// - Zero new deps.
'use client';

import { Suspense, use, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import CanvasReader from '../../../../components/reader/CanvasReader';
import { ReaderControlBar } from '../../../../components/reader/ReaderControlBar';
import { BookmarkManager } from '../../../../components/reader/BookmarkManager';
import { useReaderStore } from '../../../../stores/useReaderStore';
import { useReadWatchTracker } from '../../../../hooks/useReadWatchTracker';
import {
  fetchAnnotations,
  toggleBookmarkRemote,
} from '../../../../lib/reader/reader-control-client';

type PageState = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

const THEME_VARS: Record<string, { bg: string; text: string }> = {
  LIGHT: { bg: '#ffffff', text: '#0f172a' },
  SEPIA: { bg: '#FBF0D9', text: '#5F4B32' },
  DARK: { bg: '#0f172a', text: '#f1f5f9' },
  OLED_BLACK: { bg: '#000000', text: '#e5e7eb' },
};

function ReaderInner({ productId }: { productId: string }) {
  const params = useSearchParams();
  const accent = params.get('color') ?? '#059669';
  const [state, setState] = useState<PageState>('LIFF_INIT');
  const [error, setError] = useState<string | null>(null);
  const theme = useReaderStore((s) => s.theme);
  const annotationsLoading = useReaderStore((s) => s.uiState === 'LOADING');
  // Atomic Phase 052: dwell telemetry (server stamps identity from JWT cookie).
  const { trackPageDwell } = useReadWatchTracker({ userId: null, productId, contentId: productId, contentType: 'READ' });
  useEffect(() => {
    const t = setInterval(() => trackPageDwell(useReaderStore.getState().currentPage), 1000);
    return () => clearInterval(t);
  }, [trackPageDwell]);
  const vars = THEME_VARS[theme] ?? THEME_VARS.LIGHT;

  useEffect(() => {
    let cancelled = false;
    useReaderStore.hydrateReaderPreferences();
    setState('LOADING');
    useReaderStore.setAnnotationsLoading();
    fetchAnnotations(productId)
      .then((data) => {
        if (cancelled) return;
        const rows = data as { bookmarks?: Array<{ id: string; pageNumber: number; chapterTitle?: string | null }>; highlights?: never[] };
        useReaderStore.setTotalPages(1);
        useReaderStore.setAnnotations(
          (rows.bookmarks ?? []).map((b) => ({ id: b.id, pageNumber: b.pageNumber, chapterTitle: b.chapterTitle ?? null })),
          [],
        );
        setState('SUCCESS');
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        useReaderStore.setAnnotationsError(e instanceof Error ? e.message : 'offline');
        setError(e instanceof Error ? e.message : 'Offline — annotations will sync on reconnect');
        setState('ERROR');
      });
    return () => {
      cancelled = true;
    };
  }, [productId]);

  const handleToggleBookmark = useCallback(async () => {
    const { currentPage } = useReaderStore.getState();
    const existing = useReaderStore.getState().bookmarks.some((b) => b.pageNumber === currentPage);
    const optimisticId = `local-${currentPage}`;
    if (!existing) useReaderStore.addBookmarkLocal({ id: optimisticId, pageNumber: currentPage });
    else useReaderStore.removeBookmarkLocal(currentPage);
    try {
      const result = await toggleBookmarkRemote({ productId, pageNumber: currentPage });
      if (result.isBookmarked && result.bookmark && typeof result.bookmark === 'object') {
        const saved = result.bookmark as { id: string; pageNumber: number };
        useReaderStore.removeBookmarkLocal(currentPage);
        useReaderStore.addBookmarkLocal({ id: saved.id, pageNumber: saved.pageNumber });
      }
    } catch (e) {
      // Revert the optimistic write; keep the page readable (ERROR toast only).
      if (!existing) useReaderStore.removeBookmarkLocal(currentPage);
      else useReaderStore.addBookmarkLocal({ id: optimisticId, pageNumber: currentPage });
      setError(e instanceof Error ? e.message : 'Bookmark sync failed');
    }
  }, [productId]);

  const handleJump = useCallback((pageNumber: number) => {
    useReaderStore.setCurrentPage(pageNumber);
    useReaderStore.setShowControls(false);
  }, []);

  if (state === 'LIFF_INIT' || state === 'LOADING') {
    return (
      <div className="flex min-h-screen items-center justify-center" aria-busy>
        <div className="h-8 w-8 animate-spin rounded-full border-t-2 border-emerald-500" />
      </div>
    );
  }

  return (
    <div
      className="min-h-screen"
      style={{ ['--reader-bg' as string]: vars.bg, ['--reader-text' as string]: vars.text, ['--reader-accent' as string]: accent }}
    >
      <ReaderControlBar productId={productId} bookTitle="E-Book Reader" onBack={() => window.history.back()} onToggleBookmark={() => void handleToggleBookmark()} />
      <main className="px-4 pb-24 pt-20">
        <CanvasReader productId={productId} userIdHash="" />
        <div className="mx-auto mt-6 max-w-xl">
          <BookmarkManager
            productId={productId}
            isLoading={annotationsLoading}
            onJumpToPage={handleJump}
            onRemoveBookmark={(pageNumber) => {
              useReaderStore.removeBookmarkLocal(pageNumber);
              toggleBookmarkRemote({ productId, pageNumber }).catch(() => undefined);
            }}
          />
        </div>
      </main>
      {state === 'ERROR' && error && (
        <div role="alert" className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full bg-slate-900 px-4 py-2 text-xs text-white shadow-lg">
          {error}
          <button onClick={() => window.location.reload()} className="ml-3 font-bold text-emerald-400">
            ลองใหม่
          </button>
        </div>
      )}
    </div>
  );
}

export default function LiffReaderPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = use(params);
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center" aria-busy><div className="h-8 w-8 animate-spin rounded-full border-t-2 border-emerald-500" /></div>}>
      <ReaderInner productId={productId} />
    </Suspense>
  );
}
