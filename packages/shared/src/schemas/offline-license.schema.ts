// SSOT Phase 068 §3.1 — Download manager + offline license contracts (verbatim)
// Canonical: packages/shared/src/schemas/offline-license.schema.ts
// (legacy src/shared/schemas/offline-license.schema.ts)
// - Verbatim shapes from §3.1: DownloadStatusEnum, StorageCategoryEnum,
//   DownloadTaskSchema, StorageQuotaSchema, OfflineLicenseTokenSchema.
// - Budgets: crypto chunk ≤2MB; RAM <30MB (streaming decrypt); default
//   quota 5GB; storage warning <10% free; license 7d default / 30d max.
// - Browser-safe: pure Zod + quota/progress/key helpers. Zero new deps.
import { z } from 'zod';

export const DownloadStatusEnum = z.enum([
  'IDLE',
  'QUEUED',
  'DOWNLOADING',
  'PAUSED',
  'COMPLETED',
  'FAILED',
  'EXPIRED',
]);
export type DownloadStatus = z.infer<typeof DownloadStatusEnum>;

export const StorageCategoryEnum = z.enum([
  'EBOOK_VECTOR_CHUNK',
  'COURSE_HLS_SEGMENT',
  'AUDIOBOOK_STREAM',
  'OFFLINE_ASSET',
]);
export type StorageCategory = z.infer<typeof StorageCategoryEnum>;

export const DownloadTaskSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  tenantId: z.string(),
  title: z.string(),
  category: StorageCategoryEnum,
  totalBytes: z.number().int().positive(),
  downloadedBytes: z.number().int().nonnegative(),
  status: DownloadStatusEnum,
  downloadSpeedBps: z.number().default(0),
  progressPercentage: z.number().min(0).max(100),
  storageLocation: z.enum(['OPFS', 'INDEXED_DB']),
  expiresAt: z.string().datetime(),
});
export type DownloadTask = z.infer<typeof DownloadTaskSchema>;

export const StorageQuotaSchema = z.object({
  totalGrantedQuotaBytes: z.number(),
  usedStorageBytes: z.number(),
  availableStorageBytes: z.number(),
  categoryBreakdown: z.object({
    ebookBytes: z.number(),
    courseBytes: z.number(),
    audioBytes: z.number(),
  }),
});
export type StorageQuota = z.infer<typeof StorageQuotaSchema>;

export const OfflineLicenseTokenSchema = z.object({
  licenseId: z.string().uuid(),
  userIdHash: z.string(),
  productId: z.string().uuid(),
  deviceIdHash: z.string(),
  signature: z.string(),
  issuedAt: z.string().datetime(),
  validUntil: z.string().datetime(),
  maxOfflineDays: z.number().int().positive(),
});
export type OfflineLicenseToken = z.infer<typeof OfflineLicenseTokenSchema>;

// ---------- §5/§8 budgets + keys (single source) ----------
export const DOWNLOAD_CHUNK_BYTES = 2 * 1024 * 1024;
export const DOWNLOAD_MAX_RAM_MB = 30;
export const DOWNLOAD_DEFAULT_QUOTA_BYTES = 5368709120;
export const DOWNLOAD_WARN_FREE_RATIO = 0.1;
export const OFFLINE_LICENSE_DEFAULT_DAYS = 7;
export const OFFLINE_LICENSE_MAX_DAYS = 30;
export const OFFLINE_LICENSE_STREAM = 'events:offline-license';

export function downloadTaskKey(productId: string, deviceIdHash: string): string {
  return `dl:${productId}:${deviceIdHash}`;
}

export function licenseChannel(userId: string): string {
  return `channel:license:${userId}`;
}

/** Canonical license body for HMAC sign/verify (§8.1 tamper-evidence). */
export function licenseCanonical(
  licenseId: string,
  userIdHash: string,
  productId: string,
  deviceIdHash: string,
  validUntil: string,
): string {
  return [licenseId, userIdHash, productId, deviceIdHash, validUntil].join(':');
}

/** Storage-warning trip: free ratio below 10% (§2.2 STORAGE_WARNING). */
export function isStorageLow(usedBytes: number, quotaBytes: number): boolean {
  if (quotaBytes <= 0) return true;
  return (quotaBytes - usedBytes) / quotaBytes < DOWNLOAD_WARN_FREE_RATIO;
}

/** Clamped 0–100 progress for the drawer bar. */
export function downloadProgress(downloadedBytes: number, totalBytes: number): number {
  if (totalBytes <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((downloadedBytes / totalBytes) * 100)));
}
