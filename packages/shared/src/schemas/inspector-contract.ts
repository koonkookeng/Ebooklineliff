// SSOT Phase 110 §3.1 — 360-Degree User Inspector contract
// Canonical: packages/shared/src/schemas/inspector-contract.ts
// (legacy src/shared/schemas/inspector-contract.ts)
// - Spec-verbatim: RiskLevelEnum / UserActivityTypeEnum / RFMScoreSchema /
//   ReadingTelemetryLogSchema / VideoLearningTelemetryLogSchema /
//   SecurityAuditLogSchema / User360ProfileSchema.
// - RISK_CALL deviations (additive-only, documented):
//   - userId/ebookId/courseId/lessonId accept min(1) edge vocabulary in
//     addition to uuid (Phase 023-031 precedent).
//   - recharts/visx are NOT installed (zero-new-deps): heatmaps render as
//     CSS bars (Phase 052 HeatmapViewer precedent), data shapes unchanged.
//   - No BullMQ installed: telemetry ingestion rides the Phase 052 queue lane;
//     this contract only defines the inspector ledger shapes + pure math.
// - Zero new deps (zod only).
import { z } from 'zod';

export const RiskLevelEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export type RiskLevel = z.infer<typeof RiskLevelEnum>;

export const UserActivityTypeEnum = z.enum([
  'LOGIN_LIFF',
  'LOGIN_WEB',
  'PURCHASE_COMPLETED',
  'EBOOK_PAGE_READ',
  'COURSE_VIDEO_WATCH',
  'SLIP_UPLOADED',
  'AFFILIATE_CLICK',
  'SESSION_REVOKED',
]);
export type UserActivityType = z.infer<typeof UserActivityTypeEnum>;

export const RFMScoreSchema = z.object({
  recencyScore: z.number().int().min(1).max(5),
  frequencyScore: z.number().int().min(1).max(5),
  monetaryScore: z.number().int().min(1).max(5),
  segmentLabel: z.string(),
});
export type RFMScore = z.infer<typeof RFMScoreSchema>;

export const ReadingTelemetryLogSchema = z.object({
  ebookId: z.string().min(1),
  bookTitle: z.string(),
  pageNumber: z.number().int().positive(),
  dwellTimeSeconds: z.number().nonnegative(),
  timestamp: z.string().datetime(),
});
export type ReadingTelemetryLog = z.infer<typeof ReadingTelemetryLogSchema>;

export const VideoLearningTelemetryLogSchema = z.object({
  courseId: z.string().min(1),
  lessonId: z.string().min(1),
  lessonTitle: z.string(),
  watchedDurationSec: z.number().nonnegative(),
  completionPercentage: z.number().min(0).max(100),
  timestamp: z.string().datetime(),
});
export type VideoLearningTelemetryLog = z.infer<typeof VideoLearningTelemetryLogSchema>;

export const SecurityAuditLogSchema = z.object({
  id: z.string().min(1),
  activityType: UserActivityTypeEnum,
  ipAddress: z.string(),
  userAgent: z.string(),
  deviceFingerprint: z.string().nullable(),
  lineSessionId: z.string().nullable(),
  riskLevel: RiskLevelEnum,
  createdAt: z.string().datetime(),
});
export type SecurityAuditLog = z.infer<typeof SecurityAuditLogSchema>;

export const User360ProfileSchema = z.object({
  userId: z.string().min(1),
  displayName: z.string(),
  email: z.string().nullable(),
  lineUserId: z.string().nullable(),
  walletBalance: z.number(),
  rewardPoints: z.number(),
  lifetimeValueAmount: z.number(),
  totalOrdersCount: z.number(),
  rfmScore: RFMScoreSchema,
  recentReadingLogs: z.array(ReadingTelemetryLogSchema),
  recentLearningLogs: z.array(VideoLearningTelemetryLogSchema),
  recentSecurityLogs: z.array(SecurityAuditLogSchema),
});
export type User360Profile = z.infer<typeof User360ProfileSchema>;

export const InspectorUiStateEnum = z.enum(['INSPECTOR_INIT', 'IDLE', 'LOADING', 'SUCCESS', 'ERROR']);
export type InspectorUiState = z.infer<typeof InspectorUiStateEnum>;

/** Budgets & cache keys (§1.3 BDD <100ms, §5.2 60s cache). */
export const INSPECTOR_CACHE_TTL_SEC = 60;
export const INSPECTOR_QUERY_BUDGET_MS = 100;
export const INSPECTOR_RECENT_LIMIT = 10;
export const CONCURRENCY_IP_THRESHOLD = 3;
export const CONCURRENCY_WINDOW_SEC = 60;
export const ANOMALY_STATE_SUSPICIOUS_CONCURRENCY = 'SUSPICIOUS_CONCURRENCY';

export function inspectorCacheKey(userId: string): string {
  return `inspector:360:${userId}`;
}

export function inspectorHeatmapKey(userId: string, ebookId: string): string {
  return `inspector:heatmap:${userId}:${ebookId}`;
}

/** RFM segment labels (§7.2). */
export function rfmSegmentLabel(r: number, f: number, m: number, totalOrders: number): string {
  if (totalOrders === 0) return 'NEW_USER';
  if (r >= 4 && f >= 4 && m >= 4) return 'CHAMPION';
  if (m >= 4) return 'HIGH_VALUE';
  if (f >= 4) return 'LOYAL';
  if (r === 1 && f <= 2) return 'DORMANT';
  if (r <= 2) return 'AT_RISK';
  return 'ACTIVE';
}

export function recencyScoreFor(daysSinceActive: number | null): number {
  if (daysSinceActive === null) return 1;
  if (daysSinceActive <= 7) return 5;
  if (daysSinceActive <= 14) return 4;
  if (daysSinceActive <= 30) return 3;
  if (daysSinceActive <= 90) return 2;
  return 1;
}

export function frequencyScoreFor(totalOrders: number): number {
  if (totalOrders >= 10) return 5;
  if (totalOrders >= 6) return 4;
  if (totalOrders >= 3) return 3;
  if (totalOrders >= 2) return 2;
  return 1;
}

export function monetaryScoreFor(ltv: number): number {
  if (ltv >= 10000) return 5;
  if (ltv >= 5000) return 4;
  if (ltv >= 2000) return 3;
  if (ltv >= 500) return 2;
  return 1;
}

/** PDPA masking for SUPPORT_STAFF (§8.1): 1.2.3.4 → 1.***.***.4. */
export function maskIp(ip: string): string {
  const parts = ip.split('.');
  if (parts.length === 4) return `${parts[0]}.***.***.${parts[3]}`;
  if (ip.includes(':')) return `${ip.split(':')[0]}:****`;
  return '***';
}

export function maskDevice(fp: string | null): string | null {
  if (!fp) return null;
  if (fp.length <= 8) return '****';
  return `${fp.slice(0, 4)}****${fp.slice(-4)}`;
}

/** SUPPORT_STAFF sees masked telemetry; SUPER/FINANCE see raw (§8.1). */
export function isMaskedInspectorRole(role: string): boolean {
  return role === 'SUPPORT_STAFF';
}
