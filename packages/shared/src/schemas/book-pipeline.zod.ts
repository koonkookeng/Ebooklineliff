// SSOT Phase 038 §3.1 — Book pipeline Zod SSOT contract
// Canonical: packages/shared/src/schemas/book-pipeline.zod.ts
// (legacy src/shared/schemas/book-pipeline.zod.ts)
// - Spec-verbatim: BookJobStatusEnum / ProcessBookJobInputSchema /
//   EbookChunkMetadataSchema / BookPipelineStatusResponseSchema.
// - RISK_CALL deviations (documented, additive-only):
//   - bookId/sellerId/jobId are z.string().min(1), not uuid: edge identity
//     vocabulary (Phase 023–037 precedent).
//   - Adds PagePayloadSchema (pre-rendered page input — rasterization is the
//     upstream book-pipeline seam, no pdfjs/epub dep in this monorepo),
//     PIPELINE_* constants, progressFor() (§5.2 rule) and chunkR2Path().
// - Zero new deps (zod only).
import { z } from 'zod';

export const BookJobStatusEnum = z.enum([
  'QUEUED',
  'PARSING_STRUCTURE',
  'GENERATING_VECTOR_CHUNKS',
  'ENCRYPTING_ASSETS',
  'UPLOADING_R2',
  'COMPLETED',
  'FAILED',
]);
export type BookJobStatus = z.infer<typeof BookJobStatusEnum>;

export const ProcessBookJobInputSchema = z.object({
  bookId: z.string().min(1),
  sellerId: z.string().min(1),
  tenantId: z.string().min(1),
  rawFileUrl: z.string().url(),
  fileType: z.enum(['PDF', 'EPUB']),
  watermarkSeed: z.string().min(1),
});
export type ProcessBookJobInput = z.infer<typeof ProcessBookJobInputSchema>;

export const EbookChunkMetadataSchema = z.object({
  bookId: z.string().min(1),
  pageNumber: z.number().int().positive(),
  chunkR2Path: z.string().min(1),
  fileSizeBytes: z.number().int().positive(),
  hasVectorSvg: z.boolean(),
  extractedTextLength: z.number().int().nonnegative(),
});
export type EbookChunkMetadata = z.infer<typeof EbookChunkMetadataSchema>;

export const BookPipelineStatusResponseSchema = z.object({
  jobId: z.string().min(1),
  bookId: z.string().min(1),
  status: BookJobStatusEnum,
  progressPercentage: z.number().min(0).max(100),
  processedPages: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
  errorMessage: z.string().nullable(),
});
export type BookPipelineStatusResponse = z.infer<typeof BookPipelineStatusResponseSchema>;

/** Pre-rendered page payload (upstream rasterizer output, §5.2 seam). */
export const PagePayloadSchema = z.object({
  pageNumber: z.number().int().positive(),
  svgContent: z.string().min(1),
  extractedText: z.string().default(''),
});
export type PagePayload = z.infer<typeof PagePayloadSchema>;

/** Per-page SVG budget (bytes) — BDD vector target <50KB/page. */
export const SVG_PAGE_MAX_BYTES = 50 * 1024;
/** Chunk edge-cache TTL after pipeline upload (24h, §8.1 warm path). */
export const PIPELINE_CHUNK_TTL_SEC = 86400;
/** Queue auto-retry ceiling before DLQ (§10). */
export const PIPELINE_MAX_RETRIES = 3;
/** R2 key for a pipeline chunk envelope. */
export function chunkR2Path(bookId: string, pageNumber: number): string {
  return `ebooks/${bookId}/chunks/page-${pageNumber}.enc`;
}

/** §5.2 progress rule: 30 + (i+1)/total * 65, floored. */
export function progressFor(processedPages: number, totalPages: number): number {
  if (totalPages <= 0) return 30;
  return Math.floor(30 + (Math.min(processedPages, totalPages) / totalPages) * 65);
}
