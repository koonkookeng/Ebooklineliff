// SSOT Phase 124 §10-11 — contract tests (Zod, injector, interceptors,
// chaos proxy, outbox worker, resilient redis, paging, metrics, frontend,
// Prisma Gate 1, barrel).
// Run: npx tsx scripts/test-phase124-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CircuitBreakerStateEnum,
  ChaosFaultTypeEnum,
  ChaosInjectionPayloadSchema,
  OutboxPaymentStatusEnum,
  OutboxPaymentQueueSchema,
  CHAOS_READER_FALLBACK_MS,
  CHAOS_EASYSLIP_LATENCY_MS,
  CHAOS_SLIP_TIMEOUT_MS,
  CHAOS_DRAIN_SLA_MS,
  OUTBOX_MAX_RETRIES,
  OUTBOX_BACKOFF_BASE_MS,
  OUTBOX_BACKOFF_CAP_MS,
  CHAOS_FAULT_TTL_SEC,
  CHAOS_EVENT_STREAM,
  OUTBOX_EVENT_STREAM,
  SLIP_QUEUED_MESSAGE,
  chaosFaultKey,
  outboxClaimKey,
  outboxBackoffMs,
  shouldInjectFault,
  faultIsLive,
} from '../packages/shared/src/schemas/chaos.schema';
import { ChaosInjectorService } from '../apps/backend/src/modules/chaos/chaos-injector.service';
import { RedisFaultInterceptor } from '../apps/backend/src/modules/chaos/interceptors/redis-fault.interceptor';
import { EasySlipChaosProxy } from '../apps/backend/src/modules/chaos/interceptors/easyslip-chaos.proxy';
import { SlipOutboxWorkerService } from '../apps/backend/src/modules/payment/resilience/slip-outbox-worker.service';
import { ResilientRedisClient } from '../apps/backend/src/infra/redis/resilient-redis.client';
import { ReaderPagingService, readerChunkKey } from '../apps/backend/src/modules/reader/reader-paging.service';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** In-memory Redis port (Map-backed; EX/NX forms accepted). */
class FakeRedis {
  readonly kv = new Map<string, string>();
  readonly streams: Array<{ stream: string; batch: unknown }> = [];
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
  async xaddPipeline(stream: string, batch: Array<Record<string, string | number>>): Promise<void> {
    this.streams.push({ stream, batch });
  }
}

async function main(): Promise<void> {
const prevChaos = process.env['CHAOS_ENABLED'];

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) ----------
{
  for (const v of ['REDIS_DOWN', 'EASYSLIP_TIMEOUT', 'EASYSLIP_500_ERROR', 'DB_POOL_EXHAUSTION', 'R2_STORAGE_LATENCY']) {
    assert.equal(ChaosFaultTypeEnum.safeParse(v).success, true, v);
  }
  assert.equal(ChaosFaultTypeEnum.safeParse('CPU_SPIKE').success, false);
  for (const v of ['CLOSED', 'OPEN', 'HALF_OPEN']) {
    assert.equal(CircuitBreakerStateEnum.safeParse(v).success, true, v);
  }
  assert.deepEqual(ChaosInjectionPayloadSchema.parse({ faultType: 'REDIS_DOWN', targetService: 'reader-chunk' }), {
    faultType: 'REDIS_DOWN', durationMs: 10000, failureRate: 1, targetService: 'reader-chunk',
  });
  assert.equal(ChaosInjectionPayloadSchema.safeParse({ faultType: 'REDIS_DOWN', targetService: 'x', failureRate: 1.5 }).success, false);
  assert.equal(ChaosInjectionPayloadSchema.safeParse({ faultType: 'REDIS_DOWN', targetService: '', durationMs: -1 }).success, false);
  for (const v of ['PENDING', 'PROCESSING', 'FAILED', 'COMPLETED']) {
    assert.equal(OutboxPaymentStatusEnum.safeParse(v).success, true, v);
  }
  assert.equal(
    OutboxPaymentQueueSchema.safeParse({
      orderId: 'ORD-1', slipImageUrl: 'https://r2/s.jpg', uploadedAt: '2026-01-01T00:00:00.000Z', retryCount: 0, status: 'PENDING',
    }).success,
    true,
  );
  assert.equal(
    OutboxPaymentQueueSchema.safeParse({
      orderId: '', slipImageUrl: 'x', uploadedAt: 'nope', retryCount: -1, status: 'PENDING',
    }).success,
    false,
  );
  assert.equal(CHAOS_READER_FALLBACK_MS, 50);
  assert.equal(CHAOS_EASYSLIP_LATENCY_MS, 5000);
  assert.equal(CHAOS_SLIP_TIMEOUT_MS, 1000);
  assert.equal(CHAOS_DRAIN_SLA_MS, 30000);
  assert.equal(OUTBOX_MAX_RETRIES, 4);
  assert.equal(OUTBOX_BACKOFF_BASE_MS, 1000);
  assert.equal(OUTBOX_BACKOFF_CAP_MS, 8000);
  assert.equal(CHAOS_FAULT_TTL_SEC, 300);
  assert.equal(CHAOS_EVENT_STREAM, 'stream:chaos-faults');
  assert.equal(OUTBOX_EVENT_STREAM, 'stream:payment-outbox');
  assert.ok(SLIP_QUEUED_MESSAGE.includes('1 นาที'), 'Thai queued copy');
  ok('1. Zod SSOT verbatim (faults/state/injection/outbox) + budgets');
}

