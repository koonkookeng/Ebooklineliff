// SSOT Phase 039 §10 — contract tests (Zod, key space, gzip edge, warmer, wiring)
// Run: npx tsx scripts/test-phase039-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import {
  CacheMetricsSchema,
  CHUNK_CACHE_TTL_SEC,
  CHUNK_WINDOW_RADIUS,
  ChunkCacheKeyParamsSchema,
  chunkInvalidationPattern,
  chunkR2ObjectKey,
  buildChunkCacheKey,
  EDGE_HIT_SLA_MS,
  EDGE_SELFHEAL_MS,
  EDGE_WARM_BUDGET_MS,
  RedisChunkPayloadSchema,
  slidingWindowPages,
} from '../packages/shared/src/schemas/chunk-cache.schema';
import { isTenantIsolatedKey, REDIS_EDGE_DEFAULTS, resolveRedisEdgeConfig } from '../apps/backend/src/infra/redis/redis-cluster.config';
import { EDGE_CACHE_CLIENT, R2_CHUNK_READER } from '../apps/backend/src/modules/reader/cache/interfaces/chunk-cache.interface';
import { EdgeCacheTelemetry, RedisEdgeService } from '../apps/backend/src/modules/reader/cache/services/redis-edge.service';
import { ChunkWarmerService } from '../apps/backend/src/modules/reader/cache/services/chunk-warmer.service';
// NOTE: Controller/Module use Nest parameter decorators (@Query/@UseGuards)
// which tsx/esbuild cannot transform — verified via static source parity (§7)
// following the Phase 027–038 precedent.

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const PRODUCT_ID = '123e4567-e89b-12d3-a456-426614174000';
const PARAMS = { tenantId: 'tenant_001', productId: PRODUCT_ID, pageNumber: 10 };

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) + budgets ----------
{
  assert.equal(ChunkCacheKeyParamsSchema.safeParse(PARAMS).success, true);
  assert.equal(ChunkCacheKeyParamsSchema.safeParse({ ...PARAMS, productId: 'not-uuid' }).success, false);
  assert.equal(ChunkCacheKeyParamsSchema.safeParse({ ...PARAMS, tenantId: '' }).success, false);
  assert.equal(ChunkCacheKeyParamsSchema.safeParse({ ...PARAMS, pageNumber: 0 }).success, false);
  assert.equal(ChunkCacheKeyParamsSchema.safeParse({ ...PARAMS, pageNumber: 1.5 }).success, false);

  const payload = {
    pageNumber: 10,
    vectorSvgContent: '<svg><rect/></svg>',
    compressedSizeByte: 128,
    cachedAt: new Date().toISOString(),
  };
  const parsed = RedisChunkPayloadSchema.safeParse(payload);
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.isEncrypted, true);
    assert.equal(parsed.data.ttlSeconds, 86400);
  }
  assert.equal(RedisChunkPayloadSchema.safeParse({ ...payload, vectorSvgContent: '' }).success, false);

  assert.equal(CacheMetricsSchema.safeParse({ hitRatio: 98.5, averageLatencyMs: 4.2, keysCount: 1200, memoryUsedMb: 64 }).success, true);
  assert.equal(CacheMetricsSchema.safeParse({ hitRatio: 101, averageLatencyMs: 0, keysCount: 0, memoryUsedMb: 0 }).success, false);

  assert.equal(CHUNK_CACHE_TTL_SEC, 86400);
  assert.equal(EDGE_HIT_SLA_MS, 10);
  assert.equal(EDGE_SELFHEAL_MS, 15);
  assert.equal(EDGE_WARM_BUDGET_MS, 50);
  assert.equal(CHUNK_WINDOW_RADIUS, 1);
  ok('Zod key/payload/metrics verbatim + edge budgets');
}

// ---------- 2. Key space, invalidation pattern, window, R2 origin ----------
{
  assert.equal(buildChunkCacheKey(PARAMS), `tenant:tenant_001:ebook:${PRODUCT_ID}:page:10:chunk`);
  assert.equal(isTenantIsolatedKey(buildChunkCacheKey(PARAMS)), true);
  assert.equal(isTenantIsolatedKey('ebook:chunk:plain'), false);
  assert.equal(chunkInvalidationPattern('tenant_001', PRODUCT_ID), `tenant:tenant_001:ebook:${PRODUCT_ID}:page:*:chunk`);
  assert.deepEqual(slidingWindowPages(10), [9, 10, 11]);
  assert.deepEqual(slidingWindowPages(1), [1, 2]);
  assert.deepEqual(slidingWindowPages(0), [1]);
  assert.equal(chunkR2ObjectKey(PRODUCT_ID, 3), `ebooks/${PRODUCT_ID}/chunks/page-3.enc`);
  ok('Key space tenant-isolated; window [N-1,N,N+1]; R2 origin path');
}

