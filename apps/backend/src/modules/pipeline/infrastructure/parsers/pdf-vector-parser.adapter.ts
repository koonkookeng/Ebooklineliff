// SSOT Phase 038 Task 3 — PDF vector parser adapter (pre-rendered seam)
// Canonical: apps/backend/src/modules/pipeline/infrastructure/parsers/pdf-vector-parser.adapter.ts
// (legacy src/backend/modules/pipeline/infrastructure/parsers/pdf-vector-parser.adapter.ts)
// - RISK_CALL deviation (documented): no pdfjs in this monorepo (Gate 5) —
//   rasterization is the upstream book-pipeline seam. This adapter accepts the
//   rasterizer's PRE-RENDERED pages [{pageNumber, svgContent, extractedText?}],
//   validates/normalizes them (1-based dense sequence, non-empty SVG), and
//   returns the canonical parsed-book shape the use-cases consume.
// - Zero new deps.
import { Injectable } from '@nestjs/common';

export interface ParsedPage {
  pageNumber: number;
  svgContent: string;
  extractedText: string;
}

export interface ParsedBook {
  pages: ParsedPage[];
  totalPages: number;
}

/** Validate + normalize pre-rendered PDF pages (pure core, unit-tested). */
export function normalizePdfPages(pages: unknown): ParsedBook {
  if (!Array.isArray(pages) || pages.length === 0) throw new Error('No rendered pages');
  const seen = new Set<number>();
  const normalized: ParsedPage[] = pages.map((p, i) => {
    const row = p as { pageNumber?: unknown; svgContent?: unknown; extractedText?: unknown };
    if (!Number.isInteger(row.pageNumber) || (row.pageNumber as number) <= 0) {
      throw new Error(`Invalid page number at index ${i}`);
    }
    if (typeof row.svgContent !== 'string' || !row.svgContent) throw new Error(`Empty SVG at page ${String(row.pageNumber)}`);
    if (seen.has(row.pageNumber as number)) throw new Error(`Duplicate page ${String(row.pageNumber)}`);
    seen.add(row.pageNumber as number);
    return {
      pageNumber: row.pageNumber as number,
      svgContent: row.svgContent,
      extractedText: typeof row.extractedText === 'string' ? row.extractedText : '',
    };
  });
  normalized.sort((a, b) => a.pageNumber - b.pageNumber);
  for (let i = 0; i < normalized.length; i++) {
    if (normalized[i].pageNumber !== i + 1) throw new Error('Page sequence must be dense from 1');
  }
  return { pages: normalized, totalPages: normalized.length };
}

@Injectable()
export class PdfVectorParserAdapter {
  parseToVectorSvgs(pages: unknown): ParsedBook {
    return normalizePdfPages(pages);
  }
}
