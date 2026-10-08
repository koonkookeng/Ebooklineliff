// SSOT Phase 063 §3.1 — Offline chunk cache + DRM lease contracts
// Canonical: packages/shared/src/schemas/offline-sync.schema.ts
// (legacy src/shared/schemas/offline-sync.schema.ts)
// - Verbatim shapes from §3.1: OfflineStorageTypeEnum, SyncStatusEnum,
//   DrmLeaseToken, OfflineEbookChunk, OfflineVideoSegment,
//   OfflineProgressSyncPayload.
// - Budgets: lease 7d (renew ≤24h to expiry); quota warn <50MB free;
//   parallel prefetch 5; IDB cells small (single chunk/segment, RAM <30MB).
// - Browser-safe: ArrayBuffer fields typed via custom guard (zod browser
//   quirk documented below). Zero new deps.
import { z } from 'zod';

export const OfflineStorageTypeEnum = z.enum(['EBOOK_CHUNK', 'VIDEO_SEGMENT', 'TENANT_ASSET']);
export type OfflineStorageType = z.infer<typeof OfflineStorageTypeEnum>;

export const SyncStatusEnum = z.enum(['PENDING', 'SYNCING', 'SYNCED', 'FAILED']);
export type SyncStatus = z.infer<typeof SyncStatusEnum>;

export const DrmLeaseTokenSchema = z.object({
  leaseId: z.string().uuid(),
  userId: z.string(),
  productId: z.string(),
  cryptoKeyHash: z.string(),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  maxOfflineDays: z.number().int().default(7),
  signature: z.string(),
});
export type DrmLeaseToken = z.infer<typeof DrmLeaseTokenSchema>;

export const OfflineEbookChunkSchema = z.object({
  productId: z.string(),
  pageNumber: z.number().int().positive(),
  encryptedSvgData: z.string(),
  iv: z.string(),
  chunkSizeByte: z.number().int(),
  updatedAt: z.number(),
});
export type OfflineEbookChunk = z.infer<typeof OfflineEbookChunkSchema>;

const ArrayBufferSchema = z.custom<ArrayBuffer>(
  (v) => v instanceof ArrayBuffer,
  { message: 'Expected ArrayBuffer' },
);

export const OfflineVideoSegmentSchema = z.object({
  courseId: z.string(),
  lessonId: z.string(),
  segmentName: z.string(),
  encryptedArrayBuffer: ArrayBufferSchema,
  segmentIndex: z.number().int(),
  updatedAt: z.number(),
});
export type OfflineVideoSegment = z.infer<typeof OfflineVideoSegmentSchema>;

export const OfflineProgressSyncPayloadSchema = z.object({
  userId: z.string(),
  ebookProgress: z.array(
    z.object({
      productId: z.string(),
      lastPage: z.number().int(),
      timestamp: z.number(),
    }),
  ),
  courseProgress: z.array(
    z.object({
      lessonId: z.string(),
      watchedSec: z.number().int(),
      isCompleted: z.boolean(),
      timestamp: z.number(),
    }),
  ),
});
export type OfflineProgressSyncPayload = z.infer<typeof OfflineProgressSyncPayloadSchema>;

// ---------- §2.1/§8.1 budgets + lease policy (single source) ----------
export const OFFLINE_LEASE_DAYS = 7;
export const OFFLINE_LEASE_RENEW_WITHIN_MS = 24 * 60 * 60 * 1000;
export const OFFLINE_QUOTA_WARN_MB = 50;
export const OFFLINE_PREFETCH_CONCURRENCY = 5;
export const OFFLINE_DB_NAME = 'AhongOfflineOmniCacheDB';

export function leaseExpiringSoon(expiresAtMs: number, nowMs: number = Date.now()): boolean {
  return expiresAtMs - nowMs < OFFLINE_LEASE_RENEW_WITHIN_MS;
}

export function leaseIsUsable(expiresAtMs: number, nowMs: number = Date.now()): boolean {
  return expiresAtMs > nowMs;
}

export function quotaWarnNeeded(freeMb: number): boolean {
  return freeMb < OFFLINE_QUOTA_WARN_MB;
}
