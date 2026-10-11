// SSOT Phase 122 §10-11 — contract tests (Zod, keys, store, lock, breaker,
// interceptor, decorator, adapters, frontend client, external clients,
// Prisma Gate 1, barrel).
// Run: npx tsx scripts/test-phase122-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import 'reflect-metadata';
import {
  CircuitStateEnum,
  IdempotencyHeaderSchema,
  CircuitBreakerConfigSchema,
  IdempotencyRecordSchema,
  IDEMPOTENCY_LOCK_BUDGET_MS,
  IDEMPOTENCY_LOCK_TTL_MS,
  IDEMPOTENCY_DATA_TTL_SEC,
  CIRCUIT_WINDOW_SEC,
  CIRCUIT_COOLDOWN_SEC,
  EXTERNAL_CALL_TIMEOUT_MS,
  IDEMPOTENCY_HEADER,
  CIRCUIT_EVENT_STREAM,
  idempotencyLockKey,
  idempotencyDataKey,
  circuitStateKey,
  circuitFailureKey,
  circuitOpenedAtKey,
  circuitTripped,
  cooldownElapsed,
} from '../packages/shared/src/schemas/resilience-circuit.schema';
import { RedisIdempotencyStore } from '../apps/backend/src/modules/resilience/stores/redis-idempotency.store';
import { DistributedLockService } from '../apps/backend/src/modules/resilience/services/distributed-lock.service';
import { CircuitBreakerService } from '../apps/backend/src/modules/resilience/services/circuit-breaker.service';
import { IdempotencyInterceptor } from '../apps/backend/src/modules/resilience/interceptors/idempotency.interceptor';
import { IDEMPOTENT_METADATA, Idempotent } from '../apps/backend/src/modules/resilience/decorators/idempotent.decorator';
import {
  EasySlipCircuitAdapter,
  EASYSLIP_FALLBACK_MESSAGE,
} from '../apps/backend/src/modules/resilience/adapters/easyslip-circuit.adapter';
import {
  LineCircuitAdapter,
  LINE_FALLBACK_MESSAGE,
} from '../apps/backend/src/modules/resilience/adapters/line-circuit.adapter';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

