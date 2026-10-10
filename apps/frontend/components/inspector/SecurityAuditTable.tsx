// SSOT Phase 110 §6 — security audit table (masked-aware rows)
// Canonical: apps/frontend/components/inspector/SecurityAuditTable.tsx
// - Zero new deps.
'use client';

import React from 'react';
import type { InspectorProfile } from '@/lib/inspector';

type Row = InspectorProfile['recentSecurityLogs'][number];

const RISK_BADGE: Record<string, string> = {
  LOW: 'bg-slate-200 text-slate-700',
  MEDIUM: 'bg-amber-200 text-amber-800',
  HIGH: 'bg-orange-500 text-white',
  CRITICAL: 'bg-rose-600 text-white',
};

export const SecurityAuditTable: React.FC<{ logs: Row[]; total?: number }> = ({ logs, total }) => {
  if (logs.length === 0) {
    return (
      <div role="status" className="rounded-xl bg-slate-900 p-4 text-center text-xs text-slate-400">
        ยังไม่มี security log สำหรับผู้ใช้นี้
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {typeof total === 'number' && <p className="text-xs text-slate-500">ทั้งหมด {total.toLocaleString('th-TH')} รายการ</p>}
      {logs.map((s) => (
        <div key={s.id} className="flex flex-wrap justify-between items-center gap-2 rounded-lg bg-slate-900 p-3 text-sm">
          <div className="min-w-0">
            <span className="font-semibold text-cyan-300">{s.activityType}</span>
            <span className="block truncate text-xs text-slate-400">
              IP: {s.ipAddress} · {s.userAgent.substring(0, 48)}{s.userAgent.length > 48 ? '…' : ''}
              {s.deviceFingerprint ? ` · FP: ${s.deviceFingerprint}` : ''}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded text-xs ${RISK_BADGE[s.riskLevel] ?? 'bg-gray-200'}`}>{s.riskLevel}</span>
            <span className="text-xs text-slate-400">{new Date(s.createdAt).toLocaleString('th-TH')}</span>
          </div>
        </div>
      ))}
    </div>
  );
};

export default SecurityAuditTable;
