// SSOT Phase 102 §3.1 — live-to-VOD pipeline Zod domain contract
// Canonical: packages/shared/src/schemas/live-to-vod.schema.ts
// - Spec-verbatim: StreamWebhookEventSchema / TranscodeJobPayloadSchema /
//   VODStatusUpdatePayloadSchema (§3.1).
// - RISK_CALL: LiveSessionStatusEnum belongs to the 099 session lifecycle —
//   the 102 pipeline vocabulary lands as VodPipelineStatusEnum (bounded
//   contexts stay drift-free). No BullMQ (043 FIFO doctrine).
// - Pure helpers: job/progress keys, ladder, manifest. Zod only.
import { z } from 'zod';

export const VodPipelineStatusEnum = z.enum([
  'SCHEDULED',
  'LIVE_NOW',
  'PROCESSING_VOD',
  'VOD_AVAILABLE',
  'FAILED',
]);
export type VodPipelineStatus = z.infer<typeof VodPipelineStatusEnum>;

export const StreamWebhookEventSchema = z.object({
  eventId: z.string().uuid(),
  sessionId: z.string(),
  lessonId: z.string().uuid(),
  tenantId: z.string(),
  eventType: z.enum(['STREAM_START', 'STREAM_END', 'RECORDING_COMPLETE']),
  recordingUrl: z.string().url().optional(),
  timestamp: z.string().datetime(),
});
export type StreamWebhookEvent = z.infer<typeof StreamWebhookEventSchema>;

export const TranscodeJobPayloadSchema = z.object({
  sessionId: z.string(),
  lessonId: z.string().uuid(),
  tenantId: z.string(),
  rawSourceUrl: z.string().url(),
  targetResolutions: z.array(z.enum(['1080p', '720p', '480p'])),
  enableDRMEncryption: z.boolean().default(true),
});
export type TranscodeJobPayload = z.infer<typeof TranscodeJobPayloadSchema>;

export const VODStatusUpdatePayloadSchema = z.object({
  lessonId: z.string().uuid(),
  status: VodPipelineStatusEnum,
  hlsPlaylistUrl: z.string().url(),
  durationSec: z.number().int().nonnegative(),
  aiSummary: z.string().optional(),
});
export type VODStatusUpdatePayload = z.infer<typeof VODStatusUpdatePayloadSchema>;

/** Pipeline SLA: VOD ready <30s after STREAM_END (BDD-1). */
export const VOD_READY_BUDGET_SEC = 30;

/** Transcode ladder (multi-bitrate HLS, BDD-1). */
export const VOD_LADDER = ['1080p', '720p', '480p'] as const;

/** Job retry ceiling mirror (043 VIDEO_MAX_RETRIES doctrine). */
export const VOD_MAX_ATTEMPTS = 3;

/** Pipeline analytics stream (Gate 8). */
export const VOD_STREAM = 'stream:live:vod';

/** FIFO job ledger key for a session (idempotent enqueue). */
export function vodJobKey(sessionId: string): string {
  return `live:vod:job:${sessionId}`;
}

/** Progress probe key polled by the fallback player (BDD-2). */
export function vodProgressKey(lessonId: string): string {
  return `live:vod:progress:${lessonId}`;
}

/** R2 vault prefix for a session VOD ladder (zero-egress, Gate 6). */
export function vodR2Prefix(sessionId: string): string {
  return `live-vod/${sessionId}/hls`;
}

/** Clamp pipeline progress to 0–100. */
export function vodProgress(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((done / total) * 100)));
}
