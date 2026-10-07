// SSOT Phase 027 Task 6 — Exit confirmation dialog (dirty-state guard)
// Canonical: apps/frontend/components/navigation/ExitConfirmDialog.tsx
// - Dep-free native <div> dialog (no new UI lib in the LIFF bundle, RAM guard).
// - Thai copy per BDD Scenario 2; Cancel stays, Confirm persists + exits.
// - Pure presentational: open state + callbacks owned by LiffRouterProvider.
'use client';

interface ExitConfirmDialogProps {
  open: boolean;
  busy: boolean;
  kind: 'BACK' | 'CLOSE';
  onCancel: () => void;
  onConfirm: () => void;
}

export function ExitConfirmDialog({ open, busy, kind, onCancel, onConfirm }: ExitConfirmDialogProps) {
  if (!open) return null;
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label="ยืนยันการออกจากหน้านี้"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-background p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold">คุณมีรายการที่ยังทำไม่เสร็จ</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {kind === 'CLOSE'
            ? 'ต้องการออกจากแอปหรือไม่? ระบบจะบันทึกความคืบหน้าไว้ให้แล้ว'
            : 'ต้องการย้อนกลับหรือไม่? ความคืบหน้าจะถูกบันทึกไว้ให้'}
        </p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex-1 rounded-xl border px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            อยู่ต่อ
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy ? 'กำลังบันทึก...' : 'ออกจากหน้านี้'}
          </button>
        </div>
      </div>
    </div>
  );
}