// ---------- 2. Helpers (keys/backoff/sampling/liveness) ----------
{
  assert.equal(chaosFaultKey('easyslip'), 'chaos:fault:easyslip');
  assert.equal(outboxClaimKey('ORD-1'), 'outbox:claim:ORD-1');
  for (let i = 0; i < 20; i++) {
    const w = outboxBackoffMs(0);
    assert.ok(w >= 800 && w <= 1200, `backoff0 band (${w})`);
  }
  assert.ok(outboxBackoffMs(9) <= 9600 && outboxBackoffMs(9) >= 6400, 'backoff cap band');
  assert.equal(shouldInjectFault(1, 0.99), true);
  assert.equal(shouldInjectFault(0, 0), false);
  assert.equal(shouldInjectFault(0.5, 0.4), true);
  assert.equal(shouldInjectFault(0.5, 0.6), false);
  assert.equal(faultIsLive(true, 1000, 10000, 5000), true);
  assert.equal(faultIsLive(true, 1000, 10000, 11000), false);
  assert.equal(faultIsLive(false, 1000, 10000, 5000), false);
  ok('2. Fault keys + jittered backoff + sampling + liveness');
}

// ---------- 3. Injector (safety gate + registry + sampling) ----------
{
  process.env['CHAOS_ENABLED'] = '0';
  const off = new ChaosInjectorService(new FakeRedis());
  await assert.rejects(off.inject({ faultType: 'REDIS_DOWN', targetService: 'reader-chunk' }, 'admin'), /CHAOS_DISABLED/);
  assert.equal(await off.isFaultActive('reader-chunk', 'REDIS_DOWN'), false);

  process.env['CHAOS_ENABLED'] = '1';
  const redis = new FakeRedis();
  const ledgers: unknown[] = [];
  const prisma = {
    chaosTestRun: {
      create: async (a: unknown) => { ledgers.push(a); return { id: 'run-1' }; },
      updateMany: async () => ({}),
      findMany: async () => [],
    },
  };
  const svc = new ChaosInjectorService(redis, prisma as never);
  const { faultId, expiresAt } = await svc.inject({ faultType: 'REDIS_DOWN', targetService: 'reader-chunk', durationMs: 5000 }, 'admin-1');
  assert.ok(faultId.startsWith('fault-') && !Number.isNaN(Date.parse(expiresAt)), 'registry receipt');
  assert.equal(ledgers.length, 1);
  assert.ok(redis.streams.some((s) => s.stream === CHAOS_EVENT_STREAM), 'inject event');
  assert.equal(await svc.isFaultActive('reader-chunk', 'REDIS_DOWN'), true);
  assert.equal(await svc.isFaultActive('reader-chunk', 'EASYSLIP_TIMEOUT'), false);
  assert.equal(await svc.isFaultActive('other-svc', 'REDIS_DOWN'), false);
  // rate gate: 0.0 never samples.
  await svc.inject({ faultType: 'EASYSLIP_TIMEOUT', targetService: 'easyslip', failureRate: 0 }, 'admin-1');
  assert.equal(await svc.isFaultActive('easyslip', 'EASYSLIP_TIMEOUT', 0.99), false);
  // expiry: short fault lapses.
  await svc.inject({ faultType: 'R2_STORAGE_LATENCY', targetService: 'r2-edge', durationMs: 60 }, 'admin-1');
  assert.equal(await svc.isFaultActive('r2-edge', 'R2_STORAGE_LATENCY'), true);
  await sleep(80);
  assert.equal(await svc.isFaultActive('r2-edge', 'R2_STORAGE_LATENCY'), false);
  // reset disarms.
  assert.equal(await svc.reset('reader-chunk'), true);
  assert.equal(await svc.reset('reader-chunk'), false);
  assert.equal(await svc.isFaultActive('reader-chunk', 'REDIS_DOWN'), false);
  // ledger faults stay best-effort (registry authoritative).
  const throwPrisma = { chaosTestRun: { create: async () => { throw new Error('db down'); }, updateMany: async () => ({}), findMany: async () => [] } };
  const resilient = new ChaosInjectorService(new FakeRedis(), throwPrisma as never);
  assert.ok((await resilient.inject({ faultType: 'REDIS_DOWN', targetService: 's' }, 'a')).faultId.startsWith('fault-'));
  ok('3. Safety gate + registry + sampling + expiry + reset');
}

