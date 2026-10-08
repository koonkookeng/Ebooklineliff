// SSOT Phase 061 §5.1 — DRM chunk request DTO (Zod-gated input surface)
// Canonical: apps/backend/src/modules/reader/drm/dto/drm-chunk-request.dto.ts
// (legacy src/backend/modules/reader/drm/dto/drm-chunk-request.dto.ts)
// - Chunk query (product/page) + violation report (session/page/type).
// - Zero new deps.
import { z } from 'zod';
import { DrmShuffleAlgorithmEnum } from '@repo/shared';

export const DrmChunkRequestSchema = z.object({
  productId: z.string().uuid(),
  pageNumber: z.coerce.number().int().positive(),
  gridX: z.coerce.number().int().min(4).max(32).default(8),
  gridY: z.coerce.number().int().min(4).max(32).default(8),
  algorithm: DrmShuffleAlgorithmEnum.default('HYBRID_WEBGL_MATRIX'),
});
export type DrmChunkRequest = z.infer<typeof DrmChunkRequestSchema>;

export const DrmViolationReportSchema = z.object({
  sessionNonce: z.string().uuid(),
  productId: z.string().uuid(),
  pageNumber: z.number().int().positive(),
  violationType: z.enum([
    'SCREENSHOT_ATTEMPT',
    'DEVTOOLS_CANVAS_DUMP',
    'UNAUTHORIZED_DOM_INJECTION',
    'SESSION_HIJACK_ATTEMPT',
  ]),
  userAgent: z.string().max(500).default(''),
  metadata: z.record(z.unknown()).optional(),
});
export type DrmViolationReport = z.infer<typeof DrmViolationReportSchema>;
