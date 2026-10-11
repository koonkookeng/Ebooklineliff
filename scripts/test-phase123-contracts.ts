// SSOT Phase 123 §10-11 — contract tests (Zod, cost math, lifecycle XML,
// lifecycle service, budget sweep, Flex, resolver, REST, R2 transport,
// frontend client, Prisma Gate 1, barrel).
// Run: npx tsx scripts/test-phase123-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  StorageActionTypeEnum,
  BudgetAlertThresholdEnum,
  R2LifecycleRuleSchema,
  StorageCostBudgetConfigSchema,
  StorageUsageMetricSchema,
  R2_PRICE_USD_PER_GB_MONTH,
  TEMP_UPLOAD_TTL_SEC,
  TEMP_UPLOAD_PREFIX,
  ORPHAN_SEGMENT_TTL_SEC,
  BUDGET_ALERT_SLA_MS,
  STORAGE_FLEX_MAX_BYTES,
  STORAGE_DASHBOARD_RENDER_MS,
  STORAGE_DASHBOARD_RAM_MB,
  STORAGE_METRIC_CACHE_SEC,
  BUDGET_SWEEP_INTERVAL_MS,
  estimateMonthlyCostTHB,
  budgetPercentUsed,
  budgetSeverityFor,
  buildLifecycleXml,
  lifecycleCacheKey,
  storageMetricKey,
  budgetSweepLockKey,
} from '../packages/shared/src/schemas/r2-lifecycle.schema';
import { R2LifecycleService } from '../apps/backend/src/modules/storage/services/r2-lifecycle.service';
import { StorageBudgetService, buildStorageBudgetFlex } from '../apps/backend/src/modules/storage/services/storage-budget.service';
import { LineFlexAlertService } from '../apps/backend/src/modules/notification/services/line-flex-alert.service';
import { StorageHandler } from '../apps/backend/src/modules/storage/services/storage-handler.service';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

// Decorator shells (resolver/controller) stay unimported under plain tsx
// (115 precedent); behavior is covered through the handler core.
const ADMIN = { id: 'admin-1', role: 'SUPER_ADMIN' };
const MEMBER = { id: 'u-1', role: 'MEMBER' };
const ANON = undefined;