// ---------- 3. Edge config factory (Task 39.1) ----------
{
  const def = resolveRedisEdgeConfig({} as NodeJS.ProcessEnv);
  assert.deepEqual(def.nodes, [{ host: 'localhost', port: 6379 }]);
  assert.equal(def.password, undefined);
  assert.equal(def.connectTimeoutMs, REDIS_EDGE_DEFAULTS.connectTimeoutMs);
  assert.equal(def.maxRetriesPerRequest, 3);
  assert.equal(def.defaultTtlSec, 86400);
  assert.equal(def.enableReadyCheck, true);

  const custom = resolveRedisEdgeConfig({
    REDIS_EDGE_HOST: 'edge.internal',
    REDIS_EDGE_PORT: '6380',
    REDIS_EDGE_PASSWORD: 's3cret',
  } as NodeJS.ProcessEnv);
  assert.deepEqual(custom.nodes, [{ host: 'edge.internal', port: 6380 }]);
  assert.equal(custom.password, 's3cret');

  const clustered = resolveRedisEdgeConfig({ REDIS_CLUSTER_NODES: '10.0.0.1:6379, 10.0.0.2:6380' } as NodeJS.ProcessEnv);
  assert.deepEqual(clustered.nodes, [
    { host: '10.0.0.1', port: 6379 },
    { host: '10.0.0.2', port: 6380 },
  ]);
  ok('Edge config: defaults + single-node env + cluster list + isolation guard');
}

// ---------- 4. Telemetry snapshot math (§7.1) ----------
{
  const t = new EdgeCacheTelemetry();
  assert.equal(t.snapshot().hitRatio, 100);
  t.recordHit(4);
  t.recordHit(6);
  t.recordMiss(50);
  const snap = t.snapshot();
  assert.ok(Math.abs(snap.hitRatio - (2 / 3) * 100) < 1e-9);
  assert.ok(Math.abs(snap.averageLatencyMs - 20) < 1e-9);
  ok('Telemetry hit-ratio + p-mean latency math');
}

