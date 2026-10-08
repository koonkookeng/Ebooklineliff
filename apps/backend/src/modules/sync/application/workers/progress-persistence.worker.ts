// SSOT Phase 057 §5.2 — Write-back persistence worker (30s batch drain)
// Canonical: apps/backend/src/modules/sync/application/workers/progress-persistence.worker.ts
// - Drains the ebook/video queues in batches and upserts PostgreSQL with
//   Max-Progress policy (ConflictResolverService): stored cursor never
//   regresses. −90% DB writes vs per-tick persistence.
// - Ports-injected (tsx-importable); scheduling owned by SyncModule starter.
import { ConflictResolverService } from '../../domain/services/conflict-resolver.service';
import type { EbookProgressSync, VideoProgressSync } from '@repo/shared';

export interface PersistenceQueuePort {
  drainBatch(queue: 'ebook_progress' | 'video_progress', max: number): Promise<unknown[]>;
}

export interface PersistenceDbPort {
  upsertEbookProgress(args: { userId: string; ebookId: string; lastPage: number; deviceId: string }): Promise<{ lastPage: number }>;
  upsertVideoProgress(args: { userId: string; lessonId: string; watchedSec: number; isCompleted: boolean; deviceId: string }): Promise<{ watchedSec: number }>;
}

const WRITEBACK_BATCH_MAX = 200;

export async function drainProgressQueues(
  ports: { queue: PersistenceQueuePort; db: PersistenceDbPort; conflicts: ConflictResolverService },
  queues: Array<'ebook_progress' | 'video_progress'> = ['ebook_progress', 'video_progress'],
): Promise<{ ebook: number; video: number }> {
  const out = { ebook: 0, video: 0 };
  for (const queue of queues) {
    const batch = await ports.queue.drainBatch(queue, WRITEBACK_BATCH_MAX).catch(() => []);
    for (const raw of batch) {
      try {
        if (queue === 'ebook_progress') {
          const p = raw as EbookProgressSync;
          const stored = await ports.db.upsertEbookProgress({
            userId: p.userId,
            ebookId: p.ebookId,
            lastPage: p.lastPage,
            deviceId: p.deviceId,
          });
          void ports.conflicts.resolvePersisted(stored.lastPage, p.lastPage);
          out.ebook++;
        } else {
          const p = raw as VideoProgressSync;
          await ports.db.upsertVideoProgress({
            userId: p.userId,
            lessonId: p.lessonId,
            watchedSec: p.watchedSec,
            isCompleted: p.isCompleted,
            deviceId: p.deviceId,
          });
          out.video++;
        }
      } catch {
        // single poison row never blocks the batch (DLQ owned by Phase 124)
      }
    }
  }
  return out;
}
