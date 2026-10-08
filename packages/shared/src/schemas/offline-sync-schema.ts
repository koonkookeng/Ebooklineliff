// SSOT Phase 062 §3.1 — Offline PWA sync contracts
// Canonical: packages/shared/src/schemas/offline-sync-schema.ts
// (legacy src/shared/schemas/offline-sync-schema.ts)
// - Verbatim shapes from §3.1: SyncTargetTypeEnum, OfflineSyncQueueItem,
//   BulkOfflineSyncPayload, BulkOfflineSyncResponse.
// - Budgets: chunk cells ≤100 entries/7d; CacheStorage ≤150MB/tenant;
//   bg-sync retention 24h; volatile window [N-1,N,N+1] <30MB RAM.
// - Browser-safe: pure Zod + queue/key helpers (no node:crypto). Zero deps.
import { z } from 'zod';

export const SyncTargetTypeEnum = z.enum(['EBOOK_PROGRESS', 'COURSE_PROGRESS', 'OFFLINE_ANALYTICS']);
export type SyncTargetType = z.infer<typeof SyncTargetTypeEnum>;

export const OfflineSyncQueueItemSchema = z.object({
  id: z.string().uuid(),
  userId: z.string(),
  tenantId: z.string(),
  targetType: SyncTargetTypeEnum,
  payload: z.record(z.unknown()),
  timestamp: z.number().int().positive(),
  retryCount: z.number().int().nonnegative().default(0),
});
export type OfflineSyncQueueItem = z.infer<typeof OfflineSyncQueueItemSchema>;

export const BulkOfflineSyncPayloadSchema = z.object({
  deviceId: z.string(),
  syncItems: z.array(OfflineSyncQueueItemSchema),
});
export type BulkOfflineSyncPayload = z.infer<typeof BulkOfflineSyncPayloadSchema>;

export const BulkOfflineSyncResponseSchema = z.object({
  success: z.boolean(),
  processedCount: z.number().int().nonnegative(),
  failedIds: z.array(z.string().uuid()),
  serverTimestamp: z.number().int().positive(),
});
export type BulkOfflineSyncResponse = z.infer<typeof BulkOfflineSyncResponseSchema>;

// ---------- §2.1/§4.2 budgets + PWA storage policy (single source) ----------
export const PWA_DB_NAME = 'zene_pwa_db';
export const PWA_CHUNK_STORE = 'ebook_chunks_store';
export const PWA_VIDEO_STORE = 'video_meta_store';
export const PWA_SYNC_STORE = 'sync_queue_store';
export const PWA_CHUNK_MAX_ENTRIES = 100;
export const PWA_CHUNK_MAX_AGE_SEC = 7 * 24 * 60 * 60;
export const PWA_CACHE_MAX_MB_PER_TENANT = 150;
export const PWA_BGSYNC_RETENTION_MIN = 24 * 60;
export const PWA_LIFF_RAM_MB = 30;
export const PWA_SYNC_STREAM_KEY = 'stream:offline:sync-events';

export function tenantCacheName(base: string, tenantId: string): string {
  const tenant = tenantId && tenantId.length > 0 ? tenantId : 'default';
  return `${base}-${tenant}-v1`;
}

export function chunkCellId(productId: string, pageNumber: number): string {
  return `${productId}_p${pageNumber}`;
}

/** Bulk cap per flush (keeps a single transaction small and fast). */
export function clampBatchSize(n: number, max = 100): number {
  if (!Number.isInteger(n) || n < 0) return 0;
  return Math.min(n, max);
}
