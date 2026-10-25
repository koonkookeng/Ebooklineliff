// SSOT Phase 126 §10-11 — contract tests (Zod, gate math, single-flight
// concurrency, outbox double-drain, breaker storm, k6 gates, waiting
// room, queue interop, report evaluation, Prisma Gate, barrel).
// Run: npx tsx scripts/test-phase126-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LoadTestScenarioEnum,
  PerformanceMetricReportSchema,
  SlipVerifyQueuePayloadSchema,
  LOAD_P95_BUDGET_MS,
  LOAD_P99_BUDGET_MS,
  LOAD_ERROR_RATE_MAX,
  SLIP_PROCESS_BUDGET_MS,
  CHECKOUT_TPS_FLOOR,
  LOAD_RAM_BUDGET_MB,
  CACHE_HIT_FLOOR_PCT,
  DB_POOL_CEILING_PCT,
  SELF_HEAL_BUDGET_MS,
  WAITING_ROOM_TRIP_MS,
  LOAD_TARGET_CCU,
  percentile,
  errorRate,
  cacheHitRatio,
  evaluateLoadGates,
  loadGatesPass,
  type PerformanceMetricReport,
} from '../packages/shared/src/schemas/loadtest.schema';
import { RedisIdempotencyStore } from '../apps/backend/src/modules/resilience/stores/redis-idempotency.store';
import { SlipOutboxWorkerService } from '../apps/backend/src/modules/payment/resilience/slip-outbox-worker.service';
import { CircuitBreakerService } from '../apps/backend/src/modules/resilience/services/circuit-breaker.service';
import { shouldEnterWaitingRoom, waitingRetryLabel, verifyMemoryUsage } from '../apps/frontend/lib/perf/memory-guard';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

/** In-memory Redis port (Map-backed; EX/NX forms accepted). */
class FakeRedis {
  readonly kv = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.kv.has(key) ? this.kv.get(key)! : null;
  }
  async set(key: string, value: string | Buffer, ...args: Array<string | number>): Promise<unknown> {
    const upper = args.map((a) => String(a).toUpperCase());
    if (upper.includes('NX') && this.kv.has(key)) return null;
    this.kv.set(key, String(value));
    return 'OK';
  }
  async setnx(key: string, value: string): Promise<boolean> {
    if (this.kv.has(key)) return false;
    this.kv.set(key, value);
    return true;
  }
  async del(...keys: string[]): Promise<void> {
    for (const k of keys) this.kv.delete(k);
  }
  async incr(key: string): Promise<number> {
    const n = (Number.parseInt(this.kv.get(key) ?? '0', 10) || 0) + 1;
    this.kv.set(key, String(n));
    return n;
  }
  async expire(_key: string, _sec: number): Promise<void> {}
  async xaddPipeline(_stream: string, _batch: Array<Record<string, string | number>>): Promise<void> {}
}

const PASSING: PerformanceMetricReport = {
  scenario: 'MIXED_SOCIAL_COMMERCE_PEAK',
  concurrentUsers: 100000,
  totalRequests: 1000000,
  successfulRequests: 999950,
  failedRequests: 50,
  requestsPerSecond: 2500,
  latencyP50Ms: 18,
  latencyP95Ms: 42,
  latencyP99Ms: 120,
  redisCacheHitRatio: 98.7,
  dbConnectionPoolUsagePct: 62,
  averageClientRamMb: 24,
  zeroEgressCompliance: true,
};

