// SSOT Phase 023 §6.2 — DynamicHeaderIntegrator (tenant brand + progress + actions)
// Canonical: apps/frontend/components/header/DynamicHeaderIntegrator.tsx
// (legacy src/frontend/components/header/DynamicHeaderIntegrator.tsx)
// - React.memo + CSS containment: title changes never re-render page content.
// - Zero new deps: inline SVG icons (no lucide-react), Next router only.
// - Null config → null (zero impact until a page sets header context).
// - ERROR state → tenant storefront fallback title + non-blocking toast.
'use client';

import React, { memo, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useHeaderStore } from '../../stores/headerStore';

function BackIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <path d="m16 6-4-4-4 4" />
      <path d="M12 2v13" />
    </svg>
  );
}

function BookmarkIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
    </svg>
  );
}

export const DynamicHeaderIntegrator: React.FC<{ tenantFallbackTitle?: string }> = memo(
  ({ tenantFallbackTitle = 'Ebook LIFF' }) => {
    const router = useRouter();
    const headerConfig = useHeaderStore((s) => s.headerConfig);
    const uiState = useHeaderStore((s) => s.uiState);
    const error = useHeaderStore((s) => s.error);

    const style = useMemo(
      () =>
        ({
          '--header-accent': headerConfig?.brandColor ?? '#0284C7',
          contain: 'layout style paint',
        }) as React.CSSProperties,
      [headerConfig?.brandColor],
    );

    if (!headerConfig) return null;

    const showShare = headerConfig.actionIcons.some((a) => a.id === 'share');
    const showBookmark = headerConfig.actionIcons.some((a) => a.id === 'bookmark');

    return (
      <header
        className="sticky top-0 z-50 w-full backdrop-blur-md bg-white/90 border-b border-slate-200/80 transition-colors duration-200"
        style={style}
      >
        <div className="flex items-center justify-between h-14 px-4 max-w-7xl mx-auto">
          <div className="flex items-center gap-3 truncate">
            {headerConfig.showBackButton && (
              <button
                onClick={() =>
                  headerConfig.backToUrl ? router.push(headerConfig.backToUrl) : router.back()
                }
                className="p-2 rounded-full hover:bg-slate-100 active:scale-95 transition-all"
                aria-label="Go Back"
              >
                <span className="text-slate-700">
                  <BackIcon />
                </span>
              </button>
            )}

            <div className="flex flex-col truncate">
              <h1 className="text-sm font-bold text-slate-900 truncate leading-tight">
                {headerConfig.mainTitle}
              </h1>
              {headerConfig.subtitle && (
                <p className="text-xs font-medium text-sky-600 truncate">{headerConfig.subtitle}</p>
              )}
            </div>
          </div>

          {uiState === 'LOADING' && (
            <div className="h-1 w-24 overflow-hidden rounded bg-slate-200" aria-hidden="true">
              <div className="h-full w-1/2 animate-pulse bg-sky-500" />
            </div>
          )}

          {headerConfig.progressPercentage !== undefined && (
            <div className="hidden sm:flex items-center gap-2">
              <div className="w-20 bg-slate-200 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-sky-600 h-full transition-all duration-300"
                  style={{ width: `${headerConfig.progressPercentage}%` }}
                />
              </div>
              <span className="text-xs text-slate-500 font-mono">
                {Math.round(headerConfig.progressPercentage)}%
              </span>
            </div>
          )}

          <div className="flex items-center gap-1">
            {showShare && (
              <button
                className="p-2 rounded-full hover:bg-slate-100 active:scale-95 transition-all"
                aria-label="Share"
              >
                <span className="text-slate-600">
                  <ShareIcon />
                </span>
              </button>
            )}
            {showBookmark && (
              <button
                className="p-2 rounded-full hover:bg-slate-100 active:scale-95 transition-all"
                aria-label="Bookmark"
              >
                <span className="text-slate-600">
                  <BookmarkIcon />
                </span>
              </button>
            )}
          </div>
        </div>

        {uiState === 'ERROR' && error && (
          <div role="status" className="px-4 pb-1 text-[11px] text-slate-500">
            {tenantFallbackTitle} · {error}
          </div>
        )}
      </header>
    );
  },
);

DynamicHeaderIntegrator.displayName = 'DynamicHeaderIntegrator';

export default DynamicHeaderIntegrator;
