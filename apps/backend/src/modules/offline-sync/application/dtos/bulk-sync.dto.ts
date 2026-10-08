// SSOT Phase 062 §5.1 — Bulk sync DTO (Zod-gated transport surface)
// Canonical: apps/backend/src/modules/offline-sync/application/dtos/bulk-sync.dto.ts
// - Re-exports the Zod SSOT; the controller validates inline (no global
//   ZodValidationPipe exists — precedent: safeParse at the boundary).
// - Zero new deps.
import {
  BulkOfflineSyncPayloadSchema,
  BulkOfflineSyncResponseSchema,
  OfflineSyncQueueItemSchema,
  SyncTargetTypeEnum,
} from '@repo/shared';

export { BulkOfflineSyncPayloadSchema, BulkOfflineSyncResponseSchema, OfflineSyncQueueItemSchema, SyncTargetTypeEnum };
export type {
  BulkOfflineSyncPayload,
  BulkOfflineSyncResponse,
  OfflineSyncQueueItem,
  SyncTargetType,
} from '@repo/shared';
