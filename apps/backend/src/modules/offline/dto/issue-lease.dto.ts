// SSOT Phase 063 §5.1 — Issue-lease DTO (Zod-gated input surface)
// Canonical: apps/backend/src/modules/offline/dto/issue-lease.dto.ts
// (legacy src/backend/modules/offline/dto/issue-lease.dto.ts)
// - Zero new deps.
import { z } from 'zod';

export const IssueLeaseDtoSchema = z.object({
  productId: z.string().uuid(),
  deviceId: z.string().min(1).max(128),
  clientPublicKey: z.string().min(1).max(5000),
});
export type IssueLeaseDto = z.infer<typeof IssueLeaseDtoSchema>;