/** In-memory Redis port (Map-backed; parses EX/NX/PX SET forms). */
class FakeRedis {
  readonly kv = new Map<string, string>();
  readonly streams: Array<{ stream: string; batch: unknown }> = [];
  async get(key: string): Promise<string | null> {
    return this.kv.has(key) ? this.kv.get(key)! : null;
  }
  async set(key: string, value: string | Buffer, ...args: Array<string | number>): Promise<unknown> {
    const s = String(value);
    const upper = args.map((a) => String(a).toUpperCase());
    if (upper.includes('NX') && this.kv.has(key)) return null;
    this.kv.set(key, s);
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

const HASH64 = 'a'.repeat(64);

async function main(): Promise<void> {
// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) ----------
{
  for (const v of ['CLOSED', 'OPEN', 'HALF_OPEN']) {
    assert.equal(CircuitStateEnum.safeParse(v).success, true, v);
  }
  assert.equal(CircuitStateEnum.safeParse('HALFOPEN').success, false);
  assert.equal(IdempotencyHeaderSchema.safeParse({ idempotencyKey: 'IDEM-1234567890123456', requestHash: HASH64 }).success, true);
  assert.equal(IdempotencyHeaderSchema.safeParse({ idempotencyKey: 'short', requestHash: HASH64 }).success, false);
  assert.equal(IdempotencyHeaderSchema.safeParse({ idempotencyKey: 'x'.repeat(129), requestHash: HASH64 }).success, false);
  assert.equal(IdempotencyHeaderSchema.safeParse({ idempotencyKey: 'IDEM-1234567890123456', requestHash: 'zz' }).success, false);
  const cfg = CircuitBreakerConfigSchema.parse({ serviceName: 'easyslip' });
  assert.deepEqual(
    [cfg.failureThresholdPercentage, cfg.minimumNumberOfCalls, cfg.slidingWindowSize, cfg.cooldownPeriodMs, cfg.timeoutMs],
    [50, 10, 20, 15000, 3000],
  );
  assert.equal(CircuitBreakerConfigSchema.safeParse({ serviceName: 'x', failureThresholdPercentage: 101 }).success, false);
  assert.equal(
    IdempotencyRecordSchema.safeParse({
      key: 'IDEM-1234567890123456', requestHash: HASH64, statusCode: 200,
      responseBody: { ok: true }, createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-02T00:00:00.000Z',
    }).success,
    true,
  );
  assert.equal(IDEMPOTENCY_LOCK_BUDGET_MS, 3);
  assert.equal(IDEMPOTENCY_LOCK_TTL_MS, 10000);
  assert.equal(IDEMPOTENCY_DATA_TTL_SEC, 86400);
  assert.equal(CIRCUIT_WINDOW_SEC, 30);
  assert.equal(CIRCUIT_COOLDOWN_SEC, 15);
  assert.equal(EXTERNAL_CALL_TIMEOUT_MS, 3000);
  assert.equal(IDEMPOTENCY_HEADER, 'x-idempotency-key');
  assert.equal(CIRCUIT_EVENT_STREAM, 'stream:circuit-breaker');
  ok('1. Zod SSOT verbatim (state/header/config/record) + budgets');
}

// ---------- 2. Key builders + threshold math ----------
{
  assert.equal(idempotencyLockKey('K'), 'idempotency:lock:K');
  assert.equal(idempotencyDataKey('K'), 'idempotency:data:K');
  assert.equal(circuitStateKey('easyslip'), 'circuit:easyslip:state');
  assert.equal(circuitFailureKey('easyslip'), 'circuit:easyslip:failures');
  assert.equal(circuitOpenedAtKey('easyslip'), 'circuit:easyslip:opened_at');
  assert.equal(circuitTripped(5, 10, 50), true);
  assert.equal(circuitTripped(4, 10, 50), false);
  assert.equal(circuitTripped(0, 0, 50), false);
  assert.equal(cooldownElapsed(1000, 16000, 15000), true);
  assert.equal(cooldownElapsed(1000, 15000 - 1 + 1000, 15000), false);
  ok('2. Redis key builders + trip/cooldown math');
}

// ---------- 3. Store (record roundtrip + lock single-flight) ----------
{
  const redis = new FakeRedis();
  const store = new RedisIdempotencyStore(redis);
  const h1 = RedisIdempotencyStore.bodyHash({ a: 1 });
  assert.match(h1, /^[0-9a-f]{64}$/);
  assert.equal(RedisIdempotencyStore.bodyHash({ a: 1 }), h1);
  assert.notEqual(RedisIdempotencyStore.bodyHash({ a: 2 }), h1);
  assert.equal(await store.getRecord('IDEM-1234567890123456'), null);
  await store.putRecord({
    key: 'IDEM-1234567890123456', requestHash: h1, statusCode: 200, responseBody: [1, 2],
    createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-02T00:00:00.000Z',
  });
  const back = await store.getRecord('IDEM-1234567890123456');
  assert.deepEqual(back?.responseBody, [1, 2]);
  // corrupt row → null (fail-open read).
  redis.kv.set(idempotencyDataKey('IDEM-1234567890123456'), 'not-json{');
  assert.equal(await store.getRecord('IDEM-1234567890123456'), null);
  // lock single-flight: A owns, B denied, release → C owns.
  assert.equal(await store.acquireLock('IDEM-AAAA-0000000000001'), true);
  assert.equal(await store.acquireLock('IDEM-AAAA-0000000000001'), false);
  await store.releaseLock('IDEM-AAAA-0000000000001');
  assert.equal(await store.acquireLock('IDEM-AAAA-0000000000001'), true);
  await store.releaseLock('IDEM-AAAA-0000000000001');
  ok('3. Store record lane + NX/PX single-flight + fail-open reads');
}

// ---------- 4. Distributed lock (withLock exactly-once) ----------
{
  const store = new RedisIdempotencyStore(new FakeRedis());
  const lock = new DistributedLockService(store);
  let runs = 0;
  const out = await lock.withLock('IDEM-LOCK-00000000001', async () => {
    runs++;
    return 'done';
  });
  assert.deepEqual([out, runs], ['done', 1]);
  // contention → 409-shaped error, fn never runs.
  await store.acquireLock('IDEM-LOCK-00000000002');
  await assert.rejects(
    lock.withLock('IDEM-LOCK-00000000002', async () => 'x'),
    (e: unknown) => (e as Error).message.includes('Concurrent') && (e as { status?: number }).status === 409,
  );
  // lock released after success (re-entry allowed).
  assert.equal(await store.acquireLock('IDEM-LOCK-00000000001'), true);
  ok('4. withLock exactly-once + 409 contention + release');
}

// ---------- 5. Breaker (CLOSED → OPEN → HALF_OPEN → CLOSED) ----------
{
  const redis = new FakeRedis();
  const transitions: Array<{ from: string; to: string }> = [];
  const breaker = new CircuitBreakerService(redis, (t) => {
    transitions.push({ from: t.from, to: t.to });
  });
  const cfg = { minimumNumberOfCalls: 2, failureThresholdPercentage: 50, timeoutMs: 1000 };
  assert.equal(await breaker.getState('easyslip'), 'CLOSED');
  // closed passthrough.
  assert.equal(await breaker.executeWithCircuitBreaker('easyslip', async () => 'fresh', async () => 'fb', cfg), 'fresh');
  // two faults trip (2/3 ≥ 50%).
  assert.equal(await breaker.executeWithCircuitBreaker('easyslip', async () => { throw new Error('down'); }, async () => 'fb', cfg), 'fb');
  assert.equal(await breaker.executeWithCircuitBreaker('easyslip', async () => { throw new Error('down'); }, async () => 'fb', cfg), 'fb');
  assert.equal(await breaker.getState('easyslip'), 'OPEN');
  // OPEN short-circuits without calling action.
  let called = false;
  assert.equal(
    await breaker.executeWithCircuitBreaker('easyslip', async () => { called = true; return 'x'; }, async () => 'fb', cfg),
    'fb',
  );
  assert.equal(called, false);
  // cooldown elapsed → probe succeeds → CLOSED.
  redis.kv.set(circuitOpenedAtKey('easyslip'), String(Date.now() - 20000));
  assert.equal(await breaker.executeWithCircuitBreaker('easyslip', async () => 'probe-ok', async () => 'fb', cfg), 'probe-ok');
  assert.equal(await breaker.getState('easyslip'), 'CLOSED');
  assert.ok(transitions.some((t) => t.from === 'CLOSED' && t.to === 'OPEN'), 'trip event');
  assert.ok(transitions.some((t) => t.from === 'OPEN' && t.to === 'HALF_OPEN'), 'probe event');
  assert.ok(transitions.some((t) => t.from === 'HALF_OPEN' && t.to === 'CLOSED'), 'recover event');
  assert.ok(redis.streams.some((s) => s.stream === CIRCUIT_EVENT_STREAM), 'transition stream');
  // timeout races to fallback.
  const slow = new CircuitBreakerService(new FakeRedis());
  assert.equal(
    await slow.executeWithCircuitBreaker('line-messaging', () => new Promise<string>(() => undefined), async () => 'fb', { timeoutMs: 20 }),
    'fb',
  );
  ok('5. Breaker lifecycle + single probe + timeout + telemetry');
}

// ---------- 6. Interceptor (replay/400/409/cache) ----------
{
  const { join } = await import('node:path');
  const rxRequire = eval('require') as (id: string) => { of: (v: unknown) => { subscribe: (a: unknown) => void; pipe: (...o: Array<(s: unknown) => unknown>) => { subscribe: (a: unknown) => void } } };
  const { of } = rxRequire(join(process.cwd(), 'apps', 'backend', 'node_modules', 'rxjs'));
  const store = new RedisIdempotencyStore(new FakeRedis());
  const interceptor = new IdempotencyInterceptor(store);
  const run = (req: Record<string, unknown>, res: Record<string, unknown>, body: unknown): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const ctx = { getHandler: () => (() => 1), switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) } as never;
      void Promise.resolve(interceptor.intercept(ctx, { handle: () => of(body) } as never)).then(
        (obs) => (obs as { subscribe: (a: { next: (v: unknown) => void; error: (e: unknown) => void }) => void }).subscribe({
          next: (v: unknown) => resolve(v),
          error: (e: unknown) => reject(e),
        }),
        (e: unknown) => reject(e),
      );
    });
  // pass-through without header.
  assert.equal(await run({ headers: {}, body: {} }, {}, 'live'), 'live');
  // short key → pass-through.
  assert.equal(await run({ headers: { 'x-idempotency-key': 'short' }, body: {} }, {}, 'live'), 'live');
  // fresh key executes + caches; replay returns identical payload.
  const key = 'IDEM-SLIP-998822-000000';
  const res1: Record<string, unknown> = { statusCode: 200 };
  assert.deepEqual(await run({ headers: { 'x-idempotency-key': key }, body: { orderId: 'ORD-1' } }, res1, { ok: true }), { ok: true });
  const replayRes: Record<string, number | undefined> = {};
  const replayed = await run(
    { headers: { 'x-idempotency-key': key }, body: { orderId: 'ORD-1' } },
    { status: (c: number) => { replayRes['code'] = c; } },
    { ok: 'SHOULD-NOT-RUN' },
  );
  assert.deepEqual([replayed, replayRes['code']], [{ ok: true }, 200]);
  // altered payload with reused key → 400.
  await assert.rejects(
    run({ headers: { 'x-idempotency-key': key }, body: { orderId: 'ORD-2' } }, {}, 'x'),
    (e: unknown) => (e as Error).name === 'BadRequestException' || (e as Error).message.includes('altered'),
  );
  // contention → 409.
  const busy = 'IDEM-BUSY-000000000001';
  await store.acquireLock(busy);
  await assert.rejects(
    run({ headers: { 'x-idempotency-key': busy }, body: {} }, {}, 'x'),
    (e: unknown) => (e as Error).name === 'ConflictException' || (e as Error).message.includes('Concurrent'),
  );
  await store.releaseLock(busy);
  // handler error releases the lock (no orphan).
  const errKey = 'IDEM-ERR-0000000000001';
  const { throwError: throwErr } = rxRequire(join(process.cwd(), 'apps', 'backend', 'node_modules', 'rxjs'));
  const errCtx = { getHandler: () => (() => 1), switchToHttp: () => ({ getRequest: () => ({ headers: { 'x-idempotency-key': errKey }, body: {} }), getResponse: () => ({}) }) } as never;
  await assert.rejects(
    new Promise((_, reject) => {
      void Promise.resolve(
        interceptor.intercept(errCtx, { handle: () => throwErr(() => new Error('boom')) } as never),
      ).then((obs) => (obs as { subscribe: (a: unknown) => void }).subscribe({ error: (e: unknown) => reject(e) } as never));
    }),
    /boom/,
  );
  assert.equal(await store.acquireLock(errKey), true);
  ok('6. Interceptor replay/anti-replay/409/cache/error-release');
}

