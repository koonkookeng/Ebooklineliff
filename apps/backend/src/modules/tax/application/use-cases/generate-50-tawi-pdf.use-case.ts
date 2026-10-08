// SSOT Phase 082 BDD-2/Task 4-5 — 50 Tawi PDF generation use-case (<500ms)
// Canonical: apps/backend/src/modules/tax/application/use-cases/generate-50-tawi-pdf.use-case.ts
// - Flow: verified-profile gate (ERROR asks for KYC update, §2.2) -> amounts
//   guard (3% math) -> cert numbering -> dep-free PDF compile -> SHA-256 seal
//   -> R2 vault put (zero-egress) -> atomic certificate row -> budget check
//   (<500ms §10; overruns emit a slow-pdf stream note, never fail the doc).
// - Port-based for DB-free tests. Zero new deps.
import { BadRequestException, Injectable } from '@nestjs/common';
import {
  TAX_PDF_BUDGET_MS,
  TAX_WITHHELD_STREAM,
  calculate3PercentWithholding,
  signDownloadTicket,
  tawiCertificateNo,
  verifyThaiTaxId,
} from '@repo/shared';
import { assertCertificateAmounts, assertCertificateNo } from '../../domain/entities/tax-certificate.entity';
import { PdfCompilerService } from '../../infrastructure/pdf-generator/pdf-compiler.service';
import type { TaxRepository } from '../../infrastructure/repositories/tax-prisma.repository';

export interface TawiBus {
  xadd(stream: string, fields: Record<string, string | number>): Promise<unknown>;
}

export interface TawiR2Vault {
  putObjectBuffer(objectKey: string, body: Buffer, contentType: string): Promise<{ eTag: string }>;
  presignedGetUrl(objectKey: string, expiresInSeconds: number): string;
}

export interface TawiTx {
  run<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}

const PAYER_FALLBACK = { taxId: '0000000000000', name: 'EBOOK-LIFF PLATFORM', address: 'Bangkok, TH' };

@Injectable()
export class Generate50TawiPdfUseCase {
  constructor(
    private readonly repo: TaxRepository,
    private readonly pdf: PdfCompilerService,
    private readonly r2: TawiR2Vault,
    private readonly tx: TawiTx,
    private readonly bus: TawiBus,
    private readonly downloadSecret: string = process.env['TAX_TICKET_SECRET'] || process.env['JWT_SECRET'] || 'secret-key-144-xz',
  ) {}

  async execute(args: {
    tenantId: string;
    actorUserId: string;
    grossAmount: number;
    incomeType?: string;
    formType?: string;
    payer?: { taxId: string; name: string; address: string };
  }): Promise<{
    certificateId: string;
    certificateNo: string;
    downloadUrl: string;
    downloadExpiresInSec: number;
    pdfBytes: number;
    tookMs: number;
  }> {
    const t0 = Date.now();
    if (!(args.grossAmount > 0)) throw new BadRequestException('Gross amount must be positive');
    const profile = await this.repo.findProfile(args.actorUserId);
    if (!profile) throw new BadRequestException('Update your tax profile (ID/tax number) first');
    if (!verifyThaiTaxId(profile.taxId)) throw new BadRequestException('Update your tax profile (ID/tax number) first');

    const calc = profile.isTaxExempt
      ? { grossAmount: args.grossAmount, taxRate: 0, taxWithheld: 0, netAmount: args.grossAmount }
      : calculate3PercentWithholding(args.grossAmount);
    assertCertificateAmounts({
      grossAmount: calc.grossAmount,
      taxWithheld: calc.taxWithheld,
      netAmount: calc.netAmount,
      isTaxExempt: profile.isTaxExempt,
    });

    const { certificateNo, sequenceNo } = tawiCertificateNo(t0);
    assertCertificateNo(certificateNo);
    const payer = args.payer ?? PAYER_FALLBACK;
    const compiled = this.pdf.compile({
      certificateNo,
      sequenceNo,
      formType: args.formType ?? 'PND_3',
      incomeType: args.incomeType ?? 'CREATOR_SHARE_40_8',
      payer,
      payee: {
        taxId: profile.taxId,
        name: profile.fullNameOrCompanyName,
        address: profile.address,
        payerType: (profile.payerType === 'JURISTIC_PERSON' ? 'JURISTIC_PERSON' : 'INDIVIDUAL') as 'INDIVIDUAL' | 'JURISTIC_PERSON',
      },
      grossAmount: calc.grossAmount,
      taxRate: calc.taxRate,
      taxWithheld: calc.taxWithheld,
      netAmount: calc.netAmount,
      paymentDate: new Date(t0).toISOString(),
    });

    const objectKey = `tenants/${args.tenantId}/tax/${certificateNo}.pdf`;
    await this.r2.putObjectBuffer(objectKey, compiled.pdf, 'application/pdf');
    const row = await this.tx.run(async (tx) => {
      const repo = this.repo.withTx ? this.repo.withTx(tx) : this.repo;
      return repo.createCertificate({
        certificateNo,
        tenantId: args.tenantId,
        userId: args.actorUserId,
        taxProfileId: profile.id,
        formType: args.formType ?? 'PND_3',
        incomeType: args.incomeType ?? 'CREATOR_SHARE_40_8',
        grossAmount: calc.grossAmount,
        taxWithheld: calc.taxWithheld,
        netAmount: calc.netAmount,
        pdfStoragePathR2: objectKey,
        pdfFileHash: compiled.hash,
      });
    });

    const tookMs = Date.now() - t0;
    const downloadExpiresInSec = 15 * 60;
    const ticket = signDownloadTicket(this.downloadSecret, row.id);
    const downloadUrl = `${objectKey}?ticket=${ticket}`;
    await this.bus
      .xadd(TAX_WITHHELD_STREAM, {
        event: 'TAX_50TAWI_ISSUED',
        certificateId: row.id,
        certificateNo,
        userId: args.actorUserId,
        tookMs,
        slow: tookMs > TAX_PDF_BUDGET_MS ? 1 : 0,
        at: Date.now(),
      })
      .catch(() => undefined);
    return {
      certificateId: row.id,
      certificateNo,
      downloadUrl,
      downloadExpiresInSec,
      pdfBytes: compiled.pdf.length,
      tookMs,
    };
  }
}