async function main(): Promise<void> {
// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) ----------
{
  for (const v of ['EXPIRE_OBJECTS', 'ABORT_INCOMPLETE_MULTIPART_UPLOADS', 'TRANSITION_STORAGE_CLASS']) {
    assert.equal(StorageActionTypeEnum.safeParse(v).success, true, v);
  }
  assert.equal(StorageActionTypeEnum.safeParse('DELETE').success, false);
  for (const v of ['WARNING_70_PERCENT', 'CRITICAL_85_PERCENT', 'EXCEEDED_100_PERCENT']) {
    assert.equal(BudgetAlertThresholdEnum.safeParse(v).success, true, v);
  }
  assert.deepEqual(R2LifecycleRuleSchema.parse({ ruleId: 'temp-uploads-24h', prefix: 'temp-uploads/', enabled: true }), {
    ruleId: 'temp-uploads-24h', prefix: 'temp-uploads/', enabled: true, abortIncompleteMultipartDays: 1,
  });
  assert.equal(R2LifecycleRuleSchema.safeParse({ ruleId: 'ab', prefix: 'x', enabled: true }).success, false);
  assert.equal(R2LifecycleRuleSchema.safeParse({ ruleId: 'abc', prefix: '', enabled: true }).success, false);
  const cfg = StorageCostBudgetConfigSchema.parse({ tenantId: 'acme', monthlyBudgetLimitTHB: 5000, notifyLineUserIds: ['U1'] });
  assert.deepEqual([cfg.warningThresholdPercent, cfg.criticalThresholdPercent, cfg.autoPurgeTempOnExceed], [70, 85, true]);
  assert.equal(StorageCostBudgetConfigSchema.safeParse({ tenantId: 'acme', monthlyBudgetLimitTHB: 5000, notifyLineUserIds: [] }).success, false);
  assert.equal(StorageCostBudgetConfigSchema.safeParse({ tenantId: '', monthlyBudgetLimitTHB: 5000, notifyLineUserIds: ['U1'] }).success, false);
  assert.equal(StorageCostBudgetConfigSchema.safeParse({ tenantId: 'acme', monthlyBudgetLimitTHB: -1, notifyLineUserIds: ['U1'] }).success, false);
  assert.equal(
    StorageUsageMetricSchema.safeParse({
      totalSizeBytes: 1024, totalObjectsCount: 3, classAOperationsCount: 10,
      classBOperationsCount: 20, estimatedMonthlyCostTHB: 1.5, recordedAt: '2026-01-01T00:00:00.000Z',
    }).success,
    true,
  );
  assert.equal(R2_PRICE_USD_PER_GB_MONTH, 0.015);
  assert.equal(TEMP_UPLOAD_TTL_SEC, 86400);
  assert.equal(TEMP_UPLOAD_PREFIX, 'temp-uploads/');
  assert.equal(ORPHAN_SEGMENT_TTL_SEC, 172800);
  assert.equal(BUDGET_ALERT_SLA_MS, 3000);
  assert.equal(STORAGE_FLEX_MAX_BYTES, 10240);
  assert.equal(STORAGE_DASHBOARD_RENDER_MS, 800);
  assert.equal(STORAGE_DASHBOARD_RAM_MB, 25);
  assert.equal(STORAGE_METRIC_CACHE_SEC, 300);
  assert.equal(BUDGET_SWEEP_INTERVAL_MS, 21600000);
  ok('1. Zod SSOT verbatim (actions/thresholds/rule/budget/metric) + budgets');
}

// ---------- 2. Cost math + severity + XML + keys ----------
{
  assert.equal(estimateMonthlyCostTHB(1073741824, 35), 0.53);
  assert.equal(estimateMonthlyCostTHB(0, 35), 0);
  assert.equal(budgetPercentUsed(4250, 5000), 85);
  assert.equal(budgetPercentUsed(10, 0), 0);
  assert.equal(budgetSeverityFor(10), 'OK');
  assert.equal(budgetSeverityFor(70), 'WARNING_70_PERCENT');
  assert.equal(budgetSeverityFor(85), 'CRITICAL_85_PERCENT');
  assert.equal(budgetSeverityFor(100), 'EXCEEDED_100_PERCENT');
  assert.equal(budgetSeverityFor(84.9, 70, 85), 'WARNING_70_PERCENT');
  const xml = buildLifecycleXml([
    { ruleId: 'temp-uploads-24h', prefix: 'temp-uploads/', enabled: true, expireDays: 1, abortIncompleteMultipartDays: 1 },
    { ruleId: 'off-rule', prefix: 'x/', enabled: false, abortIncompleteMultipartDays: 1 },
    { ruleId: 'a&b<test>', prefix: 'p"', enabled: true, abortIncompleteMultipartDays: 7 },
  ]);
  assert.ok(xml.includes('<ID>temp-uploads-24h</ID>') && xml.includes('<Prefix>temp-uploads/</Prefix>'), 'rule body');
  assert.ok(xml.includes('<Days>1</Days>') && xml.includes('<DaysAfterInitiation>1</DaysAfterInitiation>'), 'expiry lanes');
  assert.ok(!xml.includes('off-rule'), 'disabled rules excluded');
  assert.ok(xml.includes('a&amp;b&lt;test&gt;') && xml.includes('p&quot;'), 'XML escaping');
  assert.ok(xml.startsWith('<?xml version="1.0"'), 'XML prolog');
  assert.equal(lifecycleCacheKey('bkt'), 'r2:lifecycle:bkt');
  assert.equal(storageMetricKey('acme'), 'storage:metric:acme');
  assert.equal(budgetSweepLockKey(), 'storage:budget:sweep:lock');
  ok('2. THB math + severity bands + lifecycle XML + cache keys');
}

// ---------- 3. Lifecycle service (rules gate + sync + backoff) ----------
{
  const policies = [
    { ruleId: 'temp-uploads-24h', prefix: 'temp-uploads/', enabled: true, expireDays: 1, abortIncompleteMultipartDays: 1, description: null },
  ];
  const prisma = { storageBucketPolicy: { findMany: async () => policies } };
  const puts: Array<{ bucket: string; xml: string }> = [];
  const dels: string[][] = [];
  let failures = 0;
  const r2 = { putBucketLifecycle: async (bucket: string, xml: string) => {
    if (failures > 0) {
      failures--;
      throw new Error('LIFECYCLE 503 for retry-test');
    }
    puts.push({ bucket, xml });
  } };
  const cache = { del: async (...keys: string[]) => { dels.push(keys); } };
  const svc = new R2LifecycleService(prisma as never, r2, cache);
  assert.deepEqual(await svc.enabledRules('vault'), [
    { ruleId: 'temp-uploads-24h', prefix: 'temp-uploads/', enabled: true, expireDays: 1, abortIncompleteMultipartDays: 1 },
  ]);
  assert.equal(await svc.syncBucketLifecycleRules('vault'), true);
  assert.deepEqual([puts.length, puts[0]!.bucket, dels], [1, 'vault', [['r2:lifecycle:vault']]]);
  assert.ok(puts[0]!.xml.includes('temp-uploads-24h'), 'XML shipped');
  // 503 then success (backoff lane).
  failures = 1;
  assert.equal(await svc.syncBucketLifecycleRules('vault'), true);
  assert.equal(puts.length, 2);
  // persistent 503 → rethrow after 3 attempts.
  failures = 99;
  await assert.rejects(svc.syncBucketLifecycleRules('vault'), /LIFECYCLE 503/);
  // corrupt row fails closed (Zod gate).
  const bad = new R2LifecycleService(
    { storageBucketPolicy: { findMany: async () => [{ ruleId: 'x', prefix: '', enabled: true, expireDays: 1, abortIncompleteMultipartDays: 1, description: null }] } } as never,
    r2, cache,
  );
  await assert.rejects(bad.enabledRules('vault'));
  ok('3. Rule gate + sync + 503-backoff + fail-closed rows');
}

// ---------- 4. Budget sweep (OK skip + alert + dedupe + FAILED) ----------
{
  const mkPrisma = (over: Record<string, unknown> = {}) => {
    const logs: unknown[] = [];
    return {
      logs,
      storageBudgetAlertConfig: { findMany: async () => over['configs'] as unknown[] },
      storageUsageMetric: { findFirst: async () => (over['metric'] as unknown ?? null) as never },
      storageCostAlertLog: {
        findFirst: async () => (over['prior'] as unknown ?? null) as never,
        create: async (a: unknown) => { logs.push(a); return { id: 'log-1' }; },
      },
    };
  };
  const pushes: Array<{ to: string }> = [];
  const line = { push: async (to: string) => { pushes.push({ to }); return { messageId: 'm1' }; } };
  const cfg = (limit: number) => ({
    tenantId: 'acme', monthlyBudgetLimitTHB: limit, warningThresholdPercent: 70,
    criticalThresholdPercent: 85, notifyLineUserIds: ['U1', 'U2'], autoPurgeTempOnExceed: true,
  });
  // OK band → no alert, no log.
  {
    const p = mkPrisma({ configs: [cfg(5000)], metric: { tenantId: 'acme', estimatedCostTHB: 100 } });
    const out = await new StorageBudgetService(p as never, line).evaluateAll();
    assert.deepEqual([out[0]!.severity, out[0]!.alerted, p.logs.length, pushes.length], ['OK', false, 0, 0]);
  }
  // 85% → CRITICAL + DELIVERED + 2 pushes.
  {
    const p = mkPrisma({ configs: [cfg(5000)], metric: { tenantId: 'acme', estimatedCostTHB: 4250 } });
    const out = await new StorageBudgetService(p as never, line).evaluateAll();
    assert.deepEqual([out[0]!.severity, out[0]!.alerted], ['CRITICAL_85_PERCENT', true]);
    assert.equal((p.logs[0] as { data: Record<string, unknown> }).data['deliveryStatus'], 'DELIVERED');
    assert.equal(pushes.length, 2);
  }
  // 70% → WARNING.
  {
    const p = mkPrisma({ configs: [cfg(5000)], metric: { tenantId: 'acme', estimatedCostTHB: 3500 } });
    const out = await new StorageBudgetService(p as never, line).evaluateAll();
    assert.equal(out[0]!.severity, 'WARNING_70_PERCENT');
  }
  // dedupe: prior covers current band → skip.
  {
    const p = mkPrisma({
      configs: [cfg(5000)],
      metric: { tenantId: 'acme', estimatedCostTHB: 4250 },
      prior: { tenantId: 'acme', severity: 'CRITICAL', percentUsed: 90, triggeredAt: new Date() },
    });
    const out = await new StorageBudgetService(p as never, line).evaluateAll();
    assert.deepEqual([out[0]!.alerted, p.logs.length], [false, 0]);
  }
  // LINE down → FAILED log persists (Gate 7 per-row atomicity).
  {
    const p = mkPrisma({ configs: [cfg(5000)], metric: { tenantId: 'acme', estimatedCostTHB: 5000 } });
    const down = { push: async () => { throw new Error('LINE_PUSH_HTTP_500'); } };
    const out = await new StorageBudgetService(p as never, down).evaluateAll();
    assert.equal(out[0]!.severity, 'EXCEEDED_100_PERCENT');
    assert.equal((p.logs[0] as { data: Record<string, unknown> }).data['deliveryStatus'], 'FAILED');
  }
  // missing metric → zero-cost OK.
  {
    const p = mkPrisma({ configs: [cfg(5000)], metric: null });
    const out = await new StorageBudgetService(p as never, line).evaluateAll();
    assert.deepEqual([out[0]!.severity, out[0]!.percentUsed], ['OK', 0]);
  }
  ok('4. Sweep bands + DELIVERED/FAILED ledger + dedupe + null-metric');
}

// ---------- 5. Flex builder + alert facade ----------
{
  const flex = buildStorageBudgetFlex({ severity: 'CRITICAL', currentCost: 4250, budgetLimit: 5000, percentUsed: 85 });
  assert.equal(Buffer.byteLength(JSON.stringify(flex), 'utf8') <= STORAGE_FLEX_MAX_BYTES, true);
  assert.ok(JSON.stringify(flex).includes('#FF2D55'), 'critical header tone');
  const warn = buildStorageBudgetFlex({ severity: 'WARNING', currentCost: 3500, budgetLimit: 5000, percentUsed: 70 });
  assert.ok(JSON.stringify(warn).includes('#FF9500'), 'warning header tone');
  const calls: string[] = [];
  const facade = new LineFlexAlertService({ push: async (to: string) => {
    calls.push(to);
    if (to === 'BAD') throw new Error('nope');
    return { messageId: 'm' };
  } });
  assert.deepEqual(
    await facade.sendStorageBudgetAlert({ severity: 'WARNING', currentCost: 1, budgetLimit: 10, percentUsed: 70, notifyLineUserIds: ['U1', 'BAD'] }),
    [{ lineUserId: 'U1', ok: true }, { lineUserId: 'BAD', ok: false }],
  );
  assert.deepEqual(calls, ['U1', 'BAD']);
  ok('5. Flex <10KB tones + per-recipient facade');
}

// ---------- 6. Handler intents (queries + mutations + guards) ----------
{
  const r2 = { putBucketLifecycle: async () => undefined };
  const cache = { del: async () => undefined };
  const prismaRows = {
    metric: { tenantId: 'acme', bucketName: 'vault', totalSizeBytes: BigInt(2147483648), totalObjectsCount: 9, classAOperations: 4, classBOperations: 6, estimatedCostTHB: '12.50', recordedAt: new Date('2026-01-02T00:00:00.000Z') },
    config: { tenantId: 'acme', monthlyBudgetLimitTHB: '5000', warningThresholdPercent: 70, criticalThresholdPercent: 85, notifyLineUserIds: ['U1'], autoPurgeTempOnExceed: true },
    policies: [{ ruleId: 'temp-uploads-24h', prefix: 'temp-uploads/', enabled: true, expireDays: 1, abortIncompleteMultipartDays: 1, description: null }],
  };
  const upserts: unknown[] = [];
  const db = {
    storageUsageMetric: { findFirst: async () => prismaRows.metric },
    storageBudgetAlertConfig: {
      findUnique: async () => prismaRows.config,
      upsert: async (a: unknown) => { upserts.push(a); return { ...(a as { create: Record<string, unknown> }).create }; },
    },
    storageBucketPolicy: {
      findMany: async () => prismaRows.policies,
      upsert: async (a: unknown) => { upserts.push(a); return {}; },
    },
  };
  const mk = () => new StorageHandler(
    new R2LifecycleService({ storageBucketPolicy: { findMany: async () => prismaRows.policies } } as never, r2, cache),
    new StorageBudgetService({ storageBudgetAlertConfig: { findMany: async () => [] }, storageUsageMetric: { findFirst: async () => null }, storageCostAlertLog: { findFirst: async () => null, create: async () => ({}) } } as never, { push: async () => ({ messageId: 'm' }) }),
    db as never,
  );
  const m = await mk().getStorageUsageMetrics('acme', ADMIN);
  assert.deepEqual([m.totalSizeBytes, m.totalObjectsCount, m.classAOperationsCount, m.classBOperationsCount, m.estimatedMonthlyCostTHB], [2147483648, 9, 4, 6, 12.5]);
  assert.equal(m.recordedAt, '2026-01-02T00:00:00.000Z');
  assert.deepEqual((await mk().getR2LifecycleRules('vault', ADMIN)).map((r) => r.ruleId), ['temp-uploads-24h']);
  assert.equal((await mk().getStorageBudgetConfig('acme', ADMIN)).monthlyBudgetLimitTHB, 5000);
  await assert.rejects(mk().getStorageUsageMetrics('acme', ANON), /Missing authentication/);
  await assert.rejects(mk().getStorageUsageMetrics('', ADMIN), /tenantId required/);
  // mutations: admin-only, Zod-gated, threshold-ordered.
  assert.equal(await mk().updateR2LifecycleRules('vault', [{ ruleId: 'temp-purge-x', prefix: 'temp-uploads/', enabled: true, expireDays: 1, abortIncompleteMultipartDays: 1, description: null }], ADMIN), true);
  await assert.rejects(mk().updateR2LifecycleRules('vault', [], MEMBER), /admin role/i);
  await assert.rejects(
    mk().updateR2LifecycleRules('vault', [{ ruleId: 'ab', prefix: 'x', enabled: true, expireDays: 1, abortIncompleteMultipartDays: 1, description: null }], ADMIN),
  );
  const updated = await mk().updateStorageBudgetConfig({ tenantId: 'acme', monthlyBudgetLimitTHB: 8000, warningThresholdPercent: null, criticalThresholdPercent: null, notifyLineUserIds: ['U9'], autoPurgeTempOnExceed: null }, ADMIN);
  assert.deepEqual([updated.monthlyBudgetLimitTHB, updated.notifyLineUserIds], [8000, ['U9']]);
  await assert.rejects(
    mk().updateStorageBudgetConfig({ tenantId: 'acme', monthlyBudgetLimitTHB: 8000, warningThresholdPercent: 90, criticalThresholdPercent: 80, notifyLineUserIds: ['U9'], autoPurgeTempOnExceed: null }, ADMIN),
    /must exceed/,
  );
  const cleaned = await mk().triggerManualR2StorageCleanup('vault', 'temp-uploads/', ADMIN);
  assert.equal(cleaned >= 1, true);
  await assert.rejects(mk().triggerManualR2StorageCleanup('vault', '', ADMIN), /required/);
  ok('6. Intent handler reads/mutations + Zod gates + admin guards');
}

// ---------- 7. Shell delegation (resolver + REST are thin) ----------
{
  const resolver = readFileSync('apps/backend/src/modules/storage/resolvers/storage.resolver.ts', 'utf8');
  for (const intent of ['getStorageUsageMetrics', 'getR2LifecycleRules', 'getStorageBudgetConfig', 'updateR2LifecycleRules', 'updateStorageBudgetConfig', 'triggerManualR2StorageCleanup']) {
    assert.ok(resolver.includes(`this.handler.${intent}`), `resolver delegates ${intent}`);
  }
  assert.ok(resolver.includes('@Query(') && resolver.includes('@Mutation('), 'code-first intents');
  const controller = readFileSync('apps/backend/src/modules/storage/controllers/storage-admin.controller.ts', 'utf8');
  for (const lane of ['metrics', 'rules', 'budgetConfig', 'updateRules', 'updateBudget', 'sweep', 'sync']) {
    assert.ok(controller.includes(lane), `REST lane ${lane}`);
  }
  assert.ok(controller.includes('JwtAuthGuard') && controller.includes('TenantGuard'), 'guard lanes');
  assert.ok(controller.includes('this.handler.') && controller.includes('this.budget.evaluateAll'), 'controller delegates');
  ok('7. Decorator shells delegate (static gates)');
}

// ---------- 8. R2 transport lifecycle seam (SigV4 subresource) ----------
{
  const { R2StorageService } = await import('../apps/backend/src/infra/cloudflare/r2-storage.service');
  const realFetch = globalThis.fetch;
  const seen: Array<{ url: string; init: Record<string, unknown> }> = [];
  (globalThis as Record<string, unknown>)['fetch'] = (async (url: unknown, init: Record<string, unknown>) => {
    seen.push({ url: String(url), init });
    return { ok: true, status: 200 } as Response;
  }) as typeof fetch;
  const svc = new R2StorageService();
  const prev = { R2_ACCOUNT_ID: process.env['R2_ACCOUNT_ID'], R2_ACCESS_KEY_ID: process.env['R2_ACCESS_KEY_ID'], R2_SECRET_ACCESS_KEY: process.env['R2_SECRET_ACCESS_KEY'] };
  process.env['R2_ACCOUNT_ID'] = 'acct123';
  process.env['R2_ACCESS_KEY_ID'] = 'AKID';
  process.env['R2_SECRET_ACCESS_KEY'] = 'SECRET';
  try {
    await svc.putBucketLifecycle('vault', '<LifecycleConfiguration/>');
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    (globalThis as Record<string, unknown>)['fetch'] = realFetch;
  }
  assert.equal(seen.length, 1);
  assert.ok(seen[0]!.url.endsWith('/vault/?lifecycle'), `subresource URL (${seen[0]!.url})`);
  const headers = seen[0]!.init['headers'] as Record<string, string>;
  assert.ok(String(headers['Authorization'] ?? '').startsWith('AWS4-HMAC-SHA256 Credential=AKID/'), 'SigV4 auth');
  assert.equal(headers['Content-Type'], 'application/xml');
  assert.equal((seen[0]!.init['body'] as string), '<LifecycleConfiguration/>');
  // error lane throws (never silent).
  (globalThis as Record<string, unknown>)['fetch'] = (async () => ({ ok: false, status: 500 })) as typeof fetch;
  process.env['R2_ACCOUNT_ID'] = 'acct123';
  process.env['R2_ACCESS_KEY_ID'] = 'AKID';
  process.env['R2_SECRET_ACCESS_KEY'] = 'SECRET';
  try {
    await assert.rejects(svc.putBucketLifecycle('vault', '<x/>'), /LIFECYCLE 500/);
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    (globalThis as Record<string, unknown>)['fetch'] = realFetch;
  }
  // unconfigured credentials fail explicit (Gate 4).
  await assert.rejects(svc.putBucketLifecycle('vault', '<x/>'), /not configured/);
  ok('8. Lifecycle PUT signing + error lanes');
}

// ---------- 9. Frontend client (paths + math) ----------
{
  const { storageApi, bytesToGB } = await import('../apps/frontend/lib/storage/storage-client');
  assert.equal(bytesToGB(2147483648), 2);
  const realFetch = globalThis.fetch;
  const seen: Array<{ url: string; method: string; body?: string }> = [];
  (globalThis as Record<string, unknown>)['fetch'] = (async (url: unknown, init: { method?: string; body?: string }) => {
    seen.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body });
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    };
  }) as typeof fetch;
  try {
    const api = storageApi('acme', 'vault');
    await api.metrics();
    await api.rules();
    await api.budget();
    await api.updateRules([]);
    await api.sweep();
    await api.sync();
  } finally {
    (globalThis as Record<string, unknown>)['fetch'] = realFetch;
  }
  assert.deepEqual(
    seen.map((s) => `${s.method ?? 'GET'} ${s.url.split('?')[0]}`),
    [
      'GET /api/v1/admin/storage/metrics',
      'GET /api/v1/admin/storage/rules',
      'GET /api/v1/admin/storage/budget',
      'POST /api/v1/admin/storage/rules',
      'POST /api/v1/admin/storage/sweep',
      'POST /api/v1/admin/storage/sync',
    ],
  );
  assert.ok(String(seen[0]!.url).includes('tenant=acme') && String(seen[1]!.url).includes('bucket=vault'), 'query lanes');
  ok('9. Console client routes + GB math');
}

