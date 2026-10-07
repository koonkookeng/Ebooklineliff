// SSOT Phase 045 Task 1 — Stream playback Zod contract
// Canonical: packages/shared/src/schemas/stream-contract.ts
// (legacy src/shared/schemas/stream-contract.ts)
// - Spec-verbatim: PlaybackSpeedEnum / VideoQualityEnum /
//   LessonStreamPayloadSchema / SyncLessonProgressSchema /
//   ProgressSyncResponseSchema (§3.1 Gate 1).
// - Additive (zero-dep): resume/completion helpers, drop-off stream key,
//   lesson-state cache TTL.
import { z } from 'zod';

export const PlaybackSpeedEnum = z.enum([
  '0.5', '0.75', '1.0', '1.25', '1.5', '1.75', '2.0', '2.25', '2.5',
]);
export type PlaybackSpeed = z.infer<typeof PlaybackSpeedEnum>;

export const VideoQualityEnum = z.enum(['AUTO', '1080P', '720P', '480P', '360P']);
export type StreamVideoQuality = z.infer<typeof VideoQualityEnum>;

export const LessonStreamPayloadSchema = z.object({
  lessonId: z.string().uuid(),
  hlsManifestUrl: z.string().url(),
  signedEdgeToken: z.string().min(1),
  lastWatchedSec: z.number().int().nonnegative(),
  durationSec: z.number().int().positive(),
  forensicWatermark: z.object({
    userIdHash: z.string().min(1),
    displayName: z.string().min(1),
    timestamp: z.string().datetime(),
  }),
});
export type LessonStreamPayload = z.infer<typeof LessonStreamPayloadSchema>;

export const SyncLessonProgressSchema = z.object({
  lessonId: z.string().uuid(),
  watchedSec: z.number().int().nonnegative(),
  durationSec: z.number().int().positive(),
  isCompleted: z.boolean(),
});
export type SyncLessonProgress = z.infer<typeof SyncLessonProgressSchema>;

export const ProgressSyncResponseSchema = z.object({
  success: z.boolean(),
  updatedAt: z.string().datetime(),
  isCompleted: z.boolean(),
});
export type ProgressSyncResponse = z.infer<typeof ProgressSyncResponseSchema>;

/** §7.1 drop-off heatmap Redis Stream key. */
export const VIDEO_DROPOFF_STREAM = 'stream:video-dropoff-events';
/** Lesson-state edge cache TTL (60s; progress moves, manifest doesn't). */
export const LESSON_STATE_CACHE_SEC = 60;
/** Completion threshold: ≥90% watched counts as done (BDD + §5.2). */
export const LESSON_COMPLETION_RATIO = 0.9;

/** Completion rule shared by client heartbeat and server sync. */
export function isLessonCompleted(watchedSec: number, durationSec: number, flagged: boolean): boolean {
  if (flagged) return true;
  if (durationSec <= 0) return false;
  return watchedSec >= durationSec * LESSON_COMPLETION_RATIO;
}

/** Clamp a resume position into [0, duration]. */
export function clampResumeSec(lastWatchedSec: number, durationSec: number): number {
  if (!Number.isFinite(lastWatchedSec) || lastWatchedSec < 0) return 0;
  if (durationSec > 0 && lastWatchedSec >= durationSec) return Math.max(0, durationSec - 1);
  return Math.floor(lastWatchedSec);
}
