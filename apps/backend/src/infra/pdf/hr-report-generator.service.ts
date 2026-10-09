// SSOT Phase 098 Task 6 — Executive PDF report generator (dep-free, R2-ready)
// Canonical: apps/backend/src/infra/pdf/hr-report-generator.service.ts
// - Minimal valid %PDF with Helvetica text lines (metrics + department
//   matrix + SHA-256 e-signature seal), same dep-free technique as 019.
// - Zero new deps (node:crypto only).
import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';

export interface HrReportInput {
  organizationId: string;
  companyName: string;
  totalSeats: number;
  usedSeats: number;
  utilization: number;
  completionRate: number;
  averageScore: number;
  passed: number;
  failed: number;
  departments: Array<{ departmentName: string; seats: number; active: number; averageScore: number }>;
  generatedAt?: string;
}

function pdfEscape(s: string): string {
  // Helvetica WinAnsi has no Thai glyphs — fold non-latin1 to '?' so the
  // /Length header always matches the emitted bytes (latin1 1:1).
  return s
    .replace(/[^\x20-\xFF]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .slice(0, 160);
}

@Injectable()
export class HrReportGeneratorService {
  build(input: HrReportInput): { pdf: Buffer; seal: string } {
    const at = input.generatedAt ?? new Date().toISOString();
    const lines = [
      'B2B Corporate Learning — Executive Report',
      `Company: ${input.companyName}`,
      `Seats: ${input.usedSeats}/${input.totalSeats} (${input.utilization}%)`,
      `Completion: ${input.completionRate}%  Avg score: ${input.averageScore}`,
      `Quiz passed: ${input.passed}  failed: ${input.failed}`,
      ...input.departments.slice(0, 20).map(
        (d) => `- ${d.departmentName}: ${d.active}/${d.seats} active, avg ${d.averageScore}`,
      ),
      `Generated: ${at}`,
    ];
    const seal = createHash('sha256')
      .update(`${input.organizationId}|${input.usedSeats}|${input.passed}|${input.failed}|${at}`)
      .digest('hex');
    lines.push(`e-Seal: ${seal.slice(0, 32)}...`);

    let y = 770;
    const text = lines.map((l) => `BT /F1 11 Tf 50 ${y = y - 18} Td (${pdfEscape(l)}) Tj ET`).join('\n');
    const content = `<< /Length ${text.length} >>\nstream\n${text}\nendstream`;
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      `5 0 obj\n${content}\nendobj`,
    ];
    // Assemble with xref (objects 1..4 inline, 5 embedded above).
    let pdf = '%PDF-1.4\n';
    const offsets: number[] = [];
    const body = objs.slice(0, 4).map((o, i) => `${i + 1} 0 obj\n${o}\nendobj\n`);
    for (const b of body) {
      offsets.push(pdf.length);
      pdf += b;
    }
    offsets.push(pdf.length);
    pdf += `${objs[4]}\n`;
    const xrefAt = pdf.length;
    pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n `).join('\n')}\n`;
    pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
    return { pdf: Buffer.from(pdf, 'latin1'), seal };
  }
}
