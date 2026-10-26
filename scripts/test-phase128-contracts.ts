// SSOT Phase 128 §10-11 — contract tests (Zod, batching, logger, cache
// lane, Prisma Gate, barrel, wiring, zero-dep, core-untouched, budgets).
// Run: npx tsx scripts/test-phase128-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  QueryScanTypeEnum,
  QueryPerformanceMetricSchema,
  DatabaseHealthStatusSchema,
  EbookChunkQueryInputSchema,
  SLOW_QUERY_MS,
  QUERY_INSPECT_MS,
  ENTITLEMENT_VERIFY_BUDGET_MS,
  ORDER_BATCH_BUDGET_MS,
  ORDER_BATCH_QUERY_COUNT,
  SLIP_LOOKUP_BUDGET_MS,
  DB_TIMEOUT_FALLBACK_MS,
  LIFF_INIT_DB_BUDGET_MS,
  IDLE_CACHE_BUDGET_MS,
  LOADING_BATCH_BUDGET_MS,
  SUCCESS_RENDER_DB_BUDGET_MS,
  CHUNK_CACHE_HIT_BUDGET_MS,
  CHUNK_COLD_READ_BUDGET_MS,
  P99_QUERY_BUDGET_MS,
  TARGET_QPS,
  POOL_SIZE,
  POOL_RESERVE,
  POOL_MAX_DB_CONNECTIONS,
  isSlowQuery,
  needsInspect,
  scanRank,
  planIsIndexed,
  cachedQueryKey,
  chunkReadKey,
} from '../packages/shared/src/schemas/query-performance.schema';
import {
  createEntitlementLoader,
  createOrderLoader,
} from '../apps/backend/src/api/graphql/dataloaders/entitlement.dataloader';
import {
  evaluateQueryDuration,
  formatQueryLine,
  installQueryPerformanceGuard,
  resetQueryPerformanceGuardForTests,
  PrismaQueryPerformanceMiddleware,
} from '../apps/backend/src/infra/prisma/prisma-query-logger.middleware';
import { CacheQueryService } from '../apps/backend/src/infra/redis/cache-query.service';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

