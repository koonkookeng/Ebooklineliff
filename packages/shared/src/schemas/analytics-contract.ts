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

// ---------------------------------------------------------------------------
// SSOT Phase 116 §3.1 — executive BI contracts (GMV/LTV/CAC/churn/cohort)
// (appended additively; the 052 telemetry section above is untouched.)
// - Spec-verbatim shapes: AnalyticsTimeRangeEnum / ExecutiveKpiOverview /
//   CohortRetentionData / ExecutiveBiDashboardPayload.
// - RISK_CALL: ids accept min(1) edge vocabulary (023-031 precedent);
//   calculatedAt accepts any datetime string (DB Date → ISO at the edge).
// - Pure math (rounded, zero-guarded): averageOrderValue, cac, ltv,
//   ltvToCac, churnRate, retentionPct, growthPct, rangeBounds,
//   cohortMonthKey, biSummaryKey. Budgets: 500ms query, 15min cache,
//   30-day churn window, 10M-row note (aggregates delegate to indexed
//   columns / DailyAnalyticsSnapshot — no full scans in request path).
export const AnalyticsTimeRangeEnum = z.enum([
  'TODAY',
  'YESTERDAY',
  'LAST_7_DAYS',
  'LAST_30_DAYS',
  'THIS_MONTH',
  'LAST_MONTH',
  'CUSTOM',
]);
export type AnalyticsTimeRange = z.infer<typeof AnalyticsTimeRangeEnum>;

export const ExecutiveKpiOverviewSchema = z.object({
  gmv: z.number(),
  netRevenue: z.number(),
  totalOrders: z.number().int(),
  averageOrderValue: z.number(),
  customerAcquisitionCost: z.number(),
  customerLifetimeValue: z.number(),
  churnRatePercentage: z.number(),
  activeUsersCount: z.number().int(),
  gmvGrowthPercentage: z.number(),
  ltvToCacRatio: z.number(),
});
export type ExecutiveKpiOverview = z.infer<typeof ExecutiveKpiOverviewSchema>;

export const CohortRetentionPeriodSchema = z.object({
  periodIndex: z.number().int(),
  activePercentage: z.number(),
  retainedUsers: z.number().int(),
});
export type CohortRetentionPeriod = z.infer<typeof CohortRetentionPeriodSchema>;

export const CohortRetentionDataSchema = z.object({
  cohortDate: z.string(),
  totalUsers: z.number().int(),
  retentionRates: z.array(CohortRetentionPeriodSchema),
});
export type CohortRetentionData = z.infer<typeof CohortRetentionDataSchema>;

export const ExecutiveBiDashboardPayloadSchema = z.object({
  kpiSummary: ExecutiveKpiOverviewSchema,
  cohortMatrix: z.array(CohortRetentionDataSchema),
  revenueBreakdownByProductType: z.object({
    physicalBook: z.number(),
    ebook: z.number(),
    course: z.number(),
    bundle: z.number(),
  }),
  calculatedAt: z.string(),
});
export type ExecutiveBiDashboardPayload = z.infer<typeof ExecutiveBiDashboardPayloadSchema>;

/** BI summary SLA: exact aggregates in under 500ms (BDD-1). */
export const BI_QUERY_SLA_MS = 500;
/** Executive summary cache TTL: 15 minutes (spec §5.1). */
export const BI_SUMMARY_CACHE_TTL_SEC = 900;
/** Churn inactivity threshold: >30 days without activity (BDD-2). */
export const CHURN_INACTIVITY_DAYS = 30;

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Average order value (0 when no orders). */
export function averageOrderValue(gmv: number, totalOrders: number): number {
  if (totalOrders <= 0) return 0;
  return round2(gmv / totalOrders);
}

/** Customer acquisition cost (0 when no customers). */
export function customerAcquisitionCost(totalAdSpend: number, totalCustomers: number): number {
  if (totalCustomers <= 0) return 0;
  return round2(totalAdSpend / totalCustomers);
}

/** Customer lifetime value (0 when no customers). */
export function customerLifetimeValue(gmv: number, totalCustomers: number): number {
  if (totalCustomers <= 0) return 0;
  return round2(gmv / totalCustomers);
}

/** LTV:CAC unit-economics ratio (0 when CAC is 0). */
export function ltvToCacRatio(ltv: number, cac: number): number {
  if (cac <= 0) return 0;
  return round2(ltv / cac);
}

/** Monthly churn % (churned / cohort start, 0 when empty). */
export function churnRatePercentage(churnedUsers: number, cohortStart: number): number {
  if (cohortStart <= 0) return 0;
  return round2((churnedUsers / cohortStart) * 100);
}

/** Cohort retention % for one period (0..100). */
export function retentionPercentage(retainedUsers: number, totalUsers: number): number {
  if (totalUsers <= 0) return 0;
  return round2(Math.min(100, Math.max(0, (retainedUsers / totalUsers) * 100)));
}

/** Period-over-period growth % (0 when baseline is 0). */
export function growthPercentage(current: number, previous: number): number {
  if (previous === 0) return current === 0 ? 0 : 100;
  return round2(((current - previous) / Math.abs(previous)) * 100);
}

/** Cohort month key (UTC YYYY-MM) for acquisition grouping. */
export function cohortMonthKey(at: Date | string): string {
  const d = new Date(at);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Month offset between two dates (periodIndex for the matrix). */
export function monthOffset(from: Date | string | number, to: Date | string | number): number {
  const a = new Date(from);
  const b = new Date(to);
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
}

/** Redis key for a pre-computed executive summary. */
export function biSummaryKey(tenantId: string, timeRange: string): string {
  return `bi:summary:${tenantId}:${timeRange}`;
}

/** Redis key for a cohort matrix snapshot. */
export function biCohortKey(tenantId: string, asOf: string): string {
  return `bi:cohort:${tenantId}:${asOf}`;
}
