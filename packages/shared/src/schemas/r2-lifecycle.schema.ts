// SSOT Phase 123 §3.1 — R2 lifecycle & storage budget contract
// Canonical: packages/shared/src/schemas/r2-lifecycle.schema.ts
// (legacy src/shared/schemas/r2-lifecycle.schema.ts)
// - Spec-verbatim: StorageActionTypeEnum / BudgetAlertThresholdEnum /
//   R2LifecycleRuleSchema (abortIncompleteMultipartDays default 1) /
//   StorageCostBudgetConfigSchema (70/85 defaults) /
//   StorageUsageMetricSchema.
// - RISK_CALL deviations (additive-only, documented):
//   - tenantId accepts min(1) slugs (spec uuid is the narrow case;
//     023-031 precedent: tenant vocabulary is slug-first).
//   - notifyLineUserIds min(1) item (an alert with zero recipients can
//     never reach DELIVERED; fail-fast at the boundary).
// - Pure helpers: THB cost math ($0.015/GB/mo), threshold verdicts,
//   lifecycle XML builder, key builders, budgets. Zero new deps (zod only).
import { z } from 'zod';

export const StorageActionTypeEnum = z.enum([
  'EXPIRE_OBJECTS',
  'ABORT_INCOMPLETE_MULTIPART_UPLOADS',
  'TRANSITION_STORAGE_CLASS',
]);
export type StorageActionType = z.infer<typeof StorageActionTypeEnum>;

export const BudgetAlertThresholdEnum = z.enum([
  'WARNING_70_PERCENT',
  'CRITICAL_85_PERCENT',
  'EXCEEDED_100_PERCENT',
]);
export type BudgetAlertThreshold = z.infer<typeof BudgetAlertThresholdEnum>;

export const R2LifecycleRuleSchema = z.object({
  ruleId: z.string().min(3),
  prefix: z.string().min(1),
  enabled: z.boolean(),
  expireDays: z.number().int().positive().optional(),
  abortIncompleteMultipartDays: z.number().int().positive().default(1),
  description: z.string().optional(),
});
export type R2LifecycleRule = z.infer<typeof R2LifecycleRuleSchema>;

export const StorageCostBudgetConfigSchema = z.object({
  tenantId: z.string().min(1),
  monthlyBudgetLimitTHB: z.number().positive(),
  warningThresholdPercent: z.number().min(50).max(95).default(70),
  criticalThresholdPercent: z.number().min(75).max(99).default(85),
  notifyLineUserIds: z.array(z.string().min(1)).min(1),
  autoPurgeTempOnExceed: z.boolean().default(true),
});
export type StorageCostBudgetConfig = z.infer<typeof StorageCostBudgetConfigSchema>;

export const StorageUsageMetricSchema = z.object({
  totalSizeBytes: z.number().nonnegative(),
  totalObjectsCount: z.number().int().nonnegative(),
  classAOperationsCount: z.number().int().nonnegative(),
  classBOperationsCount: z.number().int().nonnegative(),
  estimatedMonthlyCostTHB: z.number().nonnegative(),
  recordedAt: z.string().datetime(),
});
export type StorageUsageMetric = z.infer<typeof StorageUsageMetricSchema>;

/** R2 standard storage list price ($0.015/GB/month, zero egress). */
export const R2_PRICE_USD_PER_GB_MONTH = 0.015;
/** BDD-1: temp-upload artifact TTL (24h = 86,400s). */
export const TEMP_UPLOAD_TTL_SEC = 86400;
/** BDD-1: temp-upload prefix lane. */
export const TEMP_UPLOAD_PREFIX = 'temp-uploads/';
/** Orphan HLS segment lane (48h reference-less purge queue). */
export const ORPHAN_SEGMENT_TTL_SEC = 48 * 3600;
/** Flex alert delivery SLA (<3s to the admin group). */
export const BUDGET_ALERT_SLA_MS = 3000;
/** Flex bubble budget (<10KB per message). */
export const STORAGE_FLEX_MAX_BYTES = 10 * 1024;
/** §2.1 dashboard budgets (800ms render, 25MB RAM). */
export const STORAGE_DASHBOARD_RENDER_MS = 800;
export const STORAGE_DASHBOARD_RAM_MB = 25;
/** Usage snapshot cache TTL (5 min edge). */
export const STORAGE_METRIC_CACHE_SEC = 300;
/** Budget evaluation cadence (6h sweep). */
export const BUDGET_SWEEP_INTERVAL_MS = 6 * 3600 * 1000;

/** Estimated monthly R2 cost in THB (THB/USD rate injected by callers). */
export function estimateMonthlyCostTHB(totalBytes: number, thbPerUsd: number): number {
  const gb = totalBytes / 1024 ** 3;
  return Math.round(gb * R2_PRICE_USD_PER_GB_MONTH * thbPerUsd * 100) / 100;
}

/** Percent of budget consumed (0 when the limit is non-positive). */
export function budgetPercentUsed(currentCostTHB: number, budgetLimitTHB: number): number {
  if (!(budgetLimitTHB > 0)) return 0;
  return (currentCostTHB / budgetLimitTHB) * 100;
}

/** Threshold verdict for a percent-used reading. */
export function budgetSeverityFor(
  percentUsed: number,
  warningAt = 70,
  criticalAt = 85,
): 'OK' | 'WARNING_70_PERCENT' | 'CRITICAL_85_PERCENT' | 'EXCEEDED_100_PERCENT' {
  if (percentUsed >= 100) return 'EXCEEDED_100_PERCENT';
  if (percentUsed >= criticalAt) return 'CRITICAL_85_PERCENT';
  if (percentUsed >= warningAt) return 'WARNING_70_PERCENT';
  return 'OK';
}

/** Escape XML text content. */
export function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Build an S3-compatible LifecycleConfiguration document for R2. */
export function buildLifecycleXml(rules: R2LifecycleRule[]): string {
  const body = rules
    .filter((r) => r.enabled)
    .map(
      (r) =>
        `<Rule><ID>${xmlEscape(r.ruleId)}</ID><Status>Enabled</Status><Filter><Prefix>${xmlEscape(r.prefix)}</Prefix></Filter>` +
        (r.expireDays ? `<Expiration><Days>${r.expireDays}</Days></Expiration>` : '') +
        `<AbortIncompleteMultipartUpload><DaysAfterInitiation>${r.abortIncompleteMultipartDays}</DaysAfterInitiation></AbortIncompleteMultipartUpload></Rule>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><LifecycleConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${body}</LifecycleConfiguration>`;
}

/** Edge-cache key for a bucket's lifecycle rules. */
export function lifecycleCacheKey(bucketName: string): string {
  return `r2:lifecycle:${bucketName}`;
}

/** Edge-cache key for a tenant's latest usage snapshot. */
export function storageMetricKey(tenantId: string): string {
  return `storage:metric:${tenantId}`;
}

/** Budget evaluation lock key (single sweeper). */
export function budgetSweepLockKey(): string {
  return 'storage:budget:sweep:lock';
}
