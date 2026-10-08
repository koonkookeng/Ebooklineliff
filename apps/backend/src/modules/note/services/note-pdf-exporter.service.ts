// SSOT Phase 065 Task 7 — Note PDF exporter (dep-free %PDF + R2 zero-egress)
// Canonical: apps/backend/src/modules/note/services/note-pdf-exporter.service.ts
// (legacy src/backend/modules/note/services/note-pdf-exporter.service.ts)
// - Reuses the Phase 019 dep-free %PDF-1.4 pattern (multi-page; Helvetica
//   WinAnsi — Thai folds to '?', full Thai rides the LINE Flex message).
// - Forensic footer: sha256(lineUserId)[:16] + export timestamp (Gate 4/8).
// - Uploads via R2StorageService.putObjectBuffer, returns a short-lived
//   presigned GET URL (zero egress via Cloudflare CDN).
// - tsx-safe structural R2 port. Zero new deps.
import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { formatNoteTimestamp } from '@repo/shared';

export interface NotePdfItem {
  timestampSec: number;
  content: string;
}

export interface NoteR2Port {
  putObjectBuffer(objectKey: string, body: Buffer, contentType: string): Promise<unknown>;
  presignedGetUrl(objectKey: string, expiresInSeconds: number, contentType?: string): string;
}

/** WinAnsi-safe: escapes PDF delimiters, folds non-latin1 to '?'. */
export function sanitizeNotePdfText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7E]/g, '?');
}

export function noteUserRef(userId: string): string {
  return createHash('sha256').update(userId).digest('hex').slice(0, 16).toUpperCase();
}

function wrapLines(text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      if ((line + ' ' + word).trim().length > width) {
        out.push(line.trim());
        line = word;
      } else {
        line += ' ' + word;
      }
    }
    if (line.trim()) out.push(line.trim());
  }
  return out;
}

/** Builds a multi-page A4 PDF; returns raw bytes (R2-ready). */
export function buildNotesPdf(title: string, items: NotePdfItem[], forensic: string): Buffer {
  const raw: string[] = [`LESSON NOTES  ${title}`, `Forensic: ${forensic}`, '----------------------------------------'];
  for (const item of items.slice(0, 200)) {
    raw.push(`[${formatNoteTimestamp(item.timestampSec)}]`);
    raw.push(...wrapLines(item.content, 90).slice(0, 12));
    raw.push('');
  }
  const lines = raw.map(sanitizeNotePdfText);
  const perPage = 52;
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += perPage) pages.push(lines.slice(i, i + perPage));
  if (pages.length === 0) pages.push(['(empty)']);

  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const streams: string[] = [];
  pages.forEach((pageLines, pi) => {
    let stream = 'BT\n';
    let y = 790;
    pageLines.forEach((line, ix) => {
      const first = pi === 0 && ix === 0;
      stream += `1 0 0 1 50 ${y} Tm\n/${first ? 'F2' : 'F1'} ${first ? 15 : 10} Tf\n(${line}) Tj\n`;
      y -= first ? 26 : 15;
    });
    stream += 'ET\n';
    streams.push(stream);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 3 0 R >> >> /Contents ${5 + pi * 2} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}endstream`);
  });

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}

@Injectable()
export class NotePdfExporterService {
  constructor(private readonly r2?: NoteR2Port) {}

  async exportLessonNotes(userId: string, lessonId: string, items: NotePdfItem[]): Promise<{ ok: boolean; url?: string; error?: string }> {
    if (!this.r2 || items.length === 0) return { ok: false, error: 'EXPORT_UNAVAILABLE' };
    const forensic = `${noteUserRef(userId)}-${new Date().toISOString()}`;
    const pdf = buildNotesPdf(`lesson:${lessonId}`, items, forensic);
    const key = `note-exports/${userId}/${lessonId}-${Date.now()}.pdf`;
    try {
      await this.r2.putObjectBuffer(key, pdf, 'application/pdf');
      return { ok: true, url: this.r2.presignedGetUrl(key, 3600, 'application/pdf') };
    } catch {
      return { ok: false, error: 'UPLOAD_FAILED' };
    }
  }
}
