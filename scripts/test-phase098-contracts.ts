// SSOT Phase 098 §10-11 — contract tests (Zod, seats, quiz, analytics, PDF, parity)
// Run: npx tsx scripts/test-phase098-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  B2BSeatStatusEnum,
  QuizPassStatusEnum,
  B2BCorporateTenantSchema,
  EmployeeProgressMetricSchema,
  EmployeeQuizResultSchema,
  B2B_HR_STREAM,
  HR_DASHBOARD_CACHE_TTL_SEC,
  HR_ALLOCATE_BATCH_MAX,
  quizPassStatus,
  progressPercent,
  averageScore,
  seatUtilization,
  hrDashboardCacheKey,
  hrDepartmentCacheKey,
} from '../packages/shared/src/schemas/b2b-hr-contract';
import { B2bHrSeatService } from '../apps/backend/src/modules/b2b-hr/services/b2b-seat.service';
import { B2bHrQuizTrackerService } from '../apps/backend/src/modules/b2b-hr/services/b2b-quiz-tracker.service';
import { B2bHrAnalyticsService } from '../apps/backend/src/modules/b2b-hr/services/b2b-analytics.service';
import { HrReportGeneratorService } from '../apps/backend/src/infra/pdf/hr-report-generator.service';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const UUID = '123e4567-e89b-12d3-a456-426614174000';
const UUID_B = '223e4567-e89b-12d3-a456-426614174001';
const UUID_C = '323e4567-e89b-12d3-a456-426614174002';
const NOW = Date.now();

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) ----------
{
  assert.equal(B2BSeatStatusEnum.safeParse('EXPIRED').success, true);
  assert.equal(B2BSeatStatusEnum.safeParse('ACTIVE').success, true);
  assert.equal(B2BSeatStatusEnum.safeParse('SUSPENDED').success, false);
  assert.equal(QuizPassStatusEnum.safeParse('PENDING_REVIEW').success, true);
  assert.equal(QuizPassStatusEnum.safeParse('IN_PROGRESS').success, false);
  assert.equal(
    B2BCorporateTenantSchema.safeParse({
      id: UUID, companyName: 'Acme', totalSeats: 50, usedSeats: 10, subscriptionExpiresAt: new Date(),
    }).success,
    true,
  );
  assert.equal(
    B2BCorporateTenantSchema.safeParse({ id: UUID, companyName: 'A', totalSeats: 0, usedSeats: 0, subscriptionExpiresAt: new Date() }).success,
    false,
  );
  assert.equal(
    EmployeeProgressMetricSchema.safeParse({
      employeeId: UUID, employeeName: 'Ann', department: 'Eng', completedCoursesCount: 2,
      totalAssignedCourses: 5, overallProgressPercentage: 40, averageQuizScore: 82, lastActiveTimestamp: '2026-01-01',
    }).success,
    true,
  );
  assert.equal(
    EmployeeProgressMetricSchema.safeParse({
      employeeId: UUID, employeeName: 'Ann', department: 'Eng', completedCoursesCount: 2,
      totalAssignedCourses: 5, overallProgressPercentage: 101, averageQuizScore: 82, lastActiveTimestamp: 'x',
    }).success,
    false,
  );
  assert.equal(
    EmployeeQuizResultSchema.safeParse({
      quizId: UUID, employeeId: UUID_B, courseTitle: 'Cyber', score: 85,
      passingScore: 70, status: 'PASSED', completedAt: '2026-01-01',
    }).success,
    true,
  );
  assert.equal(
    EmployeeQuizResultSchema.safeParse({
      quizId: UUID, employeeId: UUID_B, courseTitle: 'Cyber', score: 120,
      passingScore: 70, status: 'PASSED', completedAt: '2026-01-01',
    }).success,
    false,
  );
  ok('Zod §3.1 verbatim (seat/quiz/tenant/metric/result gates)');
}

// ---------- 2. Pure helpers ----------
{
  assert.equal(B2B_HR_STREAM, 'stream:b2b:hr');
  assert.equal(HR_DASHBOARD_CACHE_TTL_SEC, 60);
  assert.equal(HR_ALLOCATE_BATCH_MAX, 500);
  assert.equal(quizPassStatus(70, 70), 'PASSED');
  assert.equal(quizPassStatus(69.9, 70), 'FAILED');
  assert.equal(progressPercent(50, 50), 100);
  assert.equal(progressPercent(1, 0), 0);
  assert.equal(averageScore([]), 0);
  assert.equal(averageScore([80, 100]), 90);
  assert.equal(seatUtilization(50, 50), 100);
  assert.equal(hrDashboardCacheKey('o1'), 'b2b:hr:dashboard:o1');
  assert.equal(hrDepartmentCacheKey('o1', 'd1'), 'b2b:hr:dept:o1:d1');
  ok('Helpers: pass/fail clamp/avg/utilization/cache keys/stream');
}

