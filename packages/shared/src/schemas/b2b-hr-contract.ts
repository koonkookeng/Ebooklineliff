// SSOT Phase 098 §3.1 — B2B HR dashboard Zod domain contract
// Canonical: packages/shared/src/schemas/b2b-hr-contract.ts
// - Spec-verbatim: B2BSeatStatusEnum / QuizPassStatusEnum /
//   B2BCorporateTenantSchema / EmployeeProgressMetricSchema /
//   EmployeeQuizResultSchema (§3.1).
// - RISK_CALL: seat status is a plain string vocabulary (INVITED/ACTIVE/
//   REVOKED/EXPIRED) mirroring the Prisma String column — the 097
//   SeatStatusEnum owns the Corporate* license pool; no enum drift.
// - Pure helpers: pass/fail derive, completion %, dashboard keys, stream.
//   Zod only.
import { z } from 'zod';

export const B2BSeatStatusEnum = z.enum(['INVITED', 'ACTIVE', 'REVOKED', 'EXPIRED']);
export type B2BSeatStatus = z.infer<typeof B2BSeatStatusEnum>;

export const QuizPassStatusEnum = z.enum(['PASSED', 'FAILED', 'PENDING_REVIEW']);
export type QuizPassStatus = z.infer<typeof QuizPassStatusEnum>;

export const B2BCorporateTenantSchema = z.object({
  id: z.string().uuid(),
  companyName: z.string().min(2),
  totalSeats: z.number().int().positive(),
  usedSeats: z.number().int().min(0),
  subscriptionExpiresAt: z.date(),
});
export type B2BCorporateTenant = z.infer<typeof B2BCorporateTenantSchema>;

export const EmployeeProgressMetricSchema = z.object({
  employeeId: z.string().uuid(),
  employeeName: z.string(),
  department: z.string(),
  completedCoursesCount: z.number().int().min(0),
  totalAssignedCourses: z.number().int().positive(),
  overallProgressPercentage: z.number().min(0).max(100),
  averageQuizScore: z.number().min(0).max(100),
  lastActiveTimestamp: z.string(),
});
export type EmployeeProgressMetric = z.infer<typeof EmployeeProgressMetricSchema>;

export const EmployeeQuizResultSchema = z.object({
  quizId: z.string().uuid(),
  employeeId: z.string().uuid(),
  courseTitle: z.string(),
  score: z.number().min(0).max(100),
  passingScore: z.number().min(0).max(100),
  status: QuizPassStatusEnum,
  completedAt: z.string(),
});
export type EmployeeQuizResult = z.infer<typeof EmployeeQuizResultSchema>;

/** HR analytics event stream (Gate 8: progress + quiz fan-in). */
export const B2B_HR_STREAM = 'stream:b2b:hr';

/** Dashboard edge-cache TTL: 60s aggregates (BDD-2 <500ms). */
export const HR_DASHBOARD_CACHE_TTL_SEC = 60;

/** Max seats per single CSV/LINE allocation batch (BDD-1). */
export const HR_ALLOCATE_BATCH_MAX = 500;

/** Derive quiz pass status from score vs passing score. */
export function quizPassStatus(score: number, passingScore: number): 'PASSED' | 'FAILED' {
  return score >= passingScore ? 'PASSED' : 'FAILED';
}

/** Completion % clamped to 0–100. */
export function progressPercent(completed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, (completed / total) * 100));
}

/** Average score clamped to 0–100 (empty_attempts → 0). */
export function averageScore(scores: number[]): number {
  if (scores.length === 0) return 0;
  return Math.min(100, Math.max(0, scores.reduce((a, b) => a + b, 0) / scores.length));
}

/** Seat utilization % for the allocation counter (BDD-1 50/50). */
export function seatUtilization(usedSeats: number, totalSeats: number): number {
  return progressPercent(usedSeats, totalSeats);
}

/** Redis edge key for an org dashboard aggregate. */
export function hrDashboardCacheKey(organizationId: string): string {
  return `b2b:hr:dashboard:${organizationId}`;
}

/** Redis edge key for a department performance aggregate. */
export function hrDepartmentCacheKey(organizationId: string, departmentId: string): string {
  return `b2b:hr:dept:${organizationId}:${departmentId}`;
}
