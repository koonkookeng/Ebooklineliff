// SSOT Phase 086 Task 5 — 50 Tawi issuance on clearing success (delegated)
// Canonical: apps/backend/src/modules/payout/application/use-cases/generate-tax-pdf.use-case.ts
// - Delegates to the 082 TaxModule use-case (single PDF pipeline — §9 Zero
//   Redundant). Best-effort from the callback path: the 081 tax record
//   already exists, so failures never block SUCCESS.
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { Generate50TawiPdfUseCase } from '../../../tax/application/use-cases/generate-50-tawi-pdf.use-case';

@Injectable()
export class GenerateTaxPdfUseCase {
  constructor(private readonly tawi: Generate50TawiPdfUseCase) {}

  issueForPayout(args: {
    tenantId: string;
    actorUserId: string;
    grossAmount: number;
    incomeType?: string;
  }): Promise<{
    certificateId: string;
    certificateNo: string;
    downloadUrl: string;
    downloadExpiresInSec: number;
    pdfBytes: number;
    tookMs: number;
  }> {
    return this.tawi.execute({
      tenantId: args.tenantId,
      actorUserId: args.actorUserId,
      grossAmount: args.grossAmount,
      incomeType: args.incomeType,
    });
  }
}
