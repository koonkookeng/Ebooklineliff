// SSOT Phase 062 §5.1 — ValidateOfflineQueue use-case (pure gate)
// Canonical: apps/backend/src/modules/offline-sync/application/use-cases/validate-offline-queue.use-case.ts
// - Shape-validates the bulk envelope + per-item Zod parse + ownership vs
//   the JWT identity. Returns partitioned valid/invalid lists (invalid →
//   failedIds, never stored). Pure + tsx-safe. Zero new deps.
import { BulkOfflineSyncPayloadSchema, type OfflineSyncQueueItem } from '@repo/shared';
import { isOwnedBy } from '../../domain/entities/sync-item.entity';
import { parseSyncTarget } from '../../domain/value-objects/sync-target.vo';

export interface QueueValidation {
  deviceId: string;
  valid: OfflineSyncQueueItem[];
  invalidIds: string[];
}

export function validateOfflineQueue(jwtUserId: string, body: unknown): QueueValidation {
  const parsed = BulkOfflineSyncPayloadSchema.safeParse(body);
  if (!parsed.success) return { deviceId: 'unknown', valid: [], invalidIds: [] };
  const valid: OfflineSyncQueueItem[] = [];
  const invalidIds: string[] = [];
  for (const item of parsed.data.syncItems) {
    if (!isOwnedBy(item, jwtUserId)) {
      invalidIds.push(item.id);
      continue;
    }
    if (!parseSyncTarget(item.targetType)) {
      invalidIds.push(item.id);
      continue;
    }
    valid.push(item);
  }
  return { deviceId: parsed.data.deviceId, valid, invalidIds };
}
