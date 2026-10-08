// SSOT Phase 059 §6.1 — ReaderKeyboardHandler (Web keyboard attach point)
// Canonical: apps/frontend/components/reader/ReaderKeyboardHandler.tsx
// (legacy src/frontend/components/reader/ReaderKeyboardHandler.tsx)
// - Thin renderless binder: mounts useReaderNavigation in keyboard mode so
//   Web routes get Space/Arrows/Home/End/KeyM/KeyF with focus-guard +
//   200ms throttle (§2.1/§5 LOADING). LIFF routes render nothing.
// - Shows a one-line shortcut hint (dismissible) for discoverability.
// - Zero new deps.
'use client';

import { useState } from 'react';
import { useReaderNavigation } from '../../hooks/useReaderNavigation';

interface ReaderKeyboardHandlerProps {
  productId: string;
  totalPages: number;
  enabled?: boolean;
}

export const ReaderKeyboardHandler: React.FC<ReaderKeyboardHandlerProps> = ({ productId, totalPages, enabled = true }) => {
  useReaderNavigation({ productId, totalPages, isLiffEnvironment: !enabled });
  const [dismissed, setDismissed] = useState(false);
  if (!enabled || dismissed) return null;
  return (
    <div className="mx-auto mt-2 flex max-w-xl items-center justify-between gap-2 rounded-full bg-slate-900/80 px-4 py-1 text-[11px] text-white">
      <span aria-label="Keyboard shortcuts">Space / ← → เปลี่ยนหน้า · Home/End · M เมนู · F เต็มจอ</span>
      <button onClick={() => setDismissed(true)} aria-label="Dismiss shortcuts hint" className="font-bold text-emerald-400">
        ✕
      </button>
    </div>
  );
};

export default ReaderKeyboardHandler;
