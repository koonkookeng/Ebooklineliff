// SSOT Phase 057 Task 6/7 — HLS player sync overlay (badge + resume toast)
// Canonical: apps/frontend/components/player/HlsPlayerSyncOverlay.tsx
// (legacy src/frontend/components/player/HlsPlayerSyncOverlay.tsx)
// - Sync Status Badge + conflict toast "พบตำแหน่งดูล่าสุด: 0:43 (ดูต่อทันที)"
//   driving onSeekToSecond. Debounced upstream (hook emits at most every 3s).
// - Drop-in over any HlsVideoPlayer — no player file modified this phase.
// - Zero new deps.
'use client';

import React from 'react';
import { useProgressSync, type SyncUiState } from '../../hooks/useProgressSync';

interface HlsPlayerSyncOverlayProps {
  tenantId: string;
  userId: string;
  deviceId: string;
  productId: string;
  lessonId: string;
  onSeekToSecond: (sec: number) => void;
}

function badgeFor(state: SyncUiState): { dot: string; label: string } {
  if (state === 'SYNC_IDLE' || state === 'SYNC_PUSHING') return { dot: 'bg-green-500', label: 'ซิงก์เรียลไทม์' };
  if (state === 'SYNC_CONFLICT' || state === 'SYNC_INIT') return { dot: 'bg-blue-500 animate-pulse', label: 'กำลังซิงก์' };
  return { dot: 'bg-amber-500', label: 'ออฟไลน์ — รอเชื่อมต่อ' };
}

function mmss(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export const HlsPlayerSyncOverlay: React.FC<HlsPlayerSyncOverlayProps> = ({
  tenantId,
  userId,
  deviceId,
  productId,
  lessonId,
  onSeekToSecond,
}) => {
  const { uiState, remoteVideoSec, dismissConflict } = useProgressSync({ tenantId, userId, deviceId, productId });
  const badge = badgeFor(uiState);
  const showToast = uiState === 'SYNC_CONFLICT' && remoteVideoSec && remoteVideoSec.lessonId === lessonId;

  return (
    <>
      <div className="absolute right-3 top-3 z-40 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1" role="status" aria-label={badge.label}>
        <span className={`h-2 w-2 rounded-full ${badge.dot}`} />
        <span className="text-[11px] font-medium text-white">{badge.label}</span>
      </div>
      {showToast && (
        <div className="absolute inset-x-4 top-12 z-50 flex items-center justify-between gap-3 rounded-xl bg-slate-900/95 px-4 py-3 shadow-xl" role="alert">
          <p className="text-xs text-white">พบตำแหน่งดูล่าสุด: {mmss(remoteVideoSec.watchedSec)} (ดูต่อทันที)</p>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={() => {
                onSeekToSecond(remoteVideoSec.watchedSec);
                dismissConflict();
              }}
              className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white"
            >
              ดูต่อ
            </button>
            <button onClick={dismissConflict} className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-white/80">
              ดูตรงนี้
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default HlsPlayerSyncOverlay;