// ---------- 4. Redis fault interceptor (BDD-1 short-circuit) ----------
{
  const { join } = await import('node:path');
  const rxRequire = eval('require') as (id: string) => { of: (v: unknown) => { subscribe: (a: unknown) => void; pipe: (...o: Array<(s: unknown) => unknown>) => { subscribe: (a: unknown) => void } } };
  const { of } = rxRequire(join(process.cwd(), 'apps', 'backend', 'node_modules', 'rxjs'));
  process.env['CHAOS_ENABLED'] = '1';
  const redis = new FakeRedis();
  const chaos = new ChaosInjectorService(redis);
  const interceptor = new RedisFaultInterceptor(chaos, 'reader-chunk');
  const ctx = { getHandler: () => (() => 1), switchToHttp: () => ({}) } as never;
  const run = (i: typeof interceptor): Promise<unknown> =>
    new Promise((resolve, reject) => {
      void Promise.resolve(i.intercept(ctx, { handle: () => of('live') } as never)).then(
        (obs) => (obs as { subscribe: (a: { next: (v: unknown) => void; error: (e: unknown) => void }) => void }).subscribe({
          next: (v: unknown) => resolve(v),
          error: (e: unknown) => reject(e),
        }),
        (e: unknown) => reject(e),
      );
    });
  assert.equal(await run(interceptor), 'live');
  await chaos.inject({ faultType: 'REDIS_DOWN', targetService: 'reader-chunk', durationMs: 60000 }, 'admin');
  await assert.rejects(run(interceptor), /CHAOS_REDIS_DOWN/);
  // drills off → pass-through even with a live registry row.
  process.env['CHAOS_ENABLED'] = '0';
  assert.equal(await run(interceptor), 'live');
  process.env['CHAOS_ENABLED'] = '1';
  ok('4. Fault short-circuit + drill-off pass-through');
}

// ---------- 5. EasySlip chaos proxy (latency + 500 composition) ----------
{
  process.env['CHAOS_ENABLED'] = '1';
  const chaos = new ChaosInjectorService(new FakeRedis());
  const inner = { verify: async (url: string) => ({ transRef: 'T1', amount: 100, receiverAccount: url }) };
  const proxy = new EasySlipChaosProxy(chaos, inner);
  assert.deepEqual(await proxy.verify('ACC-1'), { transRef: 'T1', amount: 100, receiverAccount: 'ACC-1' });
  await chaos.inject({ faultType: 'EASYSLIP_500_ERROR', targetService: 'easyslip', durationMs: 60000 }, 'admin');
  await assert.rejects(proxy.verify('ACC-1'), /EASYSLIP_HTTP_500/);
  await chaos.reset('easyslip');
  await chaos.inject({ faultType: 'EASYSLIP_TIMEOUT', targetService: 'easyslip', durationMs: 60000 }, 'admin');
  const t0 = Date.now();
  assert.deepEqual(await proxy.verify('ACC-1'), { transRef: 'T1', amount: 100, receiverAccount: 'ACC-1' });
  const elapsed = Date.now() - t0;
  assert.ok(elapsed >= CHAOS_SLIP_TIMEOUT_MS, `chaos latency trips the 1s breaker budget (${elapsed}ms)`);
  await chaos.reset('easyslip');
  ok('5. Chaos latency/500 proxy (breaker-composable)');
}

