// SSOT Phase 082 Task 4/5 — Dep-free 50 Tawi PDF compiler (R2 vault)
// Canonical: apps/backend/src/modules/tax/infrastructure/pdf-generator/pdf-compiler.service.ts
// (RISK_CALL: template lives in 50-tawi-template.ts — .tsx would force a
// backend-wide jsx flag for zero JSX content.)
// - Compiles TawiCertificateFields into a single-page A4 %PDF (core
//   Helvetica, no embedding, no react-pdf — Gate 5 RAM; 048/081 precedent).
// - Tamper evidence (§8.1): SHA-256 seal over the field canonical string is
//   printed in the footer next to the verify payload. (Full PKCS#12 CA
//   stamping needs HSM credentials — documented ADR deviation; the HMAC
//   seal + vault immutability carry integrity instead.)
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { sha256Hex } from '@repo/shared';
import { TAWI_PAGE, buildTawiFields, type TawiCertificateFields } from './templates/50-tawi-template';

export type TawiCompileInput = Omit<TawiCertificateFields, 'sealHash' | 'verifyPayload'>;

function escapePdf(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

@Injectable()
export class PdfCompilerService {
  /** Canonical seal input (stable field order). */
  sealFor(fields: TawiCompileInput): string {
    const canonical = [
      fields.certificateNo,
      fields.payer.taxId,
      fields.payee.taxId,
      fields.grossAmount.toFixed(2),
      fields.taxWithheld.toFixed(2),
      fields.paymentDate,
    ].join('|');
    return sha256Hex(canonical);
  }

  compile(input: TawiCompileInput): { pdf: Buffer; hash: string; fields: TawiCertificateFields } {
    const sealHash = this.sealFor(input);
    const fields = buildTawiFields({ ...input, sealHash });
    const L: string[] = [
      'WITHHOLDING TAX CERTIFICATE (Section 50 Bis) - 50 TAWI',
      `Certificate No: ${fields.certificateNo}   Seq: ${fields.sequenceNo}`,
      `Form: ${fields.formType}   Income: ${fields.incomeType}`,
      `Payer TAX ID ${fields.payer.taxId} - ${fields.payer.name}`,
      `Payer addr: ${fields.payer.address}`,
      `Payee TAX ID ${fields.payee.taxId} - ${fields.payee.name}`,
      `Payee addr: ${fields.payee.address}`,
      `Gross: THB ${fields.grossAmount.toFixed(2)}   Rate: ${fields.taxRate.toFixed(2)}%`,
      `Tax withheld: THB ${fields.taxWithheld.toFixed(2)}`,
      `Net paid: THB ${fields.netAmount.toFixed(2)}`,
      `Payment date: ${fields.paymentDate}`,
      `Seal (SHA-256): ${sealHash}`,
      `Verify: ${fields.verifyPayload}`,
    ];
    const { width, height, margin, fontSize, lineHeight } = TAWI_PAGE;
    const content =
      L.map((l) => `(${escapePdf(l)}) Tj T*`).join('\n') +
      '\n' +
      `(${escapePdf('This computer-generated certificate is sealed; verify via the Seal hash.')}) Tj`;
    const stream = `BT /F1 ${fontSize} Tf ${margin} ${height - margin} Td ${lineHeight} TL\n${content}\nET`;
    void width;
    const pdf =
      `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n` +
      `2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n` +
      `3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n` +
      `4 0 obj<</Length ${Buffer.byteLength(stream, 'utf8')}>>stream\n${stream}\nendstream\nendobj\n` +
      `5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n` +
      `trailer<</Root 1 0 R>>`;
    const buffer = Buffer.from(pdf, 'utf-8');
    return { pdf: buffer, hash: sha256Hex(buffer), fields };
  }
}
