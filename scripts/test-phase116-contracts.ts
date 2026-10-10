// SSOT Phase 116 §10-11 — contract tests (Zod, BI math, ranges/cohorts,
// cache-first summary, snapshot worker, finance guards, stress, Prisma
// Gate 1, SDL, frontend, barrel).
// Run: npx tsx scripts/test-phase116-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AnalyticsTimeRangeEnum,
  ExecutiveKpiOverviewSchema,
  CohortRetentionDataSchema,
  ExecutiveBiDashboardPayloadSchema,
  BI_QUERY_SLA_MS,
  BI_SUMMARY_CACHE_TTL_SEC,
  CHURN_INACTIVITY_DAYS,
  averageOrderValue,
  customerAcquisitionCost,
  customerLifetimeValue,
  ltvToCacRatio,
  churnRatePercentage,
  retentionPercentage,
  growthPercentage,
  cohortMonthKey,
  monthOffset,
  biSummaryKey,
  biCohortKey,
} from '../packages/shared/src/schemas/analytics-contract';
import {
  rangeBounds,
  buildCohortMatrix,
  ExecutiveAnalyticsService,
} from '../apps/backend/src/modules/analytics/services/executive-analytics.service';
import { DailySnapshotWorker } from '../apps/backend/src/modules/analytics/workers/daily-snapshot.worker';
import { ExecutiveAnalyticsResolver } from '../apps/backend/src/modules/analytics/resolvers/executive-analytics.resolver';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const TENANT = 'acme';
const NOW = new Date('2026-10-10T12:00:00.000Z').getTime();