async function main(): Promise<void> {
// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) ----------
{
  for (const v of ['READ_HEAVY_CANVAS_CHUNK', 'WRITE_HEAVY_SLIP_VERIFY', 'STREAM_HLS_HEARTBEAT', 'MIXED_SOCIAL_COMMERCE_PEAK']) {
    assert.equal(LoadTestScenarioEnum.safeParse(v).success, true, v);
  }
  assert.equal(LoadTestScenarioEnum.safeParse('IDLE_POLL').success, false);
  assert.equal(PerformanceMetricReportSchema.safeParse(PASSING).success, true);
  assert.equal(
    PerformanceMetricReportSchema.safeParse({ ...PASSING, zeroEgressCompliance: false }).success,
    false,
  );
  assert.equal(
    PerformanceMetricReportSchema.safeParse({ ...PASSING, redisCacheHitRatio: 101 }).success,
    false,
  );
  const job = {
    jobId: '123e4567-e89b-12d3-a456-426614174000',
    orderId: '123e4567-e89b-12d3-a456-426614174001',
    userId: '123e4567-e89b-12d3-a456-426614174002',
    slipImageUrl: 'https://r2.bucket/slip.jpg',
    submittedAt: '2026-01-01T00:00:00.000Z',
  };
  assert.deepEqual(SlipVerifyQueuePayloadSchema.parse(job).attemptCount, 0);
  assert.equal(SlipVerifyQueuePayloadSchema.safeParse({ ...job, jobId: 'not-a-uuid' }).success, false);
  assert.equal(SlipVerifyQueuePayloadSchema.safeParse({ ...job, slipImageUrl: 'notaurl' }).success, false);
  assert.equal(LOAD_P95_BUDGET_MS, 50);
  assert.equal(LOAD_P99_BUDGET_MS, 200);
  assert.equal(LOAD_ERROR_RATE_MAX, 0.0001);
  assert.equal(SLIP_PROCESS_BUDGET_MS, 850);
  assert.equal(CHECKOUT_TPS_FLOOR, 2000);
  assert.equal(LOAD_RAM_BUDGET_MB, 30);
  assert.equal(CACHE_HIT_FLOOR_PCT, 98.5);
  assert.equal(DB_POOL_CEILING_PCT, 80);
  assert.equal(SELF_HEAL_BUDGET_MS, 15000);
  assert.equal(WAITING_ROOM_TRIP_MS, 2000);
  assert.equal(LOAD_TARGET_CCU, 100000);
  ok('1. Zod SSOT verbatim (scenario/report/queue) + budgets');
}

// ---------- 2. Gate math (percentiles/rates/evaluator) ----------
{
  assert.equal(percentile([], 95), 0);
  assert.equal(percentile([10, 20, 30, 40, 50], 50), 30);
  assert.equal(percentile([10, 20, 30, 40, 50], 95), 50);
  assert.equal(percentile([10, 20, 30, 40, 50], 99), 50);
  assert.equal(errorRate(0, 0), 0);
  assert.equal(errorRate(1, 10000), 0.0001);
  assert.equal(cacheHitRatio(0, 0), 0);
  assert.equal(cacheHitRatio(9850, 10000), 98.5);
  const verdicts = evaluateLoadGates(PASSING);
  assert.equal(verdicts.length, 8);
  assert.ok(verdicts.every((g) => g.passed), 'passing report clears all gates');
  assert.equal(loadGatesPass(PASSING), true);
  const hot = { ...PASSING, latencyP95Ms: 61, averageClientRamMb: 31, dbConnectionPoolUsagePct: 81, redisCacheHitRatio: 98.4, requestsPerSecond: 1999 };
  const failed = evaluateLoadGates(hot).filter((g) => !g.passed).map((g) => g.gate);
  assert.ok(failed.some((g) => g.includes('p95')) && failed.some((g) => g.includes('RAM')) && failed.some((g) => g.includes('pool')), `hot report trips (${failed.join(',')})`);
  assert.equal(loadGatesPass(hot), false);
  // 98.5 boundary is strict-greater (documents the floor semantics).
  assert.equal(loadGatesPass({ ...PASSING, redisCacheHitRatio: 98.5 }), false);
  assert.equal(loadGatesPass({ ...PASSING, redisCacheHitRatio: 98.51 }), true);
  ok('2. Percentiles + rates + 8-gate evaluator + strict floor');
}

// ---------- 3. Single-flight storm (Gate 9: 50 racers, 1 owner) ----------
{
  const store = new RedisIdempotencyStore(new FakeRedis());
  const key = 'IDEM-STORM-000000000001';
  const racers = Array.from({ length: 50 }).map(() => store.acquireLock(key));
  const wins = (await Promise.all(racers)).filter(Boolean);
  assert.equal(wins.length, 1);
  await store.releaseLock(key);
  assert.equal(await store.acquireLock(key), true);
  ok('3. 50-way lock race → exactly 1 owner (Gate 9)');
}

// ---------- 4. Outbox double-drain (2 workers, each order once) ----------
{
  type Row = { orderId: string; slipImageUrl: string; retryCount: number; lastError: string | null; status: string };
  const rows = new Map<string, Row>();
  for (let i = 0; i < 10; i++) {
    const id = `ORD-DRAIN-${i}`;
    rows.set(id, { orderId: id, slipImageUrl: `https://r2/${i}.jpg`, retryCount: 0, lastError: null, status: 'PENDING' });
  }
  const prisma = {
    paymentOutboxQueue: {
      upsert: async (a: { where: { orderId: string }; create: Row }) => rows.get(a.where.orderId) ?? (() => { rows.set(a.create.orderId, a.create); return a.create; })(),
      findMany: async (a: { where?: { orderId?: string; status?: string }; take?: number }) => {
        let all = [...rows.values()];
        if (a.where?.status) all = all.filter((r) => r.status === a.where!.status);
        if (a.take !== undefined) all = all.slice(0, a.take);
        return all;
      },
      update: async (a: { where: { orderId: string }; data: Partial<Row> }) => {
        const row = rows.get(a.where.orderId)!;
        Object.assign(row, a.data);
        return row;
      },
    },
  };
  const locks = new FakeRedis();
  const verified: string[] = [];
  const mkWorker = () => new SlipOutboxWorkerService(
    prisma as never,
    locks as never,
    { verify: async (url: string) => ({ transRef: `T-${url}`, amount: 10, receiverAccount: 'ACC' }) },
    async (row) => { verified.push(row.orderId); },
  );
  const [a, b] = await Promise.all([mkWorker().drain(25), mkWorker().drain(25)]);
  const resolved = [...a, ...b].filter((r) => r.status === 'RESOLVED');
  assert.equal(resolved.length, 10);
  assert.equal(new Set(resolved.map((r) => r.orderId)).size, 10);
  assert.equal(verified.length, 10);
  assert.ok([...rows.values()].every((r) => r.status === 'RESOLVED'), 'zero rows left behind');
  ok('4. Concurrent double-drain → 10/10 exactly-once (Gate 9)');
}

// ---------- 5. Breaker fault storm (trips, never throws) ----------
{
  const breaker = new CircuitBreakerService(new FakeRedis());
  const cfg = { minimumNumberOfCalls: 5, failureThresholdPercentage: 50, timeoutMs: 500 };
  const storm = Array.from({ length: 20 }).map(() =>
    breaker.executeWithCircuitBreaker('easyslip', async () => { throw new Error('vendor down'); }, async () => 'fallback', cfg),
  );
  const results = await Promise.all(storm);
  assert.ok(results.every((r) => r === 'fallback'), 'storm fully short-circuited');
  assert.equal(await breaker.getState('easyslip'), 'OPEN');
  ok('5. 20-fault storm → OPEN + all-fallback (Gate 8)');
}

// ---------- 6. k6 lanes (static gates; k6 runtime, not tsc) ----------
{
  for (const f of ['test/k6/phase126-read-heavy.js', 'test/k6/phase126-write-heavy.js', 'test/k6/phase126-mixed-peak.js']) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes('TODO') && !src.includes('placeholder'), `${f} implemented`);
    assert.ok(src.includes('stages:') && src.includes('thresholds:'), `${f} stages+thresholds`);
    assert.ok(src.includes('rate<0.0001'), `${f} 0.01% error gate`);
    assert.ok(src.includes("from 'k6/http'") || src.includes('from "k6/http"'), `${f} k6 imports`);
  }
  const read = readFileSync('test/k6/phase126-read-heavy.js', 'utf8');
  assert.ok(read.includes('p(95)<50') && read.includes('80000'), 'read-heavy 80k/p95 lanes');
  const write = readFileSync('test/k6/phase126-write-heavy.js', 'utf8');
  assert.ok(write.includes('X-Idempotency-Key') && write.includes('202'), 'write idempotency + queued lanes');
  const mixed = readFileSync('test/k6/phase126-mixed-peak.js', 'utf8');
  assert.ok(mixed.includes('100000'), 'mixed 100k peak lane');
  ok('6. k6 scenarios (stages/thresholds/checks per BDD)');
}

