// SSOT Phase 033 §3.1 — Check version DTO (Zod SSOT re-export)
// Canonical: apps/backend/src/modules/version/dto/check-version.dto.ts
// (legacy src/backend/modules/version/dto/check-version.dto.ts)
// - Single source: packages/shared/src/schemas/version-contract.ts (no forked shapes).
import { VersionCheckRequestSchema } from '@repo/shared';
import type { VersionCheckRequest } from '@repo/shared';

export { VersionCheckRequestSchema };
export type CheckVersionDto = VersionCheckRequest;
