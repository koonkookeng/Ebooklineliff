// SSOT Phase 064 §3.1 — Background progress-sync contracts
// Canonical: packages/shared/src/schemas/progress-sync.schema.ts
// (legacy src/shared/schemas/progress-sync.schema.ts)
// - Verbatim shapes from §3.1: ProgressTypeEnum, EbookProgressSyncItem,
//   CourseProgressSyncItem, BatchProgressSyncPayload, SyncResponse.
// - Budgets: batch <200ms; payloads <2KB; queue RAM <5MB; retry backoff
//   1s→30s ceiling; idempotency window 24h.
// - Browser-safe: pure Zod + batch/idempotency helpers. Zero new deps.
import { z } from 'zod';

export const ProgressTypeEnum = z.enum(['EBOOK_PAGE', 'COURSE_LESSON']);
export type ProgressType = z.infer<typeof ProgressTypeEnum>;

export const EbookProgressSyncItemSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  lastPage: z.number().int().positive(),
  chapterIndex: z.number().int().nonnegative().optional(),
  clientTimestamp: z.string().datetime(),
  signature: z.string(),
});
export type EbookProgressSyncItem = z.infer<typeof EbookProgressSyncItemSchema>;

export const CourseProgressSyncItemSchema = z.object({
  id: z.string().uuid(),
  lessonId: z.string().uuid(),
  watchedSec: z.number().int().nonnegative(),
  isCompleted: z.boolean(),
  clientTimestamp: z.string().datetime(),
  signature: z.string(),
});
export type CourseProgressSyncItem = z.infer<typeof CourseProgressSyncItemSchema>;

export const BatchProgressSyncPayloadSchema = z.object({
  syncBatchId: z.string().uuid(),
  userId: z.string().uuid(),
  ebookProgressList: z.array(EbookProgressSyncItemSchema),
  courseProgressList: z.array(CourseProgressSyncItemSchema),
});
export type BatchProgressSyncPayload = z.infer<typeof BatchProgressSyncPayloadSchema>;

export const SyncResponseSchema = z.object({
  success: z.boolean(),
  syncedEbookIds: z.array(z.string()),
  syncedLessonIds: z.array(z.string()),
  conflictsResolved: z.number().int(),
  serverTimestamp: z.string().datetime(),
});
export type SyncResponse = z.infer<typeof SyncResponseSchema>;

// ---------- §8.1/§10 budgets + idempotency policy (single source) ----------
export const SYNC_BATCH_BUDGET_MS = 200;
export const SYNC_PAYLOAD_MAX_BYTES = 2048;
export const SYNC_QUEUE_RAM_MB = 5;
export const SYNC_IDEMPOTENCY_TTL_SEC = 24 * 60 * 60;
export const SYNC_BACKOFF_BASE_MS = 1000;
export const SYNC_BACKOFF_MAX_MS = 30000;
export const SYNC_STALE_QUEUE_LIMIT = 50;

export function syncBatchDedupeKey(syncBatchId: string): string {
  return `progress:batch:${syncBatchId}`;
}

/** Canonical HMAC body for an item (server signs/verifies, §8.1). */
export function syncItemCanonical(entityId: string, progress: number, clientTimestamp: string): string {
  return `${entityId}:${progress}:${clientTimestamp}`;
}

/** Exponential backoff with 30s ceiling (§2.2 ERROR retry). */
export function syncBackoffMs(retryCount: number): number {
  const n = Number.isInteger(retryCount) && retryCount > 0 ? retryCount : 1;
  return Math.min(SYNC_BACKOFF_MAX_MS, SYNC_BACKOFF_BASE_MS * 2 ** (n - 1));
}

// ---------- Phase 046 write-behind contracts (expand-contract preserved) ----------
// SSOT Phase 046 — write-behind progress sync (used by stream/progress + reader).
// Kept verbatim so Phase 045/046/054/057 imports keep resolving (zero-duplication).

export const SyncProgressInputSchema = z.object({
  lessonId: z.string().uuid(),
  watchedSec: z.number().int().nonnegative(),
  durationSec: z.number().int().positive(),
  isCompleted: z.boolean().default(false),
  clientTimestamp: z.string().datetime(),
});
export type SyncProgressInput = z.infer<typeof SyncProgressInputSchema>;

export const SyncProgressPayloadSchema = z.object({
  success: z.boolean(),
  lessonId: z.string().uuid(),
  savedWatchedSec: z.number().int().nonnegative(),
  isCompleted: z.boolean(),
  serverTimestamp: z.string().datetime(),
});
export type SyncProgressPayload = z.infer<typeof SyncProgressPayloadSchema>;

export const LessonStreamStateSchema = z.object({
  lessonId: z.string().uuid(),
  hlsPlaylistUrl: z.string().url(),
  lastWatchedSec: z.number().int().nonnegative(),
  durationSec: z.number().int().positive(),
  isCompleted: z.boolean(),
});
export type LessonStreamState = z.infer<typeof LessonStreamStateSchema>;

/** §4.2 heartbeat cadence (client) and flush cadence (server). */
export const PROGRESS_SYNC_INTERVAL_MS = 5000;
export const PROGRESS_FLUSH_INTERVAL_SEC = 30;
/** §8.1 rate limit: 2 requests per 5s window per user. */
export const PROGRESS_RATE_LIMIT = 2;
export const PROGRESS_RATE_WINDOW_SEC = 5;
/** §5.2 completion rule for the buffer path (≥95% watched). */
export const PROGRESS_COMPLETION_RATIO = 0.95;

/** §4.2 Redis Hash holding one viewer's latest position. */
export function progressBufferKey(userId: string, lessonId: string): string {
  return `progress:buffer:${userId}:${lessonId}`;
}
/** §7.1 Redis ZSET of 5-second presence buckets for the heatmap. */
export function heatmapKey(lessonId: string): string {
  return `heatmap:video:${lessonId}`;
}
/** 5-second bucket for drop-off aggregation (§5.2). */
export function secondBucket(watchedSec: number): number {
  return Math.floor(Math.max(0, watchedSec) / 5) * 5;
}
/** Buffer completion rule (spec §5.2 verbatim). */
export function bufferCompleted(watchedSec: number, durationSec: number, flagged: boolean): boolean {
  if (flagged) return true;
  if (durationSec <= 0) return false;
  return watchedSec >= Math.floor(durationSec * PROGRESS_COMPLETION_RATIO);
}

/** sendBeacon envelope (spec §5.2: userId rides the body — no headers). */
export const BeaconProgressSchema = z.object({
  userId: z.string().min(1),
  input: SyncProgressInputSchema,
});
export type BeaconProgress = z.infer<typeof BeaconProgressSchema>;