// ---------- 7. Waiting room + memory guard ----------
{
  assert.equal(shouldEnterWaitingRoom(1999), false);
  assert.equal(shouldEnterWaitingRoom(2001), true);
  assert.equal(waitingRetryLabel(0), 'ลองใหม่ใน 1 วินาที');
  assert.equal(waitingRetryLabel(2), 'ลองใหม่ใน 4 วินาที');
  assert.equal(waitingRetryLabel(9), 'ลองใหม่ใน 8 วินาที');
  assert.equal(verifyMemoryUsage(), 0);
  const room = readFileSync('apps/frontend/components/perf/SmartWaitingRoom.tsx', 'utf8');
  assert.ok(room.includes('role="status"') && room.includes('onRetry') && room.includes('queuePosition'), 'waiting-room shell');
  assert.ok(!room.includes("from 'lucide-react'") && !room.includes('from "lucide-react"'), 'dep-free room');
  const guard = readFileSync('apps/frontend/lib/perf/memory-guard.ts', 'utf8');
  assert.ok(guard.includes('usedJSHeapSize') && guard.includes('LOAD_RAM_BUDGET_MB'), 'heap lane');
  ok('7. Waiting-room trip/backoff + SSR-safe memory guard');
}

// ---------- 8. Queue interop (126 jobId ↔ 124 outbox orderId) ----------
{
  const { OutboxPaymentQueueSchema } = await import('../packages/shared/src/schemas/chaos.schema');
  const orderId = '123e4567-e89b-12d3-a456-426614174001';
  assert.equal(
    OutboxPaymentQueueSchema.safeParse({
      orderId, slipImageUrl: 'https://r2.bucket/slip.jpg', uploadedAt: '2026-01-01T00:00:00.000Z', retryCount: 0, status: 'PENDING',
    }).success,
    true,
  );
  assert.equal(
    SlipVerifyQueuePayloadSchema.safeParse({
      jobId: '123e4567-e89b-12d3-a456-426614174000', orderId,
      userId: '123e4567-e89b-12d3-a456-426614174002', slipImageUrl: 'https://r2.bucket/slip.jpg', submittedAt: '2026-01-01T00:00:00.000Z',
    }).success,
    true,
  );
  ok('8. 126 queue payload ↔ 124 outbox interop (uuid orderId)');
}