async function main(): Promise<void> {
// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) ----------
{
  for (const v of ['INDEX_ONLY_SCAN', 'INDEX_SCAN', 'BITMAP_INDEX_SCAN', 'SEQUENTIAL_SCAN']) {
    assert.equal(QueryScanTypeEnum.safeParse(v).success, true, v);
  }
  assert.equal(QueryScanTypeEnum.safeParse('FULL_SCAN').success, false);
  assert.equal(
    QueryPerformanceMetricSchema.safeParse({
      queryHash: 'h1', rawSql: 'SELECT 1', executionTimeMs: 0.4, planningTimeMs: 0.05,
      scanType: 'INDEX_ONLY_SCAN', rowsProcessed: 1, isSlowQuery: false,
    }).success,
    true,
  );
  assert.equal(
    QueryPerformanceMetricSchema.safeParse({
      queryHash: 'h1', rawSql: 'SELECT 1', executionTimeMs: -1, planningTimeMs: 0,
      scanType: 'SEQUENTIAL_SCAN', rowsProcessed: 1, isSlowQuery: true,
    }).success,
    false,
  );
  assert.equal(
    DatabaseHealthStatusSchema.safeParse({
      activeConnections: 12, idleConnections: 38, waitingQueries: 0,
      cacheHitRatioPercent: 99.2, indexHitRatioPercent: 98.7,
    }).success,
    true,
  );
  assert.equal(
    DatabaseHealthStatusSchema.safeParse({
      activeConnections: 12, idleConnections: 38, waitingQueries: 0,
      cacheHitRatioPercent: 100.5, indexHitRatioPercent: 98.7,
    }).success,
    false,
  );
  assert.equal(
    EbookChunkQueryInputSchema.safeParse({ productId: 'p1', pageNumber: 3, userId: 'u1' }).success,
    true,
  );
  assert.equal(
    EbookChunkQueryInputSchema.safeParse({ productId: 'p1', pageNumber: 0, userId: 'u1' }).success,
    false,
  );
  ok('1. Zod SSOT verbatim (§3.1 Gate 1)');
}
// ---------- 2. Pure helpers + budgets ----------
{
  assert.equal(isSlowQuery(50), false);
  assert.equal(isSlowQuery(51), true);
  assert.equal(needsInspect(10), false);
  assert.equal(needsInspect(11), true);
  assert.ok(scanRank('INDEX_ONLY_SCAN') > scanRank('INDEX_SCAN'));
  assert.ok(scanRank('INDEX_SCAN') > scanRank('BITMAP_INDEX_SCAN'));
  assert.ok(scanRank('BITMAP_INDEX_SCAN') > scanRank('SEQUENTIAL_SCAN'));
  assert.equal(planIsIndexed('INDEX_ONLY_SCAN'), true);
  assert.equal(planIsIndexed('SEQUENTIAL_SCAN'), false);
  assert.equal(cachedQueryKey('h1'), 'perf:query:{h1}');
  assert.equal(chunkReadKey('p1', 3), 'ebook:chunk:{p1}:3');
  assert.equal(SLOW_QUERY_MS, 50);
  assert.equal(QUERY_INSPECT_MS, 10);
  assert.equal(ENTITLEMENT_VERIFY_BUDGET_MS, 2);
  assert.equal(ORDER_BATCH_BUDGET_MS, 15);
  assert.equal(ORDER_BATCH_QUERY_COUNT, 3);
  assert.equal(SLIP_LOOKUP_BUDGET_MS, 1);
  assert.equal(DB_TIMEOUT_FALLBACK_MS, 50);
  assert.equal(LIFF_INIT_DB_BUDGET_MS, 10);
  assert.equal(IDLE_CACHE_BUDGET_MS, 2);
  assert.equal(LOADING_BATCH_BUDGET_MS, 15);
  assert.equal(SUCCESS_RENDER_DB_BUDGET_MS, 5);
  assert.equal(CHUNK_CACHE_HIT_BUDGET_MS, 8);
  assert.equal(CHUNK_COLD_READ_BUDGET_MS, 18);
  assert.equal(P99_QUERY_BUDGET_MS, 5);
  assert.equal(TARGET_QPS, 10000);
  assert.equal(POOL_SIZE, 50);
  assert.equal(POOL_RESERVE, 10);
  assert.equal(POOL_MAX_DB_CONNECTIONS, 200);
  ok('2. helpers + SLA budgets (§2.2/§6.1/§8.1/BDD)');
}
// ---------- 3. Entitlement loader (§5.1: N loads, 1 SQL) ----------
{
  let calls = 0;
  const seen: string[][] = [];
  const db = {
    entitlement: {
      async findMany(args: { where: { userId: { in: string[] } } }) {
        calls += 1;
        seen.push(args.where.userId.in);
        return args.where.userId.in.map((u) => ({
          id: `e-${u}`, userId: u, productId: 'p1', accessType: 'FULL_PURCHASE', expiresAt: null,
        }));
      },
    },
  };
  const loader = createEntitlementLoader(db);
  const [a, b, c] = await Promise.all([loader.load('u1'), loader.load('u2'), loader.load('u1')]);
  assert.equal(calls, 1);
  assert.deepEqual([...seen[0]].sort(), ['u1', 'u2']);
  assert.equal(a.length, 1);
  assert.equal(a[0].userId, 'u1');
  assert.equal(b[0].userId, 'u2');
  assert.deepEqual(c, a);
  const callsBefore = calls;
  await loader.load('u1');
  assert.equal(calls, callsBefore);
  loader.prime('u9', [{ id: 'e-u9', userId: 'u9', productId: 'p2', accessType: 'FULL_PURCHASE', expiresAt: null }]);
  assert.equal((await loader.load('u9'))[0].productId, 'p2');
  assert.equal(calls, callsBefore);
  loader.clear('u1');
  await loader.load('u1');
  assert.equal(calls, callsBefore + 1);
  const empty = createEntitlementLoader({ entitlement: { async findMany() { calls += 1; return []; } } });
  assert.deepEqual(await empty.load('ghost'), []);
  const failing = createEntitlementLoader({ entitlement: { async findMany(): Promise<never[]> { throw new Error('db down'); } } });
  await assert.rejects(failing.load('u1'), /db down/);
  ok('3. entitlement batching (1 SQL/tick, order, cache, prime, reject)');
}
// ---------- 4. Order loader (BDD-2: N orders, exactly 3 SQL) ----------
{
  const counts = { order: 0, item: 0, product: 0 };
  const N = 100;
  const ids = Array.from({ length: N }, (_, i) => `o${i}`);
  const db = {
    order: {
      async findMany(args: { where: { id: { in: string[] } } }) {
        counts.order += 1;
        return args.where.id.in
          .filter((id) => ids.includes(id))
          .map((id) => ({ id, orderNumber: `NO-${id}`, userId: 'u1', netAmount: 100 }));
      },
    },
    orderItem: {
      async findMany(args: { where: { orderId: { in: string[] } } }) {
        counts.item += 1;
        return args.where.orderId.in.flatMap((o) => [
          { id: `i-${o}-a`, orderId: o, productId: 'pa', price: 60, quantity: 1 },
          { id: `i-${o}-b`, orderId: o, productId: 'pb', price: 40, quantity: 1 },
        ]);
      },
    },
    product: {
      async findMany() {
        counts.product += 1;
        return [
          { id: 'pa', title: 'Book A', productType: 'EBOOK' },
          { id: 'pb', title: 'Course B', productType: 'ELEARNING_COURSE' },
        ];
      },
    },
  };
  const loader = createOrderLoader(db);
  const t0 = Date.now();
  const rows = await loader.loadMany(ids);
  const dt = Date.now() - t0;
  assert.deepEqual(counts, { order: 1, item: 1, product: 1 });
  assert.equal(rows.length, N);
  assert.equal(rows[0]?.items.length, 2);
  assert.equal(rows[0]?.items[0].product?.title, 'Book A');
  assert.equal(rows[99]?.orderNumber, 'NO-o99');
  assert.ok(dt < ORDER_BATCH_BUDGET_MS, `batched 100 orders in ${dt}ms`);
  assert.equal(await loader.load('missing'), null);
  const countsBefore = { ...counts };
  await loader.loadMany(ids.slice(0, 10));
  assert.deepEqual(counts, countsBefore);
  loader.clear();
  await loader.load('o0');
  assert.equal(counts.order, countsBefore.order + 1);
  ok('4. order batching (exactly 3 SQL for 100 orders, join, null, cache)');
}
// ---------- 5. Query logger middleware (§5.2) ----------
{
  assert.equal(evaluateQueryDuration(50), 'ok');
  assert.equal(evaluateQueryDuration(51), 'slow');
  assert.ok(formatQueryLine({ model: 'Entitlement', action: 'findMany' }, 3).includes('Entitlement'));
  assert.ok(formatQueryLine({ action: 'queryRaw' }, 60).includes('raw'));
  let installs = 0;
  const fake = { $use() { installs += 1; } };
  resetQueryPerformanceGuardForTests();
  installQueryPerformanceGuard(fake);
  installQueryPerformanceGuard(fake);
  assert.equal(installs, 1);
  resetQueryPerformanceGuardForTests();
  const out = await PrismaQueryPerformanceMiddleware(
    { model: 'Order', action: 'findMany' },
    async () => 'passthrough',
  );
  assert.equal(out, 'passthrough');
  ok('5. slow-query guard (verdict/format/once-install/passthrough)');
}
// ---------- 6. Cache query lane (§2.2 IDLE < 2ms + ERROR backup) ----------
{
  const store = new Map<string, string>([['k-hit', 'cached']]);
  let computes = 0;
  const edge = {
    async get(k: string) { return store.has(k) ? store.get(k)! : null; },
    async setex(k: string, _t: number, v: string) { store.set(k, v); },
    async del(...ks: string[]) { for (const k of ks) store.delete(k); },
    async scanKeys(pattern: string) { return [...store.keys()].filter((k) => k.startsWith(pattern.replace('*', ''))); },
  };
  const svc = new CacheQueryService(edge);
  assert.equal(await svc.query('k-hit', 60, async () => { computes += 1; return 'fresh'; }), 'cached');
  assert.equal(computes, 0);
  assert.equal(await svc.query('k-new', 60, async () => { computes += 1; return 'v1'; }), 'v1');
  assert.equal(computes, 1);
  assert.equal(store.get('k-new'), 'v1');
  const [r1, r2] = await Promise.all([
    svc.query('k-race', 60, async () => { computes += 1; await new Promise((r) => setTimeout(r, 10)); return 'won'; }),
    svc.query('k-race', 60, async () => { computes += 1; return 'lost'; }),
  ]);
  assert.equal(r1, 'won');
  assert.equal(r2, 'won');
  await assert.rejects(
    svc.query('k-boom', 60, async () => { throw new Error('compute down'); }),
    /compute down/,
  );
  store.set('k-stale', 'old');
  let flakyGets = 0;
  const flaky = new CacheQueryService({
    async get(k: string) {
      flakyGets += 1;
      if (flakyGets === 1) throw new Error('transient edge outage');
      return k === 'k-stale' ? 'old' : null;
    },
    async setex() { throw new Error('redis down'); },
    async del() { /* noop */ },
  });
  assert.equal(await flaky.query('k-stale', 60, async () => { throw new Error('compute down'); }), 'old');
  await svc.invalidate('k-hit');
  assert.equal(store.has('k-hit'), false);
  store.set('catalog:a', '1');
  store.set('catalog:b', '2');
  assert.equal(await svc.invalidatePattern('catalog:'), 0 + 2);
  const snap = svc.snapshot();
  assert.ok(snap.hits >= 1 && snap.misses >= 1 && snap.staleServed === 0);
  assert.equal(flaky.snapshot().staleServed, 1);
  ok('6. cache-aside (hit/miss/single-flight/stale/invalidate/stats)');
}
// ---------- 7. Prisma Gate 1 + SQL companion (§4.1/§4.2/§9.1) ----------
{
  const schema = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  assert.ok(schema.includes('@@index([userId, productId, expiresAt], map: "idx_entitlement_verification")'), 'entitlement verify index');
  assert.ok(schema.includes('@@index([userId, createdAt], map: "idx_order_user_created")'), 'order history index');
  assert.ok(schema.includes('transRef         String?   @unique'), 'slip transRef unique (BDD-3)');
  const sql = readFileSync('apps/backend/src/infra/postgres/performance-128.sql', 'utf8');
  for (const needle of [
    'uniq_idx_entitlement_covering', 'idx_user_line_liff_covering', 'idx_order_pending_payment_partial',
    'idx_ebook_chapter_covering', 'brin_audit_log_created_at', 'CONCURRENTLY', 'INCLUDE', 'USING BRIN',
  ]) {
    assert.ok(sql.includes(needle), `sql ${needle}`);
  }
  assert.ok(!sql.includes('PASSWORD') && !sql.includes('SECRET'), 'no secrets in SQL companion');
  ok('7. Prisma Gate 1 + covering-index SQL companion');
}
// ---------- 8. Barrel ----------
{
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  for (const e of [
    'QueryScanTypeEnum', 'QueryPerformanceMetricSchema', 'DatabaseHealthStatusSchema',
    'EbookChunkQueryInputSchema', 'SLOW_QUERY_MS', 'QUERY_INSPECT_MS',
    'ENTITLEMENT_VERIFY_BUDGET_MS', 'ORDER_BATCH_BUDGET_MS', 'ORDER_BATCH_QUERY_COUNT',
    'SLIP_LOOKUP_BUDGET_MS', 'isSlowQuery', 'scanRank', 'planIsIndexed',
    'cachedQueryKey', 'chunkReadKey', 'QueryPerformanceMetric', 'DatabaseHealthStatus',
  ]) {
    assert.ok(barrel.includes(e), `barrel ${e}`);
  }
  ok('8. barrel exports');
}
// ---------- 9. Module wiring ----------
{
  const ent = readFileSync('apps/backend/src/modules/entitlement/entitlement.module.ts', 'utf8');
  assert.ok(ent.includes('ENTITLEMENT_LOADER_FACTORY') && ent.includes('ORDER_LOADER_FACTORY'), 'loader factories');
  assert.ok(ent.includes('class EntitlementModule'), 'module class');
  const infra = readFileSync('apps/backend/src/infra/infra.module.ts', 'utf8');
  assert.ok(infra.includes('installQueryPerformanceGuard') && infra.includes('onModuleInit'), 'guard install');
  const chunk = readFileSync('apps/backend/src/modules/reader/cache/chunk-cache.module.ts', 'utf8');
  assert.ok(chunk.includes('CacheQueryService'), 'cache lane wired');
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('EntitlementModule'), 'app imports entitlement');
  ok('9. module wiring (loaders/guard/cache/app)');
}
// ---------- 10. Zero-dep + no-stub tree parity ----------
{
  for (const f of [
    'apps/backend/src/api/graphql/dataloaders/entitlement.dataloader.ts',
    'apps/backend/src/infra/prisma/prisma-query-logger.middleware.ts',
    'apps/backend/src/infra/redis/cache-query.service.ts',
    'packages/shared/src/schemas/query-performance.schema.ts',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes('AUTO-SCAFFOLD') && !src.includes('placeholder'), `${f} unimplemented`);
  }
  for (const f of [
    'apps/backend/src/api/graphql/dataloaders/entitlement.dataloader.ts',
    'apps/backend/src/infra/prisma/prisma-query-logger.middleware.ts',
    'apps/backend/src/infra/redis/cache-query.service.ts',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes("from 'dataloader'") && !src.includes('require("dataloader")'), `${f} new dep`);
  }
  const sql = readFileSync('apps/backend/src/infra/postgres/performance-128.sql', 'utf8');
  assert.ok(!sql.includes('AUTO-SCAFFOLD'), 'sql companion clean');
  ok('10. zero-dep batching + no-stub parity');
}
// ---------- 11. Core-untouched discipline ----------
{
  for (const [f, bans] of [
    ['apps/backend/src/modules/payment/services/slip-verification.service.ts', ['dataloader', 'DataLoader', 'cacheQuery']],
    ['apps/backend/src/modules/entitlement/services/entitlement-grant.service.ts', ['dataloader', 'DataLoader']],
    ['apps/frontend/components/reader/CanvasReaderEngine.tsx', ['dataloader']],
  ] as Array<[string, string[]]>) {
    const src = readFileSync(f, 'utf8');
    for (const ban of bans) assert.ok(!src.includes(ban), `${f} touched by ${ban}`);
  }
  const grant = readFileSync('apps/backend/src/modules/entitlement/services/entitlement.service.ts', 'utf8');
  assert.ok(grant.includes('listGrantResults'), 'read lane intact');
  const prismaCore = readFileSync('apps/backend/src/infra/database/prisma.service.ts', 'utf8');
  assert.ok(!prismaCore.includes('QueryPerformance'), 'pool owner untouched');
  ok('11. payment/grant/reader/pool cores untouched');
}
// ---------- 12. BDD budget posture ----------
{
  assert.ok(ENTITLEMENT_VERIFY_BUDGET_MS < P99_QUERY_BUDGET_MS, 'BDD-1 under p99');
  assert.ok(SLIP_LOOKUP_BUDGET_MS < P99_QUERY_BUDGET_MS, 'BDD-3 under p99');
  assert.ok(IDLE_CACHE_BUDGET_MS <= ENTITLEMENT_VERIFY_BUDGET_MS, 'IDLE cache fastest');
  assert.ok(CHUNK_CACHE_HIT_BUDGET_MS < CHUNK_COLD_READ_BUDGET_MS, 'hit faster than cold');
  assert.ok(LOADING_BATCH_BUDGET_MS === ORDER_BATCH_BUDGET_MS, 'LOADING == batch ceiling');
  assert.ok(DB_TIMEOUT_FALLBACK_MS === SLOW_QUERY_MS, 'fallback == slow tripwire');
  assert.ok(POOL_SIZE + POOL_RESERVE <= POOL_MAX_DB_CONNECTIONS, 'pool fits max');
  assert.ok(ORDER_BATCH_QUERY_COUNT === 3, 'BDD-2 exactly 3 SQL');
  ok('12. BDD/SLA budget coherence');
}
}

main()
  .then(() => {
    console.log(`\nPhase 128 contracts: ${passed}/12 groups passed`);
    process.exit(0);
  })
  .catch((err) => {
    console.error('\nPhase 128 contracts FAILED:', err);
    process.exit(1);
  });
