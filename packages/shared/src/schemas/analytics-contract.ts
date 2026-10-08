// SSOT Phase 052 §3.1 — read/watch telemetry contracts (dwell + heartbeat + heatmap)
// Canonical: packages/shared/src/schemas/analytics-contract.ts
// (legacy src/shared/schemas/analytics-contract.ts)
// - Verbatim shapes from §3.1 (+ budgets/helpers shared by edge + LIFF hook).
// - Budgets: pulse ≤300s, dwell ≤3600s/event, payload <400B, ring ≤100 records,
//   flush 15s, heatmap 5s segments, ingest ≤30 pulses/min/user, 202 <25ms p99.
import { z } from 'zod';

export const AnalyticsEventTypeEnum = z.enum([
  'EBOOK_PAGE_DWELL',
  'VIDEO_WATCH_HEARTBEAT',
  'VIDEO_SEEK_EVENT',
  'VIDEO_PAUSE_EVENT',
  'VIDEO_COMPLETE_EVENT',
]);
export type AnalyticsEventType = z.infer<typeof AnalyticsEventTypeEnum>;

export const ReadTimeTrackingPayloadSchema = z.object({
  userId: z.string().uuid(),
  productId: z.string().uuid(),
  ebookId: z.string().uuid(),
  pageNumber: z.number().int().positive(),
  dwellTimeSec: z.number().min(1).max(3600),
  scrollDepthPercentage: z.number().min(0).max(100).default(100),
  timestamp: z.string().datetime(),
});

export const WatchTimeTrackingPayloadSchema = z.object({
  userId: z.string().uuid(),
  productId: z.string().uuid(),
  lessonId: z.string().uuid(),
  watchedSec: z.number().min(1).max(300),
  currentTimestampSec: z.number().nonnegative(),
  durationSec: z.number().positive(),
  playbackRate: z.number().min(0.5).max(3.0).default(1.0),
  timestamp: z.string().datetime(),
});

export const AnalyticsBatchIngestSchema = z.object({
  tenantId: z.string().default('default'),
  deviceInfo: z.object({
    userAgent: z.string(),
    isLiff: z.boolean(),
  }),
  readEvents: z.array(ReadTimeTrackingPayloadSchema).default([]),
  watchEvents: z.array(WatchTimeTrackingPayloadSchema).default([]),
});

export type ReadTimeTrackingPayload = z.infer<typeof ReadTimeTrackingPayloadSchema>;
export type WatchTimeTrackingPayload = z.infer<typeof WatchTimeTrackingPayloadSchema>;
export type AnalyticsBatchIngestPayload = z.infer<typeof AnalyticsBatchIngestSchema>;

// ---------- §7.2/§8/§10.2 budgets + helpers (single source) ----------
export const ANALYTICS_STREAM_KEY = 'stream:analytics:events';
export const ANALYTICS_HEARTBEAT_SEC = 5;
export const ANALYTICS_FLUSH_SEC = 15;
export const ANALYTICS_HEATMAP_SEGMENT_SEC = 5;
export const ANALYTICS_RING_CAP = 100;
export const ANALYTICS_PULSE_PER_MIN = 30;
export const ANALYTICS_DRAIN_BATCH_SEC = 10;
export const ANALYTICS_NIL_USER = '00000000-0000-0000-0000-000000000000';

export function analyticsPulseKey(userId: string, minuteBucket: number): string {
  return `analytics:pulse:${userId}:${minuteBucket}`;
}

export function heatmapSegmentIndex(secondOffset: number): number {
  return Math.floor(Math.max(0, secondOffset) / ANALYTICS_HEATMAP_SEGMENT_SEC);
}

/** 0.0–100.0% lesson completion from furthest watch position. */
export function completionRate(maxWatchedSec: number, durationSec: number): number {
  if (durationSec <= 0) return 0;
  return Math.min(100, Math.max(0, (maxWatchedSec / durationSec) * 100));
}

/** Drop-off share for a heatmap segment (0.0–1.0). */
export function dropoffRate(dropoffCount: number, viewCount: number): number {
  if (viewCount <= 0) return 0;
  return Math.min(1, Math.max(0, dropoffCount / viewCount));
}

/** Average dwell with zero-division guard for dashboard payloads. */
export function averageDwell(totalDwellSec: number, totalReads: number): number {
  if (totalReads <= 0) return 0;
  return totalDwellSec / totalReads;
}
