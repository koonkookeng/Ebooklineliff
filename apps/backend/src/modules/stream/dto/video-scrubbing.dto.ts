// SSOT Phase 058 §3.1/§5.2 — Video scrubbing DTO (Zod-gated input surface)
// Canonical: apps/backend/src/modules/stream/dto/video-scrubbing.dto.ts
// (legacy src/backend/modules/stream/dto/video-scrubbing.dto.ts)
// - Re-exports the Zod SSOT so REST/GQL stay byte-parity with the LIFF bar.
// - Zero new deps.
import {
  ScrubbingManifestInputSchema,
  ThumbnailCueSchema,
  VideoScrubbingPayloadSchema,
  VideoSpriteManifestSchema,
} from '@repo/shared';

export const GetScrubbingManifestDto = ScrubbingManifestInputSchema;
export type GetScrubbingManifestDto = import('@repo/shared').ScrubbingManifestInput;

export const ScrubAnalyticsEventDto = ScrubbingManifestInputSchema.extend({
  targetTimeSec: ThumbnailCueSchema.shape.startTimeSec,
});
export type ScrubAnalyticsEventDto = import('zod').infer<typeof ScrubAnalyticsEventDto>;

export { VideoSpriteManifestSchema, VideoScrubbingPayloadSchema };
export type { ThumbnailCue as ScrubCueDto } from '@repo/shared';
