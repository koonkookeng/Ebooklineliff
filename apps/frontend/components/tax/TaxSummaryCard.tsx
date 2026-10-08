// SSOT Phase 082 §2.2 — Annual tax summary card (dep-free)
// Canonical: apps/frontend/components/tax/TaxSummaryCard.tsx
// - Year-to-date withheld totals; tenant vars (§2.1).
// - Zero-dep (React only).
'use client';

import React from 'react';
import type { TaxSummary } from '../../lib/tax/tax-client';

export function TaxSummaryCard({ summary }: { summary: TaxSummary }) {
  return (
    <div style={{ background: 'var(--finance-positive-color,#10B981)' }}>
      <p>ภาษีหัก ณ ที่จ่ายสะสม {summary.year}</p>
      <p>฿{summary.tax.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</p>
      <p>
        รายได้รวม ฿{summary.gross.toLocaleString('th-TH')} · {summary.count} เอกสาร
      </p>
    </div>
  );
}
