// SSOT Phase 062 §5.1 — ProcessBulkSync use-case (offline flush executor)
// Canonical: apps/backend/src/modules/offline-sync/application/use-cases/process-bulk-sync.use-case.ts
// - Validates (ownership + target taxonomy) → applies per item:
//   EBOOK_PROGRESS → monotonic page upsert; COURSE_PROGRESS → monotonic
//   watch upsert; OFFLINE_ANALYTICS → stream sink (best-effort).
// - Session ledger per flush (Gate 7); per-item failures → failedIds, never
//   fail the batch. tsx-safe. Zero new deps.
import { Injectable } from '@nestjs/common';
import type { BulkOfflineSyncResponse } from '@repo/shared';
import { foldOutcomes, type ItemOutcome } from '../../domain/entities/sync-item.entity';
import { asCourseProgress, asEbookProgress } from '../../domain/value-objects/sync-target.vo';
import { OfflineSyncRepository } from '../../infrastructure/repositories/offline-sync.repository';
import { validateOfflineQueue } from './validate-offline-queue.use-case';

@Injectable()
export class ProcessBulkSyncUseCase {
  constructor(
    private readonly ledger?: OfflineSyncRepository,
    private readonly onAnalytics?: (event: { userId: string; targetType: string; payload: Record<string, unknown> }) => void,
  ) {}

  async execute(jwtUserId: string, body: unknown, deviceLabel?: string): Promise<BulkOfflineSyncResponse> {
    const { deviceId, valid, invalidIds } = validateOfflineQueue(jwtUserId, body);
    const outcomes: Array<{ id: string; outcome: ItemOutcome }> = invalidIds.map((id) => ({ id, outcome: 'FAILED_IDENTITY' as ItemOutcome }));
    const device = typeof deviceLabel === 'string' && deviceLabel.length > 0 ? deviceLabel : deviceId;

    for (const item of valid) {
      const payload = (item.payload ?? {}) as Record<string, unknown>;
      if (item.targetType === 'EBOOK_PROGRESS') {
        const p = asEbookProgress(payload);
        const ok = p ? await this.ledger?.saveEbookProgress(item.userId, p.ebookId, p.lastPage, device) : false;
        outcomes.push({ id: item.id, outcome: ok ? 'PROCESSED' : 'FAILED_STORE' });
      } else if (item.targetType === 'COURSE_PROGRESS') {
        const p = asCourseProgress(payload);
        const ok = p ? await this.ledger?.saveCourseProgress(item.userId, p.lessonId, p.watchedSec, p.isCompleted === true, device) : false;
        outcomes.push({ id: item.id, outcome: ok ? 'PROCESSED' : 'FAILED_STORE' });
      } else {
        try {
          this.onAnalytics?.({ userId: item.userId, targetType: item.targetType, payload });
          outcomes.push({ id: item.id, outcome: 'PROCESSED' });
        } catch {
          outcomes.push({ id: item.id, outcome: 'FAILED_STORE' });
        }
      }
    }

    const { processedCount, failedIds } = foldOutcomes(outcomes);
    const status = failedIds.length === 0 ? 'SUCCESS' : processedCount > 0 ? 'PARTIAL' : 'FAILED';
    await this.ledger?.recordSessionLedger(jwtUserId, device, 'BULK_FLUSH', valid.length, status).catch(() => undefined);
    return { success: failedIds.length === 0, processedCount, failedIds, serverTimestamp: Date.now() };
  }
}
