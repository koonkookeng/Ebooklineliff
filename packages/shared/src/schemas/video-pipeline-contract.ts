// SSOT Phase 043 Task 1 — Video pipeline Zod contract
// Canonical: packages/shared/src/schemas/video-pipeline-contract.ts
// (legacy src/shared/schemas/video-pipeline-contract.ts)
// - Spec-verbatim: VideoStatusEnum / VideoResolutionEnum /
//   InitiateUploadSchema / VideoTranscodeJobPayloadSchema /
//   HlsManifestStreamPayloadSchema (§3.1 Gate 1).
// - Additive (zero-dep): rendition ladder, part sizes, TTLs, key helpers,
//   worker webhook envelope (§5.2), progress payload (§7.1).
import { z } from 'zod';

export const VideoStatusEnum = z.enum([
  'PENDING_UPLOAD',
  'UPLOADING',
  'TRANSCODING_QUEUED',
  'TRANSCODING_PROCESSING',
  'READY',
  'FAILED',
]);
export type VideoStatus = z.infer<typeof VideoStatusEnum>;

export const VideoResolutionEnum = z.enum(['RES_1080P', 'RES_720P', 'RES_480P', 'RES_360P']);
export type VideoResolution = z.infer<typeof VideoResolutionEnum>;

export const InitiateUploadSchema = z.object({
  lessonId: z.string().uuid(),
  fileName: z.string().min(1),
  fileSizeBytes: z.number().positive(),
  mimeType: z.string().refine((val) => ['video/mp4', 'video/quicktime', 'video/x-matroska'].includes(val), {
    message: 'Unsupported video format',
  }),
});
export type InitiateUpload = z.infer<typeof InitiateUploadSchema>;

export const VideoTranscodeJobPayloadSchema = z.object({
  jobId: z.string().uuid(),
  videoId: z.string().uuid(),
  rawR2Key: z.string().min(1),
  outputPrefix: z.string().min(1),
  resolutions: z.array(VideoResolutionEnum).min(1),
  enableEncryption: z.boolean().default(true),
});
export type VideoTranscodeJobPayload = z.infer<typeof VideoTranscodeJobPayloadSchema>;

export const HlsManifestStreamPayloadSchema = z.object({
  videoId: z.string().uuid(),
  masterPlaylistUrl: z.string().url(),
  securityToken: z.string().min(1),
  expiresAt: z.string().datetime(),
  watermarkMetadata: z.object({
    userIdHash: z.string().min(1),
    displayName: z.string().min(1),
    ipAddress: z.string().min(1),
  }),
});
export type HlsManifestStreamPayload = z.infer<typeof HlsManifestStreamPayloadSchema>;

/** §5.1 rendition ladder (bitrate ladder mirrors the FFmpeg -b:v map). */
export const VIDEO_RENDITION_LADDER: Array<{ resolution: VideoResolution; width: number; height: number; bitrateBps: number; audioBps: number }> = [
  { resolution: 'RES_1080P', width: 1920, height: 1080, bitrateBps: 5_000_000, audioBps: 192_000 },
  { resolution: 'RES_720P', width: 1280, height: 720, bitrateBps: 2_800_000, audioBps: 128_000 },
  { resolution: 'RES_480P', width: 854, height: 480, bitrateBps: 1_400_000, audioBps: 96_000 },
  { resolution: 'RES_360P', width: 640, height: 360, bitrateBps: 800_000, audioBps: 64_000 },
];
/** BDD-1: direct-to-R2 part size (10MB chunks, zero-egress). */
export const VIDEO_UPLOAD_PART_BYTES = 10 * 1024 * 1024;
/** BDD-1: worker dispatch budget after R2 ObjectCreated (<200ms). */
export const VIDEO_DISPATCH_BUDGET_MS = 200;
/** Transcode retry ceiling before FAILED (Phase 038 queue precedent). */
export const VIDEO_MAX_RETRIES = 3;
/** §7.1 watch-progress cadence (client telemetry every 5s). */
export const VIDEO_PROGRESS_SYNC_SEC = 5;
/** Manifest/token TTL for short-lived playback auth (BDD-3). */
export const VIDEO_TOKEN_TTL_SEC = 300;
/** Gate 5: HLS player RAM ceiling on LIFF (buffer-capped). */
export const VIDEO_RAM_BUDGET_MB = 40;

/** Raw upload prefix for a video asset (parts land underneath). */
export function rawVideoPrefix(videoId: string): string {
  return `raw-videos/${videoId}`;
}
/** R2 key for one upload part (1-indexed). */
export function rawVideoPartKey(videoId: string, partNumber: number): string {
  return `${rawVideoPrefix(videoId)}/part-${String(partNumber).padStart(5, '0')}`;
}
/** HLS output prefix for a video asset. */
export function hlsOutputPrefix(videoId: string): string {
  return `courses/hls/${videoId}`;
}
/** Master playlist key inside the HLS prefix. */
export function hlsMasterKey(videoId: string): string {
  return `${hlsOutputPrefix(videoId)}/master.m3u8`;
}
/** Variant playlist key for one rendition. */
export function hlsVariantKey(videoId: string, resolution: VideoResolution): string {
  return `${hlsOutputPrefix(videoId)}/${resolution}/prog_index.m3u8`;
}
/** AES-128 key object key (per-lesson rotation, never CDN-cached). */
export function hlsKeyObjectKey(videoId: string, keyId: string): string {
  return `${hlsOutputPrefix(videoId)}/keys/${keyId}.key`;
}

/** §5.2 worker → backend webhook envelope (VIDEO_RAW_UPLOADED). */
export const VideoWorkerEventSchema = z.object({
  event: z.literal('VIDEO_RAW_UPLOADED'),
  r2Key: z.string().min(1),
  size: z.number().nonnegative(),
  timestamp: z.string().datetime(),
});
export type VideoWorkerEvent = z.infer<typeof VideoWorkerEventSchema>;

/** §7.1 client watch-progress report. */
export const VideoProgressReportSchema = z.object({
  lessonId: z.string().uuid(),
  watchedSec: z.number().int().nonnegative(),
});
export type VideoProgressReport = z.infer<typeof VideoProgressReportSchema>;
