// SSOT Phase 127 §10-11 — contract tests (Zod, guards, WAF, audit, DR,
// PITR, verifier, Prisma Gate, barrel, tree parity).
// Run: npx tsx scripts/test-phase127-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ForbiddenException } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import {
  ThreatSeverityEnum,
  DisasterTypeEnum,
  SecurityIncidentLogSchema,
  DisasterRecoveryStatusSchema,
  SecurityRateLimitRuleSchema,
  DR_RTO_BUDGET_MS,
  DR_RPO_BUDGET_SEC,
  DR_HEARTBEAT_MISSES,
  ATTACKER_BLOCK_TTL_SEC,
  GQL_MAX_DEPTH,
  SECURITY_EVENT_STREAM,
  severityRank,
  drPostureOk,
  securityRateLimitKey,
  attackerBlockKey,
  looksLikeSqlInjection,
  looksLikeXss,
  capSnippet,
} from '../packages/shared/src/schemas/security-dr.schema';
import {
  GraphQLSecurityGuard,
  depthOfQuery,
  calculateDepth,
} from '../apps/backend/src/modules/security/guards/graphql-depth-limit.guard';
import {
  RateLimiterGuard,
  evaluateRateLimit,
} from '../apps/backend/src/modules/security/guards/rate-limiter.guard';
import {
  DrmEntitlementGuard,
  entitlementKey,
} from '../apps/backend/src/modules/security/guards/drm-entitlement.guard';
import { SqlInjectionFilterMiddleware, scanSqlInjectionInput } from '../apps/backend/src/modules/security/waf/sql-injection-filter.middleware';
import { XssSanitizerMiddleware, scanXssInput } from '../apps/backend/src/modules/security/waf/xss-sanitizer.middleware';
import { SecurityAuditLoggerService } from '../apps/backend/src/modules/security/services/security-audit-logger.service';
import {
  HealthCheckerService,
  missedBeats,
  shouldFailover,
  DR_HEARTBEAT_KEY,
} from '../apps/backend/src/modules/disaster-recovery/services/health-checker.service';
import {
  AutomatedFailoverService,
  buildFailoverMessage,
} from '../apps/backend/src/modules/disaster-recovery/services/automated-failover.service';
import {
  R2PitrBackupService,
  snapshotPath,
  sha256hex,
} from '../apps/backend/src/modules/disaster-recovery/services/r2-pitr-backup.service';
import { BackupVerifierJob } from '../apps/backend/src/modules/disaster-recovery/cron/backup-verifier.job';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

function httpCtx(req: Record<string, unknown>): never {
  return { switchToHttp: () => ({ getRequest: () => req }) } as never;
}

