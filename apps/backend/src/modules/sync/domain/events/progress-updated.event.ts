// SSOT Phase 057 §5.1 — Progress-updated domain event (room fan-out envelope)
// Canonical: apps/backend/src/modules/sync/domain/events/progress-updated.event.ts
// (legacy src/backend/modules/sync/domain/events/progress-updated.event.ts)
// - Pure factory: builds the <200-byte SyncBroadcastPayload + room channel.
// - Zero Nest imports (tsx-importable).
import {
  SyncBroadcastPayloadSchema,
  syncRoomChannel,
  type EbookProgressSync,
  type SyncBroadcastPayload,
  type VideoProgressSync,
} from '@repo/shared';

export interface ProgressUpdatedEnvelope {
  channel: string;
  event: 'ebook_page_synced' | 'video_progress_synced';
  payload: SyncBroadcastPayload;
}

export function ebookProgressUpdatedEvent(data: EbookProgressSync): ProgressUpdatedEnvelope {
  const payload: SyncBroadcastPayload = SyncBroadcastPayloadSchema.parse({
    contentType: 'EBOOK',
    ebookData: data,
    serverTimestamp: Date.now(),
  });
  return {
    channel: syncRoomChannel(data.tenantId, data.userId),
    event: 'ebook_page_synced',
    payload,
  };
}

export function videoProgressUpdatedEvent(data: VideoProgressSync): ProgressUpdatedEnvelope {
  const payload: SyncBroadcastPayload = SyncBroadcastPayloadSchema.parse({
    contentType: 'COURSE_LESSON',
    videoData: data,
    serverTimestamp: Date.now(),
  });
  return {
    channel: syncRoomChannel(data.tenantId, data.userId),
    event: 'video_progress_synced',
    payload,
  };
}
