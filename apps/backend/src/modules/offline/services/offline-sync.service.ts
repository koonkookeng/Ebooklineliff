// SSOT Phase 063 §5.2 — OfflineSyncService (lease-scoped progress flush)
// Canonical: apps/backend/src/modules/offline/services/offline-sync.service.ts
// (legacy src/backend/modules/offline/services/offline-sync.service.ts)
// - processOfflineSync: Zod-gated payload → monotonic ebook/course upserts
//   (stale replays never rewind) + user-scoped audit log. Sequential
//   upserts (small batches, <1s) instead of interactive $transaction —
//   matches the Phase 062 ledger precedent; each row is atomic.
// - tsx-safe structural ports. Zero new deps.
import { Injectable } from '@nestjs/common';
import { OfflineProgressSyncPayloadSchema, type OfflineProgressSyncPayload } from '@repo/shared';

export interface OfflineSyncTables {
  offlineDeviceSession: {
    upsert(args: unknown): Promise<{ id: string }>;
  };
  ebookReadingProgress: {
    findUnique(args: unknown): Promise<{ lastPage: number } | null>;
    upsert(args: unknown): Promise<unknown>;
  };
  courseLearningProgress: {
    findUnique(args: unknown): Promise<{ watchedSec: number } | null>;
    upsert(args: unknown): Promise<unknown>;
  };
  offlineSyncLog: {
    create(args: unknown): Promise<unknown>;
  };
}

@Injectable()
export class OfflineSyncService {
  constructor(private readonly tables?: OfflineSyncTables) {}

  async processOfflineSync(userId: string, syncData: unknown, ipAddress: string, deviceId = 'offline-lease'): Promise<{ success: boolean; syncedRecords: number }> {
    const parsed = OfflineProgressSyncPayloadSchema.safeParse({ ...(syncData as object), userId });
    if (!parsed.success || !this.tables) return { success: false, syncedRecords: 0 };
    const data: OfflineProgressSyncPayload = parsed.data;
    let synced = 0;
    for (const ep of data.ebookProgress) {
      try {
        const prev = await this.tables.ebookReadingProgress.findUnique({ where: { userId_ebookId: { userId, ebookId: ep.productId } } }).catch(() => null);
        const lastPage = Math.max(ep.lastPage, prev?.lastPage ?? 1);
        await this.tables.ebookReadingProgress.upsert({
          where: { userId_ebookId: { userId, ebookId: ep.productId } },
          update: { lastPage },
          create: { userId, ebookId: ep.productId, lastPage },
        });
        synced++;
      } catch {
        // per-row best-effort; audit counts successes only
      }
    }
    for (const cp of data.courseProgress) {
      try {
        const prev = await this.tables.courseLearningProgress.findUnique({ where: { userId_lessonId: { userId, lessonId: cp.lessonId } } }).catch(() => null);
        const watchedSec = Math.max(cp.watchedSec, prev?.watchedSec ?? 0);
        await this.tables.courseLearningProgress.upsert({
          where: { userId_lessonId: { userId, lessonId: cp.lessonId } },
          update: { watchedSec, isCompleted: cp.isCompleted },
          create: { userId, lessonId: cp.lessonId, watchedSec, isCompleted: cp.isCompleted },
        });
        synced++;
      } catch {
        // per-row best-effort
      }
    }
    // The session row satisfies the required sessionId FK; user-scoped audit
    // columns carry the §4.1 shape.
    const session = await this.tables.offlineDeviceSession
      .upsert({ where: { userId_deviceId: { userId, deviceId } }, create: { userId, deviceId }, update: {} })
      .catch(() => null);
    if (session) {
      await this.tables.offlineSyncLog
        .create({
          data: {
            sessionId: session.id,
            targetType: 'LEASE_SYNC',
            itemsCount: synced,
            status: 'SUCCESS',
            userId,
            syncedRecords: synced,
            syncPayload: data,
            ipAddress,
          },
        })
        .catch(() => undefined);
    }
    return { success: true, syncedRecords: synced };
  }
}
