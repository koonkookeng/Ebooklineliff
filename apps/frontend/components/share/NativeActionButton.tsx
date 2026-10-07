// SSOT Phase 026 §6.2/Task 5 — Native action button (floating + inline, no new deps)
// Canonical: apps/frontend/components/share/NativeActionButton.tsx
// (legacy src/frontend/components/share/NativeActionButton.tsx)
// - Inline SVG share glyph (lucide-react is NOT a dependency; zero-new-deps).
// - Tenant accent via var(--tenant-primary) with emerald fallback (§2.1).
// - Double-tap guard: disabled while LOADING; auto-dismiss toast (SUCCESS/ERROR).
'use client';

import React, { useEffect, useState } from 'react';
import { useLineShareTargetPicker } from '../../hooks/useLineShareTargetPicker';
import type { ShareContentType } from '@repo/shared';

interface NativeActionButtonProps {
  productId: string;
  contentType: ShareContentType;
  currentPage?: number;
  lessonId?: string;
  variant?: 'floating' | 'inline';
}

function ShareGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.6" y1="10.5" x2="15.4" y2="6.5" />
      <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" />
    </svg>
  );
}

export function NativeActionButton({
  productId,
  contentType,
  currentPage,
  lessonId,
  variant = 'floating',
}: NativeActionButtonProps) {
  const { status, pickerAvailable, shareToFriends } = useLineShareTargetPicker();
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(t);
  }, [toast]);

  const busy = status === 'LOADING';
  const probing = status === 'LIFF_INIT';

  const handleShareClick = async (): Promise<void> => {
    const out = await shareToFriends({
      productId,
      contentType,
      ...(currentPage !== undefined ? { targetPageNumber: currentPage } : {}),
      ...(lessonId ? { targetLessonId: lessonId } : {}),
      ...(currentPage !== undefined ? { customQuote: `กำลังอ่านหน้าที่ ${currentPage} เล่มนี้เด็ดมาก!` } : {}),
    });
    setToast(out.message);
  };

  const label = !pickerAvailable && status === 'IDLE' ? 'คัดลอกลิงก์แชร์' : 'แชร์ให้เพื่อน (+5 แต้ม)';

  const button = variant === 'floating' ? (
    <button
      type="button"
      onClick={() => void handleShareClick()}
      disabled={busy || probing}
      aria-busy={busy}
      className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full bg-[var(--tenant-primary,#059669)] px-5 py-3.5 text-white shadow-lg backdrop-blur-md transition-all hover:brightness-110 active:scale-95 disabled:opacity-50"
    >
      {busy ? (
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
      ) : (
        <>
          <ShareGlyph className="h-5 w-5" />
          <span className="text-sm font-medium">{probing ? 'กำลังโหลด...' : label}</span>
        </>
      )}
    </button>
  ) : (
    <button
      type="button"
      onClick={() => void handleShareClick()}
      disabled={busy || probing}
      aria-busy={busy}
      className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--tenant-primary,#059669)] py-3 font-semibold text-white transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
    >
      <ShareGlyph className="h-4 w-4" />
      <span>{busy ? 'กำลังเตรียมการ์ดแชร์...' : probing ? 'กำลังโหลด...' : pickerAvailable ? 'แชร์เข้าแชต LINE' : 'คัดลอกลิงก์แชร์'}</span>
    </button>
  );

  return (
    <>
      {button}
      {toast && (
        <div role="status" className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full bg-slate-900/95 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </>
  );
}

export default NativeActionButton;