async function main(): Promise<void> {
// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) ----------
{
  for (const v of ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']) assert.equal(ThreatSeverityEnum.safeParse(v).success, true, v);
  assert.equal(ThreatSeverityEnum.safeParse('UNKNOWN').success, false);
  for (const v of ['DATABASE_OUTAGE', 'REDIS_CACHE_FAILURE', 'R2_STORAGE_UNREACHABLE', 'NETWORK_DDOS']) {
    assert.equal(DisasterTypeEnum.safeParse(v).success, true, v);
  }
  assert.equal(
    SecurityIncidentLogSchema.safeParse({
      incidentId: 'a1b2', userIdHash: 'abc123', ipAddress: '203.0.113.7', userAgent: 'liff',
      threatType: 'SQL_INJECTION', severity: 'CRITICAL', payloadSnippet: 'x', timestamp: '2026-01-01T00:00:00.000Z',
    }).success,
    true,
  );
  assert.equal(
    SecurityIncidentLogSchema.safeParse({
      incidentId: 'a1b2', userIdHash: null, ipAddress: '203.0.113.7', userAgent: 'liff',
      threatType: 'XSS', severity: 'HIGH', payloadSnippet: 'x'.repeat(1001), timestamp: '2026-01-01T00:00:00.000Z',
    }).success,
    false,
  );
  assert.equal(
    DisasterRecoveryStatusSchema.safeParse({
      primaryRegionStatus: 'DOWN', secondaryRegionStatus: 'PROMOTED',
      lastDatabaseBackupTimestamp: '2026-01-01T00:00:00.000Z', currentRPOInSeconds: 12,
      isFailoverActive: true, activeRegionEndpoint: 'db-standby-asia.internal',
    }).success,
    true,
  );
  assert.equal(
    DisasterRecoveryStatusSchema.safeParse({
      primaryRegionStatus: 'DOWN', secondaryRegionStatus: 'PROMOTED',
      lastDatabaseBackupTimestamp: '2026-01-01T00:00:00.000Z', currentRPOInSeconds: -1,
      isFailoverActive: true, activeRegionEndpoint: 'db-standby-asia.internal',
    }).success,
    false,
  );
  assert.equal(
    SecurityRateLimitRuleSchema.safeParse({ endpointPattern: 'global', maxRequestsPerMinute: 30, blockDurationSeconds: 60 }).success,
    true,
  );
  assert.equal(GQL_MAX_DEPTH, 6);
  assert.equal(DR_RTO_BUDGET_MS, 300000);
  assert.equal(DR_RPO_BUDGET_SEC, 60);
  assert.equal(DR_HEARTBEAT_MISSES, 3);
  assert.equal(ATTACKER_BLOCK_TTL_SEC, 86400);
  ok('1. Zod SSOT verbatim + budgets (Gate 1)');
}
// ---------- 2. Pure helpers ----------
{
  assert.equal(severityRank('LOW') < severityRank('CRITICAL'), true);
  assert.equal(drPostureOk(12, 28000), true);
  assert.equal(drPostureOk(60, 28000), false);
  assert.equal(drPostureOk(12, 300000), false);
  assert.equal(securityRateLimitKey('global', '1.2.3.4'), 'ratelimit:global:1.2.3.4');
  assert.equal(attackerBlockKey('1.2.3.4'), 'security:block:1.2.3.4');
  assert.equal(looksLikeSqlInjection(`' OR 1=1 --`), true);
  assert.equal(looksLikeSqlInjection('UNION SELECT password FROM users'), true);
  assert.equal(looksLikeSqlInjection('DROP TABLE orders'), true);
  assert.equal(looksLikeSqlInjection('buying 2 ebooks for kids'), false);
  assert.equal(looksLikeXss('<script>alert(1)</script>'), true);
  assert.equal(looksLikeXss('see javascript:alert(1) here'), true);
  assert.equal(looksLikeXss('<img src=x onerror=alert(1)>'), true);
  assert.equal(looksLikeXss('great course, learned a lot!'), false);
  assert.equal(capSnippet('x'.repeat(1001)).length, 1000);
  assert.equal(capSnippet('short'), 'short');
  ok('2. severity/RPO-RTO/keys/signals/snippet helpers');
}
// ---------- 3. GraphQL depth guard (§6.1) ----------
{
  assert.equal(depthOfQuery('{ viewer { id } }'), 2);
  assert.equal(depthOfQuery('{ viewer { id } }') <= GQL_MAX_DEPTH, true);
  const deep = '{ a { b { c { d { e { f { g { h { id } } } } } } } } }';
  assert.ok(depthOfQuery(deep) > GQL_MAX_DEPTH, `deep=${depthOfQuery(deep)}`);
  assert.equal(calculateDepth({ kind: 'OperationDefinition', selectionSet: undefined } as never), 0);
  const guard = new GraphQLSecurityGuard();
  const origCreate = GqlExecutionContext.create;
  try {
    (GqlExecutionContext as unknown as { create: (c: unknown) => { getArgs: () => unknown } }).create =
      () => ({ getArgs: () => ({ query: '{ viewer { id } }' }) });
    assert.equal(guard.canActivate({} as never), true);
    (GqlExecutionContext as unknown as { create: (c: unknown) => { getArgs: () => unknown } }).create =
      () => ({ getArgs: () => ({ query: deep }) });
    assert.throws(() => guard.canActivate({} as never), ForbiddenException);
    (GqlExecutionContext as unknown as { create: (c: unknown) => { getArgs: () => unknown } }).create =
      () => ({ getArgs: () => ({}) });
    assert.equal(guard.canActivate({} as never), true);
  } finally {
    (GqlExecutionContext as unknown as { create: unknown }).create = origCreate;
  }
  ok('3. GraphQL depth-6 DoS guard (shallow pass / bomb 403)');
}
// ---------- 4. Rate limiter (fixed-window + 24h block + fail-open) ----------
{
  assert.deepEqual(evaluateRateLimit(30, { endpointPattern: 'g', maxRequestsPerMinute: 30, blockDurationSeconds: 60 }), { allowed: true, retryAfterSec: 0 });
  assert.deepEqual(evaluateRateLimit(31, { endpointPattern: 'g', maxRequestsPerMinute: 30, blockDurationSeconds: 60 }), { allowed: false, retryAfterSec: 60 });
  const counts = new Map<string, number>();
  const redis = {
    async get(k: string) { return k === 'security:block:9.9.9.9' ? '1' : null; },
    async incr(k: string) { const n = (counts.get(k) ?? 0) + 1; counts.set(k, n); return n; },
    async expire() { /* noop */ },
  };
  const guard = new RateLimiterGuard(redis, { endpointPattern: 'global', maxRequestsPerMinute: 2, blockDurationSeconds: 60 });
  const req = (ip: string) => httpCtx({ ip, headers: {}, route: { path: '/x' }, url: '/x' });
  assert.equal(await guard.canActivate(req('1.1.1.1')), true);
  assert.equal(await guard.canActivate(req('1.1.1.1')), true);
  await assert.rejects(guard.canActivate(req('1.1.1.1')), (e: unknown) => e instanceof ForbiddenException === false && (e as { status?: number }).status === 429);
  await assert.rejects(guard.canActivate(req('9.9.9.9')), ForbiddenException);
  const down = new RateLimiterGuard({ get: async () => { throw new Error('redis down'); }, incr: async () => { throw new Error('redis down'); }, expire: async () => undefined });
  assert.equal(await down.canActivate(req('2.2.2.2')), true);
  ok('4. rate-limit shield (allow / 429 / 24h-block / fail-open)');
}
// ---------- 5. DRM entitlement guard (BDD-1) ----------
{
  const audits: unknown[] = [];
  const blocked: string[] = [];
  const edge = {
    flags: new Map<string, string>([[entitlementKey('u1', 'p1'), '1']]),
    async getEntitlementFlag(k: string) { return this.flags.get(k) ?? null; },
    async setex(k: string) { blocked.push(k); },
    async xaddPipeline() { /* noop */ },
  };
  const audit = { async logIncident(row: unknown) { audits.push(row); } };
  const guard = new DrmEntitlementGuard(edge, audit);
  assert.equal(entitlementKey('u1', 'p1'), 'entitlement:{u1}:p1');
  assert.equal(
    await guard.canActivate(httpCtx({ user: { id: 'u1' }, headers: {}, params: { productId: 'p1' }, url: '/chunk' })),
    true,
  );
  await assert.rejects(
    guard.canActivate(httpCtx({ user: { id: 'u1' }, headers: {}, params: { productId: 'p9' }, url: '/chunk', ip: '3.3.3.3' })),
    ForbiddenException,
  );
  assert.equal(audits.length, 1);
  assert.ok(blocked.includes('security:block:3.3.3.3'), 'attacker throttled 24h');
  await assert.rejects(guard.canActivate(httpCtx({ headers: {}, params: {}, url: '/chunk' })), ForbiddenException);
  const downGuard = new DrmEntitlementGuard({ async getEntitlementFlag() { throw new Error('down'); } });
  assert.equal(await downGuard.canActivate(httpCtx({ user: { id: 'u1' }, headers: {}, params: { productId: 'p1' } })), true);
  ok('5. DRM entitlement gate (grant / 403+audit+throttle / fail-open)');
}
// ---------- 6. WAF tripwires (A03) ----------
{
  assert.ok(scanSqlInjectionInput({ q: `' OR 1=1 --` }) !== null);
  assert.ok(scanSqlInjectionInput({ nested: [{ q: 'DROP TABLE users' }] }) !== null);
  assert.equal(scanSqlInjectionInput({ q: 'pokemon picture book' }), null);
  assert.ok(scanXssInput({ q: '<script>alert(1)</script>' }) !== null);
  assert.ok(scanXssInput({ q: 'see javascript:alert(1)' }) !== null);
  assert.equal(scanXssInput({ q: 'chapter 3 notes' }), null);
  const seen: unknown[] = [];
  const sql = new SqlInjectionFilterMiddleware({ async logIncident(r: unknown) { seen.push(r); } });
  let err: unknown;
  await sql.use({ body: { q: `' OR 1=1 --` }, headers: {}, ip: '4.4.4.4', url: '/search' }, {}, (e?: unknown) => { err = e; });
  assert.ok(err instanceof ForbiddenException);
  assert.equal((seen[0] as { threatType: string }).threatType, 'SQL_INJECTION');
  err = undefined;
  await sql.use({ body: { q: 'clean query' }, headers: {}, ip: '4.4.4.4', url: '/search' }, {}, (e?: unknown) => { err = e; });
  assert.equal(err, undefined);
  const xss = new XssSanitizerMiddleware();
  await xss.use({ body: { q: '<img src=x onerror=alert(1)>' }, headers: {}, ip: '5.5.5.5', url: '/note' }, {}, (e?: unknown) => { err = e; });
  assert.ok(err instanceof ForbiddenException);
  ok('6. WAF SQLi/XSS pre-filters (hit 403+audit / clean pass)');
}
// ---------- 7. Audit logger (Gate 8, fail-open, capped) ----------
{
  const rows: Array<Record<string, unknown>> = [];
  const stream: Array<{ key: string; batch: unknown }> = [];
  const svc = new SecurityAuditLoggerService(
    { securityAuditLog: { async create(a: { data: Record<string, unknown> }) { rows.push(a.data); return {}; } } },
    { async xaddPipeline(key: string, batch: Array<Record<string, string | number>>) { stream.push({ key, batch }); } },
  );
  await svc.record({
    ipAddress: '6.6.6.6', userAgent: 'probe', endpoint: '/chunk',
    threatType: 'UNAUTHORIZED_DRM_ACCESS', severity: 'HIGH', payloadSnippet: 'z'.repeat(1001),
  });
  assert.equal((rows[0]['payloadSnippet'] as string).length, 1000);
  assert.equal(rows[0]['severity'], 'HIGH');
  assert.equal(stream[0].key, SECURITY_EVENT_STREAM);
  const flaky = new SecurityAuditLoggerService({
    securityAuditLog: { async create() { throw new Error('db down'); } },
  });
  await flaky.record({ ipAddress: '7.7.7.7', userAgent: 'p', endpoint: '/x', threatType: 'XSS', severity: 'MEDIUM' });
  ok('7. audit logger (capped snippet + SIEM fan-out + fail-open)');
}
// ---------- 8. Health checker (3-missed-beat trip) ----------
{
  assert.equal(missedBeats(null, 1000), DR_HEARTBEAT_MISSES);
  const now = Date.now();
  assert.equal(missedBeats(now - 5000, now), 0);
  assert.equal(missedBeats(now - 25000, now), 2);
  assert.equal(shouldFailover(2), false);
  assert.equal(shouldFailover(3), true);
  const created: Array<Record<string, unknown>> = [];
  let beat: string | null = null;
  const svc = new HealthCheckerService(
    { systemHealthMetric: { async create(a: { data: Record<string, unknown> }) { created.push(a.data); return {}; } } },
    { async setex(k: string, _t: number, v: string) { assert.equal(k, DR_HEARTBEAT_KEY); beat = v; }, async get() { return beat; } },
  );
  await svc.record({ nodeName: 'n1', cpuUsagePercent: 10, memoryUsagePercent: 20, dbConnectionPoolUsed: 5, redisMemoryUsedMb: 64 });
  assert.equal(created.length, 1);
  assert.equal(await svc.consecutiveMisses(now), 0);
  const dead = new HealthCheckerService(
    { systemHealthMetric: { async create() { return {}; } } },
    { async setex() { /* noop */ }, async get() { return null; } },
  );
  assert.equal(await dead.consecutiveMisses(now), DR_HEARTBEAT_MISSES);
  ok('8. health beats (miss math / trip boundary / ledger+heartbeat)');
}
// ---------- 9. Automated failover (5-step, RTO budget) ----------
{
  const calls: string[] = [];
  const mk = (up: boolean) =>
    new AutomatedFailoverService({
      async probePrimary() { calls.push('probe'); return up; },
      async promoteStandby() { calls.push('promote'); return 'db-standby-asia.internal'; },
      async rerouteEndpoint() { calls.push('reroute'); },
      async flushEdgeCache() { calls.push('flush'); },
      async broadcast() { calls.push('broadcast'); },
      async ledgerFailover() { calls.push('ledger'); },
    });
  const aborted = await mk(true).execute();
  assert.equal(aborted.executed, false);
  assert.equal(aborted.abortedReason, 'primary-responding');
  const run = await mk(false).execute();
  assert.equal(run.executed, true);
  assert.deepEqual(run.stepsCompleted, ['verify', 'promote', 'reroute', 'flush', 'broadcast']);
  assert.equal(run.newPrimaryHost, 'db-standby-asia.internal');
  assert.equal(run.withinRto, true);
  assert.ok(buildFailoverMessage('db-standby-asia.internal', 28000).includes('db-standby-asia.internal'));
  assert.ok(calls.includes('ledger') && calls.includes('broadcast'));
  ok('9. failover engine (abort-on-healthy / 5-step run / RTO)');
}
// ---------- 10. PITR vault + restoration verifier (Gate 6) ----------
{
  const store = new Map<string, Buffer>();
  const ledger: Array<Record<string, unknown>> = [];
  const vault = {
    async putObjectBuffer(k: string, b: Buffer) { store.set(k, b); return { eTag: 'e' }; },
    async getObjectBuffer(k: string) { const b = store.get(k); if (!b) throw new Error('missing'); return b; },
  };
  const db = {
    disasterRecoverySnapshot: {
      async create(a: { data: Record<string, unknown> }) { ledger.push(a.data); return {}; },
      async findMany() {
        return ledger.filter((r) => r['verifiedAt'] === undefined).map((r) => ({
          snapshotId: r['snapshotId'], r2StoragePath: r['r2StoragePath'],
          checksumSha256: r['checksumSha256'], fileSizeBytes: r['fileSizeBytes'],
        }));
      },
      async update(a: { where: { snapshotId: string }; data: Record<string, unknown> }) {
        const row = ledger.find((r) => r['snapshotId'] === a.where.snapshotId);
        Object.assign(row ?? {}, a.data);
        return {};
      },
    },
  };
  const svc = new R2PitrBackupService(vault, db, 'n1');
  const wal = Buffer.from('wal-bytes-123');
  const archived = await svc.archiveWal(wal);
  assert.equal(archived.sha256, createHash('sha256').update(wal).digest('hex'));
  assert.ok(archived.r2Path.startsWith('dr-vault/n1/'));
  assert.ok(snapshotPath('n1', 'FULL').startsWith('dr-vault/n1/'));
  assert.equal(sha256hex(wal), archived.sha256);
  const job = new BackupVerifierJob(vault, db);
  const outcomes = await job.verifyLatest();
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].verified, true);
  assert.equal(ledger[0]['isRestorationTested'], true);
  store.set(archived.r2Path, Buffer.from('wal-bytes-124'));
  const ledger2: Array<Record<string, unknown>> = [{
    snapshotId: 's2', r2StoragePath: archived.r2Path, checksumSha256: archived.sha256, fileSizeBytes: wal.byteLength,
  }];
  const job2 = new BackupVerifierJob(vault, {
    disasterRecoverySnapshot: {
      async create() { return {}; },
      async findMany() { return ledger2; },
      async update() { return {}; },
    },
  });
  const bad = await job2.verifyLatest();
  assert.equal(bad[0].verified, false);
  assert.equal(bad[0].reason, 'checksum-mismatch');
  ok('10. PITR archive + verifier (sha ledger / restore-proof / tamper trip)');
}
// ---------- 11. Prisma Gate 1 + barrel + secret hygiene ----------
{
  const schema = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const needle of [
    'enum ThreatSeverity', 'enum DRState', 'model DisasterRecoverySnapshot', 'model SystemHealthMetric',
    'severity       ThreatSeverity @default(LOW)', '@@index([ipAddress])', '@@index([severity])',
    '@@index([snapshotId])', '@@index([recordedAt])',
  ]) {
    assert.ok(schema.includes(needle), `prisma ${needle}`);
  }
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  for (const e of ['ThreatSeverityEnum', 'DisasterRecoveryStatusSchema', 'SecurityRateLimitRuleSchema', 'severityRank', 'drPostureOk', 'securityRateLimitKey', 'attackerBlockKey', 'looksLikeSqlInjection', 'looksLikeXss']) {
    assert.ok(barrel.includes(e), `barrel ${e}`);
  }
  for (const f of ['apps/backend/src/infra/scripts/dr-failover.sh', 'apps/backend/src/infra/scripts/backup-r2-vault.sh']) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes('AUTO-SCAFFOLD'), `${f} still scaffold`);
    assert.ok(!src.includes('sk-') && !src.includes('Bearer ey'), `${f} harbors a secret`);
  }
  const dr = readFileSync('apps/backend/src/infra/scripts/dr-failover.sh', 'utf8');
  assert.ok(dr.includes('pg_promote') && dr.includes('CLOUDFLARE_API_TOKEN') && dr.includes('FLUSHALL'));
  const pitr = readFileSync('apps/backend/src/infra/scripts/backup-r2-vault.sh', 'utf8');
  assert.ok(pitr.includes('MANIFEST') && pitr.includes('sha256sum'));
  ok('11. Prisma Gate 1 + barrel + script secret hygiene');
}
// ---------- 12. Tree parity + module wiring + core-untouched ----------
{
  for (const f of [
    'apps/backend/src/modules/security/guards/graphql-depth-limit.guard.ts',
    'apps/backend/src/modules/security/guards/rate-limiter.guard.ts',
    'apps/backend/src/modules/security/guards/drm-entitlement.guard.ts',
    'apps/backend/src/modules/security/waf/sql-injection-filter.middleware.ts',
    'apps/backend/src/modules/security/waf/xss-sanitizer.middleware.ts',
    'apps/backend/src/modules/security/services/security-audit-logger.service.ts',
    'apps/backend/src/modules/security/services/forensic-watermark.service.ts',
    'apps/backend/src/modules/disaster-recovery/services/health-checker.service.ts',
    'apps/backend/src/modules/disaster-recovery/services/automated-failover.service.ts',
    'apps/backend/src/modules/disaster-recovery/services/r2-pitr-backup.service.ts',
    'apps/backend/src/modules/disaster-recovery/cron/backup-verifier.job.ts',
    'apps/backend/src/modules/disaster-recovery/disaster-recovery.module.ts',
    'apps/backend/src/api/guards/graphql-depth-limit.guard.ts',
    'apps/backend/src/api/guards/rate-limiter.guard.ts',
    'apps/backend/src/api/guards/drm-entitlement.guard.ts',
    'apps/backend/src/api/middlewares/sql-injection-filter.middleware.ts',
    'apps/backend/src/api/middlewares/xss-sanitizer.middleware.ts',
    'apps/frontend/app/(liff)/maintenance/page.tsx',
    'apps/frontend/app/api/v1/infra/health/route.ts',
    'tests/security/pentest-suite.spec.ts',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes('AUTO-SCAFFOLD') && !src.includes('placeholder'), `${f} unimplemented`);
  }
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('DisasterRecoveryModule'), 'DR module wired');
  const sec = readFileSync('apps/backend/src/modules/security/security.module.ts', 'utf8');
  for (const e of ['SecurityAuditLoggerService', 'GraphQLSecurityGuard', 'RateLimiterGuard', 'DrmEntitlementGuard']) {
    assert.ok(sec.includes(e), `device module provides ${e}`);
  }
  const maint = readFileSync('apps/frontend/app/(liff)/maintenance/page.tsx', 'utf8');
  assert.ok(maint.includes('DR_FAILOVER_MODE') && maint.includes('indexedDB'), 'offline-first failover UI');
  // Cores untouched: payment slip lane, canvas reader engine.
  const slipCore = readFileSync('apps/backend/src/modules/payment/services/slip-verification.service.ts', 'utf8');
  assert.ok(!slipCore.includes('failover') && !slipCore.includes('DisasterRecovery'), 'payment core untouched');
  const readerCore = readFileSync('apps/frontend/components/reader/CanvasReaderEngine.tsx', 'utf8');
  assert.ok(!readerCore.includes('maintenance'), 'reader core untouched');
  ok('12. tree parity + wiring + core-untouched discipline');
}
}

main()
  .then(() => console.log(`\nPhase 127 contracts: ${passed}/12 groups passed`))
  .catch((err) => {
    console.error('\nPhase 127 contracts FAILED:', err);
    process.exit(1);
  });
