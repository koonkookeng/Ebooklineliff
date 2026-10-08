// SSOT Phase 057 Task 5/7 — Canvas reader sync overlay (badge + jump toast)
// Canonical: apps/frontend/components/reader/CanvasReaderSyncOverlay.tsx
// (legacy src/frontend/components/reader/CanvasReaderSyncOverlay.tsx)
// - Sync Status Badge (green dot / pulse / amber) top-right of the reader +
//   conflict toast "พบตำแหน่งอ่านล่าสุด: หน้า N (ย้ายไปทันที)" on
//   SYNC_CONFLICT. Jump callback keeps RAM flat (no refetch storm: single
//   page turn through the existing sliding window).
// - Drop-in: wrap any reader (LineLiffCanvasReader included) — no reader
//   file is modified by this phase.
// - Zero new deps.
'use client';

import React from 'react';
import { useProgressSync, type SyncUiState } from '../../hooks/useProgressSync';

interface CanvasReaderSyncOverlayProps {
  tenantId: string;
  userId: string;
  deviceId: string;
  productId: string;
  ebookId: string;
  onJumpToPage: (page: number) => void;
}

function badgeFor(state: SyncUiState): { dot: string; label: string } {
  if (state === 'SYNC_IDLE' || state === 'SYNC_PUSHING') return { dot: 'bg-green-500', label: 'ซิงก์เรียลไทม์' };
  if (state === 'SYNC_CONFLICT' || state === 'SYNC_INIT') return { dot: 'bg-blue-500 animate-pulse', label: 'กำลังซิงก์' };
  return { dot: 'bg-amber-500', label: 'ออฟไลน์ — รอเชื่อมต่อ' };
}

export const CanvasReaderSyncOverlay: React.FC<CanvasReaderSyncOverlayProps> = ({
  tenantId,
  userId,
  deviceId,
  productId,
  ebookId,
  onJumpToPage,
}) => {
  const { uiState, remoteEbookPage, dismissConflict } = useProgressSync({ tenantId, userId, deviceId, productId });
  const badge = badgeFor(uiState);
  const showToast = uiState === 'SYNC_CONFLICT' && remoteEbookPage && remoteEbookPage.ebookId === ebookId;

  return (
    <>
      <div className="absolute right-3 top-3 z-40 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1" role="status" aria-label={badge.label}>
        <span className={`h-2 w-2 rounded-full ${badge.dot}`} />
        <span className="text-[11px] font-medium text-white">{badge.label}</span>
      </div>
      {showToast && (
        <div className="absolute inset-x-4 top-12 z-50 flex items-center justify-between gap-3 rounded-xl bg-slate-900/95 px-4 py-3 shadow-xl" role="alert">
          <p className="text-xs text-white">พบตำแหน่งอ่านล่าสุด: หน้า {remoteEbookPage.lastPage} (ย้ายไปทันที)</p>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={() => {
                onJumpToPage(remoteEbookPage.lastPage);
                dismissConflict();
              }}
              className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white"
            >
              ไปเลย
            </button>
            <button onClick={dismissConflict} className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-white/80">
              อยู่หน้านี้
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default CanvasReaderSyncOverlay;
