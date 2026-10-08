// SSOT Phase 081 Task 5 — 3% e-Withholding tax engine + certificate PDF
// Canonical: apps/backend/src/modules/finance/application/tax-calculator.service.ts
// - withholdingFor: §8.2 formula (T = gross × 0.03, net = gross − T).
// - issueCertificate: persists the WithholdingTaxRecord (Gate 8 input for
//   Revenue Department reporting) and uploads a dep-free %PDF certificate
//   to the R2 vault (048 dep-free PDF precedent; R2 zero-egress).
// - Port-based for DB-free tests. Zero new deps.
import { Injectable } from '@nestjs/common';
import { FINANCE_WITHHOLDING_TAX_RATE, taxCertificateNo, withholdingSplit } from '@repo/shared';
import type { LedgerRepository } from '../infrastructure/prisma-ledger.repository';

export interface R2TaxVault {
  putObjectBuffer(objectKey: string, body: Buffer, contentType: string): Promise<{ eTag: string }>;
}

function taxPdfBytes(args: {
  certificateNo: string;
  payeeName: string;
  taxId: string;
  grossAmount: number;
  taxAmount: number;
  netAmount: number;
  issuedAt: string;
}): Buffer {
  const lines = [
    'EBOOK-LIFF E-WITHHOLDING TAX CERTIFICATE (PND)',
    `Certificate No: ${args.certificateNo}`,
    `Payee: ${args.payeeName} (TAX ID ${args.taxId})`,
    `Income: COMMISSION_AND_PROFESSIONAL_FEE`,
    `Gross: THB ${args.grossAmount.toFixed(2)}`,
    `Tax withheld (3%): THB ${args.taxAmount.toFixed(2)}`,
    `Net transferred: THB ${args.netAmount.toFixed(2)}`,
    `Issued: ${args.issuedAt}`,
  ];
  const content = lines.map((l) => `(${l.replace(/[()\\]/g, ' ')}) Tj T*`).join('\n');
  const pdf =
    `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n` +
    `2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n` +
    `3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n` +
    `4 0 obj<</Length ${content.length + 45}>>stream\nBT /F1 11 Tf 72 760 Td 13 TL\n${content}\nET\nendstream\nendobj\n` +
    `5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n` +
    `trailer<</Root 1 0 R>>`;
  return Buffer.from(pdf, 'utf-8');
}

@Injectable()
export class TaxCalculatorService {
  constructor(
    private readonly repo: LedgerRepository,
    private readonly r2: R2TaxVault,
  ) {}

  withholdingFor(grossAmount: number): { tax: number; net: number; rate: number } {
    const { tax, net } = withholdingSplit(grossAmount);
    return { tax, net, rate: FINANCE_WITHHOLDING_TAX_RATE };
  }

  async issueCertificate(args: {
    payoutTransactionId: string;
    taxId: string;
    payeeName: string;
    payeeAddress: string;
    grossAmount: number;
    tenantId: string;
  }): Promise<{ certificateNo: string; pdfStoragePathR2: string; taxAmount: number }> {
    const { tax } = withholdingSplit(args.grossAmount);
    const certificateNo = taxCertificateNo();
    const pdfStoragePathR2 = `tenants/${args.tenantId}/tax/${certificateNo}.pdf`;
    const issuedAt = new Date().toISOString();
    await this.r2.putObjectBuffer(
      pdfStoragePathR2,
      taxPdfBytes({
        certificateNo,
        payeeName: args.payeeName,
        taxId: args.taxId,
        grossAmount: args.grossAmount,
        taxAmount: tax,
        netAmount: Math.round((args.grossAmount - tax) * 100) / 100,
        issuedAt,
      }),
      'application/pdf',
    );
    await this.repo.createTaxRecord({
      payoutTransactionId: args.payoutTransactionId,
      taxCertificateNo: certificateNo,
      taxId: args.taxId,
      payeeName: args.payeeName,
      payeeAddress: args.payeeAddress,
      grossAmount: args.grossAmount,
      taxAmount: tax,
      pdfStoragePathR2,
    });
    return { certificateNo, pdfStoragePathR2, taxAmount: tax };
  }
}
