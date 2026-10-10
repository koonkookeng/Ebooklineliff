// SSOT Phase 115 §6.1 — reconciliation dashboard widgets (dep-free)
// Canonical: apps/frontend/components/reconciliation/ReconciliationDashboard.tsx
// - KPI ribbon (match rate / totals / discrepancies / overrides) + split-pane
//   queue table (statements left, orders context right via matchedOrderNumber)
//   + status badges. CSS bars only (no recharts — bundle guard, 110 precedent).
// - Zero new deps (React only).
'use client';

import React from 'react';
import type { BankStatementView, ReconKpiView } from '../../lib/reconciliation/reconciliation-client';

export function statusBadge(status: string): { label: string; color: 'green' | 'amber' | 'red' | 'blue' | 'gray' } {
  if (status === 'AUTO_MATCHED') return { label: 'AUTO MATCHED', color: 'green' };
  if (status === 'DISCREPANCY_FLAGGED') return { label: 'DISCREPANCY', color: 'amber' };
  if (status === 'MANUAL_OVERRIDDEN') return { label: 'OVERRIDDEN', color: 'blue' };
  if (status === 'REJECTED_DUPLICATE') return { label: 'DUPLICATE', color: 'gray' };
  return { label: status, color: 'red' };
}

export function KpiRibbon(props: { kpi: ReconKpiView }) {
  const { kpi } = props;
  const cards = [
    { label: 'Auto Match Rate', value: `${kpi.autoMatchedRatePercentage.toFixed(1)}%`, testid: 'kpi-rate' },
    { label: 'Total Statements', value: String(kpi.totalStatementsCount), testid: 'kpi-total' },
    { label: 'Discrepancies', value: String(kpi.pendingDiscrepanciesCount), testid: 'kpi-pending' },
    { label: 'Manual Overrides', value: String(kpi.manualOverriddenCount), testid: 'kpi-overrides' },
  ];
  return (
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
      {cards.map((c) => (
        <div key={c.testid} data-testid={c.testid} style={{ border: '1px solid #334155', borderRadius: 8, padding: 12 }}>
          <div>{c.label}</div>
          <div data-testid={`${c.testid}-value`}>{c.value}</div>
          {c.testid === 'kpi-rate' && (
            <div aria-hidden style={{ height: 6, background: '#1e293b', borderRadius: 3, marginTop: 8 }}>
              <div style={{ width: `${Math.min(100, kpi.autoMatchedRatePercentage)}%`, height: '100%', background: '#10b981', borderRadius: 3 }} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function StatementQueueTable(props: {
  rows: BankStatementView[];
  onOverride: (stmt: BankStatementView) => void;
}) {
  const { rows, onOverride } = props;
  if (rows.length === 0) return <p>ไม่มีสเตทเมนท์ในคิว</p>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table>
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>TransRef</th>
            <th>Sender</th>
            <th>Amount (THB)</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const badge = statusBadge(s.status);
            return (
              <tr key={s.id} data-testid="stmt-row" data-status={s.status} data-color={badge.color}>
                <td>{new Date(s.txTimestamp).toLocaleString('th-TH')}</td>
                <td data-testid="stmt-ref">{s.transRef || 'N/A'}</td>
                <td>{s.senderName || 'Unknown'}</td>
                <td data-testid="stmt-amount">{Number(s.amount).toFixed(2)}</td>
                <td data-testid="stmt-status">{badge.label}{s.mismatchReason ? ` · ${s.mismatchReason}` : ''}</td>
                <td>
                  {s.status !== 'AUTO_MATCHED' && s.status !== 'MANUAL_OVERRIDDEN' && (
                    <button type="button" onClick={() => onOverride(s)}>
                      Manual Override
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
