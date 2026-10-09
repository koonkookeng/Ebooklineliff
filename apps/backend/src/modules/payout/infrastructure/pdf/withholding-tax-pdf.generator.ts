// SSOT Phase 086 Task 5 — Withholding-tax PDF generator (delegated pipeline)
// Canonical: apps/backend/src/modules/payout/infrastructure/pdf/withholding-tax-pdf.generator.ts
// - Delegates bytes to the 082 PdfCompilerService (single PDF pipeline).
//   This file exists because the §5.1 tree names it — it adds no second
//   renderer (Zero Redundant).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { PdfCompilerService } from '../../../tax/infrastructure/pdf-generator/pdf-compiler.service';

@Injectable()
export class WithholdingTaxPdfGenerator {
  constructor(private readonly compiler: PdfCompilerService) {}

  compileCertificate(input: Parameters<PdfCompilerService['compile']>[0]): ReturnType<PdfCompilerService['compile']> {
    return this.compiler.compile(input);
  }
}