// ---------- 7. Decorator metadata ----------
{
  // @Idempotent() attaches metadata via NestJS SetMetadata (applied as a
  // plain factory call — no decorator syntax, so tsx needs no tsconfig flag).
  class Ctrl {
    create(): string {
      return 'ok';
    }
  }
  const proto = Ctrl.prototype as Record<string, (...a: never[]) => unknown>;
  const descriptor = Object.getOwnPropertyDescriptor(Ctrl.prototype, 'create')!;
  Idempotent({ required: true })(proto, 'create', descriptor);
  Object.defineProperty(Ctrl.prototype, 'create', descriptor);
  const meta = Reflect.getMetadata(IDEMPOTENT_METADATA, proto['create']);
  assert.deepEqual(meta, { required: true });
  assert.equal(IDEMPOTENT_METADATA, 'resilience:idempotent');
  assert.equal(new Ctrl().create(), 'ok');
  ok('7. @Idempotent() metadata lane');
}

// ---------- 8. Adapters (closed delegate + OPEN fallback copy) ----------
{
  // closed: delegates to the wrapped port.
  const closed = new CircuitBreakerService(new FakeRedis());
  const easy = new EasySlipCircuitAdapter(closed, { verify: async (url: string) => ({ transRef: 'T1', amount: 100, receiverAccount: url }) });
  assert.deepEqual(await easy.verify('ACC-1'), { transRef: 'T1', amount: 100, receiverAccount: 'ACC-1' });
  const line = new LineCircuitAdapter(closed, { push: async () => ({ messageId: 'm1' }) });
  assert.deepEqual(await line.push('U1', { text: 'hi' }), { messageId: 'm1' });
  // forced OPEN: fallbacks carry the §2.1 Thai copy (never a throw).
  const redis = new FakeRedis();
  redis.kv.set(circuitStateKey('easyslip'), 'OPEN');
  redis.kv.set(circuitOpenedAtKey('easyslip'), String(Date.now()));
  const openBreaker = new CircuitBreakerService(redis);
  const openEasy = new EasySlipCircuitAdapter(openBreaker, { verify: async () => { throw new Error('must-not-run'); } });
  const fb = await openEasy.verify('ACC-9', 'ORD-9') as { queued: boolean; fallback: string; message: string; transRef: string };
  assert.deepEqual([fb.queued, fb.fallback, fb.transRef], [true, 'CIRCUIT_OPEN_EASYSLIP', 'QUEUED-ORD-9']);
  assert.equal(fb.message, EASYSLIP_FALLBACK_MESSAGE);
  redis.kv.set(circuitStateKey('line-messaging'), 'OPEN');
  redis.kv.set(circuitOpenedAtKey('line-messaging'), String(Date.now()));
  const openLine = new LineCircuitAdapter(openBreaker, { push: async () => { throw new Error('must-not-run'); } });
  const lfb = await openLine.push('U9', {}) as { queued: boolean; fallback: string; message: string };
  assert.deepEqual([lfb.queued, lfb.fallback], [true, 'CIRCUIT_OPEN_LINE_MSG']);
  assert.equal(lfb.message, LINE_FALLBACK_MESSAGE);
  ok('8. Adapters delegate-closed + queued fallbacks (§2.1 copy)');
}

