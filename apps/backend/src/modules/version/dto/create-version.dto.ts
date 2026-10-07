// SSOT Phase 033 §3.1 — Create version DTO (Zod SSOT re-export)
// Canonical: apps/backend/src/modules/version/dto/create-version.dto.ts
// (legacy src/backend/modules/version/dto/create-version.dto.ts)
// - Single source: packages/shared/src/schemas/version-contract.ts (no forked shapes).
import { AppVersionSchema } from '@repo/shared';
import type { AppVersion } from '@repo/shared';

export { AppVersionSchema };
export type CreateVersionDto = AppVersion;