async function main(): Promise<void> {
// ---------- 1. Zod executive section verbatim (§3.1 Gate 1) ----------
{
  for (const v of ['TODAY', 'YESTERDAY', 'LAST_7_DAYS', 'LAST_30_DAYS', 'THIS_MONTH', 'LAST_MONTH', 'CUSTOM']) {
    assert.equal(AnalyticsTimeRangeEnum.safeParse(v).success, true, v);
  }
  assert.equal(AnalyticsTimeRangeEnum.safeParse('LAST_YEAR').success, false);
  assert.equal(
    ExecutiveKpiOverviewSchema.safeParse({
      gmv: 1000, netRevenue: 950, totalOrders: 5, averageOrderValue: 200,
      customerAcquisitionCost: 50, customerLifetimeValue: 200, churnRatePercentage: 10,
      activeUsersCount: 90, gmvGrowthPercentage: 25, ltvToCacRatio: 4,
    }).success,
    true,
  );
  assert.equal(
    ExecutiveKpiOverviewSchema.safeParse({ gmv: 1000, totalOrders: 5.5 }).success,
    false,
  );
  assert.equal(
    CohortRetentionDataSchema.safeParse({
      cohortDate: '2026-08', totalUsers: 10,
      retentionRates: [{ periodIndex: 0, activePercentage: 100, retainedUsers: 10 }],
    }).success,
    true,
  );
  assert.equal(
    ExecutiveBiDashboardPayloadSchema.safeParse({
      kpiSummary: {
        gmv: 1, netRevenue: 1, totalOrders: 1, averageOrderValue: 1,
        customerAcquisitionCost: 1, customerLifetimeValue: 1, churnRatePercentage: 1,
        activeUsersCount: 1, gmvGrowthPercentage: 1, ltvToCacRatio: 1,
      },
      cohortMatrix: [],
      revenueBreakdownByProductType: { physicalBook: 1, ebook: 1, course: 1, bundle: 1 },
      calculatedAt: '2026-10-10T00:00:00.000Z',
    }).success,
    true,
  );
  // 052 telemetry section untouched (spot check).
  const src = readFileSync('packages/shared/src/schemas/analytics-contract.ts', 'utf8');
  assert.ok(src.includes('EBOOK_PAGE_DWELL') && src.includes('averageDwell'), '052 section intact');
  ok('1. Zod executive section verbatim (range/KPI/cohort/payload)');
}

// ---------- 2. Pure BI math + keys + budgets ----------
{
  assert.equal(averageOrderValue(1000, 5), 200);
  assert.equal(averageOrderValue(1000, 0), 0);
  assert.equal(customerAcquisitionCost(500, 10), 50);
  assert.equal(customerAcquisitionCost(500, 0), 0);
  assert.equal(customerLifetimeValue(2000, 10), 200);
  assert.equal(customerLifetimeValue(2000, 0), 0);
  assert.equal(ltvToCacRatio(200, 50), 4);
  assert.equal(ltvToCacRatio(200, 0), 0);
  assert.equal(churnRatePercentage(10, 100), 10);
  assert.equal(churnRatePercentage(5, 0), 0);
  assert.equal(retentionPercentage(7, 10), 70);
  assert.equal(retentionPercentage(0, 0), 0);
  assert.equal(retentionPercentage(11, 10), 100);
  assert.equal(growthPercentage(150, 100), 50);
  assert.equal(growthPercentage(0, 0), 0);
  assert.equal(growthPercentage(50, 0), 100);
  assert.equal(cohortMonthKey('2026-08-15T00:00:00.000Z'), '2026-08');
  assert.equal(monthOffset('2026-08-01', '2026-10-10'), 2);
  assert.equal(monthOffset('2026-08-01', '2026-08-15'), 0);
  assert.equal(biSummaryKey(TENANT, 'LAST_30_DAYS'), 'bi:summary:acme:LAST_30_DAYS');
  assert.equal(biCohortKey(TENANT, '2026-10'), 'bi:cohort:acme:2026-10');
  assert.equal(BI_QUERY_SLA_MS, 500);
  assert.equal(BI_SUMMARY_CACHE_TTL_SEC, 900);
  assert.equal(CHURN_INACTIVITY_DAYS, 30);
  ok('2. AOV/CAC/LTV/ratio/churn/retention/growth/month/keys + budgets');
}

// ---------- 3. Range bounds + pure cohort builder ----------
{
  const last30 = rangeBounds('LAST_30_DAYS', NOW);
  assert.equal(last30.end.getTime() - last30.start.getTime(), 30 * 86400000);
  assert.equal(last30.prevEnd.getTime(), last30.start.getTime());
  const today = rangeBounds('TODAY', NOW);
  assert.equal(today.end.getTime() - today.start.getTime(), 86400000);
  const custom = rangeBounds('CUSTOM', NOW, { start: '2026-09-01T00:00:00.000Z', end: '2026-09-08T00:00:00.000Z' });
  assert.equal(custom.end.getTime() - custom.start.getTime(), 7 * 86400000);
  assert.throws(() => rangeBounds('CUSTOM', NOW), /CUSTOM range requires/);
  const fallback = rangeBounds('BOGUS', NOW);
  assert.equal(fallback.end.getTime() - fallback.start.getTime(), 30 * 86400000);

  const users = [
    { id: 'u1', createdAt: new Date('2026-08-05T00:00:00.000Z') },
    { id: 'u2', createdAt: new Date('2026-08-20T00:00:00.000Z') },
    { id: 'u3', createdAt: new Date('2026-09-02T00:00:00.000Z') },
  ];
  const activity = new Map<string, number>([
    ['u1', new Date('2026-10-01T00:00:00.000Z').getTime()],
    ['u2', new Date('2026-08-25T00:00:00.000Z').getTime()],
  ]);
  const matrix = buildCohortMatrix(users, activity, NOW, 6);
  assert.equal(matrix.length, 2);
  assert.equal(matrix[0]!.cohortDate, '2026-08');
  assert.equal(matrix[0]!.totalUsers, 2);
  assert.deepEqual(matrix[0]!.retentionRates[0], { periodIndex: 0, activePercentage: 100, retainedUsers: 2 });
  assert.deepEqual(matrix[0]!.retentionRates[2], { periodIndex: 2, activePercentage: 50, retainedUsers: 1 });
  assert.equal(matrix[1]!.retentionRates[0]!.retainedUsers, 0);
  assert.deepEqual(buildCohortMatrix([], new Map(), NOW), []);
  ok('3. 7 ranges + cohort grouping/periods/retention math');
}

// ---------- 4. Summary service: cache-first, snapshot-first, live fallback ----------
{
  const cache = new Map<string, string>();
  const redis = {
    get: async (k: string) => cache.get(k) ?? null,
    setex: async (k: string, _t: number, v: string) => { cache.set(k, v); },
    xaddPipeline: async () => undefined,
  };
  function mockDb(opts?: { snapshots?: Array<Record<string, unknown>>; orders?: Array<Record<string, unknown>>; prevOrders?: Array<Record<string, unknown>> }) {
    let orderCalls = 0;
    return {
      db: {
        order: {
          findMany: async (a: unknown) => {
            orderCalls++;
            const where = (a as { where: Record<string, { gte: Date; lt: Date }> }).where;
            const isPrev = where.createdAt.lt.getTime() <= new Date('2026-09-11T00:00:00.000Z').getTime();
            return isPrev ? (opts?.prevOrders ?? [{ netAmount: 1000 }]) : (opts?.orders ?? [{ netAmount: 1000 }, { netAmount: 1000 }]);
          },
        },
        user: {
          findMany: async () => [{ id: 'u1' }],
          count: async () => 10,
        },
        marketingCampaign: { findMany: async () => [{ totalAdSpend: 500 }] },
        ebookReadingProgress: { findMany: async () => [{ userId: 'u1' }] },
        courseLearningProgress: { findMany: async () => [] },
        orderItem: { findMany: async () => [] },
        product: { findMany: async () => [] },
        dailyAnalyticsSnapshot: { findMany: async () => opts?.snapshots ?? [] },
      },
      orderCalls: () => orderCalls,
    };
  }
  const mk = (m: ReturnType<typeof mockDb>, r = redis) =>
    new ExecutiveAnalyticsService(m.db as never, r as never);

  // 4a. cache hit short-circuits Prisma
  cache.set('bi:summary:acme:LAST_7_DAYS', JSON.stringify({ gmv: 1, cached: true }));
  const exploding = { order: { findMany: async () => { throw new Error('must not query'); } } };
  const hit = await new ExecutiveAnalyticsService(exploding as never, redis as never).getExecutiveKpiSummary(TENANT, 'LAST_7_DAYS');
  assert.equal((hit as Record<string, unknown>)['cached'], true);

  // 4b. live fallback math (gmv 2000, cac 50, ltv 200, ratio 4, growth +100%)
  cache.clear();
  const m2 = mockDb();
  const svc2 = mk(m2);
  const live = await svc2.getExecutiveKpiSummary(TENANT, 'LAST_30_DAYS');
  assert.deepEqual(
    [live['gmv'], live['netRevenue'], live['totalOrders'], live['averageOrderValue'], live['customerAcquisitionCost'], live['customerLifetimeValue'], live['ltvToCacRatio'], live['gmvGrowthPercentage']],
    [2000, 1900, 2, 1000, 50, 200, 4, 100],
  );
  assert.ok(typeof live['calculatedAt'] === 'string' && (live['calculatedAt'] as string).length > 10, 'calculatedAt stamped');
  assert.ok(cache.has('bi:summary:acme:LAST_30_DAYS'), '15min cache written');

  // 4c. snapshot-first (no live order rows needed for GMV)
  cache.clear();
  const m3 = mockDb({ snapshots: [{ gmv: 2000, netRevenue: 1900, totalOrders: 2 }] });
  const snap = await mk(m3).getExecutiveKpiSummary(TENANT, 'LAST_30_DAYS');
  assert.deepEqual([snap['gmv'], snap['totalOrders']], [2000, 2]);

  // 4d. guards
  await assert.rejects(() => mk(mockDb()).getExecutiveKpiSummary(TENANT, 'LAST_YEAR'), /Invalid time range/);
  ok('4. Cache-hit/snapshot-first/live-fallback + growth + write-through + guard');
}

// ---------- 5. Cohort + breakdown service lanes ----------
{
  const db = {
    order: { findMany: async (a: unknown) => {
      const sel = (a as { select?: Record<string, boolean> }).select;
      if (sel && 'id' in sel) return [{ id: 'o1' }, { id: 'o2' }];
      return [];
    } },
    user: {
      findMany: async (a: unknown) => {
        const sel = (a as { select?: Record<string, boolean> }).select;
        if (sel && 'createdAt' in sel) {
          return [
            { id: 'u1', createdAt: new Date('2026-08-05T00:00:00.000Z') },
            { id: 'u2', createdAt: new Date('2026-09-02T00:00:00.000Z') },
          ];
        }
        return [];
      },
      count: async () => 2,
    },
    marketingCampaign: { findMany: async () => [] },
    ebookReadingProgress: { findMany: async () => [{ userId: 'u1', updatedAt: new Date('2026-10-01T00:00:00.000Z') }] },
    courseLearningProgress: { findMany: async () => [] },
    orderItem: { findMany: async () => [
      { productId: 'p1', price: 500, quantity: 1 },
      { productId: 'p2', price: 300, quantity: 2 },
      { productId: 'p3', price: 100, quantity: 1 },
    ] },
    product: { findMany: async () => [
      { id: 'p1', productType: 'EBOOK' },
      { id: 'p2', productType: 'HYBRID_BUNDLE' },
      { id: 'p3', productType: 'PHYSICAL_BOOK' },
    ] },
    dailyAnalyticsSnapshot: { findMany: async () => [] },
  };
  const svc = new ExecutiveAnalyticsService(db as never, { get: async () => null, setex: async () => undefined, xaddPipeline: async () => undefined } as never);
  const matrix = await svc.getCohortMatrix(TENANT, 6);
  assert.equal(matrix.length, 2);
  assert.equal(matrix[0]!.cohortDate, '2026-08');
  const split = await svc.getRevenueBreakdown(TENANT, 'LAST_30_DAYS');
  assert.deepEqual(split, { physicalBook: 100, ebook: 500, course: 0, bundle: 600 });
  await assert.rejects(() => svc.getRevenueBreakdown(TENANT, 'LAST_YEAR'), /Invalid time range/);
  // tenant isolation probe: cohort member read must carry the tenant filter
  let cohortWhere: Record<string, unknown> | null = null;
  const probingDb = {
    ...db,
    user: {
      ...db.user,
      findMany: async (a: unknown) => {
        cohortWhere = (a as { where: Record<string, unknown> }).where;
        return [];
      },
    },
  };
  await new ExecutiveAnalyticsService(probingDb as never, { get: async () => null, setex: async () => undefined, xaddPipeline: async () => undefined } as never).getCohortMatrix(TENANT, 6);
  assert.equal(cohortWhere?.['tenantId'], TENANT);
  ok('5. Cohort lane + 4-bucket revenue split');
}

// ---------- 6. Nightly worker: upsert math + fail-open fan-out ----------
{
  const events: unknown[][] = [];
  const upserts: unknown[] = [];
  const db = {
    order: { findMany: async () => [{ netAmount: 1000 }, { netAmount: 500 }] },
    user: {
      findMany: async (a: unknown) => {
        const where = (a as { where: Record<string, unknown> }).where;
        if (where && 'createdAt' in where) return [{ id: 'old1' }, { id: 'old2' }];
        return [{ id: 'old1' }, { id: 'old2' }];
      },
      count: async () => 10,
    },
    marketingCampaign: { findMany: async () => [{ totalAdSpend: 200 }] },
    ebookReadingProgress: { findMany: async () => [{ userId: 'old1' }] },
    courseLearningProgress: { findMany: async () => [] },
    dailyAnalyticsSnapshot: { upsert: async (a: unknown) => { upserts.push(a); return {}; } },
  };
  const worker = new DailySnapshotWorker(db as never, { xaddPipeline: async (...a: unknown[]) => { events.push(a); } } as never);
  const built = await worker.buildSnapshot(TENANT, new Date('2026-10-09T00:00:00.000Z'));
  assert.deepEqual([built.gmv, built.totalOrders, built.tenantId], [1500, 2, TENANT]);
  assert.equal(built.churnRatePercentage, 50);
  const row = (upserts[0] as { create: Record<string, unknown> }).create;
  assert.deepEqual([row['avgOrderValue'], row['calculatedLtv'], row['calculatedCac']], [750, 150, 20]);
  assert.ok(events.some((e) => JSON.stringify(e).includes('analytics.snapshot.built')), 'snapshot stream');
  const fan = await worker.runOnce([TENANT, 't2'], new Date('2026-10-09T00:00:00.000Z'));
  assert.deepEqual(fan, { built: 2, failed: 0 });
  // 6b. DB error -> fail-open (worker catches error, continues with other tenants)
  // 6b. DB read outage -> fail-open reads: snapshot still built (zeros), upsert runs
  const failDb = {
    ...db,
    order: { findMany: async () => { throw new Error('db down'); } },
  };
  const failWorker = new DailySnapshotWorker(failDb as never, { xaddPipeline: async () => undefined } as never);
  const failResult = await failWorker.runOnce(['t1', 't2'], new Date('2026-10-09T00:00:00.000Z'));
  assert.deepEqual(failResult, { built: 2, failed: 0 });
  // 6c. Upsert outage -> true failure path (per-tenant fail-open across tenants)
  const upsertDownDb = {
    ...db,
    dailyAnalyticsSnapshot: { upsert: async () => { throw new Error('upsert down'); } },
  };
  const upsertDownWorker = new DailySnapshotWorker(upsertDownDb as never, { xaddPipeline: async () => undefined } as never);
  assert.deepEqual(await upsertDownWorker.runOnce(['t1', 't2'], new Date('2026-10-09T00:00:00.000Z')), { built: 0, failed: 2 });
  // 6c. Redis error -> worker catches error, snapshot succeeds (fail-open telemetry)
  const downRedis = { xaddPipeline: async () => { throw new Error('bus down'); } };
  const downed = new DailySnapshotWorker(db as never, downRedis as never);
  const downResult = await downed.runOnce(['t1'], new Date('2026-10-09T00:00:00.000Z'));
  assert.deepEqual(downResult, { built: 1, failed: 0 });
  ok('6. Snapshot upsert math + stream + per-tenant fail-open + Redis fail-open');
}

// ---------- 7. Finance guards (GQL + REST shape) ----------
{
  const bi = { getExecutiveKpiSummary: async () => ({}), getCohortMatrix: async () => [], getRevenueBreakdown: async () => ({}) };
  const nightly = { runOnce: async () => ({ built: 1, failed: 0 }) };
  const resolver = new ExecutiveAnalyticsResolver(bi as never, nightly as never);
  const memberCtx = { req: { user: { id: 'u1', role: 'MEMBER' }, headers: {} } };
  const anonCtx = { req: { headers: {} } };
  const adminCtx = { req: { user: { id: 'a1', role: 'SUPER_ADMIN' }, headers: { 'x-tenant-slug': TENANT } } };
  await assert.rejects(() => resolver.executiveSummary(undefined, 'LAST_30_DAYS', memberCtx as never), /finance admin/);
  await assert.rejects(() => resolver.executiveSummary(undefined, 'LAST_30_DAYS', anonCtx as never), /Missing authentication/);
  await resolver.executiveSummary(undefined, 'LAST_30_DAYS', adminCtx as never);
  await assert.rejects(() => resolver.cohortMatrix(undefined, 6, memberCtx as never), /finance admin/);
  await assert.rejects(() => resolver.revenueBreakdown(undefined, 'TODAY', memberCtx as never), /finance admin/);
  assert.equal(await resolver.runNightlySnapshot(undefined, undefined, adminCtx as never), true);
  const ctl = readFileSync('apps/backend/src/modules/analytics/controllers/executive-analytics.controller.ts', 'utf8');
  assert.ok(ctl.includes('FINANCE_ADMIN') && ctl.includes('summary') && ctl.includes('snapshot-run'), 'REST finance guards + lanes');
  ok('7. GQL/REST finance-only gate + auth fail-closed');
}

// ---------- 8. Cache outage fail-open + SLA warn path ----------
{
  const db = {
    order: { findMany: async () => [{ netAmount: 100 }] },
    user: { findMany: async () => [], count: async () => 0 },
    marketingCampaign: { findMany: async () => [] },
    ebookReadingProgress: { findMany: async () => [] },
    courseLearningProgress: { findMany: async () => [] },
    orderItem: { findMany: async () => [] },
    product: { findMany: async () => [] },
    dailyAnalyticsSnapshot: { findMany: async () => [] },
  };
  const downRedis = {
    get: async () => { throw new Error('redis down'); },
    setex: async () => { throw new Error('redis down'); },
    xaddPipeline: async () => undefined,
  };
  const svc = new ExecutiveAnalyticsService(db as never, downRedis as never);
  const out = await svc.getExecutiveKpiSummary(TENANT, 'TODAY');
  assert.equal(out['gmv'], 100);
  ok('8. Redis outage → live compute (fail-open, no throw)');
}

// ---------- 9. Stress: bulk cohort + summary timing (§10.1) ----------
{
  const N = 2000;
  const users = Array.from({ length: N }, (_, i) => ({
    id: `u${i}`,
    createdAt: new Date(Date.UTC(2026, i % 9, 3)),
  }));
  const activity = new Map<string, number>();
  users.forEach((u, i) => {
    if (i % 2 === 0) activity.set(u.id, new Date('2026-10-01T00:00:00.000Z').getTime());
  });
  const t0 = Date.now();
  const matrix = buildCohortMatrix(users, activity, NOW, 6);
  const msTotal = Date.now() - t0;
  assert.ok(matrix.length > 0 && matrix.every((r) => r.retentionRates.length > 0), 'matrix complete');
  assert.ok(msTotal < BI_QUERY_SLA_MS, `cohort build ${msTotal}ms < 500ms for ${N} users`);
  console.log(`    stress: ${N}-user cohort build, ${msTotal}ms total`);
  ok('9. 2000-user cohort stress + <500ms equation');
}

// ---------- 10. Module wiring (052 untouched, 116 additive) ----------
{
  const mod = readFileSync('apps/backend/src/modules/analytics/analytics.module.ts', 'utf8');
  for (const p of ['ExecutiveAnalyticsService', 'DailySnapshotWorker', 'ExecutiveAnalyticsController', 'ExecutiveAnalyticsResolver']) {
    assert.ok(mod.includes(p), `module wires ${p}`);
  }
  assert.ok(mod.includes('AnalyticsQueueProcessor') && mod.includes('onModuleInit'), '052 wiring intact');
  assert.ok(mod.includes('controllers: [AnalyticsIngestionController, ExecutiveAnalyticsController]'), 'controller additive');
  const alias = readFileSync('apps/backend/src/api/graphql/resolvers/analytics.resolver.ts', 'utf8');
  assert.ok(alias.includes('ExecutiveAnalyticsResolver') && alias.includes('AnalyticsResolver'), 'api alias covers both lanes');
  assert.ok(!alias.includes('AnalyticsResolverResolver'), 'scaffold placeholder retired');
  const sdl = readFileSync('apps/backend/src/api/graphql/analytics/analytics.graphql', 'utf8');
  for (const t of ['type ExecutiveKpiSummary', 'type CohortRetentionRow', 'type RevenueBreakdown', 'executiveSummary', 'cohortMatrix', 'revenueBreakdown', 'runNightlySnapshot']) {
    assert.ok(sdl.includes(t), `SDL ${t}`);
  }
  ok('10. Module/GQL/SDL wiring (052 intact, placeholder retired)');
}

// ---------- 11. Prisma Gate 1 (campaign/snapshot models) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const m of ['model MarketingCampaign', 'model CampaignAnalyticsLog', 'model DailyAnalyticsSnapshot']) {
    assert.ok(prisma.includes(m), m);
  }
  assert.ok(prisma.includes('@@unique([campaignId, date])'), 'daily log uniqueness');
  assert.ok(prisma.includes('@@unique([tenantId, snapshotDate])'), 'snapshot idempotency key');
  assert.ok(prisma.includes('totalAdSpend    Decimal        @db.Decimal(12, 2)'), 'spend precision');
  assert.ok(prisma.includes('churnRatePercentage  Float'), 'churn float');
  ok('11. Prisma Gate 1 (3 models + idempotency keys)');
}

