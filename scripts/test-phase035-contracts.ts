// SSOT Phase 035 §10 — contract tests (Zod, checkers, runner, UI, wiring)
// Run: npx tsx scripts/test-phase035-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LineReviewCategoryEnum,
  LineSandboxTestResultSchema,
  LineReviewAuditSummarySchema,
  SandboxSignalsSchema,
  RunAuditInputSchema,
  REVIEW_APPROVAL_SCORE,
  AUDIT_EVENT_CHANNEL,
  SANDBOX_RAM_LIMIT_MB,
  HANDSHAKE_BUDGET_MS,
  FIRST_PAINT_BUDGET_MS,
  scoreOf,
  isApprovedForSubmission,
} from '../packages/shared/src/schemas/line-review-contract';
import { checkMemoryPerformance } from '../apps/backend/src/modules/line-sandbox/checkers/memory-performance.checker';
import { checkAuthSecurity } from '../apps/backend/src/modules/line-sandbox/checkers/auth-security.checker';
import { checkPaymentPolicy } from '../apps/backend/src/modules/line-sandbox/checkers/payment-policy.checker';
import { verifyHandshake } from '../apps/backend/src/modules/auth/line-miniapp-verifier.service';
import { LineSandboxRunnerService } from '../apps/backend/src/modules/line-sandbox/services/line-sandbox-runner.service';
import { LineReviewVerifierService } from '../apps/backend/src/modules/line-sandbox/services/line-review-verifier.service';
import type { PrismaService } from '../apps/backend/src/infra/database/prisma.service';
import type { RedisClusterService } from '../apps/backend/src/infra/redis/redis-cluster.service';
// NOTE: Controller uses Nest parameter decorators (@Body) which tsx/esbuild
// cannot transform — verified via static source parity (§6) following the
// Phase 027–034 precedent.

let passed = 0;
function ok(name: string) {
  passed++;
  console.log(`  ✓ ${name}`);
}

const SIGNALS = {
  tenantId: 't',
  requestedScopes: ['openid', 'profile'],
  handshakeMs: 120,
  heapUsedMB: 18.5,
  blobUrlsRevoked: true,
  consentChecked: { terms: true, privacy: true },
  nativeHeaderVisible: true,
  firstPaintMs: 900,
  usesExternalIAP: false,
  promptPayZeroFee: true,
  mediaViaR2Edge: true,
  watermarkEnabled: true,
};

// ---------- 1. Zod review vocabulary + grading (§3.1 Gate 1) ----------
{
  const cats = ['AUTHENTICATION_SECURITY', 'MEMORY_PERFORMANCE', 'PRIVACY_CONSENT', 'UI_NAVIGATION_COMPLIANCE', 'PAYMENT_EXTERNAL_POLICY', 'MEDIA_STREAMING_DRM'];
  for (const c of cats) assert.equal(LineReviewCategoryEnum.safeParse(c).success, true);
  assert.equal(
    LineSandboxTestResultSchema.safeParse({ testId: 't1', category: 'MEMORY_PERFORMANCE', checkPointName: 'heap', isPassed: true, executionTimeMs: 3, memoryUsageMB: 18.5 }).success,
    true,
  );
  assert.equal(
    LineSandboxTestResultSchema.safeParse({ testId: 't1', category: 'MEMORY_PERFORMANCE', checkPointName: 'heap', isPassed: true, executionTimeMs: 3, memoryUsageMB: -1 }).success,
    false,
  );
  const summary = {
    auditId: 'a1', tenantId: 't', overallScore: 100, isApprovedForSubmission: true, timestamp: new Date().toISOString(),
    results: [{ testId: 't1', category: 'MEMORY_PERFORMANCE', checkPointName: 'heap', isPassed: true, executionTimeMs: 3, memoryUsageMB: 18.5 }],
  };
  assert.equal(LineReviewAuditSummarySchema.safeParse(summary).success, true);
  assert.equal(LineReviewAuditSummarySchema.safeParse({ ...summary, overallScore: 101 }).success, false);
  assert.equal(LineReviewAuditSummarySchema.safeParse({ ...summary, results: [] }).success, false);
  const signals = SandboxSignalsSchema.safeParse({ tenantId: 't' });
  assert.equal(signals.success, true);
  if (signals.success) assert.deepEqual(signals.data.requestedScopes, []);
  assert.equal(RunAuditInputSchema.safeParse({ ...SIGNALS, userId: 'u' }).success, true);
  assert.equal(RunAuditInputSchema.safeParse(SIGNALS).success, false);
  assert.equal(REVIEW_APPROVAL_SCORE, 100);
  assert.equal(AUDIT_EVENT_CHANNEL, 'line.audit.events');
  assert.equal(SANDBOX_RAM_LIMIT_MB, 30);
  assert.equal(HANDSHAKE_BUDGET_MS, 400);
  assert.equal(FIRST_PAINT_BUDGET_MS, 1500);
  assert.equal(scoreOf([{ isPassed: true }, { isPassed: true }]), 100);
  assert.equal(scoreOf([{ isPassed: true }, { isPassed: false }]), 50);
  assert.equal(scoreOf([]), 0);
  assert.equal(isApprovedForSubmission(100), true);
  assert.equal(isApprovedForSubmission(99.99), false);
  ok('Zod categories/results/summary/signals + score/approval math + constants');
}

