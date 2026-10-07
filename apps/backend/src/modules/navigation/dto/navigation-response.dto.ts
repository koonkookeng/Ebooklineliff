// SSOT Phase 027 §3.2 — Navigation response DTO (GraphQL/REST payload shape)
// Canonical: apps/backend/src/modules/navigation/dto/navigation-response.dto.ts
// (legacy src/backend/modules/navigation/dto/navigation-response.dto.ts)
// - Mirrors NavigationStatePayload (§3.2) + restore envelope; Zod-validated at edge.
import { z } from 'zod';

export const NavigationStackItemResponseSchema = z.object({
  id: z.string().uuid(),
  pathname: z.string(),
  timestamp: z.number().int(),
  isDirty: z.boolean(),
});
export type NavigationStackItemResponse = z.infer<typeof NavigationStackItemResponseSchema>;

export const NavigationStatePayloadSchema = z.object({
  tenantId: z.string().min(1),
  currentRoute: z.string(),
  canGoBack: z.boolean(),
  stackDepth: z.number().int().nonnegative(),
  isDirtyState: z.boolean(),
  historyStack: z.array(NavigationStackItemResponseSchema).default([]),
});
export type NavigationStatePayload = z.infer<typeof NavigationStatePayloadSchema>;

export const NavigationRestoreResponseSchema = z.object({
  found: z.boolean(),
  lastPathname: z.string().nullable().default(null),
  payload: NavigationStatePayloadSchema.nullable().default(null),
});
export type NavigationRestoreResponse = z.infer<typeof NavigationRestoreResponseSchema>;