function fakeClient(): {
  store: Map<string, Buffer>;
  expired: string[];
  deleted: string[][];
  scanned: string[];
  client: {
    getBuffer(k: string): Promise<Buffer | null>;
    get(k: string): Promise<string | null>;
    set(k: string, v: string | Buffer, ...a: Array<string | number>): Promise<string>;
    expire(k: string, s: number): Promise<number>;
    del(...ks: string[]): Promise<number>;
    scanKeys(p: string): Promise<string[]>;
  };
} {
  const store = new Map<string, Buffer>();
  const expired: string[] = [];
  const deleted: string[][] = [];
  const scanned: string[] = [];
  const match = (pattern: string, key: string): boolean => {
    const rx = new RegExp(`^${pattern.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
    return rx.test(key);
  };
  return {
    store,
    expired,
    deleted,
    scanned,
    client: {
      getBuffer: async (k) => store.get(k) ?? null,
      get: async (k) => store.get(k)?.toString('utf-8') ?? null,
      set: async (k, v) => {
        store.set(k, Buffer.isBuffer(v) ? v : Buffer.from(v as string));
        return 'OK';
      },
      expire: async (k, s) => {
        expired.push(`${k}:${s}`);
        return 1;
      },
      del: async (...ks) => {
        deleted.push(ks);
        for (const k of ks) store.delete(k);
        return ks.length;
      },
      scanKeys: async (p) => {
        scanned.push(p);
        return [...store.keys()].filter((k) => match(p, k));
      },
    },
  };
}

async function main(): Promise<void> {
  // ---------- 5. RedisEdgeService HIT/MISS/TTL + gzip round-trip (BDD-1/2) ----------
  {
    const fake = fakeClient();
    const svc = new RedisEdgeService(fake.client);
    assert.equal(svc.buildKey(PARAMS), buildChunkCacheKey(PARAMS));

    // MISS on empty edge (no R2 here — warmer owns fallback).
    assert.equal(await svc.getPageChunk(PARAMS), null);

    const payload = {
      pageNumber: 10,
      vectorSvgContent: '<svg><rect width="10"/></svg>',
      compressedSizeByte: 0,
      isEncrypted: true,
      cachedAt: new Date().toISOString(),
      ttlSeconds: 86400,
    };
    await svc.setPageChunk(PARAMS, payload);
    const stored = fake.store.get(buildChunkCacheKey(PARAMS));
    assert.ok(stored && stored.length > 0);
    // Stored bytes are gzip (not plain JSON) — zero-knowledge at rest.
    assert.throws(() => JSON.parse(stored.toString('utf-8')));
    assert.deepEqual(gunzipSync(stored).toString('utf-8').slice(0, 1), '{');

    const hit = await svc.getPageChunk(PARAMS);
    assert.ok(hit && hit.vectorSvgContent === payload.vectorSvgContent);
    assert.ok(hit.compressedSizeByte > 0);
    // Sliding-window TTL renewal fired async on HIT.
    assert.ok(fake.expired.some((e) => e === `${buildChunkCacheKey(PARAMS)}:86400`));

    const snap = svc.metrics();
    assert.ok(snap.hitRatio > 0 && snap.hitRatio < 100);

    // Corrupt bytes fail open to null (ERROR state → IndexedDB fallback).
    fake.store.set(buildChunkCacheKey(PARAMS), Buffer.from('not-gzip'));
    const l1less = new RedisEdgeService(fake.client);
    assert.equal(await l1less.getPageChunk(PARAMS), null);
    ok('Edge HIT/MISS + gzip-at-rest + sliding EXPIRE + corrupt fail-open');
  }

  // ---------- 6. Invalidation sweep (BDD-3) ----------
  {
    const fake = fakeClient();
    const svc = new RedisEdgeService(fake.client);
    for (const page of [1, 2, 3]) {
      await svc.setPageChunk({ ...PARAMS, pageNumber: page }, {
        pageNumber: page,
        vectorSvgContent: `<svg>${page}</svg>`,
        compressedSizeByte: 10,
        isEncrypted: true,
        cachedAt: new Date().toISOString(),
        ttlSeconds: 86400,
      });
    }
    // Seed a foreign-tenant key that must survive the sweep.
    const foreign = 'tenant:other:ebook:xxx:page:1:chunk';
    fake.store.set(foreign, gzipSync(JSON.stringify({ pageNumber: 1 })));
    const evicted = await svc.invalidateEbookCache('tenant_001', PRODUCT_ID);
    assert.equal(evicted, 3);
    assert.ok(fake.store.has(foreign));
    assert.equal(await svc.getPageChunk({ ...PARAMS, pageNumber: 1 }), null);
    ok('Pattern invalidation evicts 3 tenant pages, spares foreign tenant');
  }

  // ---------- 7. ChunkWarmerService R2 fallback + read-ahead (§BDD-2) ----------
  {
    const fake = fakeClient();
    const edge = new RedisEdgeService(fake.client);
    const vault = new Map<string, string>([
      [chunkR2ObjectKey(PRODUCT_ID, 10), '<svg>vault-page-10</svg>'],
      [chunkR2ObjectKey(PRODUCT_ID, 11), '<svg>vault-page-11</svg>'],
      [chunkR2ObjectKey(PRODUCT_ID, 12), '<svg>vault-page-12</svg>'],
    ]);
    const warmer = new ChunkWarmerService(edge, async (k) => vault.get(k) ?? '');
    const payload = await warmer.getOrWarm(PARAMS);
    assert.ok(payload && payload.vectorSvgContent === '<svg>vault-page-10</svg>');
    // Warmed edge serves the next read as a HIT (warm is async by design,
    // BDD-2 <50ms budget — poll briefly rather than coupling to internals).
    let hit = null;
    for (let i = 0; i < 50 && !hit; i += 1) {
      await new Promise((r) => setTimeout(r, 10));
      hit = await edge.getPageChunk(PARAMS);
    }
    assert.ok(hit && hit.vectorSvgContent === '<svg>vault-page-10</svg>');

    // Unknown vault object → null (client shows ERROR + IndexedDB fallback).
    const missing = await warmer.getOrWarm({ ...PARAMS, pageNumber: 99 });
    assert.equal(missing, null);

    const warmed = await warmer.warmReadAhead({ ...PARAMS, pageNumber: 10 }, 2);
    assert.ok(warmed >= 2);
    let ahead = null;
    for (let i = 0; i < 50 && !ahead; i += 1) {
      await new Promise((r) => setTimeout(r, 10));
      ahead = await edge.getPageChunk({ ...PARAMS, pageNumber: 12 });
    }
    assert.ok(ahead?.vectorSvgContent.includes('vault-page-12'));

    // No R2 reader configured → pure edge (miss → null, never throws).
    const edgeOnly = new ChunkWarmerService(new RedisEdgeService(fake.client));
    assert.equal(await edgeOnly.getOrWarm({ ...PARAMS, pageNumber: 77 }), null);
    ok('Warmer R2 fallback + async warm + read-ahead + readerless miss');
  }

  // ---------- 8. Wiring + controller/resolver/hook parity (§12 Gate 9) ----------
  {
    assert.equal(typeof EDGE_CACHE_CLIENT, 'string');
    assert.equal(typeof R2_CHUNK_READER, 'string');

    const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
    assert.ok(prisma.includes('model EbookDetail'), 'prisma keeps EbookDetail SSOT (§4.1)');

    const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
    for (const t of ['ChunkCacheKeyParamsSchema', 'RedisChunkPayloadSchema', 'buildChunkCacheKey', 'slidingWindowPages']) {
      assert.ok(barrel.includes(t), `shared barrel missing ${t}`);
    }
    const mod = readFileSync('apps/backend/src/modules/reader/cache/chunk-cache.module.ts', 'utf8');
    for (const t of ['RedisEdgeService', 'ChunkWarmerService', 'ReaderChunkController', 'useFactory', 'RedisClusterService', 'R2StorageService', 'R2StorageModule']) {
      assert.ok(mod.includes(t), `module missing ${t}`);
    }
    assert.ok(readFileSync('apps/backend/src/app.module.ts', 'utf8').includes('ChunkCacheModule'));
    const ctlSrc = readFileSync('apps/backend/src/modules/reader/controllers/reader-chunk.controller.ts', 'utf8');
    for (const t of ['api/reader/chunk', '@Get()', '@Delete()', 'JwtAuthGuard', 'ChunkCacheKeyParamsSchema', 'ChunkWarmerService']) {
      assert.ok(ctlSrc.includes(t), `controller missing ${t}`);
    }
    const aliasCtl = readFileSync('apps/backend/src/modules/reader/cache/controllers/reader-chunk.controller.ts', 'utf8');
    assert.ok(aliasCtl.includes('ReaderChunkController'));
    const aliasSvc = readFileSync('apps/backend/src/modules/reader/cache/redis-edge.service.ts', 'utf8');
    assert.ok(aliasSvc.includes('RedisEdgeService'));
    const clusterSrc = readFileSync('apps/backend/src/infra/redis/redis-cluster.service.ts', 'utf8');
    for (const t of ['getBuffer', 'scanKeys', 'expire']) {
      assert.ok(clusterSrc.includes(t), `cluster missing ${t}`);
    }
    const hook = readFileSync('apps/frontend/hooks/useRedisEdgeChunk.ts', 'utf8');
    for (const t of ['slidingWindowPages', '/api/reader/chunk', 'revokeObjectURL', 'trackBlobUrl', 'LIFF_INIT', 'SUCCESS', 'ERROR', 'retry']) {
      assert.ok(hook.includes(t), `hook missing ${t}`);
    }
    const proxy = readFileSync('apps/frontend/app/api/reader/chunk/route.ts', 'utf8');
    for (const t of ['/api/reader/chunk', 'tenantId', 'productId', 'BACKEND_URL']) {
      assert.ok(proxy.includes(t), `proxy missing ${t}`);
    }
    assert.ok(!hook.includes('new Map()') || hook.includes('new Map<number, string>()'), 'hook keeps typed window map');
    ok('Barrel + module wired in AppModule; controller/alias/cluster/hook parity');
  }

  console.log(`\nPhase 039 contracts: ${passed} checks passed`);
}

void main();
