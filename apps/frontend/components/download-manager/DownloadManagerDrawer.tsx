// SSOT Phase 068 Task 6 — DownloadManagerDrawer + StorageUsageBar (§2.2)
// Canonical: apps/frontend/components/download-manager/DownloadManagerDrawer.tsx
// (legacy src/frontend/components/download-manager/DownloadManagerDrawer.tsx)
// - RISK_CALL deviations: no @/components/ui (shadcn not vendored) and no
//   lucide-react (not installed) — Tailwind + inline SVG, same 5 states.
// - 44px touch targets (LIFF); progress/speed/ETA live from the store;
//   EXPIRED overlay blocks content with a renew action.
// - Zero new deps.
'use client';

import { useDownloadStore } from '../../stores/use-download-store';
import {
  cancelDownload,
  pauseDownload,
  removeDownload,
  startDownload,
} from '../../lib/download/download-manager';
import type { StorageCategory } from '@repo/shared';

function fmtMB(bytes: number): string {
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function fmtEta(sec: number | null): string {
  if (sec === null) return '—';
  if (sec < 60) return `${sec} วินาที`;
  return `${Math.floor(sec / 60)} นาที ${sec % 60} วินาที`;
}

export function StorageUsageBar() {
  const quotaBytes = useDownloadStore((s) => s.quotaBytes);
  const usedBytes = useDownloadStore((s) => s.usedBytes);
  if (!quotaBytes) return null;
  const pct = Math.min(100, Math.round((usedBytes / quotaBytes) * 100));
  const low = quotaBytes - usedBytes < quotaBytes * 0.1;
  return (
    <div className="w-full" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="พื้นที่จัดเก็บ">
      <div className="mb-1 flex justify-between text-xs text-muted-foreground">
        <span>พื้นที่ใช้ไป {fmtMB(usedBytes)} / {fmtMB(quotaBytes)}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${low ? 'bg-red-500' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
      </div>
      {low && <p className="mt-1 text-xs text-red-500">พื้นที่ใกล้เต็ม — แนะนำลบไฟล์เก่า</p>}
    </div>
  );
}

interface DownloadManagerDrawerProps {
  productId: string;
  title: string;
  category?: StorageCategory;
  fileUrl?: string;
  totalBytes?: number;
}

export function DownloadManagerDrawer({ productId, title, category = 'OFFLINE_ASSET', fileUrl = '', totalBytes = 0 }: DownloadManagerDrawerProps) {
  const task = useDownloadStore((s) => s.tasks[productId]);
  const uiState = useDownloadStore((s) => s.uiState);
  const error = useDownloadStore((s) => s.error);

  const status = task?.status ?? 'IDLE';

  return (
    <div className="rounded-xl border border-border bg-background p-4 shadow-lg">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 24 24" className="h-5 w-5 text-primary" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
          </svg>
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
        {task && <span className="text-xs text-muted-foreground">{fmtMB(task.downloadedBytes)} / {fmtMB(task.totalBytes)}</span>}
      </div>

      <StorageUsageBar />

      {(status === 'IDLE' || status === 'FAILED') && (
        <button
          type="button"
          onClick={() => void startDownload({ productId, title, category, fileUrl, totalBytes })}
          disabled={!fileUrl || !totalBytes}
          className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary text-xs text-primary-foreground disabled:opacity-50"
        >
          ดาวน์โหลดไว้ดูแบบ Offline{totalBytes > 0 && ` (${fmtMB(totalBytes)})`}
        </button>
      )}

      {(status === 'QUEUED' || status === 'DOWNLOADING' || status === 'PAUSED') && task && (
        <div className="mt-3 space-y-2">
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={task.progress} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${task.progress}%` }} />
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {status === 'PAUSED' ? 'หยุดชั่วคราว' : `กำลังดาวน์โหลด... ${task.progress}%`} · {(task.speedBps / 1048576).toFixed(2)} MB/s · เหลือ {fmtEta(task.etaSec)}
            </span>
            <span className="flex gap-1">
              {status !== 'PAUSED' ? (
                <button type="button" aria-label="หยุดชั่วคราว" onClick={() => pauseDownload(productId)} className="min-h-[44px] min-w-[44px] rounded-md border border-border">
                  ⏸
                </button>
              ) : (
                <button type="button" aria-label="ดาวน์โหลดต่อ" onClick={() => void startDownload({ productId, title, category, fileUrl, totalBytes })} className="min-h-[44px] min-w-[44px] rounded-md border border-border">
                  ▶
                </button>
              )}
              <button type="button" aria-label="ยกเลิก" onClick={() => cancelDownload(productId)} className="min-h-[44px] min-w-[44px] rounded-md border border-border text-destructive">
                ✕
              </button>
            </span>
          </div>
        </div>
      )}

      {status === 'COMPLETED' && (
        <div className="mt-3 flex items-center justify-between rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-2.5">
          <div className="flex items-center gap-2 text-xs font-medium text-emerald-600">
            <span aria-hidden>✓</span> พร้อมอ่านแบบ Offline
          </div>
          <button type="button" aria-label="ลบไฟล์ดาวน์โหลด" onClick={() => void removeDownload(productId)} className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-destructive">
            🗑
          </button>
        </div>
      )}

      {uiState === 'LICENSE_EXPIRED_ERROR' && (
        <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs" role="alert">
          <p className="font-medium text-red-600">สิทธิ์ออฟไลน์หมดอายุ — เชื่อมต่ออินเทอร์เน็ตเพื่อต่ออายุ</p>
          {error && <p className="mt-1 text-muted-foreground">{error}</p>}
          <button
            type="button"
            onClick={() => void startDownload({ productId, title, category, fileUrl, totalBytes })}
            className="mt-2 h-9 w-full rounded-md bg-primary text-xs text-primary-foreground"
          >
            ต่ออายุสิทธิ์แล้วดาวน์โหลดใหม่
          </button>
        </div>
      )}
    </div>
  );
}

export default DownloadManagerDrawer;