// ---------- 2. Pure checkers: all-pass + per-checkpoint failure isolation ----------
{
  const all = [...checkMemoryPerformance(SIGNALS), ...checkAuthSecurity(SIGNALS), ...checkPaymentPolicy(SIGNALS)];
  assert.equal(all.length, 8);
  assert.ok(all.every((r) => r.isPassed), 'golden signals must pass all 8');
  assert.ok(all.some((r) => r.category === 'MEMORY_PERFORMANCE'));
  assert.ok(all.some((r) => r.category === 'PRIVACY_CONSENT'));
  assert.ok(all.some((r) => r.category === 'MEDIA_STREAMING_DRM'));

  const overHeap = checkMemoryPerformance({ ...SIGNALS, heapUsedMB: 30 });
  assert.equal(overHeap.filter((r) => r.isPassed).length, 1);
  assert.ok((overHeap.find((r) => !r.isPassed)?.diagnosticMessage ?? '').includes('30'));
  const broad = checkAuthSecurity({ ...SIGNALS, requestedScopes: ['openid', 'profile', 'email'] });
  assert.ok(broad.some((r) => !r.isPassed && r.category === 'AUTHENTICATION_SECURITY'));
  const noConsent = checkAuthSecurity({ ...SIGNALS, consentChecked: { terms: true, privacy: false } });
  assert.ok(noConsent.some((r) => !r.isPassed && r.category === 'PRIVACY_CONSENT'));
  const hiddenNav = checkAuthSecurity({ ...SIGNALS, nativeHeaderVisible: false });
  assert.ok(hiddenNav.some((r) => !r.isPassed && r.category === 'UI_NAVIGATION_COMPLIANCE'));
  const iap = checkPaymentPolicy({ ...SIGNALS, usesExternalIAP: true });
  assert.ok(iap.some((r) => !r.isPassed && r.category === 'PAYMENT_EXTERNAL_POLICY'));
  const noMark = checkPaymentPolicy({ ...SIGNALS, watermarkEnabled: false });
  assert.ok(noMark.some((r) => !r.isPassed && r.category === 'MEDIA_STREAMING_DRM'));
  // Unmeasured signals fail closed (never a free PASS).
  const bare = [...checkMemoryPerformance({ tenantId: 't' }), ...checkAuthSecurity({ tenantId: 't' }), ...checkPaymentPolicy({ tenantId: 't' })];
  assert.ok(bare.every((r) => !r.isPassed), 'bare signals must fail every checkpoint');
  ok('Checkers pass golden signals; isolate each failure; fail closed when blind');
}

