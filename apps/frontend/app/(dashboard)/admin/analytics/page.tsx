// SSOT Phase 116 §6.1/Tasks 3-5 — executive BI dashboard page (5-state)
// Canonical: apps/frontend/app/(dashboard)/admin/analytics/page.tsx
// - DASHBOARD_INIT (branding skeleton + auth) -> IDLE (KPIs + cohort +
//   breakdown) -> LOADING (range skeleton) -> SUCCESS (YoY/MoM deltas) /
//   ERROR (toast + fallback + retry). Range switch refetches all three lanes.
// - Zero new deps.
'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CohortMatrix, KpiCards, RevenueBreakdown } from '@/components/analytics/ExecutiveBiDashboard';
import { executiveBiApi, type BiRange, type BiUiState, type CohortRowView, type ExecutiveKpiView, type RevenueBreakdownView } from '@/lib/analytics/executive-bi-client';

const EMPTY_KPI: ExecutiveKpiView = {
  gmv: 0,
  netRevenue: 0,
  totalOrders: 0,
  averageOrderValue: 0,
  customerAcquisitionCost: 0,
  customerLifetimeValue: 0,
  churnRatePercentage: 0,
  activeUsersCount: 0,
  gmvGrowthPercentage: 0,
  ltvToCacRatio: 0,
  calculatedAt: '',
};

const EMPTY_BREAKDOWN: RevenueBreakdownView = { physicalBook: 0, ebook: 0, course: 0, bundle: 0 };

const RANGES: BiRange[] = ['TODAY', 'YESTERDAY', 'LAST_7_DAYS', 'LAST_30_DAYS', 'THIS_MONTH', 'LAST_MONTH'];

function AnalyticsInner() {
  const params = useSearchParams();
  const tenant = params.get('tenant') ?? 'default';
  const [state, setState] = useState<BiUiState>('DASHBOARD_INIT');
  const [range, setRange] = useState<BiRange>('LAST_30_DAYS');
  const [kpi, setKpi] = useState<ExecutiveKpiView>(EMPTY_KPI);
  const [cohort, setCohort] = useState<CohortRowView[]>([]);
  const [breakdown, setBreakdown] = useState<RevenueBreakdownView>(EMPTY_BREAKDOWN);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextRange?: BiRange) => {
    const r = nextRange ?? range;
    setState((s) => (s === 'DASHBOARD_INIT' ? s : 'LOADING'));
    setError(null);
    try {
      const api = executiveBiApi(tenant);
      const [summary, matrix, split] = await Promise.all([api.summary(r), api.cohort(6), api.breakdown(r)]);
      setKpi(summary);
      setCohort(matrix);
      setBreakdown(split);
      setState('SUCCESS');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลด BI ไม่สำเร็จ');
      setState('ERROR');
    }
  }, [tenant, range]);

  useEffect(() => {
    void load();
  }, [load]);

  function switchRange(next: BiRange) {
    setRange(next);
    void load(next);
  }

  if (state === 'DASHBOARD_INIT') return <p>กำลังโหลด Executive BI…</p>;

  return (
    <div>
      <h1>Executive Business Intelligence</h1>
      <div role="group" aria-label="ช่วงเวลา">
        {RANGES.map((r) => (
          <button key={r} type="button" aria-pressed={r === range} onClick={() => switchRange(r)} disabled={state === 'LOADING'}>
            {r}
          </button>
        ))}
      </div>
      {state === 'LOADING' && <p>กำลังคำนวณใหม่…</p>}
      {state === 'ERROR' && (
        <p role="alert">
          {error ?? 'เกิดข้อผิดพลาด'}{' '}
          <button type="button" onClick={() => void load()}>
            ลองใหม่
          </button>
        </p>
      )}
      {state === 'SUCCESS' && (
        <p role="status" data-testid="bi-growth">
          GMV {kpi.gmvGrowthPercentage >= 0 ? '+' : ''}{Number(kpi.gmvGrowthPercentage).toFixed(2)}% · LTV:CAC {Number(kpi.ltvToCacRatio).toFixed(2)}x
        </p>
      )}
      <KpiCards kpi={kpi} />
      <h2>Cohort Retention</h2>
      <CohortMatrix rows={cohort} />
      <h2>Revenue Breakdown</h2>
      <RevenueBreakdown data={breakdown} />
    </div>
  );
}

export default function AdminAnalyticsDashboardPage() {
  return (
    <Suspense fallback={<p>กำลังโหลด Executive BI…</p>}>
      <AnalyticsInner />
    </Suspense>
  );
}
