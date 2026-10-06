// SSOT Phase 019 §6.1 — Dependency-free E-Receipt PDF builder (valid %PDF-1.4, no deps)
// Canonical: apps/backend/src/modules/notification/pdf/receipt-pdf.generator.ts
// (legacy src/backend/modules/notification/pdf/receipt-pdf.generator.ts)
// NOTE: Type1 Helvetica covers WinAnsi only — Thai glyphs cannot embed without a
// font binary, so amounts use THB prefix and titles are sanitized (documented
// limitation); the LINE Flex message carries full Thai display. The forensic
// line binds buyer-hash + paid date into the document bytes.
import { createHash } from 'node:crypto';

export interface ReceiptPdfItem {
  title: string;
  quantity: number;
  totalPrice: number;
}

export interface ReceiptPdfInput {
  orderNumber: string;
  tenantName: string;
  taxRegistrationNo?: string | null;
  buyerHash: string;
  paidAt: string;
  paymentMethod: string;
  items: ReceiptPdfItem[];
  netAmount: number;
  vatAmount: number;
}

/** WinAnsi-safe: escapes PDF delimiters, folds non-latin1 to '?'. */
export function sanitizePdfText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7E]/g, '?');
}

/** Forensic buyer reference: sha256(lineUserId) truncated (no PII in bytes). */
export function buyerRef(lineUserId: string): string {
  return createHash('sha256').update(lineUserId).digest('hex').slice(0, 16).toUpperCase();
}

const money = (n: number): string => `THB ${n.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

function contentLines(input: ReceiptPdfInput): string[] {
  const lines: string[] = [
    `E-RECEIPT  ${input.tenantName}`,
    `Order: ${input.orderNumber}   Paid: ${input.paidAt}`,
    `Payment: ${input.paymentMethod}   BuyerRef: ${input.buyerHash}`,
  ];
  if (input.taxRegistrationNo) lines.push(`Tax ID: ${input.taxRegistrationNo}`);
  lines.push('----------------------------------------');
  for (const i of input.items.slice(0, 40)) {
    lines.push(`${i.title} (x${i.quantity})  ${money(i.totalPrice)}`);
  }
  lines.push('----------------------------------------');
  lines.push(`VAT (incl): ${money(input.vatAmount)}   TOTAL: ${money(input.netAmount)}`);
  lines.push(`Forensic: ${input.buyerHash}-${input.paidAt}`);
  return lines.map(sanitizePdfText);
}

/** Builds a single-page A4 PDF; returns raw bytes (R2-ready). */
export function buildReceiptPdf(input: ReceiptPdfInput): Buffer {
  const text = contentLines(input);
  let y = 790;
  let stream = 'BT\n';
  for (const [ix, line] of text.entries()) {
    const font = ix === 0 ? 'F2' : 'F1';
    const size = ix === 0 ? 15 : 10;
    stream += `1 0 0 1 50 ${y} Tm\n/${font} ${size} Tf\n(${line}) Tj\n`;
    y -= ix === 0 ? 26 : 15;
  }
  stream += 'ET\n';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 6 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const [ix, body] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${ix + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xrefAt = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}