// ---------- 9. Frontend client (keys/fallbacks/retry) ----------
{
  const { newIdempotencyKey, fallbackCopyFor, resilientFetch, RESILIENCE_FALLBACK_MESSAGES } =
    await import('../apps/frontend/lib/api-client');
  const k1 = newIdempotencyKey();
  assert.ok(k1.startsWith('IDEM-') && k1.length >= 16, 'key shape');
  assert.notEqual(newIdempotencyKey(), k1);
  assert.equal(fallbackCopyFor({ fallback: 'CIRCUIT_OPEN_EASYSLIP' }), RESILIENCE_FALLBACK_MESSAGES.CIRCUIT_OPEN_EASYSLIP);
  assert.equal(fallbackCopyFor({ queued: true }), RESILIENCE_FALLBACK_MESSAGES.IDEMPOTENT_REPLAY_ACTIVE);
  assert.equal(fallbackCopyFor({ ok: true }), null);
  // retry: 503,503 → 200 with header injection.
  const seen: Array<Record<string, string>> = [];
  const realFetch = globalThis.fetch;
  let calls = 0;
  (globalThis as Record<string, unknown>)['fetch'] = (async (_url: unknown, init: { headers?: Record<string, string> }) => {
    calls++;
    seen.push(init.headers ?? {});
    if (calls < 3) return { status: 503 } as Response;
    return { status: 200 } as Response;
  }) as typeof fetch;
  try {
    const res = await resilientFetch('https://x.test/pay', { method: 'POST', body: { a: 1 }, backoffBaseMs: 1, timeoutMs: 2000 });
    assert.equal(res.status, 200);
    assert.equal(calls, 3);
    assert.ok(String(seen[0]!['X-Idempotency-Key'] ?? '').startsWith('IDEM-'), 'auto key injected');
    assert.equal(seen[0]!['X-Idempotency-Key'], seen[1]!['X-Idempotency-Key'], 'key stable across retries');
  } finally {
    (globalThis as Record<string, unknown>)['fetch'] = realFetch;
  }
  ok('9. LIFF client keys/fallbacks/503-retry/header-stability');
}

