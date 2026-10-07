// SSOT Phase 044 Task 1 — Transcode job Zod contract
// Canonical: packages/shared/src/schemas/video-transcode.contract.ts
// (legacy src/shared/schemas/video-transcode.contract.ts — spec §3.1 names it
// video-transcode.contract.ts; the Phase 043 video-pipeline-contract.ts owns
// the asset/delivery half and stays untouched.)
// - Spec-verbatim: TranscodeQualityEnum / TranscodeStatusEnum /
//   VideoTranscodeJobSchema / HlsVariantMetadataSchema (§3.1 Gate 1).
// - Additive (zero-dep): 2MB segment ceiling (§6.1/§10), stage weights for
//   the studio stepper, lesson HLS prefix helpers, submit/progress shapes.
import { z } from 'zod';

export const TranscodeQualityEnum = z.enum(['RES_1080P', 'RES_720P', 'RES_480P', 'RES_360P']);
export type TranscodeQuality = z.infer<typeof TranscodeQualityEnum>;

export const TranscodeStatusEnum = z.enum([
  'QUEUED',
  'PROCESSING_UPLOAD',
  'TRANSCODING',
  'UPLOADING_R2',
  'COMPLETED',
  'FAILED',
]);
export type TranscodeStatus = z.infer<typeof TranscodeStatusEnum>;

export const VideoTranscodeJobSchema = z.object({
  jobId: z.string().uuid(),
  lessonId: z.string().uuid(),
  originalFileName: z.string().min(1),
  fileSizeBytes: z.number().positive(),
  durationSeconds: z.number().nonnegative(),
  status: TranscodeStatusEnum,
  progressPercentage: z.number().min(0).max(100),
  masterPlaylistUrl: z.string().url().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type VideoTranscodeJob = z.infer<typeof VideoTranscodeJobSchema>;

export const HlsVariantMetadataSchema = z.object({
  quality: TranscodeQualityEnum,
  bandwidthBitsPerSec: z.number().positive(),
  resolutionWidth: z.number().positive(),
  resolutionHeight: z.number().positive(),
  playlistFileName: z.string().min(1),
  chunkCount: z.number().int().positive(),
  averageChunkSizeBytes: z.number().positive().max(2097152),
});
export type HlsVariantMetadata = z.infer<typeof HlsVariantMetadataSchema>;

/** §6.1/§10: every .ts segment must stay at or under 2MB. */
export const HLS_SEGMENT_MAX_BYTES = 2097152;
/** §6.1 segment duration target (4s → ~1.5–2MB at ladder bitrates). */
export const HLS_SEGMENT_SECONDS = 4;
/** Studio stepper weights: upload / transcode / R2 sync shares of 100%. */
export const TRANSCODE_STAGE_WEIGHTS = { upload: 10, transcode: 60, r2sync: 30 } as const;
/** Progress poll cadence for the studio component. */
export const TRANSCODE_POLL_MS = 2000;

/** Lesson HLS prefix (§6.2 layout: courses/{lessonId}/hls/). */
export function lessonHlsPrefix(lessonId: string): string {
  return `courses/${lessonId}/hls`;
}
/** Master playlist key inside the lesson prefix. */
export function lessonMasterKey(lessonId: string): string {
  return `${lessonHlsPrefix(lessonId)}/master.m3u8`;
}
/** Variant playlist file name (§6.2: prog.m3u8 per stream). */
export function lessonVariantPlaylist(resolution: TranscodeQuality): string {
  return `prog-${resolution.toLowerCase().replace('res_', '')}.m3u8`;
}

/** Creator submit payload (REST boundary, Zod-gated). */
export const SubmitTranscodeJobSchema = z.object({
  lessonId: z.string().uuid(),
  originalFileName: z.string().min(1),
  fileSizeBytes: z.number().positive(),
  durationSeconds: z.number().nonnegative().default(0),
  rawR2Key: z.string().min(1),
});
export type SubmitTranscodeJob = z.infer<typeof SubmitTranscodeJobSchema>;
