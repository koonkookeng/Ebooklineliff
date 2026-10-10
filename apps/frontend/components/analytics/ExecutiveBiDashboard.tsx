// SSOT Phase 116 §6.1 — executive BI widgets (dep-free)
// Canonical: apps/frontend/components/analytics/ExecutiveBiDashboard.tsx
// - KPI cards (GMV/LTV/CAC/ratio) + cohort matrix (CSS heat cells) +
//   revenue breakdown (CSS bars). No recharts/tremor (bundle guard, 110).
// - Zero new deps (React only).
'use client';

import React from 'react';
import { formatBiThb, type CohortRowView, type ExecutiveKpiView, type RevenueBreakdownView } from '../../lib/analytics/executive-bi-client';

export function KpiCards(props: { kpi: ExecutiveKpiView }) {
  const { kpi } = props;
  const cards = [
    { label: 'Gross Merchandise Value (GMV)', value: formatBiThb(kpi.gmv), testid: 'bi-gmv' },
    { label: 'Customer Lifetime Value (LTV)', value: formatBiThb(kpi.customerLifetimeValue), testid: 'bi-ltv' },
    { label: 'Acquisition Cost (CAC)', value: formatBiThb(kpi.customerAcquisitionCost), testid: 'bi-cac' },
    { label: 'LTV : CAC Ratio', value: `${Number(kpi.ltvToCacRatio).toFixed(2)}x`, testid: 'bi-ratio' },
    { label: 'Churn Rate', value: `${Number(kpi.churnRatePercentage).toFixed(2)}%`, testid: 'bi-churn' },
    { label: 'Net Revenue', value: formatBiThb(kpi.netRevenue), testid: 'bi-net' },
  ];
  return (
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
      {cards.map((c) => (
        <div key={c.testid} data-testid={c.testid} style={{ border: '1px solid #334155', borderRadius: 8, padding: 12 }}>
          <div>{c.label}</div>
          <div data-testid={`${c.testid}-value`}>{c.value}</div>
        </div>
      ))}
    </div>
  );
}

function heatColor(pct: number): string {
  if (pct >= 75) return '#059669';
  if (pct >= 50) return '#65a30d';
  if (pct >= 25) return '#d97706';
  return '#7f1d1d';
}

export function CohortMatrix(props: { rows: CohortRowView[] }) {
  const { rows } = props;
  if (rows.length === 0) return <p>ยังไม่มีข้อมูล cohort</p>;
  const maxPeriods = Math.max(...rows.map((r) => r.retentionRates.length));
  return (
    <div style={{ overflowX: 'auto' }}>
      <table>
        <thead>
          <tr>
            <th>Cohort</th>
            <th>Users</th>
            {Array.from({ length: maxPeriods }, (_, p) => (
              <th key={p}>M{p}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.cohortDate} data-testid="cohort-row" data-cohort={r.cohortDate}>
              <td>{r.cohortDate}</td>
              <td data-testid="cohort-users">{r.totalUsers}</td>
              {Array.from({ length: maxPeriods }, (_, p) => {
                const cell = r.retentionRates.find((x) => x.periodIndex === p);
                return (
                  <td key={p} data-testid="cohort-cell" style={cell ? { background: heatColor(cell.activePercentage) } : undefined}>
                    {cell ? `${cell.activePercentage.toFixed(1)}%` : '—'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RevenueBreakdown(props: { data: RevenueBreakdownView }) {
  const { data } = props;
  const total = data.physicalBook + data.ebook + data.course + data.bundle;
  const rows = [
    { label: 'Physical Book', value: data.physicalBook },
    { label: 'E-Book', value: data.ebook },
    { label: 'Course', value: data.course },
    { label: 'Bundle', value: data.bundle },
  ];
  return (
    <div data-testid="revenue-breakdown">
      {rows.map((r) => (
        <div key={r.label}>
          <span>{r.label} {formatBiThb(r.value)}</span>
          <div aria-hidden style={{ height: 8, background: '#1e293b', borderRadius: 4 }}>
            <div data-testid="revenue-bar" style={{ width: `${total > 0 ? (r.value / total) * 100 : 0}%`, height: '100%', background: '#3b82f6', borderRadius: 4 }} />
          </div>
        </div>
      ))}
    </div>
  );
}
