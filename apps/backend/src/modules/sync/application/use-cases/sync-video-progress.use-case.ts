// SSOT Phase 057 §5.2 BDD Scenario 2 — Video timestamp sync use-case
// Canonical: apps/backend/src/modules/sync/application/use-cases/sync-video-progress.use-case.ts
// - Zod-gated input → Redis edge hash (progress:user:{id}:lesson:{id} shape) →
//   room broadcast → write-back queue. Client throttles to 3s; local latency
//   stays <50ms because persistence is async.
// - Constructor-free function with ports (tsx-importable).
import { VideoProgressSyncSchema, videoProgressCacheKey, type VideoProgressSync } from '@repo/shared';
import { videoProgressUpdatedEvent, type ProgressUpdatedEnvelope } from '../../domain/events/progress-updated.event';

export interface VideoSyncCachePort {
  hset(key: string, fields: Record<string, string>): Promise<void>;
}

export interface VideoSyncBusPort {
  broadcast(envelope: ProgressUpdatedEnvelope): Promise<void>;
}

export interface VideoSyncQueuePort {
  enqueue(queue: string, payload: VideoProgressSync): Promise<void>;
}

export async function syncVideoProgress(
  ports: { cache: VideoSyncCachePort; bus: VideoSyncBusPort; queue: VideoSyncQueuePort },
  raw: unknown,
): Promise<ProgressUpdatedEnvelope> {
  const data = VideoProgressSyncSchema.parse(raw);
  await ports.cache.hset(videoProgressCacheKey(data.userId, data.lessonId), {
    watchedSec: String(data.watchedSec),
    isCompleted: data.isCompleted ? '1' : '0',
    deviceId: data.deviceId,
    updatedAt: String(Date.now()),
  });
  const envelope = videoProgressUpdatedEvent(data);
  await ports.bus.broadcast(envelope);
  await ports.queue.enqueue('video_progress', data);
  return envelope;
}
