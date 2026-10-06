// SSOT Phase 010 Task 6 — Preview modal engine (ebook sample / course trailer, signed-token ready)
// Canonical: apps/frontend/components/pdp/PreviewModal.tsx
// DRM note: real assets load via time-limited signed URLs (15 min) issued by the
// preview-token endpoint; this modal renders through the gated `assetUrl` only.
'use client';

import React, { useEffect } from 'react';

export type PreviewKind = 'EBOOK_SAMPLE' | 'COURSE_TRAILER';

interface Props {
  open: boolean;
  kind: PreviewKind;
  title: string;
  assetUrl: string | null;
  onClose: () => void;
}

export function PreviewModal({ open, kind, title, assetUrl, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="absolute inset-x-4 top-[10%] mx-auto max-w-lg rounded-2xl bg-white p-4 shadow-2xl">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold truncate">{title}</h2>
          <button type="button" onClick={onClose} aria-label="ปิดตัวอย่าง" className="p-1 text-gray-500">
            ✕
          </button>
        </div>
        {assetUrl ? (
          kind === 'COURSE_TRAILER' ? (
            <video src={assetUrl} controls playsInline preload="metadata" className="w-full rounded-xl bg-black" />
          ) : (
            <iframe src={assetUrl} title={title} className="h-[60vh] w-full rounded-xl border" sandbox="allow-same-origin" />
          )
        ) : (
          <div className="rounded-xl bg-gray-50 p-6 text-center text-xs text-gray-500">
            {kind === 'COURSE_TRAILER'
              ? 'วิดีโอตัวอย่างจะพร้อมใช้งานหลังผู้ขายอัปโหลดไฟล์ตัวอย่าง'
              : 'ตัวอย่างหนังสือจะพร้อมใช้งานหลังผู้ขายอัปโหลดไฟล์ตัวอย่าง (10 หน้าแรก)'}
          </div>
        )}
        <p className="mt-2 text-[11px] text-gray-400">ลิงก์ตัวอย่างมีอายุ 15 นาที (Signed Token)</p>
      </div>
    </div>
  );
}

export default PreviewModal;
