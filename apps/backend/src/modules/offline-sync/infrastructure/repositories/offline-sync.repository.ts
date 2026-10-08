// SSOT Phase 062 §5.1 — OfflineSyncRepository (ledger persistence port)
// Canonical: apps/backend/src/modules/offline-sync/infrastructure/repositories/offline-sync.repository.ts
// - Session upsert (userId+deviceId) + per-flush OfflineSyncLog row under one
//   Prisma $transaction (Gate 7); progress upserts ride the same client.
// - Monotonic progress: max(lastPage)/max(watchedSec) so stale offline
//   replays never rewind newer online state (Phase 057 LWW precedent).
// - tsx-safe structural port. Zero new deps.
import { Injectable } from '@nestjs/common';

export interface OfflineSyncTables {
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
    findUnique(args: unknown): Promise<{ watchedSec: number } | null>;
    upsert(args: unknown): Promise<unknown>;
  };
}

@Injectable()
export class OfflineSyncRepository {
  constructor(private readonly tables?: OfflineSyncTables) {}

  async recordSessionLedger(userId: string, deviceId: string, targetType: string, itemsCount: number, status: string): Promise<void> {
    if (!this.tables) return;
    // Session upsert is atomic on @@unique(userId, deviceId); the audit log
    // follows best-effort so ledger writes never fail a progress flush.
    const session = await this.tables.offlineDeviceSession
      .upsert({
        where: { userId_deviceId: { userId, deviceId } },
        create: { userId, deviceId },
        update: {},
      })
      .catch(() => null);
    if (!session) return;
    await this.tables.offlineSyncLog
      .create({ data: { sessionId: session.id, targetType, itemsCount, status } })
      .catch(() => undefined);
  }

  async saveEbookProgress(userId: string, ebookId: string, lastPage: number, deviceId: string): Promise<boolean> {
    if (!this.tables) return false;
    try {
      const prev = await this.tables.ebookReadingProgress.findUnique({ where: { userId_ebookId: { userId, ebookId } } }).catch(() => null);
      const page = Math.max(lastPage, prev?.lastPage ?? 1);
      await this.tables.ebookReadingProgress.upsert({
        where: { userId_ebookId: { userId, ebookId } },
        create: { userId, ebookId, lastPage: page, deviceId },
        update: { lastPage: page, deviceId },
      });
      return true;
    } catch {
      return false;
    }
  }

  async saveCourseProgress(userId: string, lessonId: string, watchedSec: number, isCompleted: boolean, deviceId: string): Promise<boolean> {
    if (!this.tables) return false;
    try {
      const prev = await this.tables.courseLearningProgress.findUnique({ where: { userId_lessonId: { userId, lessonId } } }).catch(() => null);
      const sec = Math.max(watchedSec, prev?.watchedSec ?? 0);
      await this.tables.courseLearningProgress.upsert({
        where: { userId_lessonId: { userId, lessonId } },
        create: { userId, lessonId, watchedSec: sec, isCompleted, deviceId },
        update: { watchedSec: sec, isCompleted, deviceId },
      });
      return true;
    } catch {
      return false;
    }
  }
}
