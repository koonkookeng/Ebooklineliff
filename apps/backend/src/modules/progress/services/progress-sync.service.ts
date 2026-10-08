// SSOT Phase 064 §5.2 — ProgressSyncService (batch + conflict matrix)
// Canonical: apps/backend/src/modules/progress/services/progress-sync.service.ts
// (legacy src/backend/modules/progress/services/progress-sync.service.ts)
// - processBatchSync: ownership (body userId == JWT) → idempotency claim →
//   per-item monotonic apply (highest-valid-progress wins; stale counts as
//   conflict-resolved but acked so clients clear) → audit log.
// - Row-atomic sequential upserts (062/063 precedent; interactive
//   $transaction can't stay tsx-safe on structural ports — ADR-064).
// - tsx-safe. Zero new deps.
import { Injectable } from '@nestjs/common';
import {
  BatchProgressSyncPayloadSchema,
  syncItemCanonical,
  type SyncResponse,
} from '@repo/shared';
import { PayloadVerifierService } from './payload-verifier.service';

export interface ProgressSyncTables {
  offlineDeviceSession: {
    upsert(args: unknown): Promise<{ id: string }>;
  };
  offlineSyncLog: {
    create(args: unknown): Promise<unknown>;
  };
  ebookReadingProgress: {
    findUnique(args: unknown): Promise<{ lastPage: number } | null>;
    upsert(args: unknown): Promise<unknown>;
  };
  courseLearningProgress: {
    findUnique(args: unknown): Promise<{ watchedSec: number; isCompleted: boolean } | null>;
    upsert(args: unknown): Promise<unknown>;
  };
}

@Injectable()
export class ProgressSyncService {
  constructor(
    private readonly tables?: ProgressSyncTables,
    private readonly verifier?: PayloadVerifierService,
    private readonly onSync?: (event: { userId: string; conflicts: number }) => void,
  ) {}

  async processBatchSync(
    userId: string,
    body: unknown,
    ipAddress: string,
    userAgent: string,
    deviceId = 'bg-sync',
  ): Promise<SyncResponse> {
    const parsed = BatchProgressSyncPayloadSchema.safeParse(body);
    const now = new Date().toISOString();
    if (!parsed.success || parsed.data.userId !== userId || !this.tables) {
      return { success: false, syncedEbookIds: [], syncedLessonIds: [], conflictsResolved: 0, serverTimestamp: now };
    }
    const payload = parsed.data;
    const fresh = await this.verifier?.claimBatch(payload.syncBatchId).catch(() => true);
    if (fresh === false) {
      return { success: true, syncedEbookIds: [], syncedLessonIds: [], conflictsResolved: 0, serverTimestamp: now };
    }

    const syncedEbookIds: string[] = [];
    const syncedLessonIds: string[] = [];
    let conflictsResolved = 0;

    for (const item of payload.ebookProgressList) {
      try {
        const canonical = syncItemCanonical(item.productId, item.lastPage, item.clientTimestamp);
        void this.verifier?.verifyItemSignature(canonical, item.signature);
        const prev = await this.tables.ebookReadingProgress
          .findUnique({ where: { userId_ebookId: { userId, ebookId: item.productId } } })
          .catch(() => null);
        if (!prev || item.lastPage > prev.lastPage) {
          await this.tables.ebookReadingProgress.upsert({
            where: { userId_ebookId: { userId, ebookId: item.productId } },
            update: { lastPage: item.lastPage },
            create: { userId, ebookId: item.productId, lastPage: item.lastPage },
          });
        } else {
          conflictsResolved++;
        }
        syncedEbookIds.push(item.id);
      } catch {
        // per-item best-effort; unacked ids stay queued client-side
      }
    }

    for (const item of payload.courseProgressList) {
      try {
        const canonical = syncItemCanonical(item.lessonId, item.watchedSec, item.clientTimestamp);
        void this.verifier?.verifyItemSignature(canonical, item.signature);
        const prev = await this.tables.courseLearningProgress
          .findUnique({ where: { userId_lessonId: { userId, lessonId: item.lessonId } } })
          .catch(() => null);
        const updateSec = !prev || item.watchedSec > prev.watchedSec;
        const updateDone = !prev || (item.isCompleted && !prev.isCompleted);
        if (updateSec || updateDone) {
          await this.tables.courseLearningProgress.upsert({
            where: { userId_lessonId: { userId, lessonId: item.lessonId } },
            update: {
              watchedSec: updateSec ? item.watchedSec : prev?.watchedSec,
              isCompleted: updateDone ? item.isCompleted : prev?.isCompleted,
            },
            create: { userId, lessonId: item.lessonId, watchedSec: item.watchedSec, isCompleted: item.isCompleted },
          });
        } else {
          conflictsResolved++;
        }
        syncedLessonIds.push(item.id);
      } catch {
        // per-item best-effort
      }
    }

    const session = await this.tables.offlineDeviceSession
      .upsert({ where: { userId_deviceId: { userId, deviceId } }, create: { userId, deviceId }, update: {} })
      .catch(() => null);
    if (session) {
      await this.tables.offlineSyncLog
        .create({
          data: {
            sessionId: session.id,
            targetType: 'BATCH_SYNC',
            itemsCount: syncedEbookIds.length + syncedLessonIds.length,
            status: 'SUCCESS',
            userId,
            syncedRecords: syncedEbookIds.length + syncedLessonIds.length,
            syncPayload: { syncBatchId: payload.syncBatchId },
            ipAddress,
          },
        })
        .catch(() => undefined);
    }
    void userAgent;
    try {
      this.onSync?.({ userId, conflicts: conflictsResolved });
    } catch {
      // analytics fan-out best-effort
    }
    return { success: true, syncedEbookIds, syncedLessonIds, conflictsResolved, serverTimestamp: now };
  }
}
