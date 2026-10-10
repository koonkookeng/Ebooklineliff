// SSOT Phase 114 §6.1/Task 5 — admin financial clearinghouse page
// Canonical: apps/frontend/app/(admin)/financial-clearinghouse/page.tsx
// - FIN_INIT (splash+skeleton) -> IDLE (metrics+ledger) -> RECONCILING
//   (overlay) -> SETTLED (badge+cert) / DISPUTE_HOLD (red banner, payout
//   locked) / ERROR (retry). Dep-free (no shadcn/recharts — bundle guard).
'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ClearingSummaryCards } from '@/components/clearing/ClearingSummaryCards';
import { LedgerTable } from '@/components/clearing/LedgerTable';
import { clearingApi, type ClearingUiState, type FinancialSummaryView, type LedgerRowView } from '@/lib/clearing/clearing-client';

const EMPTY: FinancialSummaryView = {
  totalGrossCashflow: 0,
  totalEscrowHeld: 0,
  totalPlatformRevenue: 0,
  totalCreatorPayable: 0,
  totalTaxWithheld: 0,
};

function ClearinghouseInner() {
  const params = useSearchParams();
  const tenant = params.get('tenant') ?? 'default';
  const [state, setState] = useState<ClearingUiState>('FIN_INIT');
  const [summary, setSummary] = useState<FinancialSummaryView>(EMPTY);
  const [ledger, setLedger] = useState<LedgerRowView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastRun, setLastRun] = useState<{ matched: number; discrepancies: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, l] = await Promise.all([clearingApi(tenant).summary(), clearingApi(tenant).ledger(20, 0)]);
      setSummary(s);
      setLedger(l);
      setState((prev) => (prev === 'FIN_INIT' || prev === 'RECONCILING' ? 'IDLE' : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดข้อมูลไม่สำเร็จ');
      setState('ERROR');
    }
  }, [tenant]);

  useEffect(() => {
    void load();
  }, [load]);

  async function reconcile() {
    setBusy(true);
    setState('RECONCILING');
    try {
      // Empty probe batch validates the lane; statement batches post here.
      const out = await clearingApi(tenant).reconcile([]);
      setLastRun({ matched: out.matched, discrepancies: out.discrepancies.length });
      if (out.discrepancies.length > 0) {
        setState('DISPUTE_HOLD');
      } else {
        setState('SETTLED');
        await load();
        setState('IDLE');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'reconcile ล้มเหลว');
      setState('ERROR');
    } finally {
      setBusy(false);
    }
  }

  if (state === 'FIN_INIT') return <p>กำลังโหลดศูนย์เคลียริ่ง…</p>;

  return (
    <div>
      <h1>Global Financial Clearinghouse</h1>
      <p>Real-time Cashflow Audit · Double-Entry Ledger · Revenue Settlement</p>
      {state === 'DISPUTE_HOLD' && (
        <p role="alert" data-testid="dispute-hold-banner">
          พบยอดไม่ตรง — ล็อกปุ่มอนุมัติโอนเงิน เปิด Dispute Ticket แล้ว
        </p>
      )}
      {state === 'SETTLED' && <p role="status" data-testid="settled-badge">SETTLED · เคลียริ่งสำเร็จ</p>}
      {state === 'ERROR' && (
        <p role="alert">
          {error ?? 'เกิดข้อผิดพลาด'}{' '}
          <button type="button" onClick={() => void load()}>
            ลองใหม่
          </button>
        </p>
      )}
      <ClearingSummaryCards summary={summary} ledger={ledger} onTrace={(account) => ledger.filter((r) => r.accountType === account)} />
      <div>
        <button type="button" onClick={() => void reconcile()} disabled={busy || state === 'DISPUTE_HOLD'}>
          {state === 'RECONCILING' ? 'กำลัง reconciling…' : 'Run Reconciliation'}
        </button>
        {lastRun && (
          <p role="status">
            matched {lastRun.matched} · discrepancies {lastRun.discrepancies}
          </p>
        )}
      </div>
      <h2>Audit Double-Entry Ledger Stream</h2>
      <LedgerTable rows={ledger} />
    </div>
  );
}

export default function FinancialClearinghousePage() {
  return (
    <Suspense fallback={<p>กำลังโหลดศูนย์เคลียริ่ง…</p>}>
      <ClearinghouseInner />
    </Suspense>
  );
}
