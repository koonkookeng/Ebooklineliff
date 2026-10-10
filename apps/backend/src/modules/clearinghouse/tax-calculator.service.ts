// SSOT Phase 114 Task 3 §8.1 — withholding-tax facade (082 single source)
// Canonical: apps/backend/src/modules/clearinghouse/tax-calculator.service.ts
// (legacy src/backend/modules/clearinghouse/tax-calculator.service.ts)
// - Zero-duplication facade over 082 calculate3PercentWithholding (the repo
//   §9 single source; 081 withholdingSplit is tier vocabulary — different
//   lane). 10000 → { tax: 300, net: 9700 }. Certificate PDFs stay in the 082
//   lane (staged stream handoff, never recompiled here).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { calculate3PercentWithholding, TAX_STANDARD_RATE } from '@repo/shared';

export interface WithholdingQuote {
  grossAmount: number;
  taxRatePercent: number;
  taxAmount: number;
  netAmount: number;
}

@Injectable()
export class ClearinghouseTaxService {
  quote(grossAmount: number): WithholdingQuote {
    // 082 returns taxRate already in percent points (3.0) — pass through.
    const calc = calculate3PercentWithholding(grossAmount);
    return {
      grossAmount: calc.grossAmount,
      taxRatePercent: calc.taxRate,
      taxAmount: calc.taxWithheld,
      netAmount: calc.netAmount,
    };
  }

  standardRate(): number {
    return TAX_STANDARD_RATE * 100;
  }
}
