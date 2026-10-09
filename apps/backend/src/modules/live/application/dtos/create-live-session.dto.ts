// SSOT Phase 099 §5.1 — Create live session DTO (Zod-gated)
// Canonical: apps/backend/src/modules/live/application/dtos/create-live-session.dto.ts
// - Zero new deps (zod rides @repo/shared peer).
import { LiveSessionStatusEnum, LiveStreamVendorEnum } from '@repo/shared';
import { z } from 'zod';

export const CreateLiveSessionSchema = z.object({
  productId: z.string().uuid().optional(),
  title: z.string().min(2).max(120),
  description: z.string().max(2000).default(''),
  coverImageUrl: z.string().url(),
  vendor: LiveStreamVendorEnum.default('AMAZON_IVS'),
  status: LiveSessionStatusEnum.default('SCHEDULED'),
  scheduledAt: z.string().datetime(),
});
export type CreateLiveSessionDto = z.infer<typeof CreateLiveSessionSchema>;
