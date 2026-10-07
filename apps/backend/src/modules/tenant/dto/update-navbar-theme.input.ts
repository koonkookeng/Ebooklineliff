// SSOT Phase 030 §3.1 — Update navbar theme input (Zod SSOT re-export)
// Canonical: apps/backend/src/modules/tenant/dto/update-navbar-theme.input.ts
// (legacy src/backend/modules/tenant/dto/update-navbar-theme.input.ts)
// - Single source: packages/shared/src/schemas/tenant-branding.schema.ts (no forked shapes).
import { UpdateNavbarThemeInputSchema } from '@repo/shared';
import type { UpdateNavbarThemeInput } from '@repo/shared';

export { UpdateNavbarThemeInputSchema };
export type UpdateNavbarThemeInputDto = UpdateNavbarThemeInput;
