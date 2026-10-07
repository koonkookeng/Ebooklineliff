// SSOT Phase 029 §10 — contract tests (Zod, domain, adapter, repo, services, wiring, UI)
// Run: npx tsx scripts/test-phase029-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PerformanceMetricTypeEnum,
  BundleGuardMetricSchema,
  PrefetchResourceTypeEnum,
  PrefetchRequestSchema,
  PrefetchPayloadSchema,
  TelemetryIngestSchema,
  BUNDLE_MAX_BYTES,
  BUNDLE_CHUNK_MAX_BYTES,
  PREFETCH_TTL_SEC,
  PREFETCH_DWELL_MS,
  PERF_TELEMETRY_CHANNEL,
  prefetchCacheKey,
  rumToMetricType,
  velocityPrefetchCount,
} from '../packages/shared/src/schemas/performance.schema';
import { BundleSize } from '../apps/backend/src/modules/performance/domain/value-objects/bundle-size.vo';
import { PerformanceMetric } from '../apps/backend/src/modules/performance/domain/entities/performance-metric.entity';
import { RedisPrefetchCacheAdapter } from '../apps/backend/src/modules/performance/infrastructure/adapters/redis-prefetch-cache.adapter';
import { PrismaPerformanceRepository } from '../apps/backend/src/modules/performance/infrastructure/persistence/prisma-performance.repository';
import { BundleGuardService } from '../apps/backend/src/modules/performance/application/services/bundle-guard.service';
import { PredictivePrefetchService } from '../apps/backend/src/modules/performance/application/services/predictive-prefetch.service';
import { GetBundleMetricsQuery } from '../apps/backend/src/modules/performance/application/queries/get-bundle-metrics.query';
import type { PrismaService } from '../apps/backend/src/infra/database/prisma.service';
import type { RedisClusterService } from '../apps/backend/src/infra/redis/redis-cluster.service';
import { dwellReady, nextResourceIds, chunkUrl } from '../apps/frontend/lib/prefetch/prefetch-client';
import { verifyBundleGuard } from './check-bundle-size';
// NOTE: PrefetchResolver/PerformanceTelemetryController use Nest parameter
// decorators (@Args/@Body) which tsx/esbuild cannot transform — verified via
// static source parity (§8) following the Phase 027/028 precedent.

let passed = 0;
function ok(name: string) {
  passed++;
  console.log(`  ✓ ${name}`);
}

