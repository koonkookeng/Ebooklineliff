// SSOT Phase 032 Task 4/§6.2 — Pre-permission educational bottom sheet (PDPA)
// Canonical: apps/frontend/components/permissions/PrePermissionSheet.tsx
// (legacy src/frontend/components/permissions/PrePermissionSheet.tsx)
// - Copy single-sourced from PERMISSION_SHEET_COPY (@repo/shared §2.1).
// - RISK_CALL deviation (documented): inline SVG icons instead of lucide-react
//   (spec §6.2 names it) — the LIFF bundle has no icon lib (Gate 5 zero-dep);
//   visuals match the spec layout (PDPA badge, icon disc, benefit box).
// - Pure presentational (open + callbacks owned by useDevicePermissions hosts).
'use client';

import React from 'react';
import { PERMISSION_SHEET_COPY, type PermissionType } from '@repo/shared';

interface PrePermissionSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  permissionType: PermissionType;
  tenantName?: string;
  busy?: boolean;
}

function TypeIcon({ type }: { type: PermissionType }) {
  const paths: Record<PermissionType, string> = {
    CAMERA: 'M4 7h3l2-2h6l2 2h3v12H4zM12 16a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
    PHOTO_LIBRARY: 'M4 5h16v14H4zM8 11l2.5 3 2-2.5L16 15H8zM9 8.5A1.25 1.25 0 1 0 9 11a1.25 1.25 0 0 0 0-2.5z',
    GEOLOCATION: 'M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 0 12 6.5a2.5 2.5 0 0 0 0 5z',
    MICROPHONE: 'M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zm6-3a6 6 0 0 1-12 0H4a8 8 0 0 0 7 7.94V22h2v-2.06A8 8 0 0 0 20 12z',
  };
  return (
    <svg className="h-8 w-8" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={paths[type]} />
    </svg>
  );
}

export function PrePermissionSheet({ isOpen, onClose, onConfirm, permissionType, tenantName = 'แพลตฟอร์ม', busy = false }: PrePermissionSheetProps) {
  if (!isOpen) return null;
  const config = PERMISSION_SHEET_COPY[permissionType];
  return (
    <div role="dialog" aria-modal="true" aria-label={config.title} className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-2xl bg-white p-6 shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2 text-emerald-600">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
            <span className="text-xs font-semibold uppercase tracking-wider">PDPA Privacy Protected</span>
          </div>
          <button type="button" onClick={onClose} aria-label="ปิด" className="rounded-full p-1 text-slate-400 hover:bg-slate-100">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>

        <div className="py-6 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <TypeIcon type={permissionType} />
          </div>
          <h3 className="mb-2 text-lg font-bold text-slate-900">{config.title}</h3>
          <p className="mb-1 text-sm text-slate-600">{config.description}</p>
          <p className="mb-4 text-xs text-slate-400">{tenantName} จะใช้สิทธิ์นี้ตามวัตถุประสงค์ที่แจ้งเท่านั้น</p>
          <div className="rounded-xl bg-slate-50 p-3 text-left text-xs text-slate-500">
            💡 <strong className="text-slate-700">ประโยชน์ที่คุณจะได้รับ:</strong> {config.benefit}
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} disabled={busy} className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 disabled:opacity-50">
            ยกเลิก
          </button>
          <button type="button" onClick={onConfirm} disabled={busy} className="flex-1 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-medium text-white shadow-lg disabled:opacity-50">
            {busy ? 'กำลังขอสิทธิ์...' : 'ยินยอมและอนุญาต'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default PrePermissionSheet;
