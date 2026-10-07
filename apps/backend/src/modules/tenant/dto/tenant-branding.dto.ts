// SSOT Phase 030 §3.1 — Tenant branding DTO (Zod SSOT re-export)
// Canonical: apps/backend/src/modules/tenant/dto/tenant-branding.dto.ts
// (legacy src/backend/modules/tenant/dto/tenant-branding.dto.ts)
// - Single source: packages/shared/src/schemas/tenant-branding.schema.ts (no forked shapes).
import { TenantBrandingSchema } from '@repo/shared';
import type { TenantBranding } from '@repo/shared';

export { TenantBrandingSchema };
export type TenantBrandingDto = TenantBranding;
