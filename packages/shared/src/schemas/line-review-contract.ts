// SSOT Phase 035 §3.1 — LINE review sandbox Zod SSOT contract
// Canonical: packages/shared/src/schemas/line-review-contract.ts
// (legacy src/shared/schemas/line-review-contract.ts)
// - Spec-verbatim: LineReviewCategoryEnum / LineSandboxTestResultSchema /
//   LineReviewAuditSummarySchema.
// - RISK_CALL deviations (documented, additive-only):
//   - testId/auditId/tenantId are z.string().min(1), not uuid: ids flow as
//     opaque strings at the edge (Phase 023–034 precedent).
//   - executionTimeMs/memoryUsageMB accept any non-negative finite number
//     (spec leaves them unrefined; negative heap is rejected).
//   - Adds SandboxSignalsSchema (runner evidence input), RunAuditInputSchema,
//     scoreOf()/isApproved() (single grading source) and channel/threshold
//     constants shared by the runner and the inspector UI.
// - Zero new deps (zod only).
import { z } from 'zod';

export const LineReviewCategoryEnum = z.enum([
  'AUTHENTICATION_SECURITY',
  'MEMORY_PERFORMANCE',
  'PRIVACY_CONSENT',
  'UI_NAVIGATION_COMPLIANCE',
  'PAYMENT_EXTERNAL_POLICY',
  'MEDIA_STREAMING_DRM',
]);
export type LineReviewCategory = z.infer<typeof LineReviewCategoryEnum>;

export const LineSandboxTestResultSchema = z.object({
  testId: z.string().min(1),
  category: LineReviewCategoryEnum,
  checkPointName: z.string().min(1),
  isPassed: z.boolean(),
  executionTimeMs: z.number().nonnegative(),
  memoryUsageMB: z.number().nonnegative(),
  diagnosticMessage: z.string().max(500).optional(),
});
export type LineSandboxTestResult = z.infer<typeof LineSandboxTestResultSchema>;

export const LineReviewAuditSummarySchema = z.object({
  auditId: z.string().min(1),
  tenantId: z.string().min(1),
  overallScore: z.number().min(0).max(100),
  isApprovedForSubmission: z.boolean(),
  results: z.array(LineSandboxTestResultSchema).min(1),
  timestamp: z.string().datetime(),
});
export type LineReviewAuditSummary = z.infer<typeof LineReviewAuditSummarySchema>;

/** Evidence bundle the runner grades (measured client/server-side). */
export const SandboxSignalsSchema = z.object({
  tenantId: z.string().min(1),
  requestedScopes: z.array(z.string()).default([]),
  handshakeMs: z.number().nonnegative().optional(),
  heapUsedMB: z.number().nonnegative().optional(),
  blobUrlsRevoked: z.boolean().optional(),
  consentChecked: z.object({
    terms: z.boolean(),
    privacy: z.boolean(),
  }).optional(),
  nativeHeaderVisible: z.boolean().optional(),
  firstPaintMs: z.number().nonnegative().optional(),
  usesExternalIAP: z.boolean().optional(),
  promptPayZeroFee: z.boolean().optional(),
  mediaViaR2Edge: z.boolean().optional(),
  watermarkEnabled: z.boolean().optional(),
});
export type SandboxSignals = z.infer<typeof SandboxSignalsSchema>;

export const RunAuditInputSchema = SandboxSignalsSchema.extend({
  userId: z.string().min(1),
});
export type RunAuditInput = z.infer<typeof RunAuditInputSchema>;

/** Submission readiness threshold: every checkpoint must pass (100/100). */
export const REVIEW_APPROVAL_SCORE = 100;
/** Audit analytics channel (Gate 8 — spec §7.1 stream; publish handoff). */
export const AUDIT_EVENT_CHANNEL = 'line.audit.events';
/** LIFF heap ceiling for the memory checkpoint (MB, BDD Scenario 1). */
export const SANDBOX_RAM_LIMIT_MB = 30;
/** OAuth handshake budget for the auth checkpoint (ms, BDD Scenario 2). */
export const HANDSHAKE_BUDGET_MS = 400;
/** First-paint budget for the navigation checkpoint (ms, §2.1). */
export const FIRST_PAINT_BUDGET_MS = 1500;

/** Grade a result set: pass-rate percentage, rounded to 2 decimals. */
export function scoreOf(results: Array<{ isPassed: boolean }>): number {
  if (results.length === 0) return 0;
  const passed = results.filter((r) => r.isPassed).length;
  return Math.round((passed / results.length) * 10000) / 100;
}

/** Submission-ready only at a perfect score (spec §2.2 SUCCESS). */
export function isApprovedForSubmission(score: number): boolean {
  return score >= REVIEW_APPROVAL_SCORE;
}
