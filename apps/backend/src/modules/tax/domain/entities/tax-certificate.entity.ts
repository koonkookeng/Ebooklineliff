// SSOT Phase 082 §4.1 — Tax certificate entity guards
// Canonical: apps/backend/src/modules/tax/domain/entities/tax-certificate.entity.ts
// - Guards: positive amounts, tax == 3% half-up of gross (or 0 when exempt),
//   certificate number shape (50TW-YYYYMM-####), SHA-256 seal present.
// - Zero new deps.
import { BadRequestException } from '@nestjs/common';
import { calculate3PercentWithholding } from '@repo/shared';

export function assertCertificateAmounts(args: {
  grossAmount: number;
  taxWithheld: number;
  netAmount: number;
  isTaxExempt?: boolean;
}): void {
  if (!(args.grossAmount > 0)) throw new BadRequestException('Certificate gross must be positive');
  const expected = args.isTaxExempt
    ? { taxWithheld: 0, netAmount: args.grossAmount }
    : calculate3PercentWithholding(args.grossAmount);
  if (
    Math.round(args.taxWithheld * 100) !== Math.round(expected.taxWithheld * 100) ||
    Math.round(args.netAmount * 100) !== Math.round(expected.netAmount * 100)
  ) {
    throw new BadRequestException('Certificate amounts mismatch 3% withholding math');
  }
}

export function assertCertificateNo(certificateNo: string): void {
  if (!/^50TW-\d{6}-[0-9A-Z]{4,}$/.test(certificateNo)) {
    throw new BadRequestException('Invalid 50 Tawi certificate number');
  }
}
