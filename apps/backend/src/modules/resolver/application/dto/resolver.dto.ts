// SSOT Phase 025 §5.1 — Resolver DTOs (thin re-export over Zod SSOT)
// Canonical: apps/backend/src/modules/resolver/application/dto/resolver.dto.ts
// (legacy src/backend/modules/resolver/application/dto/resolver.dto.ts)
import {
  CreateShortLinkInputSchema,
  ResolveShortCodeResponseSchema,
  ResolvedStateSchema,
  ShortCodeParamSchema,
  type CreateShortLinkInput,
  type ResolveShortCodeResponse,
  type ResolvedState,
  type ShortCodeParam,
} from '@repo/shared';

export {
  CreateShortLinkInputSchema,
  ResolveShortCodeResponseSchema,
  ResolvedStateSchema,
  ShortCodeParamSchema,
};
export type { CreateShortLinkInput, ResolveShortCodeResponse, ResolvedState, ShortCodeParam };
