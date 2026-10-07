// SSOT Phase 046 — Progress response DTO (Zod SSOT re-export)
// Canonical: apps/backend/src/modules/stream/progress/dto/sync-progress.response.ts
// (legacy src/backend/modules/stream/progress/dto/sync-progress.response.ts)
// - Single source: packages/shared/src/schemas/progress-sync.schema.ts.
import { SyncProgressPayloadSchema } from '@repo/shared';
import type { SyncProgressPayload } from '@repo/shared';

export { SyncProgressPayloadSchema };
export type SyncProgressResponseDto = SyncProgressPayload;
