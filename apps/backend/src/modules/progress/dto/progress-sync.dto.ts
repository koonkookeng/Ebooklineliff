// SSOT Phase 064 §5.1 — Progress sync DTO (Zod-gated transport surface)
// Canonical: apps/backend/src/modules/progress/dto/progress-sync.dto.ts
// (legacy src/backend/modules/progress/dto/progress-sync.dto.ts)
// - Re-exports the Zod SSOT; boundary safeParse at controller/resolver.
// - Zero new deps.
import {
  BatchProgressSyncPayloadSchema,
  CourseProgressSyncItemSchema,
  EbookProgressSyncItemSchema,
  SyncResponseSchema,
} from '@repo/shared';

export { BatchProgressSyncPayloadSchema, CourseProgressSyncItemSchema, EbookProgressSyncItemSchema, SyncResponseSchema };
export type { BatchProgressSyncPayload, CourseProgressSyncItem, EbookProgressSyncItem, SyncResponse } from '@repo/shared';