// ---------- 9. Hot-path report SerDe (k6 → gates loop) ----------
{
  const raw = JSON.stringify({ ...PASSING, scenario: 'READ_HEAVY_CANVAS_CHUNK' });
  const parsed = PerformanceMetricReportSchema.parse(JSON.parse(raw));
  assert.equal(loadGatesPass(parsed), true);
  assert.equal(evaluateLoadGates(parsed).length, 8);
  ok('9. JSON report round-trip → gates');
}

// ---------- 10. Reader/paging lanes intact (040/124 reuse, no 126 fork) ----------
{
  const paging = readFileSync('apps/backend/src/modules/reader/reader-paging.service.ts', 'utf8');
  assert.ok(paging.includes('getPage') && paging.includes('r2-direct'), '124 degraded lane reused');
  assert.ok(!paging.includes('loadtest') && !paging.includes('Loadtest'), 'no 126 fork in reader');
  const mem = readFileSync('apps/frontend/components/reader/utils/memoryManager.ts', 'utf8');
  assert.ok(mem.includes('revokeObjectURL') || mem.includes('clearRect') || mem.includes('usedJSHeapSize'), '040 RAM lane intact');
  ok('10. Reader reuse (no fork) + RAM lane intact');
}

// ---------- 11. Prisma Gate (no new tables; indexes intact) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  assert.ok(!prisma.includes('model OrderTransactionIndex'), 'no redundant index table (existing Order indexes cover)');
  assert.ok(prisma.includes('@@index([userId])') && prisma.includes('@@index([orderStatus, paymentStatus])'), 'Order hot-path indexes intact');
  // 122/123/124/125 lanes intact (union-not-replace).
  assert.ok(
    prisma.includes('model IdempotencyLog') && prisma.includes('model StorageBucketPolicy') &&
    prisma.includes('model ChaosTestRun') && prisma.includes('model DatabaseReplicaNode'),
    '122/123/124/125 lanes intact',
  );
  ok('11. Prisma Gate (schema untouched + lanes intact)');
}

// ---------- 12. Tree parity + barrel + scope discipline ----------
{
  for (const f of [
    'apps/frontend/lib/perf/memory-guard.ts',
    'apps/frontend/components/perf/SmartWaitingRoom.tsx',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes('TODO') && !src.includes('placeholder'), `${f} unimplemented`);
  }
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  for (const e of ['LoadTestScenarioEnum', 'PerformanceMetricReportSchema', 'SlipVerifyQueuePayloadSchema', 'evaluateLoadGates', 'percentile', 'LOAD_TARGET_CCU']) {
    assert.ok(barrel.includes(e), `barrel ${e}`);
  }
  // No BullMQ anywhere in scope (124 outbox lane owns async verify).
  for (const f of [
    'apps/backend/src/modules/payment/resilience/slip-outbox-worker.service.ts',
    'packages/shared/src/schemas/loadtest.schema.ts',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes("from 'bullmq'") && !src.includes('from "bullmq"') && !src.includes("require('bullmq"), `${f} zero-dep`);
  }
  // Cores untouched by 126: payment verify, stream, reader service.
  const slipCore = readFileSync('apps/backend/src/modules/payment/services/slip-verification.service.ts', 'utf8');
  assert.ok(!slipCore.includes('loadtest') && !slipCore.includes('Loadtest'), 'payment core untouched');
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(!app.includes('LoadtestModule') && !app.includes('LoadTestModule'), 'no new module (harness-only phase)');
  ok('12. 126 tree parity + barrel + core-untouched discipline');
}
}

main()
  .then(() => {
    console.log(`\nPhase 126 contracts: ${passed}/12 groups passed`);
    process.exit(0);
  })
  .catch((err) => {
    console.error('\nPhase 126 contracts FAILED:', err);
    process.exit(1);
  });
