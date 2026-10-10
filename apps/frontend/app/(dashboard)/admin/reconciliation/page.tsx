// SSOT Phase 115 §6.1/Task 7 — reconciliation dashboard page (5-state)
// Canonical: apps/frontend/app/(dashboard)/admin/reconciliation/page.tsx
// - RECON_IDLE (KPIs + queue) -> STATEMENT_MATCHING (skeleton) ->
//   DISCREPANCY_DETECTED (flag highlight + override modal) ->
//   OVERRIDE_PENDING_CHECKER (waiting modal) -> OVERRIDE_SUCCESS (toast +
//   optimistic removal) / ERROR (banner + retry). Dep-free.
// - Zero new deps.
'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { KpiRibbon, StatementQueueTable } from '@/components/reconciliation/ReconciliationDashboard';
import { OverrideModal } from '@/components/reconciliation/OverrideModal';
import { reconApi, type BankStatementView, type ReconKpiView, type ReconUiState } from '@/lib/reconciliation/reconciliation-client';

const EMPTY_KPI: ReconKpiView = {
  totalStatementsCount: 0,
  autoMatchedRatePercentage: 100,
  totalMatchedAmount: 0,
  pendingDiscrepanciesCount: 0,
  manualOverriddenCount: 0,
};

function ReconciliationInner() {
  const params = useSearchParams();
  const tenant = params.get('tenant') ?? 'default';
  const [state, setState] = useState<ReconUiState>('RECON_IDLE');
  const [rows, setRows] = useState<BankStatementView[]>([]);
  const [kpi, setKpi] = useState<ReconKpiView>(EMPTY_KPI);
  const [selected, setSelected] = useState<BankStatementView | null>(null);
  const [pendingChecker, setPendingChecker] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');

  const load = useCallback(async (nextState?: ReconUiState) => {
    setState('STATEMENT_MATCHING');
    setError(null);
    setToast(null);
    try {
      const [list, summary] = await Promise.all([
        reconApi(tenant).statements({ status: filter || undefined, page: 1, limit: 50 }),
        reconApi(tenant).kpi(),
      ]);
      setRows(list);
      setKpi(summary);
      if (list.some((r) => r.status === 'DISCREPANCY_FLAGGED')) {
        setState('DISCREPANCY_DETECTED');
      } else {
        setState(nextState ?? 'RECON_IDLE');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดข้อมูลไม่สำเร็จ');
      setState('ERROR');
    }
  }, [tenant, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitOverride(body: { statementId: string; orderId: string; overrideReason: string; adjustmentNote?: string; checkerUserId?: string }): Promise<void> {
    setBusy(true);
    try {
      const out = await reconApi(tenant).initiate(body);
      if (out.needsChecker) {
        setPendingChecker(out.overrideId);
        setState('OVERRIDE_PENDING_CHECKER');
      } else {
        setRows((prev) => prev.filter((r) => r.id !== body.statementId));
        setToast('ปรับรายการสำเร็จ + ปลดล็อกสิทธิ์แล้ว');
        setState('OVERRIDE_SUCCESS');
        await load('RECON_IDLE');
      }
      setSelected(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'override ล้มเหลว');
      setState('ERROR');
    } finally {
      setBusy(false);
    }
  }

  if (state === 'STATEMENT_MATCHING' && rows.length === 0) return <p>กำลังซิงก์สเตทเมนท์…</p>;

  return (
    <div>
      <h1>Bank Statement Reconciliation</h1>
      <KpiRibbon kpi={kpi} />
      <label>
        กรองสถานะ
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">ทั้งหมด</option>
          <option value="UNMATCHED">UNMATCHED</option>
          <option value="AUTO_MATCHED">AUTO_MATCHED</option>
          <option value="DISCREPANCY_FLAGGED">DISCREPANCY_FLAGGED</option>
          <option value="MANUAL_OVERRIDDEN">MANUAL_OVERRIDDEN</option>
          <option value="REJECTED_DUPLICATE">REJECTED_DUPLICATE</option>
        </select>
      </label>
      <button type="button" onClick={() => void load()} disabled={busy}>
        Refresh Queue
      </button>
      {state === 'ERROR' && (
        <p role="alert">
          {error ?? 'เกิดข้อผิดพลาด'}{' '}
          <button type="button" onClick={() => void load()}>
            ลองใหม่
          </button>
        </p>
      )}
      {state === 'OVERRIDE_PENDING_CHECKER' && (
        <p role="status" data-testid="pending-checker">
          รอ Checker อนุมัติ (override {pendingChecker}) — ยอดเกิน ฿1,000 ต้องอนุมัติสองชั้น
        </p>
      )}
      {state === 'OVERRIDE_SUCCESS' && <p role="status" data-testid="override-toast">ปรับรายการสำเร็จ + ปลดล็อกสิทธิ์แล้ว</p>}
      {state !== 'OVERRIDE_SUCCESS' && toast && <p role="status">{toast}</p>}
      <StatementQueueTable rows={rows} onOverride={setSelected} />
      {selected && (
        <OverrideModal statement={selected} busy={busy} error={state === 'ERROR' ? error : null} onClose={() => setSelected(null)} onSubmit={submitOverride} />
      )}
    </div>
  );
}

export default function ReconciliationDashboardPage() {
  return (
    <Suspense fallback={<p>กำลังโหลดแดชบอร์ด…</p>}>
      <ReconciliationInner />
    </Suspense>
  );
}
