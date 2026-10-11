// SSOT Phase 126 Task 6 §2.1 — smart waiting room (peak-traffic fallback)
// Canonical: apps/frontend/components/perf/SmartWaitingRoom.tsx
// - Minimalist gate shown when queue latency trips 2s: live position,
//   Thai copy, exponential-backoff retry. Props-driven (the host shell
//   owns queue telemetry via SSE/polling). Dep-free, inline SVG only.
// - Zero new deps.
'use client';

import React from 'react';
import { waitingRetryLabel } from '@/lib/perf/memory-guard';

interface SmartWaitingRoomProps {
  queuePosition: number;
  etaSeconds: number;
  retryAttempt?: number;
  onRetry: () => void;
}

export function SmartWaitingRoom({ queuePosition, etaSeconds, retryAttempt = 0, onRetry }: SmartWaitingRoomProps) {
  return (
    <div className="p-6 bg-white rounded-2xl shadow-xl max-w-md w-full mx-auto text-center" role="status">
      <span className="w-16 h-16 rounded-full bg-slate-100 text-slate-500 text-4xl flex items-center justify-center mb-3 mx-auto">
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" strokeWidth="2" />
          <path strokeLinecap="round" strokeWidth="2" d="M12 7v5l3 3" />
        </svg>
      </span>
      <h3 className="text-lg font-bold text-gray-900">ช่วงนี้มีผู้ใช้งานจำนวนมาก</h3>
      <p className="text-sm text-gray-500 mt-1">
        คิวของท่าน: <span className="font-bold text-gray-800">{queuePosition.toLocaleString('th-TH')}</span>
        {' · '}โดยประมาณ <span className="font-bold text-gray-800">{etaSeconds} วินาที</span>
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 px-4 py-2 rounded-xl text-white text-sm font-semibold"
        style={{ background: 'var(--primary-color, #059669)' }}
      >
        {waitingRetryLabel(retryAttempt)}
      </button>
    </div>
  );
}

export default SmartWaitingRoom;
