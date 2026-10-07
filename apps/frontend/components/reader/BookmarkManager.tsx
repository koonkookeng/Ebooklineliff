// SSOT Phase 041 Task 5 — BookmarkManager (page pins, BDD bookmark sync)
// Canonical: apps/frontend/components/reader/BookmarkManager.tsx
// (legacy src/frontend/components/reader/BookmarkManager.tsx)
// - Presentational list over the store: jump-to-page + remove; the LIFF page
//   owns remote sync (IndexedDB-first per BDD, backend second).
// - Zero new deps.
'use client';

import { useReaderStore, type ReaderBookmark } from '../../stores/useReaderStore';

interface BookmarkManagerProps {
  productId: string;
  isLoading: boolean;
  onJumpToPage: (pageNumber: number) => void;
  onRemoveBookmark: (pageNumber: number) => void;
}

export function BookmarkManager({ productId, isLoading, onJumpToPage, onRemoveBookmark }: BookmarkManagerProps) {
  void productId;
  const bookmarks = useReaderStore((s) => s.bookmarks);
  const currentPage = useReaderStore((s) => s.currentPage);

  const sorted: ReaderBookmark[] = [...bookmarks].sort((a, b) => a.pageNumber - b.pageNumber);

  return (
    <section aria-label="Bookmarks" className="w-full max-w-xl space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        ที่คั่นหนังสือ ({sorted.length})
      </h3>
      {isLoading && (
        <div aria-busy className="space-y-2">
          {[0, 1].map((i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-secondary" />)}
        </div>
      )}
      {!isLoading && sorted.length === 0 && (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          ยังไม่มีที่คั่น — แตะไอคอนคั่นหนังสือเพื่อบันทึกหน้าที่อ่านอยู่
        </p>
      )}
      {!isLoading &&
        sorted.map((b) => (
          <div
            key={`${b.pageNumber}-${b.id}`}
            className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm transition-colors ${
              b.pageNumber === currentPage ? 'border-amber-500/60 bg-amber-500/10' : 'border-border bg-card'
            }`}
          >
            <button onClick={() => onJumpToPage(b.pageNumber)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
              <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4 shrink-0 text-amber-500" aria-hidden>
                <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
              </svg>
              <span className="font-medium">หน้า {b.pageNumber}</span>
              {b.chapterTitle && <span className="truncate text-xs text-muted-foreground">{b.chapterTitle}</span>}
            </button>
            <button
              onClick={() => onRemoveBookmark(b.pageNumber)}
              className="rounded-full p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={`Remove bookmark page ${b.pageNumber}`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4" aria-hidden>
                <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        ))}
    </section>
  );
}

export default BookmarkManager;
