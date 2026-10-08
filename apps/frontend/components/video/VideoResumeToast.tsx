// SSOT Phase 054 §6.1 — VideoResumeToast (cross-device resume offer overlay)
// Canonical: apps/frontend/components/video/VideoResumeToast.tsx
// (legacy src/frontend/components/video/VideoResumeToast.tsx)
// - BDD Scenario 1: "คุณเรียนค้างไว้ที่ MM:SS ต้องการเล่นต่อจากจุดเดิมหรือไม่?"
//   with เล่นต่อจากเดิม / เริ่มใหม่ actions + 10s auto-dismiss (→ restart).
// - LIFF-safe: DOM-only overlay (<500KB, §2.1), translate3d animation,
//   44px touch targets, inline SVG icons (zero new deps — no lucide).
// - States: SUCCESS (visible) → fade-out 200ms → unmount (null).
'use client';

import { useEffect, useState } from 'react';
import { RESUME_TOAST_AUTO_DISMISS_SEC, formatResumeMMSS } from '@repo/shared';

interface VideoResumeToastProps {
  savedTimeSec: number;
  onResume: () => void;
  onRestart: () => void;
  autoDismissSec?: number;
}

export function VideoResumeToast({
  savedTimeSec,
  onResume,
  onRestart,
  autoDismissSec = RESUME_TOAST_AUTO_DISMISS_SEC,
}: VideoResumeToastProps) {
  const [visible, setVisible] = useState(true);
  const [leaving, setLeaving] = useState(false);
  const [countdown, setCountdown] = useState(autoDismissSec);

  useEffect(() => {
    if (countdown <= 0) {
      setLeaving(true);
      const t = setTimeout(() => {
        setVisible(false);
        onRestart(); // BDD Scenario 3: dismiss defaults to start-over.
      }, 200);
      return () => clearTimeout(t);
    }
    const timer = setInterval(() => setCountdown((p) => p - 1), 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown]);

  if (!visible) return null;

  const dismiss = (fn: () => void): void => {
    setLeaving(true);
    setTimeout(() => {
      setVisible(false);
      fn();
    }, 200);
  };

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="resume playback offer"
      className={`absolute bottom-6 right-4 left-4 z-50 transition-all duration-200 md:left-auto md:w-96 ${
        leaving ? 'translate-y-2 opacity-0' : 'translate-y-0 opacity-100'
      }`}
      style={{ transform: 'translate3d(0,0,0)' }}
    >
      <div className="flex flex-col gap-3 rounded-xl border border-slate-700/60 bg-slate-900/90 p-4 text-white shadow-2xl backdrop-blur-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5 animate-pulse text-emerald-400" aria-hidden>
              <circle cx="12" cy="12" r="10" />
              <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none" />
            </svg>
            <span className="text-sm font-semibold">คุณเรียนค้างไว้ที่ {formatResumeMMSS(savedTimeSec)}</span>
          </div>
          <button
            type="button"
            onClick={() => dismiss(onRestart)}
            aria-label="Close Toast"
            className="min-h-[44px] min-w-[44px] p-1 text-slate-400 transition-colors hover:text-white"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <p className="text-xs text-slate-300">ต้องการเล่นต่อจากจุดเดิมหรือไม่? ({countdown}s)</p>

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => dismiss(onResume)}
            className="flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-bold text-slate-950 shadow-md transition-all hover:bg-emerald-600 active:scale-95"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5" aria-hidden>
              <circle cx="12" cy="12" r="10" />
              <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none" />
            </svg>
            เล่นต่อจากเดิม
          </button>
          <button
            type="button"
            onClick={() => dismiss(onRestart)}
            className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 transition-all hover:bg-slate-700 active:scale-95"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5" aria-hidden>
              <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
              <path d="M3 3v5h5" />
            </svg>
            เริ่มใหม่
          </button>
        </div>
      </div>
    </div>
  );
}

export default VideoResumeToast;
