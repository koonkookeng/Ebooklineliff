// SSOT Phase 032 §3.1 — Request permission DTO (Zod SSOT re-export)
// Canonical: apps/backend/src/modules/permission/dto/request-permission.dto.ts
// (legacy src/backend/modules/permission/dto/request-permission.dto.ts)
// - Single source: packages/shared/src/schemas/permission-contract.ts (no forked shapes).
import { PermissionRequestPayloadSchema } from '@repo/shared';
import type { PermissionRequestPayload } from '@repo/shared';

export { PermissionRequestPayloadSchema };
export type RequestPermissionDto = PermissionRequestPayload;