// ---------- 10. Dashboard + proxies (static source gates) ----------
{
  const dash = readFileSync('apps/frontend/components/storage/StorageDashboard.tsx', 'utf8');
  for (const s of ['INIT', 'IDLE', 'LOADING', 'SUCCESS', 'ERROR']) {
    assert.ok(dash.includes(s), `state ${s}`);
  }
  for (const dep of ["from 'recharts'", 'from "recharts"', "from 'lucide-react'", 'from "lucide-react"', "from '@/components/ui/"]) {
    assert.ok(!dash.includes(dep), `dep-free UI (no ${dep})`);
  }
  assert.ok(dash.includes('aria-busy') && dash.includes('progressbar'), 'a11y lanes');
  const page = readFileSync('apps/frontend/app/(admin)/dashboard/storage-management/page.tsx', 'utf8');
  assert.ok(page.includes('Suspense') && page.includes('useSearchParams'), 'search-param suspense shell');
  for (const f of [
    'apps/frontend/app/api/v1/admin/storage/metrics/route.ts',
    'apps/frontend/app/api/v1/admin/storage/rules/route.ts',
    'apps/frontend/app/api/v1/admin/storage/budget/route.ts',
    'apps/frontend/app/api/v1/admin/storage/sweep/route.ts',
    'apps/frontend/app/api/v1/admin/storage/sync/route.ts',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(src.includes('BACKEND_URL') && src.includes('x-tenant-id'), `${f} forwards tenant+auth`);
  }
  ok('10. 5-state shell + dep-free gates + proxy forwarding');
}

// ---------- 11. Prisma Gate 1 (storage models) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const m of ['enum StorageAlertStatus', 'enum AlertSeverity', 'model StorageBucketPolicy', 'model StorageUsageMetric', 'model StorageBudgetAlertConfig', 'model StorageCostAlertLog']) {
    assert.ok(prisma.includes(m), m);
  }
  for (const v of ['PENDING', 'DELIVERED', 'FAILED', 'RESOLVED', 'INFO', 'WARNING', 'CRITICAL']) {
    assert.ok(prisma.includes(v), `enum value ${v}`);
  }
  assert.ok(prisma.includes('ruleId                       String   @unique'), 'policy dedupe key');
  assert.ok(prisma.includes('tenantId                 String   @unique'), 'budget singleton key');
  assert.ok(prisma.includes('@@index([tenantId, recordedAt])'), 'metric window index');
  assert.ok(prisma.includes('@@index([tenantId, triggeredAt])'), 'alert window index');
  // 121/122 lanes intact (union-not-replace).
  assert.ok(prisma.includes('model SystemAuditLog') && prisma.includes('model IdempotencyLog'), '121/122 lanes intact');
  ok('11. Prisma Gate 1 (2 enums + 4 models + keys)');
}

