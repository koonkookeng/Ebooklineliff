// SSOT Phase 012 §3.1 — Entitlement Zod domain contract (instant unlock on VERIFIED)
// Canonical: packages/shared/src/schemas/entitlement.schema.ts
// (legacy src/shared/schemas/entitlement.schema.ts)
// Zero-redundant policy: ContentAccessTypeEnum owned by ./sdid-contract.
import { z } from 'zod';
import { ContentAccessTypeEnum } from './sdid-contract';
export { ContentAccessTypeEnum };

export const GrantEntitlementInputSchema = z.object({
  userId: z.string().uuid(),
  productId: z.string().uuid(),
  accessType: ContentAccessTypeEnum.default('FULL_PURCHASE'),
  expiresAt: z.string().nullable().optional(),
});
export type GrantEntitlementInput = z.infer<typeof GrantEntitlementInputSchema>;

export const EntitlementSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  productId: z.string().uuid(),
  accessType: ContentAccessTypeEnum,
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
});
export type Entitlement = z.infer<typeof EntitlementSchema>;
