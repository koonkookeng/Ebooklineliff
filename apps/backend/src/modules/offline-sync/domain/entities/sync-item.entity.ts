// SSOT Phase 062 §5.1 — SyncItem entity (queue item lifecycle)
// Canonical: apps/backend/src/modules/offline-sync/domain/entities/sync-item.entity.ts
// - Pure, tsx-safe. Ownership check (zero-trust: item.userId must equal the
//   JWT identity), per-item outcome classification, bulk result folding.
// - Zero new deps.
import type { OfflineSyncQueueItem } from '@repo/shared';

export type ItemOutcome = 'PROCESSED' | 'FAILED_IDENTITY' | 'FAILED_PAYLOAD' | 'FAILED_STORE';

export function isOwnedBy(item: Pick<OfflineSyncQueueItem, 'userId'>, jwtUserId: string): boolean {
  return item.userId === jwtUserId;
}

export interface BulkFold {
  processedCount: number;
  failedIds: string[];
}

export function foldOutcomes(outcomes: Array<{ id: string; outcome: ItemOutcome }>): BulkFold {
  const failedIds: string[] = [];
  let processedCount = 0;
  for (const o of outcomes) {
    if (o.outcome === 'PROCESSED') processedCount++;
    else failedIds.push(o.id);
  }
  return { processedCount, failedIds };
}
