// SSOT Phase 057 §5.2 BDD Scenario 1 — Ebook page sync use-case
// Canonical: apps/backend/src/modules/sync/application/use-cases/sync-ebook-progress.use-case.ts
// - Zod-gated input → Redis edge hash (fast cache) → room broadcast event →
//   write-back queue (DB persisted async every 30s, −90% writes).
// - Constructor takes ports — no Nest param decorators (tsx-importable).
import { EbookProgressSyncSchema, ebookProgressCacheKey, type EbookProgressSync } from '@repo/shared';
import { ebookProgressUpdatedEvent, type ProgressUpdatedEnvelope } from '../../domain/events/progress-updated.event';

export interface EbookSyncCachePort {
  hset(key: string, fields: Record<string, string>): Promise<void>;
}

export interface EbookSyncBusPort {
  broadcast(envelope: ProgressUpdatedEnvelope): Promise<void>;
}

export interface EbookSyncQueuePort {
  enqueue(queue: string, payload: EbookProgressSync): Promise<void>;
}

export async function syncEbookProgress(
  ports: { cache: EbookSyncCachePort; bus: EbookSyncBusPort; queue: EbookSyncQueuePort },
  raw: unknown,
): Promise<ProgressUpdatedEnvelope> {
  const data = EbookProgressSyncSchema.parse(raw);
  await ports.cache.hset(ebookProgressCacheKey(data.userId, data.ebookId), {
    lastPage: String(data.lastPage),
    totalPages: String(data.totalPages),
    deviceId: data.deviceId,
    updatedAt: String(Date.now()),
  });
  const envelope = ebookProgressUpdatedEvent(data);
  await ports.bus.broadcast(envelope);
  await ports.queue.enqueue('ebook_progress', data);
  return envelope;
}
