// SSOT Phase 082 §6.1/§9 — Tax calculator domain service (SINGLE tax-math source)
// Canonical: apps/backend/src/modules/tax/domain/services/tax-calculator.domain-service.ts
// - §9 Zero-Redundant policy: every module (081 finance included) computes
//   withholding through calculate3PercentWithholding — spec-§6.1 verbatim
//   math (EPSILON half-up, 10000 → 300/9700).
// - verifyThaiTaxId gates profiles; exempt profiles resolve rate 0.
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { calculate3PercentWithholding, verifyThaiTaxId } from '@repo/shared';

export type TaxPayerKind = 'INDIVIDUAL' | 'JURISTIC_PERSON';

@Injectable()
export class TaxCalculatorDomainService {
  static calculate3PercentWithholding(
    grossAmount: number,
    payerType: TaxPayerKind = 'INDIVIDUAL',
  ): { grossAmount: number; taxRate: number; taxWithheld: number; netAmount: number } {
    return calculate3PercentWithholding(grossAmount, payerType);
  }

  /** Effective rate: exempt profiles withhold 0, everyone else 3%. */
  static effectiveRate(isTaxExempt: boolean): number {
    return isTaxExempt ? 0 : 0.03;
  }

  static isValidTaxId(taxId: string): boolean {
    return verifyThaiTaxId(taxId);
  }

  calculate(
    grossAmount: number,
    opts: { payerType?: TaxPayerKind; isTaxExempt?: boolean } = {},
  ): { grossAmount: number; taxRate: number; taxWithheld: number; netAmount: number } {
    if (opts.isTaxExempt) {
      if (!(grossAmount > 0)) throw new Error('Gross amount must be positive');
      return { grossAmount, taxRate: 0, taxWithheld: 0, netAmount: grossAmount };
    }
    return calculate3PercentWithholding(grossAmount, opts.payerType ?? 'INDIVIDUAL');
  }
}
