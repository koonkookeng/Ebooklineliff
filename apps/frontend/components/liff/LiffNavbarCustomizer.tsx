// SSOT Phase 030 Task 4/§6.2 — LiffNavbarCustomizer (brand header + actions)
// Canonical: apps/frontend/components/liff/LiffNavbarCustomizer.tsx
// (legacy src/frontend/components/liff/LiffNavbarCustomizer.tsx)
// - Consumes useLiffTheme (CSS vars + native bar sync); renders the web fallback
//   bar (sticky h-14, 150ms color transition, logo/title + Option/Close).
// - Inline SVG icons only (no icon lib in the LIFF bundle, Gate 5).
// - Close: onClose override → liff.closeWindow() → history.back() fallback.
//   Option: opens the current URL in the outer browser (LINE external handoff).
// - Renders nothing when branding is null (caller shows skeleton, CLS = 0).
'use client';

import React from 'react';
import type { TenantBranding } from '@repo/shared';
import { useLiffTheme } from '../../hooks/useLiffTheme';
import { getLiff } from '../../lib/liff/liff-sdk';

interface LiffNavbarCustomizerProps {
  branding: TenantBranding | null;
  title?: string;
  onClose?: () => void;
  onOption?: () => void;
}

async function closeWindow(): Promise<void> {
  try {
    const liff = await getLiff();
    const closer = (liff as unknown as { closeWindow?: () => void }).closeWindow;
    if (typeof closer === 'function') {
      closer.call(liff);
      return;
    }
  } catch {
    // SDK unavailable: fall through to history fallback.
  }
  if (typeof window !== 'undefined') window.history.back();
}

export function LiffNavbarCustomizer({ branding, title, onClose, onOption }: LiffNavbarCustomizerProps) {
  useLiffTheme(branding);
  if (!branding) return null;

  const handleOption = () => {
    if (onOption) {
      onOption();
      return;
    }
    if (typeof window !== 'undefined') window.open(window.location.href, '_blank', 'noopener');
  };

  const handleClose = () => {
    if (onClose) {
      onClose();
      return;
    }
    void closeWindow();
  };

  return (
    <header
      data-testid="liff-navbar"
      className="sticky top-0 z-50 flex h-14 w-full items-center justify-between px-4 shadow-sm transition-colors duration-150"
      style={{ backgroundColor: 'var(--nav-bg-color)', color: 'var(--nav-text-color)' }}
    >
      <div className="flex items-center gap-3">
        {branding.logoUrl ? (
          <img src={branding.logoUrl} alt={branding.brandName} className="h-7 w-7 rounded-full object-cover" />
        ) : null}
        <h1 className="max-w-[200px] truncate text-base font-semibold">{title || branding.brandName}</h1>
      </div>

      <div className="flex items-center gap-2">
        {branding.enableShareOptionMenu ? (
          <button type="button" aria-label="Options" onClick={handleOption} className="rounded-full p-1.5 transition-colors hover:bg-white/10">
            <svg className="h-5 w-5 fill-current" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
            </svg>
          </button>
        ) : null}

        {branding.enableCustomCloseButton ? (
          <button type="button" aria-label="Close" onClick={handleClose} className="rounded-full p-1.5 transition-colors hover:bg-white/10">
            <svg className="h-5 w-5 fill-current" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        ) : null}
      </div>
    </header>
  );
}

export default LiffNavbarCustomizer;
