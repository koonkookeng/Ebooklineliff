// SSOT Phase 046 — Progress DTO (Zod SSOT re-export)
// Canonical: apps/backend/src/modules/stream/progress/dto/sync-progress.input.ts
// (legacy src/backend/modules/stream/progress/dto/sync-progress.input.ts)
// - Single source: packages/shared/src/schemas/progress-sync.schema.ts.
import { SyncProgressInputSchema, BeaconProgressSchema } from '@repo/shared';
import type { SyncProgressInput, BeaconProgress } from '@repo/shared';

export { SyncProgressInputSchema, BeaconProgressSchema };
export type ProgressSyncInputDto = SyncProgressInput;
export type BeaconProgressDto = BeaconProgress;
