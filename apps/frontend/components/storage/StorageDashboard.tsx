// SSOT Phase 123 §6.1 — storage management dashboard (dep-free, 5-state)
// Canonical: apps/frontend/components/storage/StorageDashboard.tsx
// - RISK_CALL deviations (documented): no shadcn Card/Button/Progress,
//   no lucide-react, no Recharts (none installed; zero-dep rule) —
//   Tailwind cards + CSS bars + inline SVG, same information density.
// - States: INIT (skeleton) → IDLE (cards + bars + rules) → LOADING
//   (spinner + disabled) → SUCCESS (toast + refresh) / ERROR (banner +
//   retry). Tenant-scoped via props. <25MB (no chart lib, no retained
//   series beyond the latest snapshot).
// - Zero new deps.
'use client';

import React from 'react';
import {
  storageApi,
  bytesToGB,
  type LifecycleRuleView,
  type StorageBudgetView,
  type StorageMetricView,
  type StorageUiState,
} from '@/lib/storage/storage-client';

const EMPTY_METRIC: StorageMetricView = {
  totalSizeBytes: 0,
  totalObjectsCount: 0,
  classAOperationsCount: 0,
  classBOperationsCount: 0,
  estimatedMonthlyCostTHB: 0,
  recordedAt: new Date(0).toISOString(),
};

function statusOf(percent: number): { label: string; tone: string } {
  if (percent >= 85) return { label: 'Critical', tone: '#fb7185' };
  if (percent >= 70) return { label: 'Warning', tone: '#fbbf24' };
  return { label: 'Optimal', tone: '#34d399' };
}

export function StorageDashboard({ tenant, bucket }: { tenant: string; bucket: string }) {
  const api = React.useMemo(() => storageApi(tenant, bucket), [tenant, bucket]);
  const [state, setState] = React.useState<StorageUiState>('INIT');
  const [metric, setMetric] = React.useState<StorageMetricView>(EMPTY_METRIC);
  const [rules, setRules] = React.useState<LifecycleRuleView[]>([]);
  const [budget, setBudget] = React.useState<StorageBudgetView | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    setError(null);
    setToast(null);
    try {
      const [m, r, b] = await Promise.all([api.metrics(), api.rules(), api.budget().catch(() => null)]);
      setMetric(m);
      setRules(r);
      setBudget(b);
      setState('IDLE');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดข้อมูลไม่สำเร็จ');
      setState('ERROR');
    }
  }, [api]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function handleSync() {
    setBusy(true);
    setState('LOADING');
    try {
      await api.sync();
      await load();
      setToast('อัปเดต Lifecycle Policy สำเร็จ');
      setState('SUCCESS');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ซิงก์ไม่สำเร็จ');
      setState('ERROR');
    } finally {
      setBusy(false);
    }
  }

  async function handleSweep() {
    setBusy(true);
    setState('LOADING');
    try {
      await api.sweep();
      await load();
      setToast('ประเมินงบประมาณและแจ้งเตือนเรียบร้อย');
      setState('SUCCESS');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ประเมินงบประมาณไม่สำเร็จ');
      setState('ERROR');
    } finally {
      setBusy(false);
    }
  }

  if (state === 'INIT') {
    return (
      <div className="p-6 space-y-6" aria-busy="true">
        <div className="h-8 w-64 rounded bg-slate-800 animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-32 rounded bg-slate-900 border border-slate-800 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const limit = budget?.monthlyBudgetLimitTHB ?? 0;
  const percent = limit > 0 ? (metric.estimatedMonthlyCostTHB / limit) * 100 : 0;
  const status = statusOf(percent);

  return (
    <div className="p-6 space-y-6 bg-slate-950 text-slate-50 min-h-screen">
      <div className="flex justify-between items-center flex-wrap gap-3">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <ellipse cx="12" cy="5" rx="8" ry="3" stroke="#34d399" strokeWidth="2" />
            <path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" stroke="#34d399" strokeWidth="2" />
            <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" stroke="#34d399" strokeWidth="2" />
          </svg>
          Cloudflare R2 Storage &amp; Budget Center
        </h1>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleSweep}
            disabled={busy}
            className="px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-sm font-semibold"
          >
            {busy && state === 'LOADING' ? 'กำลังประเมิน...' : 'ประเมินงบประมาณ'}
          </button>
          <button
            type="button"
            onClick={handleSync}
            disabled={busy}
            className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-sm font-semibold"
          >
            {busy && state === 'LOADING' ? 'กำลังซิงก์...' : 'Sync R2 Lifecycle Rules'}
          </button>
        </div>
      </div>

      {toast && (
        <div role="status" className="rounded border border-emerald-700 bg-emerald-950 px-4 py-2 text-sm text-emerald-200">
          {toast}
        </div>
      )}
      {error && (
        <div role="alert" className="rounded border border-rose-700 bg-rose-950 px-4 py-2 text-sm text-rose-200">
          {error}{' '}
          <button type="button" onClick={() => void load()} className="underline font-semibold">
            Retry Sync
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="rounded bg-slate-900 border border-slate-800 p-5">
          <p className="text-sm text-slate-400">Total Usage Capacity</p>
          <p className="text-3xl font-extrabold text-emerald-400">{bytesToGB(metric.totalSizeBytes).toFixed(2)} GB</p>
          <p className="text-xs text-slate-500 mt-1">
            {metric.totalObjectsCount.toLocaleString()} objects · Zero-Egress ($0.015/GB/mo)
          </p>
        </div>
        <div className="rounded bg-slate-900 border border-slate-800 p-5">
          <p className="text-sm text-slate-400">Monthly Cost Forecast</p>
          <p className="text-3xl font-extrabold text-blue-400">{metric.estimatedMonthlyCostTHB.toLocaleString()} THB</p>
          <p className="text-xs text-slate-500 mt-1">Budget Limit: {limit.toLocaleString()} THB</p>
        </div>
        <div className="rounded bg-slate-900 border border-slate-800 p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-bold">{percent.toFixed(1)}% Used</span>
            <span className="text-xs font-bold" style={{ color: status.tone }}>
              {status.label}
            </span>
          </div>
          <div className="h-2 rounded bg-slate-800 overflow-hidden" role="progressbar" aria-valuenow={Math.min(100, percent)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded" style={{ width: `${Math.min(100, percent)}%`, background: status.tone }} />
          </div>
          <p className="text-xs text-slate-500 mt-2">
            Warn {budget?.warningThresholdPercent ?? 70}% · Critical {budget?.criticalThresholdPercent ?? 85}%
          </p>
        </div>
      </div>

      <div className="rounded bg-slate-900 border border-slate-800 p-5">
        <h2 className="text-sm font-bold text-slate-300 mb-3">Lifecycle Rules · {bucket}</h2>
        {rules.length === 0 ? (
          <p className="text-sm text-slate-500">ยังไม่มี lifecycle rule สำหรับ bucket นี้</p>
        ) : (
          <ul className="divide-y divide-slate-800 text-sm">
            {rules.map((r) => (
              <li key={r.ruleId} className="py-2 flex items-center justify-between gap-3">
                <span className="font-mono text-slate-200">{r.ruleId}</span>
                <span className="text-slate-400 truncate">{r.prefix}</span>
                <span className="text-slate-500">
                  {r.expireDays ? `expire ${r.expireDays}d` : 'no expiry'} · abort-mpu {r.abortIncompleteMultipartDays}d
                </span>
                <span className={r.enabled ? 'text-emerald-400' : 'text-slate-500'}>{r.enabled ? 'Enabled' : 'Disabled'}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
