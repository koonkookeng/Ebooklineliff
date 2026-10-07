// SSOT Phase 027 §5.1 — Navigation sync DTO (Zod SSOT re-export)
// Canonical: apps/backend/src/modules/navigation/dto/sync-navigation.dto.ts
// (legacy src/backend/modules/navigation/dto/sync-navigation.dto.ts)
// - Single source: packages/shared/src/schemas/navigation.schema.ts (no forked shapes).
import { NavigationSyncPayloadSchema } from '@repo/shared';
import type { NavigationSyncPayload } from '@repo/shared';

export { NavigationSyncPayloadSchema };
export type SyncNavigationDto = NavigationSyncPayload;
