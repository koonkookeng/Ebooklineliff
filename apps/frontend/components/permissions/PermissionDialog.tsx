// SSOT Phase 032 Task 5 — PermissionDialog (sheet + DENIED fallback orchestrator)
// Canonical: apps/frontend/components/permissions/PermissionDialog.tsx
// (legacy src/frontend/components/permissions/PermissionDialog.tsx)
// - One dialog for the whole permission lifecycle (§9 single-point rule):
//   PROMPT → PrePermissionSheet → native request → GRANTED (auto-close +
//   success slot) / DENIED → guided fallback (settings steps + copy path +
//   retry, i.e. the FallbackPermissionModal role, no second component).
// - Tenant accent via --primary-color (multi-tenant, §2.1); dep-free.
// - Stream-safe: callers stop preview tracks; the hook sweeps on unmount.
'use client';

import React, { useState } from 'react';
import { SETTINGS_PATH_COPY, detectDevicePlatform, type DevicePlatform, type PermissionType } from '@repo/shared';
import { PrePermissionSheet } from './PrePermissionSheet';
import { copyText } from '../../lib/permissions/permission-client';
import { useDevicePermissions, type GrantedCoords } from '../../hooks/useDevicePermissions';

interface PermissionDialogProps {
  permissionType: PermissionType;
  purpose?: string;
  triggerLabel: string;
  tenantName?: string;
  /** Rendered after GRANTED (e.g. the file picker or GPS result slot). */
  children?: (granted: { openSheet: () => void }) => React.ReactNode;
  onGranted?: (stream?: MediaStream, coords?: GrantedCoords) => void;
}

export function PermissionDialog({ permissionType, purpose, triggerLabel, tenantName, children, onGranted }: PermissionDialogProps) {
  const { uiState, status, isSheetOpen, setIsSheetOpen, error, requestPermission } = useDevicePermissions(permissionType, {
    purpose,
    onGranted,
  });
  const [copied, setCopied] = useState(false);
  const busy = uiState === 'LOADING';

  const platform: DevicePlatform =
    typeof navigator !== 'undefined' ? detectDevicePlatform(navigator.userAgent, false) : 'LINE_LIFF';
  const settingsPath = SETTINGS_PATH_COPY[platform];

  const handleCopy = async () => {
    const ok = await copyText(settingsPath);
    setCopied(ok);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div data-testid="permission-dialog" data-status={status} data-state={uiState}>
      {status === 'GRANTED' && children ? (
        children({ openSheet: () => setIsSheetOpen(true) })
      ) : (
        <button
          type="button"
          onClick={() => setIsSheetOpen(true)}
          className="rounded-xl px-4 py-2 text-sm font-medium text-white"
          style={{ backgroundColor: 'var(--primary-color, #059669)' }}
        >
          {triggerLabel}
          {status !== 'PROMPT' && status !== 'GRANTED' ? ` (${status})` : ''}
        </button>
      )}

      <PrePermissionSheet
        isOpen={isSheetOpen && status === 'PROMPT'}
        onClose={() => setIsSheetOpen(false)}
        onConfirm={() => void requestPermission()}
        permissionType={permissionType}
        tenantName={tenantName}
        busy={busy}
      />

      {isSheetOpen && (status === 'DENIED' || status === 'RESTRICTED' || status === 'UNSUPPORTED' || uiState === 'ERROR') ? (
        <div role="alertdialog" aria-modal="true" aria-label="วิธีเปิดสิทธิ์การใช้งาน" className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" onClick={() => setIsSheetOpen(false)}>
          <div className="w-full max-w-md rounded-t-2xl bg-white p-6 shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-2 text-base font-bold text-slate-900">เปิดสิทธิ์เพื่อใช้งานต่อ</h3>
            <p className="mb-3 text-sm text-slate-600">
              {status === 'UNSUPPORTED'
                ? 'อุปกรณ์นี้ไม่รองรับการเข้าถึงโดยตรง กรุณาใช้อุปกรณ์อื่น'
                : 'คุณได้ปฏิเสธสิทธิ์ไว้ก่อนหน้า แอปไม่สามารถเรียกขอซ้ำได้ กรุณาเปิดสิทธิ์ตามขั้นตอนนี้'}
            </p>
            {status !== 'UNSUPPORTED' ? (
              <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-slate-600">
                <li>เปิดแอป “การตั้งค่า” ของเครื่องหรือแอป LINE</li>
                <li>ไปที่เส้นทาง: {settingsPath}</li>
                <li>เปิดสวิตช์สิทธิ์ แล้วกลับมากด “ลองอีกครั้ง”</li>
              </ol>
            ) : null}
            {error ? <p className="mb-3 text-xs text-red-600">{error}</p> : null}
            <div className="flex gap-3">
              <button type="button" onClick={() => void handleCopy()} className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700">
                {copied ? 'คัดลอกแล้ว!' : 'คัดลอกเส้นทาง'}
              </button>
              {status !== 'UNSUPPORTED' ? (
                <button
                  type="button"
                  onClick={() => void requestPermission()}
                  disabled={busy}
                  className="flex-1 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
                >
                  {busy ? 'กำลังตรวจสอบ...' : 'ลองอีกครั้ง'}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default PermissionDialog;
