// SSOT Phase 130 §10-12 — contract tests (Zod, readiness, audit, k8s,
// compose, promotion gates, barrel, wiring, read-only schema, budgets).
// Run: npx tsx scripts/test-phase130-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ProductionHealthStatusEnum,
  GoLiveAuditReportSchema,
  SystemMetricsTelemetrySchema,
  DNS_CUTOVER_BUDGET_MS,
  SLIP_VERIFY_BUDGET_MS,
  TENANT_HYDRATION_BUDGET_MS,
  DEGRADED_API_BUDGET_MS,
  DEGRADED_REDIS_LOAD_PCT,
  K6_TARGET_VUS,
  K6_SUCCESS_RATE_FLOOR,
  K6_CHUNK_P99_BUDGET_MS,
  K6_SLIP_P95_BUDGET_MS,
  HEAL_RAM_TRIP_MB,
  HEAL_SLIP_QUEUE_TRIP_MS,
  HEAL_POOL_TRIP_PCT,
  HPA_MIN_PODS,
  HPA_MAX_PODS,
  RELEASE_TAG_PREFIX,
  GATEKEEPER_KEYS,
  gatekeepersPass,
  overallScoreFor,
  telemetryPass,
  productionState,
  isReleaseTag,
  goLiveReportKey,
} from '../packages/shared/src/schemas/telemetry';
import { GoLiveAuditService } from '../apps/backend/src/modules/health/go-live-audit.service';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const GATES = {
  schemaSync: true,
  typeSafety: true,
  liffRamCheck: true,
  zeroEgressCheck: true,
  slipVerifyLatencyMs: 320,
  securityPenTestPassed: true,
};