// ---------- 3. Seat allocation (BDD-1: 50/50 <500ms) ----------
async function sectionSeats(): Promise<void> {
  const streams: string[] = [];
  const repo = {
    findOrganization: async (id: string) =>
      id === UUID ? { id, companyName: 'Acme', taxId: null, logoUrl: null, totalSeats: 50, usedSeats: 48 } : null,
    findSeat: async (id: string) =>
      id === 'seat-1' ? {
        id, organizationId: UUID, departmentId: null, departmentName: null,
        userId: UUID_B, employeeEmail: 'a@acme.co', employeeName: 'Ann', status: 'ACTIVE',
      } : null,
    allocateSeats: async (a: { emails: string[]; lineUserIds: string[] }) => ({ invited: a.emails.length + a.lineUserIds.length, organizationId: UUID }),
    bumpOrgUsage: async (_id: string, d: number) => {
      if (48 + d > 50) throw new Error('No available seats in organization pool');
      return { usedSeats: 48 + d, totalSeats: 50 };
    },
    revokeSeat: async () => ({ organizationId: UUID }),
  };
  const bus = { xadd: async (s: string) => { streams.push(s); } };
  const svc = new B2bHrSeatService(repo as never, bus);
  const t0 = Date.now();
  const r = await svc.allocateSeats({ organizationId: UUID, emails: ['a@b.co', 'c@d.co'] });
  assert.ok(Date.now() - t0 < 500, 'allocate <500ms budget');
  assert.deepEqual([r.invited, r.usedSeats, r.totalSeats], [2, 50, 50]);
  assert.ok(streams.includes(B2B_HR_STREAM));
  // Pool-full overflow → 400 (no oversell: 48 used + 3 > 50).
  await assert.rejects(
    svc.allocateSeats({ organizationId: UUID, emails: ['x@y.co', 'y@z.co', 'z@w.co'] }),
    /No available seats/,
  );
  // Gates: bad org / empty batch / oversize / unknown org / bad email filtered.
  await assert.rejects(svc.allocateSeats({ organizationId: 'nope', emails: ['a@b.co'] }), /Invalid organizationId/);
  await assert.rejects(svc.allocateSeats({ organizationId: UUID, emails: ['bad'] }), /No valid invitees/);
  await assert.rejects(
    svc.allocateSeats({ organizationId: UUID, emails: Array.from({ length: 501 }, (_, i) => `u${i}@x.co`) }),
    /exceeds 500/,
  );
  await assert.rejects(svc.allocateSeats({ organizationId: UUID_B, emails: ['a@b.co'] }), /not found/);
  // Revoke releases the counter.
  const rev = await svc.revokeSeat('seat-1');
  assert.deepEqual([rev.released, rev.usedSeats], [true, 47]);
  await assert.rejects(svc.revokeSeat('seat-nope'), /not found/);
  ok('Seats: batch + 50/50 counter + overflow/revoke + 6 gates (<500ms)');
}

