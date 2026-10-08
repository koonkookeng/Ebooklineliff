// SSOT Phase 063 §3.1/§5.1 — Offline progress sync DTO (Zod gate)
// Canonical: apps/backend/src/modules/offline/dto/offline-sync.dto.ts
// (legacy src/backend/modules/offline/dto/offline-sync.dto.ts)
// - Re-exports the §3.1 payload so controller + service share one shape.
// - Zero new deps.
import { OfflineProgressSyncPayloadSchema } from '@repo/shared';

export { OfflineProgressSyncPayloadSchema };
export type { OfflineProgressSyncPayload } from '@repo/shared';