// ---------- 1. Zod vocabulary + boundaries (§3.1 Gate 1) ----------
{
  for (const t of ['INITIAL_BUNDLE_SIZE', 'LARGEST_CONTENTFUL_PAINT', 'FIRST_INPUT_DELAY', 'CUMULATIVE_LAYOUT_SHIFT', 'PREFETCH_CACHE_HIT', 'PREFETCH_CACHE_MISS']) {
    assert.equal(PerformanceMetricTypeEnum.safeParse(t).success, true);
  }
  assert.equal(PerformanceMetricTypeEnum.safeParse('LCP').success, false);
  for (const t of ['EBOOK_PAGE', 'COURSE_LESSON', 'PRODUCT_PDP']) assert.equal(PrefetchResourceTypeEnum.safeParse(t).success, true);

  const metric = { tenantId: 'default', bundleSizeBytes: 1500000, gzipSizeBytes: 400000, chunkCount: 12, buildHash: 'babc1234', timestamp: new Date().toISOString() };
  assert.equal(BundleGuardMetricSchema.safeParse(metric).success, true);
  assert.equal(BundleGuardMetricSchema.safeParse({ ...metric, bundleSizeBytes: 2097153 }).success, false);
  assert.equal(BundleGuardMetricSchema.safeParse({ ...metric, tenantId: '' }).success, false);
  assert.equal(BundleGuardMetricSchema.safeParse({ ...metric, buildHash: 'short' }).success, false);

  const req = { userId: 'u-1', productId: 'p-1', currentResourceType: 'EBOOK_PAGE', currentResourceId: '10', predictedNextResourceIds: ['11', '12'] };
  assert.equal(PrefetchRequestSchema.safeParse(req).success, true);
  assert.equal(PrefetchRequestSchema.safeParse({ ...req, predictedNextResourceIds: [] }).success, false);
  assert.equal(PrefetchRequestSchema.safeParse({ ...req, predictedNextResourceIds: ['1', '2', '3', '4', '5', '6'] }).success, false);
  assert.equal(PrefetchRequestSchema.safeParse({ ...req, currentResourceType: 'VIDEO' }).success, false);
  assert.equal(PrefetchPayloadSchema.safeParse({ success: true, prefetchedCount: 2, cacheStorageKeys: ['a'], ttlSeconds: 900 }).success, true);

  assert.equal(TelemetryIngestSchema.safeParse({ metricType: 'LARGEST_CONTENTFUL_PAINT', value: 900, route: '/reader/1' }).success, true);
  assert.equal(TelemetryIngestSchema.safeParse({ metricType: 'LARGEST_CONTENTFUL_PAINT', value: -1, route: '/reader/1' }).success, false);
  assert.equal(TelemetryIngestSchema.safeParse({ metricType: 'LARGEST_CONTENTFUL_PAINT', value: 1, route: 'no-slash' }).success, false);
  assert.equal(TelemetryIngestSchema.safeParse({ metricType: 'NOPE', value: 1, route: '/' }).success, false);

  assert.equal(BUNDLE_MAX_BYTES, 2097152);
  assert.equal(BUNDLE_CHUNK_MAX_BYTES, 512000);
  assert.equal(PREFETCH_TTL_SEC, 900);
  assert.equal(PREFETCH_DWELL_MS, 1500);
  assert.equal(PERF_TELEMETRY_CHANNEL, 'performance.telemetry');
  assert.equal(prefetchCacheKey('p', 'EBOOK_PAGE', '11'), 'prefetch:p:EBOOK_PAGE:11');
  assert.equal(velocityPrefetchCount(5), 3);
  assert.equal(velocityPrefetchCount(20), 2);
  assert.equal(velocityPrefetchCount(60), 1);
  assert.equal(rumToMetricType('LARGEST_CONTENTFUL_PAINT'), 'LCP_MS');
  assert.equal(rumToMetricType('FIRST_INPUT_DELAY'), 'FID_MS');
  assert.equal(rumToMetricType('CUMULATIVE_LAYOUT_SHIFT'), 'CLS_SCORE');
  assert.equal(rumToMetricType('PREFETCH_CACHE_HIT'), 'PREFETCH_CACHE_HIT');
  ok('Zod metrics/bundle/prefetch/telemetry + velocity/key/map helpers + constants');
}

// ---------- 2. Domain VO + entity invariants ----------
{
  const size = BundleSize.of(1500000, 400000, 8);
  assert.equal(size.isWithinGuard, true);
  assert.equal(size.headroomBytes, 2097152 - 1500000);
  assert.equal(BundleSize.of(2097153, 500000, 8).isWithinGuard, false);
  assert.throws(() => BundleSize.of(0, 1, 1), /Invalid total/);
  assert.throws(() => BundleSize.of(1, -1, 1), /Invalid gzip/);
  assert.throws(() => BundleSize.of(1, 1, 0), /Invalid chunk/);

  const m = PerformanceMetric.create({ tenantId: 't', metricType: 'LARGEST_CONTENTFUL_PAINT', metricValue: 1.2, route: '/a' });
  assert.equal(m.props.route, '/a');
  assert.throws(() => PerformanceMetric.create({ tenantId: '', metricType: 'LARGEST_CONTENTFUL_PAINT', metricValue: 1, route: '/a' }), /tenant/);
  assert.throws(() => PerformanceMetric.create({ tenantId: 't', metricType: 'NOPE' as never, metricValue: 1, route: '/a' }), /Unknown metric/);
  assert.throws(() => PerformanceMetric.create({ tenantId: 't', metricType: 'LARGEST_CONTENTFUL_PAINT', metricValue: NaN, route: '/a' }), /Invalid metric value/);
  assert.throws(() => PerformanceMetric.create({ tenantId: 't', metricType: 'LARGEST_CONTENTFUL_PAINT', metricValue: 1, route: 'a' }), /rooted/);
  ok('BundleSize guard/headroom + Metric entity double-guards');
}