// ---------- 10. External clients (envelope + timeout budgets) ----------
{
  const { EasySlipClient } = await import('../apps/backend/src/infrastructure/external/clients/easyslip/easyslip.client');
  const { LineMessagingClient } = await import('../apps/backend/src/infrastructure/external/clients/line/line-messaging.client');
  const realFetch = globalThis.fetch;
  (globalThis as Record<string, unknown>)['fetch'] = (async () => ({
    ok: true,
    json: async () => ({ data: { transRef: 'T9', amount: 250, receiverAccount: 'ACC-9' } }),
  })) as typeof fetch;
  try {
    assert.deepEqual(await new EasySlipClient().verify({ slipUrl: 'https://r2/s.jpg' }), { transRef: 'T9', amount: 250, receiverAccount: 'ACC-9' });
  } finally {
    (globalThis as Record<string, unknown>)['fetch'] = realFetch;
  }
  (globalThis as Record<string, unknown>)['fetch'] = (async () => ({
    ok: false,
    status: 500,
  })) as typeof fetch;
  try {
    await assert.rejects(new EasySlipClient().verify({ slipUrl: 'u' }), /EASYSLIP_HTTP_500/);
    await assert.rejects(new LineMessagingClient().push('U1', { text: 'x' }), /LINE_PUSH_HTTP_500/);
  } finally {
    (globalThis as Record<string, unknown>)['fetch'] = realFetch;
  }
  (globalThis as Record<string, unknown>)['fetch'] = (async () => ({
    ok: true,
    json: async () => ({ data: { transRef: '', amount: 'nan', receiverAccount: '' } }),
  })) as typeof fetch;
  try {
    await assert.rejects(new EasySlipClient().verify({ slipUrl: 'u' }), /MALFORMED/);
  } finally {
    (globalThis as Record<string, unknown>)['fetch'] = realFetch;
  }
  ok('10. External fetch clients (parse/HTTP/malformed guards)');
}