// ---------- 12. Tree parity + barrel + scope discipline ----------
{
  for (const f of [
    'apps/backend/src/modules/storage/services/r2-lifecycle.service.ts',
    'apps/backend/src/modules/storage/services/storage-budget.service.ts',
    'apps/backend/src/modules/storage/services/storage-handler.service.ts',
    'apps/backend/src/modules/notification/services/line-flex-alert.service.ts',
    'apps/backend/src/modules/storage/storage.module.ts',
    'apps/frontend/lib/storage/storage-client.ts',
    'apps/frontend/components/storage/StorageDashboard.tsx',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes('TODO') && !src.includes('placeholder'), `${f} unimplemented`);
  }
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  for (const e of ['R2LifecycleRuleSchema', 'StorageCostBudgetConfigSchema', 'StorageUsageMetricSchema', 'buildLifecycleXml', 'budgetSeverityFor', 'TEMP_UPLOAD_TTL_SEC']) {
    assert.ok(barrel.includes(e), `barrel ${e}`);
  }
  // Cores untouched: payment engine, HLS pipeline, R2 transport (additive only).
  const slipCore = readFileSync('apps/backend/src/modules/payment/services/slip-verification.service.ts', 'utf8');
  assert.ok(!slipCore.includes('storage/'), 'payment core untouched');
  const r2 = readFileSync('apps/backend/src/infra/cloudflare/r2-storage.service.ts', 'utf8');
  assert.ok(r2.includes('putObjectBuffer') && r2.includes('presignedGetUrl'), '036 transport intact');
  assert.ok(!r2.includes("from '@aws-sdk") && !r2.includes('require("@aws-sdk'), 'no aws-sdk (zero-dep seam)');
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('StorageModule'), 'module wired');
  // No new runtime deps anywhere in scope (import-form gates; prose
  // mentions in RISK_CALL comments are intentional documentation).
  for (const f of [
    'apps/backend/src/modules/storage/services/r2-lifecycle.service.ts',
    'apps/backend/src/modules/storage/services/storage-budget.service.ts',
    'apps/backend/src/modules/storage/services/storage-handler.service.ts',
    'apps/frontend/components/storage/StorageDashboard.tsx',
  ]) {
    const src = readFileSync(f, 'utf8');
    for (const dep of ["from '@aws-sdk", 'from "recharts"', "from 'recharts'", 'from "lucide-react"', "from 'lucide-react'", "require('node-fetch", 'from \'node-fetch']) {
      assert.ok(!src.includes(dep), `${f} zero-dep (no ${dep})`);
    }
  }
  ok('12. 123 tree parity + barrel + core-untouched discipline');
}
}

main()
  .then(() => console.log(`\nPhase 123 contracts: ${passed}/12 groups passed`))
  .catch((err) => {
    console.error('\nPhase 123 contracts FAILED:', err);
    process.exit(1);
  });