function stubCluster(store: Map<string, string> = new Map(), published: Array<{ c: string; m: string }> = []): RedisClusterService {
  return {
    get: async (k: string) => store.get(k) ?? null,
    setex: async (k: string, _t: number, v: string) => { store.set(k, v); },
    del: async (k: string) => { store.delete(k); },
    publish: async (c: string, m: string) => { published.push({ c, m }); },
  } as unknown as RedisClusterService;
}

async function main(): Promise<void> {
// ---------- 3. Edge adapter: exists/get/setex/del/publish + fail-open ----------
{
  const store = new Map([['prefetch:p:EBOOK_PAGE:11', '{"kind":"EBOOK_PAGE"}']]);
  const published: Array<{ c: string; m: string }> = [];
  const adapter = new RedisPrefetchCacheAdapter(stubCluster(store, published));
  assert.equal(await adapter.exists('prefetch:p:EBOOK_PAGE:11'), true);
  assert.equal(await adapter.exists('prefetch:p:EBOOK_PAGE:99'), false);
  assert.equal(await adapter.get('prefetch:p:EBOOK_PAGE:11'), '{"kind":"EBOOK_PAGE"}');
  await adapter.setex('k', 900, 'v');
  assert.equal(await adapter.get('k'), 'v');
  await adapter.del('k');
  assert.equal(await adapter.exists('k'), false);
  await adapter.publish('performance.telemetry', '{}');
  assert.equal(published[0].c, 'performance.telemetry');

  const dead = new RedisPrefetchCacheAdapter({
    get: async () => { throw new Error('down'); },
    setex: async () => { throw new Error('down'); },
    del: async () => { throw new Error('down'); },
    publish: async () => { throw new Error('down'); },
  } as unknown as RedisClusterService);
  assert.equal(await dead.exists('k'), false);
  assert.equal(await dead.get('k'), null);
  await dead.setex('k', 1, 'v');
  await dead.del('k');
  await dead.publish('c', 'm');
  ok('Adapter edge ops + total-outage fail-open (hot path never throws)');
}

// ---------- 4. Repository: vocab mapping + upsert shape + null-safe read ----------
{
  const created: unknown[] = [];
  const upserted: unknown[] = [];
  const prisma = {
    performanceMetric: { create: async (a: unknown) => { created.push(a); return {}; } },
    bundleManifest: {
      upsert: async (a: unknown) => { upserted.push(a); return {}; },
      findFirst: async () => ({ buildHash: 'h1', totalSizeBytes: 100, gzipSizeBytes: 50, isPassedGuard: true, chunksJson: [] }),
    },
    prefetchAnalytics: { create: async (a: unknown) => { created.push(a); return {}; } },
  } as unknown as PrismaService;
  const repo = new PrismaPerformanceRepository(prisma);
  await repo.saveMetric({ tenantId: 't', metricType: 'LARGEST_CONTENTFUL_PAINT', metricValue: 1.5, route: '/r', deviceMemory: 4, effectiveType: '4g', userAgent: 'UA' });
  const metricRow = (created[0] as { data: Record<string, unknown> }).data;
  assert.equal(metricRow.metricType, 'LCP_MS');
  assert.equal(metricRow.deviceMemory, 4);
  await repo.saveMetric({ tenantId: 't', metricType: 'PREFETCH_CACHE_HIT', metricValue: 1, route: '/r' });
  assert.equal((created[1] as { data: Record<string, unknown> }).data.metricType, 'PREFETCH_CACHE_HIT');
  assert.ok(!('deviceMemory' in ((created[1] as { data: Record<string, unknown> }).data)));

  await repo.saveManifest({ buildHash: 'h', totalSizeBytes: 10, gzipSizeBytes: 5, isPassedGuard: true, chunksJson: [] });
  assert.deepEqual((upserted[0] as { where: unknown }).where, { buildHash: 'h' });
  const latest = await repo.latestManifest();
  assert.equal(latest?.buildHash, 'h1');
  const empty = new PrismaPerformanceRepository({ bundleManifest: { findFirst: async () => null } } as unknown as PrismaService);
  assert.equal(await empty.latestManifest(), null);
  await repo.logPrefetch({ userId: 'u', productId: 'p', resourceKey: 'EBOOK_PAGE:11', isHit: true, latencySavedMs: 180 });
  assert.equal((created[2] as { data: Record<string, unknown> }).data.resourceKey, 'EBOOK_PAGE:11');
  ok('Repo maps RUM vocab, upserts manifest by buildHash, null-safe read, logs prefetch');
}

// ---------- 5. BundleGuardService: verdict + 400s + persisted manifest ----------
{
  const upserted: unknown[] = [];
  const prisma = {
    bundleManifest: { upsert: async (a: unknown) => { upserted.push(a); return {}; }, findFirst: async () => null },
  } as unknown as PrismaService;
  const svc = new BundleGuardService(new PrismaPerformanceRepository(prisma));
  const good = await svc.evaluateManifest([{ name: 'a.js', sizeBytes: 1000 }, { name: 'b.css', sizeBytes: 500 }], 800);
  assert.equal(good.passed, true);
  assert.equal(good.totalSizeBytes, 1500);
  assert.ok(good.buildHash.length >= 8);
  assert.equal(good.headroomBytes, BUNDLE_MAX_BYTES - 1500);
  assert.equal((upserted[0] as { create: { isPassedGuard: boolean } }).create.isPassedGuard, true);

  const over = await svc.evaluateManifest([{ name: 'big.js', sizeBytes: BUNDLE_MAX_BYTES + 1 }], 10);
  assert.equal(over.passed, false);
  assert.ok(over.headroomBytes < 0);
  await assert.rejects(() => svc.evaluateManifest([], 10), /chunks missing/);
  await assert.rejects(() => svc.evaluateManifest([{ name: 'a', sizeBytes: -5 }], 10), /Invalid chunk/);
  await assert.rejects(() => svc.evaluateManifest([{ name: 'a', sizeBytes: 5 }], 0), /Invalid gzip/);
  assert.equal(await svc.latest(), null);
  const q = new GetBundleMetricsQuery(svc);
  assert.equal(await q.execute(), null);
  ok('Guard verdict + headroom + 400s + manifest persisted; query delegates');
}

// ---------- 6. PrefetchService: hit/miss/pointer/400s + analytics + event ----------
{
  const store = new Map([['prefetch:p1:EBOOK_PAGE:11', '{"kind":"EBOOK_PAGE"}']]);
  const published: Array<{ c: string; m: string }> = [];
  const created: unknown[] = [];
  let setexCount = 0;
  const adapter = new RedisPrefetchCacheAdapter({
    get: async (k: string) => store.get(k) ?? null,
    setex: async (k: string, _t: number, v: string) => { setexCount++; store.set(k, v); },
    del: async () => undefined,
    publish: async (c: string, m: string) => { published.push({ c, m }); },
  } as unknown as RedisClusterService);
  const prisma = {
    ebookDetail: { findFirst: async () => ({ storagePathR2: 'books/p1', totalPages: 300 }) },
    prefetchAnalytics: { create: async (a: unknown) => { created.push(a); return {}; } },
  } as unknown as PrismaService;
  const svc = new PredictivePrefetchService(prisma, adapter, new PrismaPerformanceRepository(prisma));

  const out = await svc.processPredictivePrefetch({ userId: 'u', productId: 'p1', currentResourceType: 'EBOOK_PAGE', currentResourceId: '10', predictedNextResourceIds: ['11', '12'] });
  assert.equal(out.success, true);
  assert.equal(out.prefetchedCount, 2);
  assert.deepEqual(out.cacheStorageKeys, ['prefetch:p1:EBOOK_PAGE:11', 'prefetch:p1:EBOOK_PAGE:12']);
  assert.equal(setexCount, 1);
  const warmed = JSON.parse(store.get('prefetch:p1:EBOOK_PAGE:12') as string) as { kind: string; pageNumber: number; totalPages: number };
  assert.equal(warmed.kind, 'EBOOK_PAGE');
  assert.equal(warmed.pageNumber, 12);
  assert.equal(warmed.totalPages, 300);
  assert.equal((created[0] as { data: { isHit: boolean; latencySavedMs: number } }).data.isHit, true);
  assert.equal((published[0] as { m: string }).m.includes('prefetch.triggered'), true);

  // Out-of-range page skipped (no write, still success).
  const skip = await svc.processPredictivePrefetch({ userId: 'u', productId: 'p1', currentResourceType: 'EBOOK_PAGE', currentResourceId: '300', predictedNextResourceIds: ['999'] });
  assert.equal(skip.prefetchedCount, 0);
  // Generic resource caches a pointer stub.
  const generic = await svc.processPredictivePrefetch({ userId: 'u', productId: 'p2', currentResourceType: 'COURSE_LESSON', currentResourceId: 'l1', predictedNextResourceIds: ['l2'] });
  assert.equal(generic.prefetchedCount, 1);
  await assert.rejects(() => svc.processPredictivePrefetch({ userId: 'u', productId: 'p', currentResourceType: 'EBOOK_PAGE', currentResourceId: '1', predictedNextResourceIds: [] }), /Invalid prefetch/);
  await assert.rejects(() => svc.processPredictivePrefetch({ userId: 'u', productId: 'p', currentResourceType: 'VIDEO', currentResourceId: '1', predictedNextResourceIds: ['2'] }), /Invalid prefetch/);
  ok('Prefetch hit skips write, miss warms R2 pointer (TTL), skips OOB, 400s, analytics+event');
}

// ---------- 7. Client pure helpers: dwell, velocity ids, chunk URLs ----------
{
  assert.equal(dwellReady(0, 1499), false);
  assert.equal(dwellReady(0, 1500), true);
  assert.deepEqual(nextResourceIds(10, 5), [11, 12, 13]);
  assert.deepEqual(nextResourceIds(10, 20), [11, 12]);
  assert.deepEqual(nextResourceIds(10, 60), [11]);
  assert.deepEqual(nextResourceIds(299, 5, 300), [300]);
  assert.deepEqual(nextResourceIds(300, 5, 300), []);
  assert.equal(chunkUrl('https://cdn.omnichannel.com/', '/books/p1/', 11), 'https://cdn.omnichannel.com/books/p1/page-11.svg');
  ok('Dwell 1500ms gate + velocity depths + total cap + CDN URL builder');
}

// ---------- 8. Bundle-guard script: pass/fail/skip via fixture manifests ----------
{
  const dir = mkdtempSync(join(tmpdir(), 'bundle-guard-'));
  mkdirSync(join(dir, 'static'), { recursive: true });
  writeFileSync(join(dir, 'static', 'a.js'), 'x'.repeat(1000));
  writeFileSync(join(dir, 'build-manifest.json'), JSON.stringify({ pages: { '/': ['static/a.js'] } }));
  const pass = verifyBundleGuard(dir)!;
  assert.equal(pass.passed, true);
  assert.equal(pass.totalBytes, 1000);
  assert.equal(pass.checkedFiles, 1);
  writeFileSync(join(dir, 'static', 'big.js'), 'x'.repeat(BUNDLE_MAX_BYTES + 1));
  writeFileSync(join(dir, 'build-manifest.json'), JSON.stringify({ pages: { '/': ['static/big.js'] } }));
  const fail = verifyBundleGuard(dir)!;
  assert.equal(fail.passed, false);
  assert.equal(verifyBundleGuard(join(dir, 'missing')), null);
  ok('Guard script enforces 2MB on manifests, fails over budget, skips when unbuilt');
}

// ---------- 9. Wiring + SDL + next/SW/hook/UI parity (Gates 1-6) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of ['enum MetricType', 'model PerformanceMetric', 'model BundleManifest', 'model PrefetchAnalytics', 'PREFETCH_HIT', '@@index([tenantId, metricType])', '@@index([userId, productId])']) {
    assert.ok(prisma.includes(t), `prisma missing ${t}`);
  }
  const sdl = readFileSync('apps/backend/src/api/graphql/schemas/performance.graphql/schema.graphql', 'utf8');
  for (const t of ['PerformanceReport', 'PrefetchPayload', 'PrefetchInput', 'getBundlePerformanceMetrics', 'triggerPredictivePrefetch', 'reportClientPerformanceMetrics']) {
    assert.ok(sdl.includes(t), `SDL missing ${t}`);
  }
  const mod = readFileSync('apps/backend/src/modules/performance/performance.module.ts', 'utf8');
  for (const t of ['BundleGuardService', 'PredictivePrefetchService', 'PrefetchResolver', 'PerformanceTelemetryController']) {
    assert.ok(mod.includes(t), `module missing ${t}`);
  }
  assert.ok(readFileSync('apps/backend/src/app.module.ts', 'utf8').includes('PerformanceModule'));
  const alias = readFileSync('apps/backend/src/api/graphql/resolvers/prefetch.resolver.ts', 'utf8');
  assert.ok(alias.includes('modules/performance/presentation/graphql/prefetch.resolver'));
  const resolverSrc = readFileSync('apps/backend/src/modules/performance/presentation/graphql/prefetch.resolver.ts', 'utf8');
  for (const t of ['getBundlePerformanceMetrics', 'triggerPredictivePrefetch', 'reportClientPerformanceMetrics', 'Missing tenant id', 'TelemetryIngestSchema']) {
    assert.ok(resolverSrc.includes(t), `resolver missing ${t}`);
  }
  const teleSrc = readFileSync('apps/backend/src/modules/performance/presentation/webhooks/performance-telemetry.controller.ts', 'utf8');
  for (const t of ['api/v1/performance', 'telemetry', 'prefetch', 'bundle', 'JwtAuthGuard']) {
    assert.ok(teleSrc.includes(t), `telemetry controller missing ${t}`);
  }

  const next = readFileSync('apps/frontend/next.config.ts', 'utf8');
  for (const t of ['maxSize: 500000', 'reader-canvas', 'hls-player', 'framework', 'optimizePackageImports', "chunks: 'async'"]) {
    assert.ok(next.includes(t), `next.config missing ${t}`);
  }
  assert.ok(!/require\(['"][^'"]*bundle-analyzer|from ['"][^'"]*bundle-analyzer|withBundleAnalyzer\(/.test(next), 'zero new deps: no bundle-analyzer import');
  const mjs = readFileSync('apps/frontend/next.config.mjs', 'utf8');
  assert.ok(mjs.includes('next.config.ts') && !mjs.includes('export default {') && !/splitChunks\s*[:=]/.test(mjs));

  const sw = readFileSync('apps/frontend/public/sw-prefetch.js', 'utf8');
  for (const t of ['zene-prefetch-v1', 'PREFETCH_URLS', 'skipWaiting', 'clients.claim', 'slice(0, 5)', 'https://cdn.omnichannel.com', 'https://videocdn.omnichannel.com']) {
    assert.ok(sw.includes(t), `SW missing ${t}`);
  }
  const hook = readFileSync('apps/frontend/hooks/use-predictive-prefetch.ts', 'utf8');
  for (const t of ['LIFF_INIT', 'IDLE', 'LOADING', 'SUCCESS', 'ERROR', 'PREFETCH_DWELL_MS', 'fanoutToServiceWorker', 'triggerEdgePrefetch']) {
    assert.ok(hook.includes(t), `hook missing ${t}`);
  }
  assert.ok(!hook.includes("from 'zustand'"), 'zero new deps: no zustand import');
  const observer = readFileSync('apps/frontend/components/performance/PrefetchObserver.tsx', 'utf8');
  assert.ok(observer.includes('usePredictivePrefetch') && observer.includes('return null'));
  const rum = readFileSync('apps/frontend/components/performance/RumReporter.tsx', 'utf8');
  for (const t of ['largest-contentful-paint', 'first-input', 'layout-shift', 'beaconRum', 'PerformanceObserver']) {
    assert.ok(rum.includes(t), `RUM missing ${t}`);
  }
  assert.ok(!/from ['"]web-vitals['"]|require\(['"]web-vitals/.test(rum), 'zero new deps: no web-vitals import');
  const layout = readFileSync('apps/frontend/app/(liff)/layout.tsx', 'utf8');
  assert.ok(layout.includes('PrefetchObserver') && layout.includes('RumReporter'));
  const mw = readFileSync('apps/frontend/middleware.ts', 'utf8');
  assert.ok(mw.includes("'/api/v1/performance/telemetry'"));
  for (const p of ['telemetry/route.ts', 'prefetch/route.ts', 'bundle/route.ts']) {
    assert.ok(readFileSync(`apps/frontend/app/api/v1/performance/${p}`, 'utf8').includes('/api/v1/performance/'), `proxy missing ${p}`);
  }
  ok('SDL/module wired; next splitChunks; SW allowlist; hook 5-state; observer+RUM null-hosts; layout+middleware+proxies');
}

console.log(`\nPhase 029 contracts: ${passed} checks passed`);
}

void main();
