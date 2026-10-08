// SSOT Phase 070 Task 5 — CrossDeviceSyncToast (§6.2 handoff prompt)
// Canonical: apps/frontend/components/sync/CrossDeviceSyncToast.tsx
// - Thai prompt: source device + target position; confirm jumps, dismiss
//   keeps local position. No @/components/ui (not vendored) — Tailwind.
// - Zero new deps.
'use client';

interface CrossDeviceSyncToastProps {
  sourceDevice: string;
  targetPage?: number;
  targetSec?: number;
  onConfirm: () => void;
  onDismiss: () => void;
}

function deviceLabel(device: string): string {
  if (device.includes('LIFF')) return 'LINE LIFF';
  if (device.includes('DESKTOP') || device.includes('WEB')) return 'Web Desktop';
  return device;
}

export function CrossDeviceSyncToast({ sourceDevice, targetPage, targetSec, onConfirm, onDismiss }: CrossDeviceSyncToastProps) {
  const where = targetPage !== undefined ? `หน้า ${targetPage}` : targetSec !== undefined ? `นาทีที่ ${Math.floor(targetSec / 60)}:${String(targetSec % 60).padStart(2, '0')}` : 'ตำแหน่งล่าสุด';
  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-4 rounded-xl border border-emerald-500/30 bg-slate-900 p-4 text-white shadow-2xl" role="dialog" aria-label="สลับอุปกรณ์">
      <div className="h-3 w-3 animate-ping rounded-full bg-emerald-400" />
      <div>
        <p className="text-sm font-semibold">พบตำแหน่งล่าสุดจาก {deviceLabel(sourceDevice)}</p>
        <p className="text-xs text-slate-400">ข้ามไป{where}หรือไม่?</p>
      </div>
      <button type="button" onClick={onConfirm} className="min-h-[44px] rounded-md bg-emerald-500 px-3 text-sm font-bold text-black hover:bg-emerald-600">
        ข้ามไป
      </button>
      <button type="button" onClick={onDismiss} className="min-h-[44px] rounded-md px-3 text-sm text-slate-300 hover:bg-slate-800">
        ยกเลิก
      </button>
    </div>
  );
}

export default CrossDeviceSyncToast;
