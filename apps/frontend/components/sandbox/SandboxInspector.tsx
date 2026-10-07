// SSOT Phase 035 Task 3/§2.1 — Sandbox inspector floating widget (QA-only)
// Canonical: apps/frontend/components/sandbox/SandboxInspector.tsx
// (legacy src/frontend/components/sandbox/SandboxInspector.tsx)
// - Live heap readout (performance.memory guarded — non-Chromium → "n/a"),
//   latest audit score/certificate badge, JSON export, and failure diagnostics.
// - Mounted ONLY on the sandbox console route (never global — Gate 5: zero
//   cost to production LIFF users).
// - 5 states: LIFF_INIT (probing) → IDLE (ready) → LOADING (audit running) →
//   SUCCESS (100% certificate) / ERROR (diagnostics panel).
// - Zero new deps.
'use client';

import { useEffect, useState } from 'react';
import { SANDBOX_RAM_LIMIT_MB, type LineReviewAuditSummary } from '@repo/shared';

export type InspectorStatus = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

interface SandboxInspectorProps {
  tenantId: string;
  summary: LineReviewAuditSummary | null;
  status: InspectorStatus;
  onRunAudit: () => void;
}

function readHeapMB(): number | null {
  try {
    const memory = (performance as unknown as { memory?: { usedJSHeapSize?: unknown } }).memory;
    if (typeof memory?.usedJSHeapSize === 'number') return memory.usedJSHeapSize / (1024 * 1024);
    return null;
  } catch {
    return null;
  }
}

export function SandboxInspector({ tenantId, summary, status, onRunAudit }: SandboxInspectorProps) {
  const [ramMB, setRamMB] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setRamMB(readHeapMB());
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  const overBudget = ramMB !== null && ramMB > SANDBOX_RAM_LIMIT_MB;
  const failures = (summary?.results ?? []).filter((r) => !r.isPassed);

  const exportJson = () => {
    if (!summary) return;
    try {
      const blob = new Blob([JSON.stringify(summary, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `line-sandbox-audit-${summary.auditId}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch {
      // Export unavailable (storage-blocked WebView): results stay on screen.
    }
  };

  return (
    <div data-testid="sandbox-inspector" className="fixed bottom-4 right-4 z-50 w-72 rounded-xl border border-emerald-500 bg-slate-900 p-4 text-xs text-white shadow-2xl">
      <div className="mb-1 font-bold text-emerald-400">LINE Mini App Inspector</div>
      <div>Tenant: {tenantId}</div>
      <div>
        RAM Usage:{' '}
        <span className={overBudget ? 'font-bold text-red-400' : 'text-emerald-300'}>
          {ramMB === null ? 'n/a' : `${ramMB.toFixed(2)} MB`} / {SANDBOX_RAM_LIMIT_MB.toFixed(2)} MB
        </span>
      </div>
      {overBudget ? <div role="alert" className="mt-1 text-red-300">[LINE Review Alert] RAM limit exceeded 30MB constraint!</div> : null}
      <div className="mt-2">
        {status === 'SUCCESS' && summary?.isApprovedForSubmission ? (
          <span className="rounded bg-emerald-500/20 px-2 py-0.5 font-semibold text-emerald-300">
            Review Compliance: 100% READY
          </span>
        ) : status === 'ERROR' || failures.length > 0 ? (
          <span className="rounded bg-red-500/20 px-2 py-0.5 font-semibold text-red-300">
            {failures.length} checkpoint{failures.length === 1 ? '' : 's'} failing
          </span>
        ) : (
          <span className="rounded bg-slate-500/20 px-2 py-0.5 font-semibold text-slate-300">
            {status === 'LOADING' ? 'Running checklist…' : `Score: ${summary?.overallScore ?? '—'}/100`}
          </span>
        )}
      </div>
      {failures.length > 0 ? (
        <ul className="mt-2 max-h-32 space-y-1 overflow-auto">
          {failures.map((f) => (
            <li key={f.testId} className="text-red-200">
              {f.checkPointName}: {f.diagnosticMessage ?? 'see console'}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={onRunAudit} disabled={status === 'LOADING'} className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 font-semibold disabled:opacity-50">
          {status === 'LOADING' ? 'Running…' : 'Run audit'}
        </button>
        <button type="button" onClick={exportJson} disabled={!summary} className="flex-1 rounded-lg border border-slate-600 px-3 py-2 disabled:opacity-50">
          Export JSON
        </button>
      </div>
    </div>
  );
}

export default SandboxInspector;