// ---------- 12. Frontend Gate 3 (5 states, widgets, proxies) ----------
{
  const page = readFileSync('apps/frontend/app/(dashboard)/admin/analytics/page.tsx', 'utf8');
  for (const s of ['DASHBOARD_INIT', 'IDLE', 'LOADING', 'SUCCESS', 'ERROR']) {
    assert.ok(page.includes(s), `dashboard state ${s}`);
  }
  assert.ok(page.includes('aria-pressed') && page.includes('ลองใหม่'), 'range switch + retry');
  const widgets = readFileSync('apps/frontend/components/analytics/ExecutiveBiDashboard.tsx', 'utf8');
  assert.ok(widgets.includes('bi-gmv') && widgets.includes('bi-ltv') && widgets.includes('bi-cac') && widgets.includes('bi-ratio'), 'KPI markers');
  assert.ok(widgets.includes('cohort-row') && widgets.includes('cohort-cell') && widgets.includes('revenue-bar'), 'matrix + bars markers');
  const lib = readFileSync('apps/frontend/lib/analytics/executive-bi-client.ts', 'utf8');
  assert.ok(lib.includes('formatBiThb') && lib.includes('minimumFractionDigits: 2'), '2-decimal accuracy UI');
  assert.ok(!lib.includes('recharts') && !lib.includes('tremor') && !lib.includes('lucide'), 'no heavy viz deps');
  for (const p of [
    'apps/frontend/app/api/v1/admin/bi/summary/route.ts',
    'apps/frontend/app/api/v1/admin/bi/cohort/route.ts',
    'apps/frontend/app/api/v1/admin/bi/breakdown/route.ts',
    'apps/frontend/app/api/v1/admin/bi/snapshot-run/route.ts',
  ]) {
    assert.ok(readFileSync(p, 'utf8').includes('localhost:4000'), `proxy backend: ${p}`);
  }
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  for (const e of ['ExecutiveKpiOverviewSchema', 'CohortRetentionDataSchema', 'averageOrderValue', 'ltvToCacRatio', 'biSummaryKey', 'BI_QUERY_SLA_MS']) {
    assert.ok(barrel.includes(e), `barrel ${e}`);
  }
  ok('12. Frontend 5-state + widgets + 4 proxies + barrel');
}
}

main()
  .then(() => console.log(`\nPhase 116 contracts: ${passed}/12 groups passed`))
  .catch((err) => {
    console.error('\nPhase 116 contracts FAILED:', err);
    process.exit(1);
  });
