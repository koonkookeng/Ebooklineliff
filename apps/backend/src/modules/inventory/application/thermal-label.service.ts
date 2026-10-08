// SSOT Phase 075 Task 6 — Batch thermal label engine (PDF/ZPL/TSPL -> R2)
// Canonical: apps/backend/src/modules/inventory/application/thermal-label.service.ts
// - PDF_A6: dep-free single-page %PDF (019 pattern); ZPL_4X6 / TSPL_100X150:
//   plain-text command streams for thermal printers.
// - Vault: putObjectBuffer to tenants/{tenant}/labels/ + presigned GET
//   (zero-egress, Gate 6). Only tenant-owned orders render (BDD-1).
// - Zero new deps.
import { BadRequestException, Injectable } from '@nestjs/common';
import { ThermalLabelPrintRequestSchema } from '@repo/shared';
import type { WarehouseInventoryRepository } from '../domain/warehouse-stock.repository';
import { R2StorageService } from '../../../infra/cloudflare/r2-storage.service';

function sanitize(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[^\x20-\x7E]/g, '?');
}

function pageStream(lines: string[]): string {
  let y = 380;
  let stream = 'BT\n';
  for (const [ix, line] of lines.entries()) {
    stream += `1 0 0 1 30 ${y} Tm\n/F${ix === 0 ? 2 : 1} ${ix === 0 ? 14 : 10} Tf\n(${sanitize(line)}) Tj\n`;
    y -= ix === 0 ? 24 : 14;
  }
  return `${stream}ET\n`;
}

function buildLabelPdf(pages: string[][]): Buffer {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>'];
  const pageRefs: string[] = [];
  const contents: string[] = pages.map((lines) => pageStream(lines));
  pages.forEach((_, i) => {
    // Per page: Page(3+3i), Font(4+3i), FontB(5+3i), Content(6+3i)... computed below.
    pageRefs.push(`${3 + i * 4} 0 R`);
  });
  objects.push(`<< /Type /Pages /Kids [${pageRefs.join(' ')}] /Count ${pages.length} >>`);
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

function buildZpl(orderNumber: string, tracking: string): string {
  return `^XA^FO30,30^A0N,40,40^FD${orderNumber}^FS^FO30,90^A0N,30,30^FD${tracking}^FS^FO30,130^BY3^BCN,80,Y,N,N^FD${tracking}^FS^XZ`;
}

function buildTspl(orderNumber: string, tracking: string): string {
  return `SIZE 100 mm,150 mm\nTEXT 30,30,"3",0,1,1,"${orderNumber}"\nTEXT 30,80,"2",0,1,1,"${tracking}"\nBARCODE 30,120,"128",80,1,0,2,2,"${tracking}"\nPRINT 1\n`;
}

@Injectable()
export class ThermalLabelService {
  constructor(
    private readonly repo: WarehouseInventoryRepository,
    private readonly r2: R2StorageService,
  ) {}

  async generateBatch(tenantId: string, body: unknown): Promise<{ objectKey: string; downloadUrl: string; count: number }> {
    const parsed = ThermalLabelPrintRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid label request');
    const orders = await this.repo.findOrdersForLabels(parsed.data.orderIds, tenantId);
    if (orders.length === 0) throw new BadRequestException('No tenant orders found.');
    const stamp = Date.now();
    const ext = parsed.data.labelFormat === 'PDF_A6' ? 'pdf' : 'txt';
    const objectKey = `tenants/${tenantId}/labels/batch-${stamp}.${ext}`;
    let bytes: Buffer;
    let contentType = 'application/pdf';
    if (parsed.data.labelFormat === 'PDF_A6') {
      const pages = orders.map((o) => [
        `ORDER ${o.orderNumber}`,
        `Tracking: ${o.trackingNumber ?? '-'}`,
        ...(parsed.data.includePackingList ? ['Packing list enclosed'] : []),
      ]);
      bytes = buildLabelPdf(pages);
    } else {
      const text = orders
        .map((o) =>
          parsed.data.labelFormat === 'ZPL_4X6'
            ? buildZpl(o.orderNumber, o.trackingNumber ?? o.id)
            : buildTspl(o.orderNumber, o.trackingNumber ?? o.id),
        )
        .join('\n');
      bytes = Buffer.from(text, 'utf8');
      contentType = 'text/plain';
    }
    await this.r2.putObjectBuffer(objectKey, bytes, contentType);
    return { objectKey, downloadUrl: this.r2.presignedGetUrl(objectKey, 3600), count: orders.length };
  }
}
