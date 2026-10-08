// SSOT Phase 065 §5.1 — Update-preference DTO (Zod-gated transport surface)
// Canonical: apps/backend/src/modules/user-preference/dto/update-preference.dto.ts
// (legacy src/backend/modules/user-preference/dto/update-preference.dto.ts)
// - Re-exports the Zod SSOT; boundary safeParse in service/resolver.
// - Zero new deps.
import { UpdatePreferenceInputSchema, UserReadingPreferenceSchema } from '@repo/shared';

export { UpdatePreferenceInputSchema, UserReadingPreferenceSchema };
export type { UpdatePreferenceInput, UserReadingPreference } from '@repo/shared';
