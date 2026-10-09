// SSOT Phase 086 §5.1 — Payout calculator entity (single-source 3% math)
// Canonical: apps/backend/src/modules/payout/domain/entities/payout-calculator.entity.ts
// - Delegates to finance-contract §8.2 (withholdingSplit) — zero new math
//   (§9 Zero Redundant). Fee is 0.00 (spec §5.2).
// - Zero new deps.
import { BadRequestException } from '@nestjs/common';
import { withholdingSplit } from '@repo/shared';

export interface PayoutCalculation {
  grossAmount: number;
  taxWithheldAmount: number;
  feeAmount: number;
  netPayableAmount: number;
}

export function calculatePayout(grossAmount: number): PayoutCalculation {
  if (!(grossAmount > 0)) throw new BadRequestException('Payout amount must be positive');
  const { tax, net } = withholdingSplit(grossAmount);
  return { grossAmount, taxWithheldAmount: tax, feeAmount: 0, netPayableAmount: net };
}
