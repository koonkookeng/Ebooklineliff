// SSOT Phase 046 Task 1 — Progress sync Zod contract
// Canonical: packages/shared/src/schemas/progress-sync.schema.ts
// (legacy src/shared/schemas/progress-sync.schema.ts)
// - Spec-verbatim: SyncProgressInputSchema (with clientTimestamp) /
//   SyncProgressPayloadSchema / LessonStreamStateSchema (§3.1 Gate 1).
// - Additive (zero-dep): buffer/heatmap key builders, 5s-bucket helper,
//   write-behind budgets, beacon payload envelope.
import { z } from 'zod';

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
