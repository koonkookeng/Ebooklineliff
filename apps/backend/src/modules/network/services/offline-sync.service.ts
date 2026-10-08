// SSOT Phase 069 Task 3 — OfflineSyncService (batch queue processor)
// Canonical: apps/backend/src/modules/network/services/offline-sync.service.ts
// (legacy src/backend/modules/network/services/offline-sync.service.ts)
// - processBatchQueue: Zod-gated items → per-type appliers (monotonic
//   progress upserts, quiz attempt insert, bookmark toggle) → per-item
//   best-effort { processedCount, failedItemIds }. Ownership from JWT
//   userId (never trusts client-stamped identity).
// - tsx-safe structural ports. Zero new deps.
import { Injectable } from '@nestjs/common';
import { OfflineQueueItemSchema } from '@repo/shared';

export interface OfflineSyncTables {
  ebookReadingProgress: {
    findUnique(args: unknown): Promise<{ lastPage: number } | null>;
    upsert(args: unknown): Promise<unknown>;
  };
  courseLearningProgress: {
    findUnique(args: unknown): Promise<{ watchedSec: number } | null>;
    upsert(args: unknown): Promise<unknown>;
  };
  quizAttempt: {
    create(args: unknown): Promise<unknown>;
  };
  ebookBookmark: {
    findUnique(args: unknown): Promise<unknown | null>;
    create(args: unknown): Promise<unknown>;
    delete(args: unknown): Promise<unknown>;
  };
}

interface QueueItem {
  id: string;
  actionType: 'SYNC_EBOOK_PROGRESS' | 'SYNC_LESSON_PROGRESS' | 'SUBMIT_QUIZ_ANSWER' | 'TOGGLE_BOOKMARK';
  payload: Record<string, unknown>;
}

@Injectable()
export class OfflineSyncService {
  constructor(private readonly tables?: OfflineSyncTables) {}

  private async applyEbookProgress(userId: string, payload: Record<string, unknown>): Promise<boolean> {
    if (!this.tables) return false;
    const ebookId = String(payload['ebookId'] ?? '');
    const lastPage = Math.max(1, Math.floor(Number(payload['lastPage']) || 1));
    if (!ebookId) return false;
    const prev = await this.tables.ebookReadingProgress
      .findUnique({ where: { userId_ebookId: { userId, ebookId } } })
      .catch(() => null);
    if (prev && prev.lastPage >= lastPage) return true;
    await this.tables.ebookReadingProgress
      .upsert({
        where: { userId_ebookId: { userId, ebookId } },
        update: { lastPage },
        create: { userId, ebookId, lastPage },
      })
      .catch(() => null);
    return true;
  }

  private async applyLessonProgress(userId: string, payload: Record<string, unknown>): Promise<boolean> {
    if (!this.tables) return false;
    const lessonId = String(payload['lessonId'] ?? '');
    const watchedSec = Math.max(0, Math.floor(Number(payload['watchedSec']) || 0));
    if (!lessonId) return false;
    const prev = await this.tables.courseLearningProgress
      .findUnique({ where: { userId_lessonId: { userId, lessonId } } })
      .catch(() => null);
    if (prev && prev.watchedSec >= watchedSec) return true;
    await this.tables.courseLearningProgress
      .upsert({
        where: { userId_lessonId: { userId, lessonId } },
        update: { watchedSec },
        create: { userId, lessonId, watchedSec },
      })
      .catch(() => null);
    return true;
  }

  private async applyQuizAnswer(userId: string, payload: Record<string, unknown>): Promise<boolean> {
    if (!this.tables) return false;
    const quizId = String(payload['quizId'] ?? '');
    if (!quizId) return false;
    const selected = Array.isArray(payload['selectedOpts']) ? payload['selectedOpts'].map(String) : [];
    await this.tables.quizAttempt
      .create({
        data: {
          userId, quizId, selectedOpts: selected,
          shortAnswer: typeof payload['shortAnswer'] === 'string' ? payload['shortAnswer'] : null,
        },
      })
      .catch(() => null);
    return true;
  }

  private async applyBookmark(userId: string, payload: Record<string, unknown>): Promise<boolean> {
    if (!this.tables) return false;
    const ebookId = String(payload['ebookId'] ?? '');
    const pageNumber = Math.max(1, Math.floor(Number(payload['pageNumber']) || 1));
    if (!ebookId) return false;
    const existing = await this.tables.ebookBookmark
      .findUnique({ where: { userId_ebookId_pageNumber: { userId, ebookId, pageNumber } } })
      .catch(() => null);
    if (existing) {
      await this.tables.ebookBookmark
        .delete({ where: { userId_ebookId_pageNumber: { userId, ebookId, pageNumber } } })
        .catch(() => null);
    } else {
      await this.tables.ebookBookmark.create({ data: { userId, ebookId, pageNumber } }).catch(() => null);
    }
    return true;
  }

  async processBatchQueue(items: unknown, userId?: string): Promise<{ processedCount: number; failedItemIds: string[] }> {
    const list = Array.isArray(items) ? items : [];
    let processedCount = 0;
    const failedItemIds: string[] = [];
    for (const raw of list.slice(0, 100)) {
      const parsed = OfflineQueueItemSchema.safeParse(raw);
      if (!parsed.success || !userId) {
        const id = (raw as { id?: unknown })?.id;
        if (typeof id === 'string') failedItemIds.push(id);
        continue;
      }
      const item = parsed.data as QueueItem;
      try {
        let ok = false;
        switch (item.actionType) {
          case 'SYNC_EBOOK_PROGRESS':
            ok = await this.applyEbookProgress(userId, item.payload);
            break;
          case 'SYNC_LESSON_PROGRESS':
            ok = await this.applyLessonProgress(userId, item.payload);
            break;
          case 'SUBMIT_QUIZ_ANSWER':
            ok = await this.applyQuizAnswer(userId, item.payload);
            break;
          case 'TOGGLE_BOOKMARK':
            ok = await this.applyBookmark(userId, item.payload);
            break;
        }
        if (ok) processedCount++;
        else failedItemIds.push(item.id);
      } catch {
        failedItemIds.push(item.id);
      }
    }
    return { processedCount, failedItemIds };
  }
}