// ---------- 11. Prisma Gate 1 (resilience models) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const m of ['model IdempotencyLog', 'model ExternalApiAuditLog']) {
    assert.ok(prisma.includes(m), m);
  }
  assert.ok(prisma.includes('key          String   @unique'), 'idempotency dedupe key');
  assert.ok(prisma.includes('circuitState String'), 'circuit state column');
  assert.ok(prisma.includes('@@index([expiresAt])'), 'expiry sweep index');
  assert.ok(prisma.includes('@@index([serviceName, createdAt])'), 'service window index');
  // 121/118 lanes intact (union-not-replace).
  assert.ok(prisma.includes('model SystemAuditLog'), '121 lane intact');
  ok('11. Prisma Gate 1 (2 models + keys + union intact)');
}

// ---------- 12. Tree parity + barrel + scope discipline ----------
{
  for (const f of [
    'apps/backend/src/modules/resilience/services/circuit-breaker.service.ts',
    'apps/backend/src/modules/resilience/services/distributed-lock.service.ts',
    'apps/backend/src/modules/resilience/interceptors/idempotency.interceptor.ts',
    'apps/backend/src/modules/resilience/decorators/idempotent.decorator.ts',
    'apps/backend/src/modules/resilience/stores/redis-idempotency.store.ts',
    'apps/backend/src/modules/resilience/adapters/easyslip-circuit.adapter.ts',
    'apps/backend/src/modules/resilience/adapters/line-circuit.adapter.ts',
    'apps/backend/src/modules/resilience/resilience.module.ts',
    'apps/backend/src/infrastructure/external/clients/easyslip/easyslip.client.ts',
    'apps/backend/src/infrastructure/external/clients/line/line-messaging.client.ts',
    'apps/frontend/lib/api-client.ts',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes('TODO') && !src.includes('placeholder'), `${f} unimplemented`);
  }
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  for (const e of ['CircuitStateEnum', 'IdempotencyHeaderSchema', 'CircuitBreakerConfigSchema', 'circuitTripped', 'IDEMPOTENCY_DATA_TTL_SEC']) {
    assert.ok(barrel.includes(e), `barrel ${e}`);
  }
  // Payment/notification cores untouched (adapters are the only seam).
  const slipCore = readFileSync('apps/backend/src/modules/payment/services/slip-verification.service.ts', 'utf8');
  assert.ok(!slipCore.includes('resilience') && !slipCore.includes('CircuitBreaker'), 'payment core untouched');
  const lineCore = readFileSync('apps/backend/src/modules/notification/line-messaging.service.ts', 'utf8');
  assert.ok(!lineCore.includes('resilience') && !lineCore.includes('CircuitBreaker'), 'messaging core untouched');
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('ResilienceModule'), 'module wired');
  ok('12. 122 tree parity + barrel + core-untouched discipline');
}
}

main()
  .then(() => console.log(`\nPhase 122 contracts: ${passed}/12 groups passed`))
  .catch((err) => {
    console.error('\nPhase 122 contracts FAILED:', err);
    process.exit(1);
  });
