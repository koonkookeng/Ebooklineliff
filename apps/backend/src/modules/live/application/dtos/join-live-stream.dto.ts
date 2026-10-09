// SSOT Phase 099 §5.1 — Join live stream DTO (Zod-gated)
// Canonical: apps/backend/src/modules/live/application/dtos/join-live-stream.dto.ts
// - Zero new deps (zod rides @repo/shared peer).
import { LiveStreamAccessRequestSchema } from '@repo/shared';
import { z } from 'zod';

export const JoinLiveStreamSchema = LiveStreamAccessRequestSchema;
export type JoinLiveStreamDto = z.infer<typeof JoinLiveStreamSchema>;

export const WebrtcOfferSchema = z.object({
  sessionId: z.string().uuid(),
  sdpOffer: z.string().min(10).max(20000),
});
export type WebrtcOfferDto = z.infer<typeof WebrtcOfferSchema>;
