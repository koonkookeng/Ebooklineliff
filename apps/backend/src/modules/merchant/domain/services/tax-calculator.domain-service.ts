// SSOT Phase 073 §5 — Tax calculator domain service (3% e-Withholding)
// Canonical: apps/backend/src/modules/merchant/domain/services/tax-calculator.domain-service.ts
// - Thin DDD wrapper over the shared pure math (single decimal-2 source in
//   @repo/shared merchant-contract; Zero Redundant with finance 081 later).
// - BDD-3: gross 50000 -> tax 1500 + fee 10 -> net 48490.
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { netPayoutFor, toBaht, withholdingTaxFor } from '@repo/shared';

export interface PayoutBreakdown {
  gross: number;
  tax: number;
  fee: number;
  net: number;
}

@Injectable()
export class MerchantTaxCalculator {
  withholdingFor(grossAmount: number): number {
    return withholdingTaxFor(toBaht(grossAmount));
  }

  breakdown(grossAmount: number): PayoutBreakdown {
    const gross = toBaht(grossAmount);
    const { tax, fee, net } = netPayoutFor(gross);
    return { gross, tax, fee, net };
  }
}