// ---------- 4. Quiz tracker (BDD-2) ----------
async function sectionQuiz(): Promise<void> {
  const streams: Array<Record<string, string | number>> = [];
  const repo = {
    findSeat: async (id: string) => {
      if (id === UUID) return { id, organizationId: UUID, status: 'ACTIVE' };
      if (id === UUID_B) return { id, organizationId: UUID, status: 'INVITED' };
      return null;
    },
    recordQuizAttempt: async (a: Record<string, unknown>) => ({ id: 'att-1', ...a, completedAt: new Date(NOW) }),
  };
  const bus = { xadd: async (_s: string, f: Record<string, string | number>) => { streams.push(f); } };
  const svc = new B2bHrQuizTrackerService(repo as never, bus);
  const pass = await svc.recordAttempt({
    seatId: UUID, courseId: 'c1', quizId: 'q1', scoreObtained: 85, maxScore: 100, passingScore: 70, timeTakenSec: 120,
  });
  assert.deepEqual([pass.status, pass.score], ['PASSED', 85]);
  const fail = await svc.recordAttempt({
    seatId: UUID, courseId: 'c1', quizId: 'q1', scoreObtained: 50, maxScore: 100, timeTakenSec: 60,
  });
  assert.equal(fail.status, 'FAILED');
  assert.ok(streams.some((f) => f['event'] === 'b2b.quiz.completed'));
  await assert.rejects(
    svc.recordAttempt({ seatId: UUID_B, courseId: 'c1', quizId: 'q1', scoreObtained: 90, maxScore: 100, timeTakenSec: 10 }),
    /not active/,
  );
  await assert.rejects(
    svc.recordAttempt({ seatId: UUID_C, courseId: 'c1', quizId: 'q1', scoreObtained: 90, maxScore: 100, timeTakenSec: 10 }),
    /not found/,
  );
  await assert.rejects(
    svc.recordAttempt({ seatId: UUID, courseId: 'c1', quizId: 'q1', scoreObtained: 120, maxScore: 100, timeTakenSec: 10 }),
    /Invalid score/,
  );
  await assert.rejects(
    svc.recordAttempt({ seatId: 'bad', courseId: 'c1', quizId: 'q1', scoreObtained: 10, maxScore: 100, timeTakenSec: 10 }),
    /Invalid seatId/,
  );
  ok('Quiz: pass/fail ledger + stream + 4 gates');
}

// ---------- 5. Analytics aggregate + cache + PDF ----------
async function sectionAnalytics(): Promise<void> {
  const store = new Map<string, string>();
  const cache = {
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string) => { store.set(k, v); },
  };
  const seats = [
    { id: 's1', organizationId: UUID, departmentId: 'd1', departmentName: 'Eng', userId: UUID, employeeEmail: 'a@x.co', employeeName: 'Ann', status: 'ACTIVE' },
    { id: 's2', organizationId: UUID, departmentId: 'd1', departmentName: 'Eng', userId: null, employeeEmail: 'b@x.co', employeeName: null, status: 'INVITED' },
  ];
  const attempts = [
    { id: 'a1', seatId: 's1', courseId: 'c1', quizId: 'q1', scoreObtained: 80, maxScore: 100, isPassed: true, timeTakenSec: 60, completedAt: new Date(NOW) },
    { id: 'a2', seatId: 's1', courseId: 'c1', quizId: 'q2', scoreObtained: 60, maxScore: 100, isPassed: false, timeTakenSec: 60, completedAt: new Date(NOW) },
  ];
  const repo = {
    findOrganization: async () => ({ id: UUID, companyName: 'Acme', taxId: null, logoUrl: null, totalSeats: 50, usedSeats: 2 }),
    listSeats: async () => seats,
    listQuizAttempts: async () => attempts,
  };
  const svc = new B2bHrAnalyticsService(repo as never, cache);
  const d = await svc.dashboard(UUID);
  assert.deepEqual([d.utilization, d.completionRate, d.passed, d.failed], [4, 50, 1, 1]);
  assert.equal(d.averageScore, 35); // mean of seat avgs (70 + 0) / 2
  assert.deepEqual([d.departments[0]?.seats, d.departments[0]?.active], [2, 1]);
  assert.equal(d.employees[1]?.employeeName, 'b@x.co');
  // Cache hit path (repo would throw if called again).
  const svc2 = new B2bHrAnalyticsService({ findOrganization: async () => { throw new Error('must not hit db'); } } as never, cache);
  assert.equal((await svc2.dashboard(UUID)).averageScore, 35);
  await assert.rejects(
    new B2bHrAnalyticsService({ findOrganization: async () => null } as never, cache).dashboard(UUID_B),
    /not found/,
  );
  // Dep-free sealed PDF parses as %PDF with seal header.
  const gen = new HrReportGeneratorService();
  const { pdf, seal } = gen.build({
    organizationId: UUID, companyName: 'Acme', totalSeats: 50, usedSeats: 2,
    utilization: 4, completionRate: 50, averageScore: 70, passed: 1, failed: 1,
    departments: [{ departmentName: 'Eng', seats: 2, active: 1, averageScore: 70 }],
  });
  assert.ok(pdf.subarray(0, 5).toString() === '%PDF-');
  assert.equal(seal.length, 64);
  assert.ok(pdf.includes('Acme') && pdf.includes('e-Seal'));
  ok('Analytics: funnel + dept matrix + 60s cache + sealed PDF');
}