// ---------- 3. Handshake verifier matrix ----------
{
  assert.deepEqual(verifyHandshake({ requestedScopes: ['openid', 'profile'], handshakeMs: 120 }), { scopesMinimal: true, withinBudget: true, passed: true });
  assert.equal(verifyHandshake({ requestedScopes: ['openid', 'profile', 'email'], handshakeMs: 120 }).passed, false);
  assert.equal(verifyHandshake({ requestedScopes: [], handshakeMs: 120 }).passed, false);
  assert.equal(verifyHandshake({ requestedScopes: ['openid', 'profile'], handshakeMs: 400 }).passed, false);
  assert.equal(verifyHandshake({ requestedScopes: ['openid', 'profile'] }).passed, false);
  ok('Handshake minimal-scope + 400ms budget matrix');
}

function stubCluster(published: Array<{ c: string; m: string }> = []): RedisClusterService {
  return {
    get: async () => null,
    setex: async () => undefined,
    del: async () => undefined,
    publish: async (c: string, m: string) => { published.push({ c, m }); },
  } as unknown as RedisClusterService;
}

async function main(): Promise<void> {
// ---------- 4. Runner: grade + atomic persist + event; failure paths ----------
{
  const published: Array<{ c: string; m: string }> = [];
  const created: unknown[] = [];
  const prisma = {
    lineMiniAppSandboxAudit: {
      create: async (a: unknown) => { created.push(a); return { id: 'audit-1', createdAt: new Date('2026-01-01T00:00:00.000Z') }; },
    },
  } as unknown as PrismaService;
  const svc = new LineSandboxRunnerService(prisma, stubCluster(published));
  const summary = await svc.executeAllCheckers({ ...SIGNALS, userId: 'qa-1' });
  assert.equal(summary.auditId, 'audit-1');
  assert.equal(summary.overallScore, 100);
  assert.equal(summary.isApprovedForSubmission, true);
  assert.equal(summary.results.length, 8);
  assert.ok(summary.results.every((r) => r.testId.length > 0));
  const data = (created[0] as { data: Record<string, unknown> }).data;
  assert.equal(data.tenantId, 't');
  assert.equal((data.testResults as { create: unknown[] }).create.length, 8);
  assert.equal(published[0].c, 'line.audit.events');
  assert.ok((published[0].m as string).includes('"approved":true'));

  // Failing signals → scored audit, not approved, diagnostics attached.
  const created2: unknown[] = [];
  const prisma2 = {
    lineMiniAppSandboxAudit: {
      create: async (a: unknown) => { created2.push(a); return { id: 'audit-2', createdAt: new Date() }; },
    },
  } as unknown as PrismaService;
  const svc2 = new LineSandboxRunnerService(prisma2, stubCluster());
  const bad = await svc2.executeAllCheckers({ tenantId: 't', userId: 'qa-1', requestedScopes: ['openid', 'profile', 'email'], heapUsedMB: 64 });
  assert.ok(bad.overallScore < 100);
  assert.equal(bad.isApprovedForSubmission, false);
  assert.ok(bad.results.some((r) => !r.isPassed && (r.diagnosticMessage ?? '').length > 0));

  await assert.rejects(() => svc.executeAllCheckers({ tenantId: 't' }), /Invalid sandbox audit/);
  const persistFail = new LineSandboxRunnerService(
    { lineMiniAppSandboxAudit: { create: async () => { throw new Error('db down'); } } } as unknown as PrismaService,
    stubCluster(),
  );
  await assert.rejects(() => persistFail.executeAllCheckers({ ...SIGNALS, userId: 'u' }), /db down/);
  ok('Runner grades 8, persists atomically, publishes; scores failures; 400s + persist errors');
}

// ---------- 5. Verifier latest-audit read (null-safe mapping) ----------
{
  const svc = new LineReviewVerifierService({
    lineMiniAppSandboxAudit: {
      findFirst: async () => ({
        id: 'a9', tenantId: 't', overallScore: 87.5, isApprovedForSubmission: false, createdAt: new Date('2026-02-01T00:00:00.000Z'),
        testResults: [{ id: 'r1', category: 'MEMORY_PERFORMANCE', checkPointName: 'heap', isPassed: false, executionTimeMs: 2, memoryUsageMB: 64, diagnosticMessage: 'GC' }],
      }),
    },
  } as unknown as PrismaService);
  const latest = await svc.latestAudit('t');
  assert.equal(latest?.overallScore, 87.5);
  assert.equal(latest?.results[0].diagnosticMessage, 'GC');
  const empty = new LineReviewVerifierService({
    lineMiniAppSandboxAudit: { findFirst: async () => null },
  } as unknown as PrismaService);
  assert.equal(await empty.latestAudit('ghost'), null);
  await assert.rejects(() => svc.latestAudit(''), /Missing tenant id/);
  ok('Verifier maps latest audit; null when never audited; 400 empty tenant');
}

// ---------- 6. Inspector + console + proxies source parity (5 states, QA gate) ----------
{
  const inspector = readFileSync('apps/frontend/components/sandbox/SandboxInspector.tsx', 'utf8');
  for (const t of ['LIFF_INIT', 'IDLE', 'LOADING', 'SUCCESS', 'ERROR', 'usedJSHeapSize', '30MB constraint', '100% READY', 'Export JSON', 'sandbox-inspector']) {
    assert.ok(inspector.includes(t), `inspector missing ${t}`);
  }
  const page = readFileSync('apps/frontend/app/(liff)/sandbox/page.tsx', 'utf8');
  for (const t of ['audit=1', 'SandboxInspector', 'LineReviewAuditSummarySchema', 'first-paint', 'requestedScopes', 'NOT READY', 'Suspense']) {
    assert.ok(page.includes(t), `console page missing ${t}`);
  }
  for (const [f, marker] of [
    ['apps/frontend/app/api/v1/line-sandbox/run-audit/route.ts', '/api/v1/line-sandbox/run-audit'],
    ['apps/frontend/app/api/v1/line-sandbox/latest/route.ts', 'Missing tenant id'],
  ] as Array<[string, string]>) {
    assert.ok(readFileSync(f, 'utf8').includes(marker), `${f} missing ${marker}`);
  }
  ok('Inspector 5-state + heap guard + export; QA-gated console; proxies route');
}

// ---------- 7. Prisma + module wiring + controller/DTO parity ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of ['enum LineReviewCategory', 'MEDIA_STREAMING_DRM', 'model LineMiniAppSandboxAudit', 'model LineSandboxResultItem', 'testResults', '@@index([auditId])']) {
    assert.ok(prisma.includes(t), `prisma missing ${t}`);
  }
  const mod = readFileSync('apps/backend/src/modules/line-sandbox/line-sandbox.module.ts', 'utf8');
  for (const t of ['LineSandboxRunnerService', 'LineReviewVerifierService', 'LineSandboxAuditController']) {
    assert.ok(mod.includes(t), `module missing ${t}`);
  }
  assert.ok(readFileSync('apps/backend/src/app.module.ts', 'utf8').includes('LineSandboxModule'));
  const ctlSrc = readFileSync('apps/backend/src/modules/line-sandbox/controllers/line-sandbox-audit.controller.ts', 'utf8');
  for (const t of ['api/v1/line-sandbox', 'run-audit', 'audits/latest', 'JwtAuthGuard', 'userId mismatch']) {
    assert.ok(ctlSrc.includes(t), `controller missing ${t}`);
  }
  const dtoSrc = readFileSync('apps/backend/src/modules/line-sandbox/dto/line-sandbox-audit.dto.ts', 'utf8');
  assert.ok(dtoSrc.includes("from '@repo/shared'") && dtoSrc.includes('RunAuditInputSchema'));
  const verifierSrc = readFileSync('apps/backend/src/modules/auth/line-miniapp-verifier.service.ts', 'utf8');
  assert.ok(verifierSrc.includes('verifyHandshake') && verifierSrc.includes('LineMiniappVerifierService'));
  ok('Prisma audit trail; SandboxModule wired; controller/DTO/verifier parity');
}

console.log(`\nPhase 035 contracts: ${passed} checks passed`);
}

void main();
