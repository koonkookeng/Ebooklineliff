// SSOT Phase 102 §5.1 — Stream-ended domain event (Zod-validated factory)
// Canonical: apps/backend/src/modules/stream/domain/events/stream-ended.event.ts
// - Provider webhooks arrive as unknown JSON; only STREAM_END /
//   RECORDING_COMPLETE with a lesson binding enter the pipeline.
// - Zero new deps.
import { StreamWebhookEventSchema, type StreamWebhookEvent } from '@repo/shared';

export function parseStreamEvent(raw: unknown): StreamWebhookEvent | null {
  const parsed = StreamWebhookEventSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data;
}

export function isVodTrigger(event: StreamWebhookEvent): boolean {
  return event.eventType === 'STREAM_END' || event.eventType === 'RECORDING_COMPLETE';
}
