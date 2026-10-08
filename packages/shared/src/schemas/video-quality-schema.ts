// SSOT Phase 067 §3.1 — ABR video quality contracts (verbatim)
// Canonical: packages/shared/src/schemas/video-quality-schema.ts
// (legacy src/shared/schemas/video-quality-schema.ts)
// - Verbatim shapes from §3.1: VideoQualityLevelEnum, NetworkMetricsSchema,
//   VideoStreamManifestSchema, StreamTelemetryPayloadSchema.
// - Budgets: downscale detect ≤2 chunk cycles (4s); upscale needs >8Mbps
//   sustained 8s (anti-flapping hysteresis); buffer ≤3 chunks/12s; RAM
//   <30MB; telemetry fire-and-forget (never blocks playback).
// - Browser-safe: pure Zod + ladder/hysteresis/key helpers. Zero new deps.
import { z } from 'zod';

export const VideoQualityLevelEnum = z.enum([
  'AUTO',
  'QUALITY_1080P',
  'QUALITY_720P',
  'QUALITY_480P',
  'QUALITY_360P',
]);
export type VideoQualityLevel = z.infer<typeof VideoQualityLevelEnum>;

export const NetworkMetricsSchema = z.object({
  downlinkMbps: z.number().nonnegative(),
  rttMs: z.number().nonnegative(),
  effectiveType: z.enum(['slow-2g', '2g', '3g', '4g', '5g', 'wifi']),
  saveDataMode: z.boolean(),
});
export type NetworkMetrics = z.infer<typeof NetworkMetricsSchema>;

export const VideoStreamManifestSchema = z.object({
  lessonId: z.string().uuid(),
  masterPlaylistUrl: z.string().url(),
  variants: z.array(
    z.object({
      quality: VideoQualityLevelEnum,
      resolution: z.string(),
      bandwidthBps: z.number().int().positive(),
      playlistUrl: z.string().url(),
    }),
  ),
  watermarkText: z.string(),
});
export type VideoStreamManifest = z.infer<typeof VideoStreamManifestSchema>;

export const StreamTelemetryPayloadSchema = z.object({
  lessonId: z.string().uuid(),
  userId: z.string(),
  selectedQuality: VideoQualityLevelEnum,
  activeQuality: VideoQualityLevelEnum,
  measuredMbps: z.number(),
  bufferStallCount: z.number().int().nonnegative(),
  ramUsageMb: z.number(),
  timestamp: z.string().datetime(),
});
export type StreamTelemetryPayload = z.infer<typeof StreamTelemetryPayloadSchema>;

// ---------- §5.2 ladder + hysteresis budgets (single source) ----------
export interface QualityLadderRung {
  quality: Exclude<VideoQualityLevel, 'AUTO'>;
  resolution: string;
  bandwidthBps: number;
}

/** §5.2 verbatim ladder (4500/2500/1200/600 kbps). */
export const QUALITY_LADDER: QualityLadderRung[] = [
  { quality: 'QUALITY_1080P', resolution: '1920x1080', bandwidthBps: 4500000 },
  { quality: 'QUALITY_720P', resolution: '1280x720', bandwidthBps: 2500000 },
  { quality: 'QUALITY_480P', resolution: '854x480', bandwidthBps: 1200000 },
  { quality: 'QUALITY_360P', resolution: '640x360', bandwidthBps: 600000 },
];

export const ABR_DOWNSCALE_MBPS = 1.5;
export const ABR_UPSCALE_MBPS = 8;
export const ABR_UPSCALE_HOLD_SEC = 8;
export const ABR_MAX_BUFFER_SEC = 12;
export const ABR_MAX_BUFFER_MB = 15;
export const ABR_TELEMETRY_STREAM = 'events:stream-telemetry';

export function streamManifestKey(lessonId: string, userId: string): string {
  return `stream:manifest:${lessonId}:${userId}`;
}

export function streamTelemetryStream(): string {
  return ABR_TELEMETRY_STREAM;
}

/**
 * Pure ABR decision (§BDD-1/2): highest rung fitting the measured
 * throughput (BDD-1: 1.2Mbps sustains the 1200kbps 480p rung); saveData
 * caps at 480p; manual selection bypasses AUTO.
 * Hysteresis state (upscale hold) is caller-owned — see useNetworkBandwidth.
 */
export function selectQualityFor(
  measuredMbps: number,
  manual: VideoQualityLevel,
  saveDataMode: boolean,
): Exclude<VideoQualityLevel, 'AUTO'> {
  if (manual !== 'AUTO') return manual;
  const capIndex = saveDataMode ? ladderIndexOf('QUALITY_480P') : 0;
  const budgetBps = Math.max(0, measuredMbps) * 1000000;
  for (let i = capIndex; i < QUALITY_LADDER.length; i++) {
    if (QUALITY_LADDER[i].bandwidthBps <= budgetBps) return QUALITY_LADDER[i].quality;
  }
  return QUALITY_LADDER[QUALITY_LADDER.length - 1].quality;
}

/** String compare on rung order is unsafe — use ladder index instead. */
export function ladderIndexOf(quality: Exclude<VideoQualityLevel, 'AUTO'>): number {
  const ix = QUALITY_LADDER.findIndex((r) => r.quality === quality);
  return ix < 0 ? QUALITY_LADDER.length - 1 : ix;
}
