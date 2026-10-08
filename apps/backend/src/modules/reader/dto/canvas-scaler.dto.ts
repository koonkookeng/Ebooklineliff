// SSOT Phase 060 §3.1 — Canvas scaler DTO (Zod-gated input surface)
// Canonical: apps/backend/src/modules/reader/dto/canvas-scaler.dto.ts
// (legacy src/backend/modules/reader/dto/canvas-scaler.dto.ts)
// - Re-exports the Zod SSOT + the retina query input (product/page/DPR/box).
// - Zero new deps.
import { z } from 'zod';
import {
  CanvasResolutionConfigSchema,
  EbookMultiResChunkPayloadSchema,
  ViewportMatrixSchema,
} from '@repo/shared';

export const RetinaChunkQuerySchema = z.object({
  productId: z.string().uuid(),
  pageNumber: z.coerce.number().int().positive(),
  deviceDpr: z.coerce.number().min(1).max(4).default(1),
  cssWidth: z.coerce.number().positive().max(4096).default(393),
  cssHeight: z.coerce.number().positive().max(4096).default(852),
});
export type RetinaChunkQuery = z.infer<typeof RetinaChunkQuerySchema>;

export { CanvasResolutionConfigSchema, EbookMultiResChunkPayloadSchema, ViewportMatrixSchema };