async function main(): Promise<void> {
// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) ----------
{
  for (const v of ['HEALTHY', 'DEGRADED', 'MAINTENANCE', 'CRITICAL_FAILURE']) {
    assert.equal(ProductionHealthStatusEnum.safeParse(v).success, true, v);
  }
  assert.equal(ProductionHealthStatusEnum.safeParse('DOWN').success, false);
  assert.equal(
    GoLiveAuditReportSchema.safeParse({
      deploymentId: 'app:v1.130.0-a8f3b2e', timestamp: '2026-01-01T00:00:00.000Z',
      environment: 'production', gatekeeperStatus: GATES, overallScore: 100,
    }).success,
    true,
  );
  for (const bad of [
    { ...{ deploymentId: 'x', timestamp: '2026-01-01T00:00:00.000Z', environment: 'production', gatekeeperStatus: GATES }, overallScore: 99 },
    { deploymentId: 'x', timestamp: '2026-01-01T00:00:00.000Z', environment: 'staging', gatekeeperStatus: GATES, overallScore: 100 },
    { deploymentId: '', timestamp: '2026-01-01T00:00:00.000Z', environment: 'production', gatekeeperStatus: GATES, overallScore: 100 },
    { deploymentId: 'x', timestamp: 'not-a-date', environment: 'production', gatekeeperStatus: GATES, overallScore: 100 },
  ]) {
    assert.equal(GoLiveAuditReportSchema.safeParse(bad).success, false);
  }
  assert.equal(
    SystemMetricsTelemetrySchema.safeParse({
      activeLiffSessions: 50000, canvasAvgRamMb: 24.5, redisCacheHitRatio: 0.97,
      slipVerificationP99Ms: 640, cloudEgressCostThb: 0,
    }).success,
    true,
  );
  for (const bad of [
    { activeLiffSessions: 1, canvasAvgRamMb: 30.1, redisCacheHitRatio: 0.97, slipVerificationP99Ms: 640, cloudEgressCostThb: 0 },
    { activeLiffSessions: 1, canvasAvgRamMb: 24, redisCacheHitRatio: 0.89, slipVerificationP99Ms: 640, cloudEgressCostThb: 0 },
    { activeLiffSessions: 1, canvasAvgRamMb: 24, redisCacheHitRatio: 0.97, slipVerificationP99Ms: 801, cloudEgressCostThb: 0 },
    { activeLiffSessions: 1, canvasAvgRamMb: 24, redisCacheHitRatio: 0.97, slipVerificationP99Ms: 640, cloudEgressCostThb: 1 },
    { activeLiffSessions: -1, canvasAvgRamMb: 24, redisCacheHitRatio: 0.97, slipVerificationP99Ms: 640, cloudEgressCostThb: 0 },
  ]) {
    assert.equal(SystemMetricsTelemetrySchema.safeParse(bad).success, false);
  }
  ok('1. Zod SSOT verbatim (§3.1 Gate 1)');
}
// ---------- 2. Pure helpers + budgets ----------
{
  assert.equal(gatekeepersPass(GATES), true);
  assert.equal(gatekeepersPass({ ...GATES, schemaSync: false }), false);
  assert.equal(gatekeepersPass({ ...GATES, slipVerifyLatencyMs: 1001 }), false);
  assert.equal(gatekeepersPass({ ...GATES, slipVerifyLatencyMs: 1000 }), true);
  assert.equal(overallScoreFor(true), 100);
  assert.equal(overallScoreFor(false), 0);
  assert.equal(telemetryPass({ activeLiffSessions: 1, canvasAvgRamMb: 30, redisCacheHitRatio: 0.9, slipVerificationP99Ms: 800, cloudEgressCostThb: 0 }), true);
  assert.equal(telemetryPass({ activeLiffSessions: 1, canvasAvgRamMb: 30, redisCacheHitRatio: 0.9, slipVerificationP99Ms: 801, cloudEgressCostThb: 0 }), false);
  assert.equal(productionState({ dbReachable: true, apiP95Ms: 100, redisLoadPct: 10, paymentUpstreamUp: true }), 'HEALTHY');
  assert.equal(productionState({ dbReachable: true, apiP95Ms: 801, redisLoadPct: 10, paymentUpstreamUp: true }), 'DEGRADED');
  assert.equal(productionState({ dbReachable: true, apiP95Ms: 100, redisLoadPct: 81, paymentUpstreamUp: true }), 'DEGRADED');
  assert.equal(productionState({ dbReachable: true, apiP95Ms: 100, redisLoadPct: 10, paymentUpstreamUp: false }), 'MAINTENANCE');
  assert.equal(productionState({ dbReachable: false, apiP95Ms: 0, redisLoadPct: 0, paymentUpstreamUp: true }), 'CRITICAL_FAILURE');
  assert.equal(isReleaseTag('app:v1.130.0-a8f3b2e'), true);
  assert.equal(isReleaseTag('app:v1.129.0-abc'), false);
  assert.equal(isReleaseTag('app:v1.130.0-'), false);
  assert.equal(goLiveReportKey('d1'), 'golive:report:{d1}');
  assert.deepEqual([...GATEKEEPER_KEYS], ['schemaSync', 'typeSafety', 'liffRamCheck', 'zeroEgressCheck', 'slipVerifyLatencyMs', 'securityPenTestPassed']);
  assert.equal(DNS_CUTOVER_BUDGET_MS, 100);
  assert.equal(SLIP_VERIFY_BUDGET_MS, 800);
  assert.equal(TENANT_HYDRATION_BUDGET_MS, 15);
  assert.equal(DEGRADED_API_BUDGET_MS, 800);
  assert.equal(DEGRADED_REDIS_LOAD_PCT, 80);
  assert.equal(K6_TARGET_VUS, 50000);
  assert.equal(K6_SUCCESS_RATE_FLOOR, 0.9999);
  assert.equal(K6_CHUNK_P99_BUDGET_MS, 120);
  assert.equal(K6_SLIP_P95_BUDGET_MS, 750);
  assert.equal(HEAL_RAM_TRIP_MB, 28);
  assert.equal(HEAL_SLIP_QUEUE_TRIP_MS, 1000);
  assert.equal(HEAL_POOL_TRIP_PCT, 85);
  assert.equal(HPA_MIN_PODS, 10);
  assert.equal(HPA_MAX_PODS, 50);
  assert.equal(RELEASE_TAG_PREFIX, 'app:v1.130.0-');
  ok('2. gate rollup/state machine/tag/budget helpers');
}
// ---------- 3. Readiness probe (redacted, fast) ----------
{
  const svc = new GoLiveAuditService(
    { queryRaw: async () => [{ '?column?': 1 }] },
    { get: async () => null },
  );
  const ready = await svc.readiness();
  assert.equal(ready.status, 'HEALTHY');
  assert.equal(ready.database.up, true);
  assert.equal(ready.redis.up, true);
  assert.ok(ready.elapsedMs < 1000);
  assert.ok(!JSON.stringify(ready).match(/postgres:\/\/|SECRET|PASSWORD/i), 'redacted envelope');
  const dbDown = new GoLiveAuditService(
    { queryRaw: async () => { throw new Error('conn refused'); } },
    { get: async () => null },
  );
  assert.equal((await dbDown.readiness()).status, 'CRITICAL_FAILURE');
  const redisDown = new GoLiveAuditService(
    { queryRaw: async () => [{}] },
    { get: async () => { throw new Error('cluster down'); } },
  );
  assert.equal((await redisDown.readiness()).status, 'DEGRADED');
  ok('3. readiness (healthy/degraded/critical + redaction)');
}
// ---------- 4. Fail-closed audit report (§11 100-or-nothing) ----------
{
  const svc = new GoLiveAuditService(
    { queryRaw: async () => [{}] },
    { get: async () => null },
  );
  const report = svc.buildGoLiveReport('app:v1.130.0-a8f3b2e', GATES);
  assert.equal(report.overallScore, 100);
  assert.equal(report.environment, 'production');
  assert.equal(report.gatekeeperStatus.slipVerifyLatencyMs, 320);
  assert.throws(() => svc.buildGoLiveReport('app:v1.130.0-x', { ...GATES, typeSafety: false }), /REJECTED/);
  assert.throws(() => svc.buildGoLiveReport('', GATES), /REJECTED/);
  assert.throws(() => svc.buildGoLiveReport('app:v1.130.0-x', { ...GATES, slipVerifyLatencyMs: 5000 }), /REJECTED/);
  ok('4. audit report (pass 100 / fail-closed REJECTED)');
}
// ---------- 5. Probes controller (static — tsx decorator-load precedent 092) ----------
{
  const src = readFileSync('apps/backend/src/modules/health/go-live.controller.ts', 'utf8');
  assert.ok(src.includes("@Controller('healthz')"), 'healthz route');
  assert.ok(src.includes("@Get('live')"), 'liveness probe');
  assert.ok(src.includes("@Get('readiness')"), 'readiness probe');
  assert.ok(src.includes('this.audit.readiness()'), 'delegates to audit service');
  assert.ok(!src.includes('terminus'), 'zero-dep probes');
  // Behavior already proven in group 3 (same service instance shape).
  const svc = new GoLiveAuditService(
    { queryRaw: async () => [{}] },
    { get: async () => 'warm' },
  );
  assert.equal((await svc.readiness()).status, 'HEALTHY');
  ok('5. /healthz/live + /healthz/readiness');
}
// ---------- 6. Prisma read-only boundary (no 130 schema edits) ----------
{
  const schema = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const ban of ['model GoLive', 'model ProductionHealth', 'model SystemMetrics', 'model Telemetry']) {
    assert.ok(!schema.includes(ban), `130 leaked into schema: ${ban}`);
  }
  for (const keep of ['model UserConsentHistory', 'model DataSubjectRequest', '@@index([userId, productId, expiresAt], map: "idx_entitlement_verification")']) {
    assert.ok(schema.includes(keep), `prior-phase model intact: ${keep}`);
  }
  ok('6. schema read-only (no 130 models, priors intact)');
}
// ---------- 7. Barrel ----------
{
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  for (const e of [
    'ProductionHealthStatusEnum', 'GoLiveAuditReportSchema', 'SystemMetricsTelemetrySchema',
    'DNS_CUTOVER_BUDGET_MS', 'SLIP_VERIFY_BUDGET_MS', 'K6_TARGET_VUS', 'K6_SUCCESS_RATE_FLOOR',
    'HEAL_RAM_TRIP_MB', 'HPA_MIN_PODS', 'HPA_MAX_PODS', 'RELEASE_TAG_PREFIX',
    'gatekeepersPass', 'overallScoreFor', 'telemetryPass', 'productionState',
    'isReleaseTag', 'GoLiveAuditReport', 'SystemMetricsTelemetry',
  ]) {
    assert.ok(barrel.includes(e), `barrel ${e}`);
  }
  ok('7. barrel exports');
}
// ---------- 8. k8s manifests (§5.1/BDD-1) ----------
{
  const deploy = readFileSync('apps/backend/src/infra/k8s/backend-deployment.yaml', 'utf8');
  assert.ok(deploy.includes('name: api-green') && deploy.includes('replicas: 10'));
  assert.ok(deploy.includes('/healthz/readiness') && deploy.includes('/healthz/live'));
  assert.ok(deploy.includes('maxUnavailable: 0') && deploy.includes('memory: "512Mi"'));
  assert.ok(!deploy.includes('TODO') && !deploy.includes('placeholder'));
  const hpa = readFileSync('apps/backend/src/infra/k8s/backend-hpa.yaml', 'utf8');
  assert.ok(hpa.includes('minReplicas: 10') && hpa.includes('maxReplicas: 50'));
  const svc = readFileSync('apps/backend/src/infra/k8s/backend-service-ingress.yaml', 'utf8');
  assert.ok(svc.includes('slot: green') && svc.includes('api.omnichannel.com'));
  assert.ok(svc.includes('letsencrypt-prod'));
  ok('8. k8s green deployment + HPA 10-50 + cutover service');
}
// ---------- 9. Compose + promotion workflow ----------
{
  const compose = readFileSync('apps/backend/src/infra/docker/docker-compose.prod.yml', 'utf8');
  for (const needle of ['postgres:16-alpine', 'redis:7.2-alpine', 'POOL_MODE: transaction', 'DEFAULT_POOL_SIZE: "50"', 'RESERVE_POOL_SIZE: "10"', 'MAX_DB_CONNECTIONS: "200"', '/healthz/readiness', 'replicas: 10']) {
    assert.ok(compose.includes(needle), `compose ${needle}`);
  }
  assert.ok(compose.includes('env_file: .env.production'), 'secrets via env_file');
  assert.ok(!compose.includes('POSTGRES_PASSWORD:') && !compose.includes('SECRET_KEY:'), 'no hardcoded secrets');
  const flow = readFileSync('.github/workflows/deploy-production.yml', 'utf8');
  assert.ok(flow.includes('app:v1.130.0-*'), 'tag-gated');
  assert.ok(!flow.includes('branches: [main]'), 'not a push-main duplicate');
  for (const gate of ['test-phase130-contracts', 'test-phase129-contracts', 'test-phase128-contracts', 'apps/backend/tsconfig.json', 'apps/frontend/tsconfig.json', 'prisma validate']) {
    assert.ok(flow.includes(gate), `promotion gate ${gate}`);
  }
  assert.ok(flow.includes('wrangler'), 'cloudflare handoff');
  ok('9. prod compose (pool 50/10/200) + tag-gated promotion');
}
// ---------- 10. Module wiring + 001 lane intact ----------
{
  const mod = readFileSync('apps/backend/src/modules/health/health.module.ts', 'utf8');
  assert.ok(mod.includes('GoLiveController') && mod.includes('GoLiveAuditService'), 'go-live wired');
  const ctrl001 = readFileSync('apps/backend/src/modules/health/health.controller.ts', 'utf8');
  assert.ok(!ctrl001.includes('readiness') && ctrl001.includes('HealthService'), '001 controller untouched');
  const svc001 = readFileSync('apps/backend/src/modules/health/health.service.ts', 'utf8');
  assert.ok(svc001.includes('Fastify Engine') && !svc001.includes('GoLive'), '001 service untouched');
  for (const f of [
    'packages/shared/src/schemas/telemetry.ts',
    'apps/backend/src/modules/health/go-live-audit.service.ts',
    'apps/backend/src/modules/health/go-live.controller.ts',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes('AUTO-SCAFFOLD') && !src.includes('placeholder') && !src.includes('TODO'), `${f} unimplemented`);
  }
  const tel = readFileSync('packages/shared/src/schemas/telemetry.ts', 'utf8');
  assert.ok(!tel.includes('terminus') && !tel.includes('bullmq'), 'zero-dep SSOT');
  ok('10. health wiring + 001 intact + no-stub parity');
}
// ---------- 11. Core-untouched discipline ----------
{
  for (const [f, bans] of [
    ['apps/backend/src/modules/payment/services/slip-verification.service.ts', ['golive', 'GoLive', 'healthz']],
    ['apps/backend/src/modules/payment/services/easyslip.service.ts', ['golive', 'GoLive']],
    ['apps/backend/src/modules/entitlement/services/entitlement-grant.service.ts', ['golive', 'GoLive']],
    ['apps/frontend/components/reader/CanvasReaderEngine.tsx', ['golive', 'GoLive']],
  ] as Array<[string, string[]]>) {
    const src = readFileSync(f, 'utf8');
    for (const ban of bans) assert.ok(!src.includes(ban), `${f} touched by ${ban}`);
  }
  const slipFlow = readFileSync('.github/workflows/cloudflare-deploy.yml', 'utf8');
  assert.ok(slipFlow.includes('branches: [main]'), 'continuous lane intact');
  ok('11. payment/entitlement/reader cores + continuous lane untouched');
}
// ---------- 12. BDD/budget coherence ----------
{
  assert.ok(DNS_CUTOVER_BUDGET_MS < SLIP_VERIFY_BUDGET_MS, 'cutover faster than slip');
  assert.ok(SLIP_VERIFY_BUDGET_MS <= 1000, 'BDD-2 inside 1s gate');
  assert.ok(K6_SLIP_P95_BUDGET_MS < SLIP_VERIFY_BUDGET_MS, 'k6 p95 under p99 budget');
  assert.ok(K6_CHUNK_P99_BUDGET_MS < 1000, 'chunk p99 sane');
  assert.ok(K6_SUCCESS_RATE_FLOOR < 1 && K6_SUCCESS_RATE_FLOOR > 0.99, 'four-nines band');
  assert.ok(HPA_MIN_PODS < HPA_MAX_PODS && HPA_MIN_PODS === 10, 'HPA 10-50 (§5.1)');
  assert.ok(HEAL_RAM_TRIP_MB < 30 && HEAL_SLIP_QUEUE_TRIP_MS === 1000 && HEAL_POOL_TRIP_PCT === 85, '§10.2 tripwires');
  assert.ok(TENANT_HYDRATION_BUDGET_MS < 100, 'hydration inside cutover window');
  assert.ok(isReleaseTag(`${RELEASE_TAG_PREFIX}a8f3b2e`), 'tag gate coherent');
  ok('12. BDD/SLA/k6/HPA coherence');
}
}

main()
  .then(() => console.log(`\nPhase 130 contracts: ${passed}/12 groups passed`))
  .catch((err) => {
    console.error('\nPhase 130 contracts FAILED:', err);
    process.exit(1);
  });
