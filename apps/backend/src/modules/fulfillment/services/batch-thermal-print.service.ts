// SSOT Phase 076 BDD-2 — Batch thermal label print service (TSPL/PDF -> R2)
// Canonical: apps/backend/src/modules/fulfillment/services/batch-thermal-print.service.ts
// - printBatch: Zod gate -> booked-only items (tenant-owned) -> TSPL 100x150
//   stream + dep-free PDF (075 engine pattern, label-sized) -> R2 vault with
//   24h lifecycle note -> LABEL_GENERATED (+PRINTED when autoUpdate).
// - HMAC-SHA256 QR token per label (Gate 4). Blob GC is client-side (Gate 5).
// - Port-based (repo/R2) for DB-free tests. Zero new deps.
import { BadRequestException, Injectable } from '@nestjs/common';
import { BatchPrintRequestSchema, buildTsplLabel } from '@repo/shared';
import { signLabelToken } from '../domain/fulfillment.entity';
import type { FulfillmentRepository } from '../domain/fulfillment.repository';

export interface PrintR2 {
  putObjectBuffer(objectKey: string, body: Buffer, contentType: string): Promise<unknown>;
  presignedGetUrl(objectKey: string, expiresInSeconds: number): string;
}

function sanitize(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[^\x20-\x7E]/g, '?');
}

function pageStream(lines: string[]): string {
  let y = 400;
  let stream = 'BT\n';
  for (const [ix, line] of lines.entries()) {
    stream += `1 0 0 1 30 ${y} Tm\n/F${ix === 0 ? 2 : 1} ${ix === 0 ? 14 : 10} Tf\n(${sanitize(line)}) Tj\n`;
    y -= ix === 0 ? 24 : 13;
  }
  return `${stream}ET\n`;
}

/** Dep-free single-PDF with one 100x150mm page per label (A6-ish 298x420pt). */
function buildLabelPdf(pages: string[][]): Buffer {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>'];
  const refs: string[] = [];
  const contents: string[] = pages.map((lines) => pageStream(lines));
  pages.forEach((_, i) => { refs.push(`${3 + i * 4} 0 R`); });
  objects.push(`<< /Type /Pages /Kids [${refs.join(' ')}] /Count ${pages.length} >>`);
  pages.forEach((_, i) => {
    const base = 3 + i * 4;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 298 420] /Resources << /Font << /F1 ${base + 1} 0 R /F2 ${base + 2} 0 R >> >> /Contents ${base + 3} 0 R >>`,
    );
    objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
    objects.push(`<< /Length ${Buffer.byteLength(contents[i] ?? '', 'utf8')} >>\nstream\n${contents[i] ?? ''}endstream`);
  });
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

@Injectable()
export class BatchThermalPrintService {
  constructor(
    private readonly repo: FulfillmentRepository,
    private readonly r2: PrintR2,
    private readonly hmacSecret: string,
  ) {}

  async printBatch(tenantId: string, body: unknown): Promise<{
    success: boolean;
    totalProcessed: number;
    failedOrders: Array<{ orderId: string; reason: string }>;
    objectKey: string;
    downloadUrl: string;
    rawTsplCommands: string;
  }> {
    const parsed = BatchPrintRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid batch print payload');
    const { orderIds, courierProvider, labelDpi, autoUpdateStatusToPrinted } = parsed.data;

    const items = await this.repo.bookedItems([...new Set(orderIds)], tenantId);
    const byId = new Map(items.map((i) => [i.orderId, i]));
    const failedOrders: Array<{ orderId: string; reason: string }> = [];
    const printable: typeof items = [];
    for (const orderId of new Set(orderIds)) {
      const row = byId.get(orderId);
      if (!row) { failedOrders.push({ orderId, reason: 'Not booked for this tenant' }); continue; }
      printable.push(row);
    }
    if (printable.length === 0) throw new BadRequestException('No booked tenant orders to print.');

    const tsplPrograms = printable.map((o) =>
      buildTsplLabel({
        senderName: tenantId,
        senderPhone: '-',
        senderAddress: tenantId,
        recipientName: o.recipientName,
        recipientPhone: o.recipientPhone,
        recipientAddress: o.shippingAddress,
        postalCode: o.postalCode,
        trackingNumber: o.trackingNumber,
        sortingCode: o.sortingCode ?? o.courierProvider.slice(0, 2),
        orderNumber: o.orderNumber,
        dpi: labelDpi,
      }),
    );
    const rawTsplCommands = tsplPrograms.join('\n');

    const sender = `FROM ${tenantId}`;
    const pages = printable.map((o) => {
      const token = signLabelToken(this.hmacSecret, o.orderId, o.trackingNumber, tenantId);
      return [
        `ORDER ${o.orderNumber} [${courierProvider}]`,
        sender,
        `TO: ${o.recipientName} (${o.recipientPhone})`,
        o.shippingAddress,
        `ZIP: ${o.postalCode} SORT: ${o.sortingCode ?? '-'}`,
        `TRACK: ${o.trackingNumber}`,
        `QR:${token.slice(0, 32)}`,
      ];
    });
    const pdf = buildLabelPdf(pages);
    const stamp = Date.now();
    const objectKey = `tenants/${tenantId}/labels/fulfillment-${stamp}.pdf`;
    await this.r2.putObjectBuffer(objectKey, pdf, 'application/pdf');

    for (const o of printable) {
      await this.repo.markLabel({ orderId: o.orderId, labelUrl: objectKey, printed: autoUpdateStatusToPrinted });
    }

    return {
      success: failedOrders.length === 0,
      totalProcessed: printable.length,
      failedOrders,
      objectKey,
      downloadUrl: this.r2.presignedGetUrl(objectKey, 86400),
      rawTsplCommands,
    };
  }
}
