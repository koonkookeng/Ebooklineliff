// SSOT Phase 114 §6.1 — clearing summary cards + trace modal (dep-free)
// Canonical: apps/frontend/components/clearing/ClearingSummaryCards.tsx
// - 4 metric cards (gross/escrow/platform/tax) with 2-decimal BigNumber
//   formatting; every amount click opens the audit trace modal (§2.1).
//   No recharts (bundle guard, 110 precedent — CSS bars only).
// - Zero new deps (React only).
'use client';

import React, { useState } from 'react';
import { formatThb, type FinancialSummaryView, type LedgerRowView } from '../../lib/clearing/clearing-client';

export function ClearingSummaryCards(props: {
  summary: FinancialSummaryView;
  ledger: LedgerRowView[];
  onTrace: (accountType: string) => LedgerRowView[];
}) {
  const { summary, onTrace } = props;
  const [traceAccount, setTraceAccount] = useState<string | null>(null);
  const [traceRows, setTraceRows] = useState<LedgerRowView[]>([]);

  function openTrace(accountType: string) {
    setTraceAccount(accountType);
    setTraceRows(onTrace(accountType));
  }

  const cards: Array<{ label: string; value: number; testid: string; account: string }> = [
    { label: 'Total Gross Cashflow', value: summary.totalGrossCashflow, testid: 'metric-gross', account: 'CASH_ASSET' },
    { label: 'Escrow Funds Held', value: summary.totalEscrowHeld, testid: 'metric-escrow', account: 'ESCROW_LIABILITY' },
    { label: 'Platform Net Revenue', value: summary.totalPlatformRevenue, testid: 'metric-platform', account: 'PLATFORM_REVENUE' },
    { label: '3% Tax Withheld', value: summary.totalTaxWithheld, testid: 'metric-tax', account: 'TAX_WITHHOLDING_PAYABLE' },
  ];

  return (
    <div>
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
        {cards.map((c) => (
          <button key={c.testid} type="button" data-testid={c.testid} onClick={() => openTrace(c.account)} style={{ textAlign: 'left', border: '1px solid #334155', borderRadius: 8, padding: 12 }}>
            <div>{c.label}</div>
            <div data-testid={`${c.testid}-value`}>{formatThb(c.value)}</div>
          </button>
        ))}
      </div>
      {traceAccount && (
        <div role="dialog" aria-label={`Audit trace ${traceAccount}`} style={{ border: '1px solid #334155', borderRadius: 8, padding: 12, marginTop: 12 }}>
          <h3>Audit trace · {traceAccount} ({traceRows.length})</h3>
          <ul>
            {traceRows.map((r) => (
              <li key={r.id}>
                {r.entryType} {formatThb(r.amount)} — {r.description}
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => setTraceAccount(null)}>ปิด</button>
        </div>
      )}
    </div>
  );
}
