// SSOT Phase 040 — Reader DTO (Zod SSOT re-export)
// Canonical: apps/backend/src/modules/reader/dto/reader.dto.ts
// (legacy src/backend/modules/reader/dto/reader.dto.ts)
// - Single source: packages/shared/src/schemas/reader.schema.ts (no forked shapes).
import {
  EbookChunkPayloadSchema,
  ForensicWatermarkSchema,
  ProgressSyncResultSchema,
  ReaderProgressPayloadSchema,
} from '@repo/shared';
import type { EbookChunkPayload, ForensicWatermark, ProgressSyncResult, ReaderProgressPayload } from '@repo/shared';

export { EbookChunkPayloadSchema, ForensicWatermarkSchema, ReaderProgressPayloadSchema, ProgressSyncResultSchema };
export type ReaderChunkDto = EbookChunkPayload;
export type ReaderWatermarkDto = ForensicWatermark;
export type ReaderProgressDto = ReaderProgressPayload;
export type ProgressSyncResultDto = ProgressSyncResult;