// ---------- 6. Outbox worker (enqueue + drain + backoff) ----------
{
  type Row = { orderId: string; slipImageUrl: string; retryCount: number; lastError: string | null; status: string };
  const rows = new Map<string, Row>();
  const prisma = {
    paymentOutboxQueue: {
      upsert: async (a: { where: { orderId: string }; create: { orderId: string; slipImageUrl: string } }) => {
        const existing = rows.get(a.where.orderId);
        if (existing) return existing;
        const row: Row = { orderId: a.create.orderId, slipImageUrl: a.create.slipImageUrl, retryCount: 0, lastError: null, status: 'PENDING' };
        rows.set(row.orderId, row);
        return row;
      },
      findMany: async (a: { where?: { orderId?: string; status?: string } }) => {
        const all = [...rows.values()];
        if (a.where?.orderId) return all.filter((r) => r.orderId === a.where!.orderId);
        if (a.where?.status) return all.filter((r) => r.status === a.where!.status);
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
  const worker = new SlipOutboxWorkerService(
    prisma as never,
    locks as never,
    { verify: async (url: string) => ({ transRef: `T-${url}`, amount: 50, receiverAccount: 'ACC' }) },
    async (row) => { verified.push(row.orderId); },
  );
  // idempotent enqueue (second call returns the row, no dup).
  const e1 = await worker.enqueue('ORD-1', 'https://r2/a.jpg');
  assert.deepEqual([e1.status, (await worker.enqueue('ORD-1', 'https://r2/a.jpg')).orderId], ['PENDING', 'ORD-1']);
  assert.equal(rows.size, 1);
  // drain resolves + hook fires.
  assert.deepEqual(await worker.drain(), [{ orderId: 'ORD-1', status: 'RESOLVED', attempts: 1 }]);
  assert.deepEqual([verified, rows.get('ORD-1')!.status], [['ORD-1'], 'RESOLVED']);
  // failing vendor backs off then flips FAILED at max.
  const failing = new SlipOutboxWorkerService(prisma as never, locks as never, {
    verify: async () => { throw new Error('EASYSLIP_HTTP_500'); },
  });
  await worker.enqueue('ORD-9', 'https://r2/b.jpg');
  for (let i = 0; i < OUTBOX_MAX_RETRIES; i++) {
    const out = await failing.drain();
    assert.equal(out[0]!.orderId, 'ORD-9');
  }
  assert.deepEqual([rows.get('ORD-9')!.status, rows.get('ORD-9')!.retryCount], ['FAILED', OUTBOX_MAX_RETRIES]);
  // claim contention skips (single-worker lane).
  await worker.enqueue('ORD-7', 'https://r2/c.jpg');
  (rows.get('ORD-7') as Row).status = 'PENDING';
  await locks.setnx(outboxClaimKey('ORD-7'), 'OTHER-WORKER', 120);
  assert.deepEqual(await worker.drain(25), []);
  await locks.del(outboxClaimKey('ORD-7'));
  // read fail-open (DB down → empty drain, never throws).
  const down = new SlipOutboxWorkerService(
    { paymentOutboxQueue: { upsert: async () => { throw new Error('db down'); }, findMany: async () => { throw new Error('db down'); }, update: async () => { throw new Error('db down'); } } } as never,
    locks as never,
    { verify: async () => ({ transRef: 'T', amount: 1, receiverAccount: 'A' }) },
  );
  assert.deepEqual(await down.drain(), []);
  ok('6. Idempotent enqueue + drain/hook + backoff-to-FAILED + claims');
}

// ---------- 7. Resilient Redis (fail-open + 50ms detect) ----------
{
  const { ResilientRedisClient } = await import('../apps/backend/src/infra/redis/resilient-redis.client');
  const hit = new ResilientRedisClient({ get: async () => 'v', set: async () => 'OK', del: async () => undefined });
  assert.equal(await hit.get('k'), 'v');
  assert.equal(hit.isDegraded(), false);
  const down = new ResilientRedisClient({
    get: async () => { throw new Error('Connection refused'); },
    set: async () => { throw new Error('OOM'); },
    del: async () => undefined,
  });
  assert.equal(await down.get('k'), null);
  assert.equal(down.isDegraded(), true);
  await down.set('k', 'v', 60);
  const slow = new ResilientRedisClient({
    get: () => new Promise<string>((resolve) => setTimeout(() => resolve('late'), 5000)),
    set: async () => 'OK',
    del: async () => undefined,
  });
  const t0 = Date.now();
  assert.equal(await slow.get('k'), null);
  assert.ok(Date.now() - t0 < 5000, 'detect budget beats the hung socket');
  ok('7. Fail-open reads + degraded flag + detect budget');
}

// ---------- 8. Reader paging (edge → R2 degraded lane) ----------
{
  const svc = new ReaderPagingService(
    { get: async () => '<svg>edge</svg>' },
    { getObjectText: async () => '<svg>r2</svg>' },
  );
  assert.deepEqual(await svc.getPage('P1', 3), { productId: 'P1', page: 3, svg: '<svg>edge</svg>', degraded: false, source: 'edge-cache' });
  const faulty = new ReaderPagingService(
    { get: async () => { throw new Error('Connection refused'); } },
    { getObjectText: async (key: string) => `<svg>${key}</svg>` },
  );
  const degraded = await faulty.getPage('P1', 4);
  assert.deepEqual([degraded.degraded, degraded.source], [true, 'r2-direct']);
  assert.ok(degraded.svg.includes('ebooks/P1/page-4.svg'), 'R2 object lane');
  assert.equal(readerChunkKey('P1', 4), 'ebook:chunk:{P1}:4');
  const dead = new ReaderPagingService(
    { get: async () => null },
    { getObjectText: async () => { throw new Error('R2 partition'); } },
  );
  await assert.rejects(dead.getPage('P1', 1), /R2 partition/);
  ok('8. Edge-hit + R2-degraded + double-fault throw');
}

// ---------- 9. Metrics additive (chaos + outbox lanes) ----------
{
  const { MetricsService } = await import('../apps/backend/src/infra/observability/metrics.service');
  const m = new MetricsService();
  assert.equal(m.incrementChaosFault('REDIS_DOWN', 'reader-chunk'), true);
  assert.equal(m.observeOutboxDepth(7), true);
  const text = m.expose();
  assert.ok(text.includes('chaos_fault_injected_total{fault_type="REDIS_DOWN",service="reader-chunk"} 1'), 'chaos counter');
  assert.ok(text.includes('payment_outbox_queue_depth{status="PENDING"} 7'), 'outbox gauge');
  m.resetForTests();
  assert.ok(!m.expose().includes('chaos_fault'), 'reset clears chaos series');
  ok('9. Chaos counter + outbox gauge + exposition');
}

// ---------- 10. Frontend lanes (static source gates) ----------
{
  const reader = readFileSync('apps/frontend/components/reader/ResilientCanvasReader.tsx', 'utf8');
  assert.ok(reader.includes('indexedDBEngine') && reader.includes('cacheEbookChunk') && reader.includes('getEbookChunk'), 'IDB fallback lane');
  assert.ok(!reader.includes("from 'idb-keyval'") && !reader.includes('from "idb-keyval"'), 'no idb-keyval (zero-dep)');
  assert.ok(reader.includes('URL.revokeObjectURL') && reader.includes('clearRect'), 'RAM discipline');
  assert.ok(reader.includes('isDegradedMode') && reader.includes('Local Cache'), 'degraded banner');
  assert.ok(reader.includes('AbortController') && reader.includes('2000'), '2s edge timeout');
  const drawer = readFileSync('apps/frontend/components/payment/SlipUploadDrawer.tsx', 'utf8');
  assert.ok(drawer.includes('useSlipVerification'), '014 hook reuse (no pipeline dup)');
  assert.ok(drawer.includes('SLIP_QUEUED_MESSAGE') && drawer.includes('PAYMENT_VERIFYING_PENDING'), 'BDD-2 queued lane');
  assert.ok(drawer.includes('role="status"') && drawer.includes('onQueued'), 'queued a11y + callback');
  ok('10. IDB reader fallback + queued drawer (dep-free)');
}

// ---------- 11. Prisma Gate 1 (chaos models) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const m of ['enum ChaosFaultType', 'enum CircuitState', 'enum OutboxStatus', 'model ChaosTestRun', 'model CircuitBreakerMetric', 'model PaymentOutboxQueue']) {
    assert.ok(prisma.includes(m), m);
  }
  for (const v of ['REDIS_DOWN', 'EASYSLIP_TIMEOUT', 'EASYSLIP_500_ERROR', 'DB_POOL_EXHAUSTION', 'R2_STORAGE_LATENCY']) {
    assert.ok(prisma.includes(v), `fault ${v}`);
  }
  assert.ok(prisma.includes('orderId      String       @unique'), 'outbox dedupe key');
  assert.ok(prisma.includes('paymentOutbox        PaymentOutboxQueue?'), 'Order back-relation');
  assert.ok(prisma.includes('@@index([faultType, isActive])'), 'fault lookup index');
  assert.ok(prisma.includes('@@index([status])') && prisma.includes('@@index([retryCount])'), 'outbox sweep indexes');
  // 122/123 lanes intact (union-not-replace).
  assert.ok(prisma.includes('model IdempotencyLog') && prisma.includes('model StorageBucketPolicy'), '122/123 lanes intact');
  ok('11. Prisma Gate 1 (3 enums + 3 models + Order link)');
}

// ---------- 12. Tree parity + barrel + scope discipline ----------
{
  for (const f of [
    'apps/backend/src/modules/chaos/chaos-injector.service.ts',
    'apps/backend/src/modules/chaos/chaos.controller.ts',
    'apps/backend/src/modules/chaos/chaos.module.ts',
    'apps/backend/src/modules/chaos/interceptors/redis-fault.interceptor.ts',
    'apps/backend/src/modules/chaos/interceptors/easyslip-chaos.proxy.ts',
    'apps/backend/src/modules/payment/resilience/slip-outbox-worker.service.ts',
    'apps/backend/src/infra/redis/resilient-redis.client.ts',
    'apps/backend/src/modules/reader/reader-paging.service.ts',
    'apps/frontend/components/reader/ResilientCanvasReader.tsx',
    'apps/frontend/components/payment/SlipUploadDrawer.tsx',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes('TODO') && !src.includes('placeholder'), `${f} unimplemented`);
  }
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  for (const e of ['ChaosFaultTypeEnum', 'ChaosInjectionPayloadSchema', 'OutboxPaymentQueueSchema', 'outboxBackoffMs', 'SLIP_QUEUED_MESSAGE', 'CircuitBreakerStateEnum']) {
    assert.ok(barrel.includes(e), `barrel ${e}`);
  }
  // Single-breaker policy: no second executeWithCircuitBreaker owner.
  const paymentBreaker = readFileSync('apps/backend/src/modules/payment/resilience/circuit-breaker.service.ts', 'utf8');
  assert.ok(!paymentBreaker.includes('executeWithCircuitBreaker(') || paymentBreaker.includes('re-export'), 'breaker alias only');
  // Cores untouched: payment verify, reader service, canvas core.
  const slipCore = readFileSync('apps/backend/src/modules/payment/services/slip-verification.service.ts', 'utf8');
  assert.ok(!slipCore.includes('chaos') && !slipCore.includes('Chaos'), 'payment core untouched');
  const readerCore = readFileSync('apps/backend/src/modules/reader/reader.service.ts', 'utf8');
  assert.ok(!readerCore.includes('chaos') && !readerCore.includes('Chaos'), 'reader core untouched');
  const canvas = readFileSync('apps/frontend/components/reader/CanvasReader.tsx', 'utf8');
  assert.ok(!canvas.includes('chaos') && !canvas.includes('Chaos'), 'canvas core untouched');
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('ChaosModule'), 'module wired');
  ok('12. 124 tree parity + barrel + core-untouched discipline');
}

  if (prevChaos === undefined) delete process.env['CHAOS_ENABLED'];
  else process.env['CHAOS_ENABLED'] = prevChaos;
}

main()
  .then(() => {
    console.log(`\nPhase 124 contracts: ${passed}/12 groups passed`);
    process.exit(0);
  })
  .catch((err) => {
    console.error('\nPhase 124 contracts FAILED:', err);
    process.exit(1);
  });
