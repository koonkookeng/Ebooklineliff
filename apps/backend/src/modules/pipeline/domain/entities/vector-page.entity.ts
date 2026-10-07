// SSOT Phase 038 Task 4 — Vector page entity (per-page payload invariants)
// Canonical: apps/backend/src/modules/pipeline/domain/entities/vector-page.entity.ts
// (legacy src/backend/modules/pipeline/domain/entities/vector-page.entity.ts)
// - pageNumber positive; svg non-empty and within the 50KB budget (oversized
//   pages are rejected at the boundary — the rasterizer must re-emit, never
//   silently truncate, Gate 5).
// - Zero new deps.
import { SVG_PAGE_MAX_BYTES } from '@repo/shared';

export interface VectorPageProps {
  pageNumber: number;
  svgContent: string;
  extractedText: string;
}

export class VectorPage {
  private constructor(readonly props: VectorPageProps) {}

  static create(props: VectorPageProps): VectorPage {
    if (!Number.isInteger(props.pageNumber) || props.pageNumber <= 0) throw new Error('Invalid page number');
    if (typeof props.svgContent !== 'string' || !props.svgContent) throw new Error('Empty SVG content');
    if (Buffer.byteLength(props.svgContent, 'utf8') > SVG_PAGE_MAX_BYTES) throw new Error('SVG exceeds 50KB page budget');
    if (typeof props.extractedText !== 'string') throw new Error('Invalid extracted text');
    return new VectorPage({ pageNumber: props.pageNumber, svgContent: props.svgContent, extractedText: props.extractedText });
  }
}
