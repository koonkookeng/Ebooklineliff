// SSOT Phase 041 Task 5 — ReaderControlBar (immersive overlay, §6.2)
// Canonical: apps/frontend/components/reader/ReaderControlBar.tsx
// (legacy src/frontend/components/reader/ReaderControlBar.tsx)
// - GPU-only show/hide (translate3d + opacity, will-change) — no canvas
//   reflow, no heap bloat (Gate 5). Auto-hide 4s idle; tap zone reveals.
// - Zero new deps (inline SVG icons; no lucide/framer-motion in LIFF).
'use client';

import { useEffect, useState } from 'react';
import { useReaderStore } from '../../stores/useReaderStore';
import { PageNavigationSlider } from './PageNavigationSlider';
import { ThemeSettingsPopover } from './ThemeSettingsPopover';

interface ReaderControlBarProps {
  productId: string;
  bookTitle: string;
  onBack: () => void;
  onToggleBookmark: () => void;
}

function IconBack() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5" aria-hidden>
      <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconBookmark({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={2}
      className={`h-5 w-5 transition-colors ${filled ? 'text-amber-500' : ''}`}
      aria-hidden
    >
      <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconSliders() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5" aria-hidden>
      <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" strokeLinecap="round" />
    </svg>
  );
}

export function ReaderControlBar({ productId, bookTitle, onBack, onToggleBookmark }: ReaderControlBarProps) {
  const showControls = useReaderStore((s) => s.showControls);
  const currentPage = useReaderStore((s) => s.currentPage);
  const bookmarked = useReaderStore((s) => s.bookmarks.some((b) => b.pageNumber === s.currentPage));
  const [showThemeSettings, setShowThemeSettings] = useState(false);

  // Auto-hide after 4s of inactivity (BDD: overlay fades, never leaks).
  useEffect(() => {
    if (!showControls) return;
    const timer = setTimeout(() => {
      if (!showThemeSettings) useReaderStore.setShowControls(false);
    }, 4000);
    return () => clearTimeout(timer);
  }, [showControls, showThemeSettings, currentPage]);

  if (!showControls) {
    return <div className="fixed inset-0 z-30 cursor-pointer bg-transparent" onClick={() => useReaderStore.setShowControls(true)} aria-label="Show reader controls" />;
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-40 flex flex-col justify-between transition-all duration-300 will-change-transform">
      <div className="pointer-events-auto flex items-center justify-between border-b border-border bg-background/95 px-4 py-3 shadow-sm backdrop-blur-md">
        <div className="flex items-center space-x-3">
          <button onClick={onBack} className="rounded-full p-2 transition-colors hover:bg-accent" aria-label="Back">
            <IconBack />
          </button>
          <h1 className="max-w-[180px] truncate text-sm font-semibold text-foreground sm:max-w-xs">{bookTitle}</h1>
        </div>
        <div className="flex items-center space-x-1 sm:space-x-2">
          <button onClick={onToggleBookmark} className="rounded-full p-2 transition-colors hover:bg-accent" aria-label="Bookmark page">
            <IconBookmark filled={bookmarked} />
          </button>
          <button
            onClick={() => setShowThemeSettings((v) => !v)}
            className="rounded-full p-2 transition-colors hover:bg-accent"
            aria-label="Theme and typography settings"
            aria-expanded={showThemeSettings}
          >
            <IconSliders />
          </button>
        </div>
      </div>

      {showThemeSettings && (
        <div className="pointer-events-auto absolute right-4 top-16 z-50">
          <ThemeSettingsPopover onClose={() => setShowThemeSettings(false)} />
        </div>
      )}

      <div className="pointer-events-auto border-t border-border bg-background/95 px-4 py-3 shadow-lg backdrop-blur-md">
        <PageNavigationSlider productId={productId} />
      </div>
    </div>
  );
}

export default ReaderControlBar;