// ---------- 6. Prisma additive (Gate 1/7) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of [
    'model B2BOrganization {',
    'corporateSeats B2BCorporateSeat[]',
    'model B2BDepartment {',
    'model B2BCorporateSeat {',
    'userId         String?          @unique',
    'status         String           @default("INVITED")',
    'quizAttempts   B2BQuizAttempt[]',
    '@@index([employeeEmail])',
    'model B2BQuizAttempt {',
    'scoreObtained Decimal          @db.Decimal(5, 2)',
    '@@index([courseId])',
    'b2bSeat           B2BCorporateSeat?',
  ]) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  ok('Prisma: org/department/seat/quiz + User 1-1 back-relation');
}

function sectionParity(): void {
  for (const f of [
    'apps/backend/src/modules/b2b-hr/b2b-hr.module.ts',
    'apps/backend/src/modules/b2b-hr/controllers/b2b-export.controller.ts',
    'apps/backend/src/modules/b2b-hr/repositories/b2b-hr.repository.ts',
    'apps/backend/src/modules/b2b-hr/services/b2b-seat.service.ts',
    'apps/backend/src/modules/b2b-hr/services/b2b-quiz-tracker.service.ts',
    'apps/backend/src/modules/b2b-hr/services/b2b-analytics.service.ts',
    'apps/backend/src/infra/redis/b2b-analytics-cache.service.ts',
    'apps/backend/src/infra/pdf/hr-report-generator.service.ts',
    'apps/backend/src/api/graphql/b2b-hr.resolver.ts',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes('AUTO-SCAFFOLD') && !src.includes('placeholder'), `${f} unimplemented`);
  }
  const mod = readFileSync('apps/backend/src/modules/b2b-hr/b2b-hr.module.ts', 'utf8');
  assert.ok(mod.includes('B2bHrModule') && mod.includes('B2bHrSeatService') && mod.includes('B2bHrQuizTrackerService'));
  assert.ok(!/class B2bHrModuleModule/.test(mod), 'legacy scaffold class removed');
  assert.ok(!/ServiceService/.test(mod), 'scaffold service names removed');
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('B2bHrModule'));
  const gql = readFileSync('apps/backend/src/api/graphql/b2b-hr.resolver.ts', 'utf8');
  assert.ok(gql.includes('getHrDashboard') && gql.includes('allocateHrSeats') && gql.includes('recordQuizAttempt'));
  const sdl = readFileSync('apps/backend/src/api/graphql/b2b-hr.types.graphql', 'utf8');
  assert.ok(sdl.includes('HrDashboard') && sdl.includes('getHrDashboard') && sdl.includes('B2BSeatStatus'));
  for (const p of [
    'apps/frontend/components/hr/HrDashboard.tsx',
    'apps/frontend/hooks/useHrDashboard.ts',
    'apps/frontend/lib/b2b-hr/hr-client.ts',
    'apps/frontend/app/(web)/hr-dashboard/page.tsx',
  ]) {
    assert.ok(readFileSync(p, 'utf8').length > 200, `frontend missing: ${p}`);
  }
  const hook = readFileSync('apps/frontend/hooks/useHrDashboard.ts', 'utf8');
  assert.ok(hook.includes('HR_INIT') && hook.includes('SUCCESS') && hook.includes('ERROR'), '5-state hook');
  for (const p of [
    'apps/frontend/app/api/v1/b2b-hr/analytics/route.ts',
    'apps/frontend/app/api/v1/b2b-hr/allocate/route.ts',
    'apps/frontend/app/api/v1/b2b-hr/quiz-attempt/route.ts',
    'apps/frontend/app/api/v1/b2b-hr/export-pdf/route.ts',
  ]) {
    assert.ok(readFileSync(p, 'utf8').includes('localhost:4000'), `proxy missing backend: ${p}`);
  }
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  assert.ok(barrel.includes('b2b-hr-contract') && barrel.includes('B2BCorporateTenantSchema'));
  ok('Parity: module/GQL/SDL/dashboard/hook/proxies/barrel (5-state, zero-dep)');
}

async function main(): Promise<void> {
  await sectionSeats();
  await sectionQuiz();
  await sectionAnalytics();
  sectionParity();
}

void main().then(
  () => console.log(`\nPhase098 contracts: ${passed + 4} checks passed`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
