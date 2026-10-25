// SSOT Phase 125 §10-11 — contract tests (Zod, routing math, replica
// router, pool services, balancers, interceptor, health, frontend,
// failover spec, Prisma Gate 1, barrel).
// Run: npx tsx scripts/test-phase125-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RegionZoneEnum,
  ReplicaHealthStatusEnum,
  InfraNodeMetricSchema,
  EdgeRoutingConfigSchema,
  EDGE_READ_BUDGET_MS,
  EDGE_FAILOVER_BUDGET_MS,
  EDGE_UNHEALTHY_AFTER_MS,
  EDGE_RESOLVE_BUDGET_MS,
  EDGE_HEALTH_PROBE_SEC,
  REPLICA_LAG_TRIP_MS,
  EDGE_FAILOVER_STRIKES,
  INFRA_ALERT_STREAM,
  nodeIsReadable,
  nearestReadableNode,
  failoverOrder,
  regionForCountry,
  edgeCacheKey,
  type EdgeNode,
} from '../packages/shared/src/schemas/edge-infrastructure.schema';
import { topologyFromEnv, resolveReadUrl, resolveWriteUrl } from '../apps/backend/src/infra/database/replica-router';
import { planEdgeRoute, pickRouteHead } from '../apps/backend/src/infra/edge/load-balancer';
import { CloudflareBalancer } from '../apps/backend/src/infra/edge/cloudflare-balancer';
import { EdgeRedisClusterService } from '../apps/backend/src/infra/redis/edge-cluster';
import { DatabaseReplicaService } from '../apps/backend/src/infra/connection-pool/database-replica.service';
import { EdgeRegionCacheService } from '../apps/backend/src/infra/connection-pool/edge-redis-cluster.service';
import { InfraHealthService, toPublicRow } from '../apps/backend/src/infra/connection-pool/infra-health.service';
import { ReadWriteInterceptor, READ_REPLICA_FLAG } from '../apps/backend/src/infra/connection-pool/read-write-interceptor';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const NODES: EdgeNode[] = [
  { region: 'ASIA_SOUTHEAST_BANGKOK', status: 'HEALTHY', replicationLagMs: 10, url: 'https://bkk.edge' },
  { region: 'ASIA_SOUTHEAST_SINGAPORE', status: 'HEALTHY', replicationLagMs: 5, url: 'https://sg.edge' },
  { region: 'ASIA_EAST_TOKYO', status: 'DEGRADED', replicationLagMs: 2000, url: 'https://tokyo.edge' },
  { region: 'US_WEST_OREGON', status: 'UNHEALTHY', replicationLagMs: 0, url: 'https://oregon.edge' },
];

async function main(): Promise<void> {
// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) ----------
{
  for (const v of ['ASIA_SOUTHEAST_BANGKOK', 'ASIA_SOUTHEAST_SINGAPORE', 'ASIA_EAST_TOKYO', 'US_WEST_OREGON']) {
    assert.equal(RegionZoneEnum.safeParse(v).success, true, v);
  }
  assert.equal(RegionZoneEnum.safeParse('EU_WEST').success, false);
  for (const v of ['HEALTHY', 'DEGRADED', 'UNHEALTHY', 'MAINTENANCE']) {
    assert.equal(ReplicaHealthStatusEnum.safeParse(v).success, true, v);
  }
  assert.equal(
    InfraNodeMetricSchema.safeParse({
      region: 'ASIA_EAST_TOKYO', replicaStatus: 'HEALTHY', replicationLagMs: 12,
      activeConnections: 7, cpuUsagePercent: 33, memoryUsagePercent: 41, timestamp: '2026-01-01T00:00:00.000Z',
    }).success,
    true,
  );
  assert.equal(
    InfraNodeMetricSchema.safeParse({
      region: 'ASIA_EAST_TOKYO', replicaStatus: 'HEALTHY', replicationLagMs: -1,
      activeConnections: 7, cpuUsagePercent: 101, memoryUsagePercent: 41, timestamp: '2026-01-01T00:00:00.000Z',
    }).success,
    false,
  );
  assert.equal(
    EdgeRoutingConfigSchema.safeParse({
      tenantId: 'acme', clientRegion: 'US_WEST_OREGON', primaryWriteNodeUrl: 'pg-primary:5432',
      assignedReadReplicaUrl: 'pg-replica:5432', cacheTtlSec: 300,
    }).success,
    true,
  );
  assert.equal(
    EdgeRoutingConfigSchema.safeParse({
      tenantId: '', clientRegion: 'US_WEST_OREGON', primaryWriteNodeUrl: '',
      assignedReadReplicaUrl: 'x', cacheTtlSec: 0,
    }).success,
    false,
  );
  assert.equal(EDGE_READ_BUDGET_MS, 20);
  assert.equal(EDGE_FAILOVER_BUDGET_MS, 200);
  assert.equal(EDGE_UNHEALTHY_AFTER_MS, 500);
  assert.equal(EDGE_RESOLVE_BUDGET_MS, 5);
  assert.equal(EDGE_HEALTH_PROBE_SEC, 30);
  assert.equal(REPLICA_LAG_TRIP_MS, 1000);
  assert.equal(EDGE_FAILOVER_STRIKES, 2);
  assert.equal(INFRA_ALERT_STREAM, 'stream:infra-alerts');
  ok('1. Zod SSOT verbatim (zones/health/metric/routing) + budgets');
}

// ---------- 2. Routing math (BDD-1 geo + BDD-2 order) ----------
{
  assert.equal(regionForCountry('TH'), 'ASIA_SOUTHEAST_BANGKOK');
  assert.equal(regionForCountry('th'), 'ASIA_SOUTHEAST_BANGKOK');
  assert.equal(regionForCountry('SG'), 'ASIA_SOUTHEAST_SINGAPORE');
  assert.equal(regionForCountry('JP'), 'ASIA_EAST_TOKYO');
  assert.equal(regionForCountry('US'), 'US_WEST_OREGON');
  assert.equal(regionForCountry('XX'), 'ASIA_SOUTHEAST_SINGAPORE');
  assert.equal(nodeIsReadable(NODES[0]!), true);
  assert.equal(nodeIsReadable({ region: 'ASIA_EAST_TOKYO', status: 'DEGRADED', replicationLagMs: 500, url: 'x' }), true);
  assert.equal(nodeIsReadable(NODES[2]!), false);
  assert.equal(nodeIsReadable(NODES[3]!), false);
  assert.equal(nodeIsReadable({ region: 'ASIA_EAST_TOKYO', status: 'MAINTENANCE', replicationLagMs: 0, url: 'x' }), false);
  // Singapore reader → Singapore replica (BDD-1 <20ms lane).
  assert.equal(nearestReadableNode('ASIA_SOUTHEAST_SINGAPORE', NODES)!.region, 'ASIA_SOUTHEAST_SINGAPORE');
  assert.equal(nearestReadableNode('US_WEST_OREGON', NODES)!.region, 'ASIA_SOUTHEAST_SINGAPORE');
  assert.equal(nearestReadableNode('ASIA_SOUTHEAST_BANGKOK', []), null);
  const order = failoverOrder('ASIA_SOUTHEAST_SINGAPORE', NODES).map((n) => n.region);
  assert.deepEqual(order.slice(0, 2), ['ASIA_SOUTHEAST_SINGAPORE', 'ASIA_SOUTHEAST_BANGKOK']);
  assert.equal(edgeCacheKey('ASIA_EAST_TOKYO', 'acme', 'rights:U1:P1'), 'edge:ASIA_EAST_TOKYO:acme:rights:U1:P1');
  ok('2. Geo mapping + readability + nearest + failover order');
}

// ---------- 3. Replica router (env topology + read/write split) ----------
{
  const topo = topologyFromEnv({
    DATABASE_URL: 'pg-primary:5432',
    DATABASE_REPLICA_ASIA_SE: 'pg-bkk:5432',
    DATABASE_REPLICA_ASIA_EAST: 'pg-tokyo:5432',
  });
  assert.equal(topo.primaryUrl, 'pg-primary:5432');
  assert.equal(topo.replicas.length, 3);
  assert.deepEqual(topo.replicas.map((r) => r.region), ['ASIA_SOUTHEAST_BANGKOK', 'ASIA_SOUTHEAST_SINGAPORE', 'ASIA_EAST_TOKYO']);
  const read = resolveReadUrl(topo, 'ASIA_SOUTHEAST_SINGAPORE');
  assert.deepEqual([read.url, read.replica], ['pg-bkk:5432', true]);
  const empty = resolveReadUrl({ primaryUrl: 'pg-primary:5432', replicas: [] }, 'US_WEST_OREGON');
  assert.deepEqual([empty.url, empty.region, empty.replica], ['pg-primary:5432', 'PRIMARY', false]);
  assert.equal(resolveWriteUrl(topo), 'pg-primary:5432');
  ok('3. Env topology + nearest-read + primary-write (Gate 7)');
}

// ---------- 4. Database replica service (rows → verdicts) ----------
{
  const rows = [
    { regionZone: 'ASIA_SOUTHEAST_BANGKOK', connectionString: 'pg-bkk:5432', isPrimary: false, isActive: true, currentLagMs: 5 },
    { regionZone: 'ASIA_SOUTHEAST_SINGAPORE', connectionString: 'pg-sg:5432', isPrimary: false, isActive: true, currentLagMs: 5000 },
    { regionZone: 'ASIA_EAST_TOKYO', connectionString: 'pg-tokyo:5432', isPrimary: false, isActive: false, currentLagMs: 0 },
    { regionZone: 'EU_WEST', connectionString: 'pg-eu:5432', isPrimary: false, isActive: true, currentLagMs: 0 },
    { regionZone: 'ASIA_SOUTHEAST_SINGAPORE', connectionString: 'pg-primary:5432', isPrimary: true, isActive: true, currentLagMs: 0 },
  ];
  const svc = new DatabaseReplicaService({ databaseReplicaNode: { findMany: async () => rows } });
  // Singapore row is lag-DEGRADED past trip → Bangkok wins for SG readers.
  const sg = await svc.readUrl('ASIA_SOUTHEAST_SINGAPORE', 'pg-primary:5432');
  assert.deepEqual([sg.url, sg.region], ['pg-bkk:5432', 'ASIA_SOUTHEAST_BANGKOK']);
  assert.equal(svc.writeUrl('pg-primary:5432'), 'pg-primary:5432');
  const none = new DatabaseReplicaService({ databaseReplicaNode: { findMany: async () => [] } });
  assert.deepEqual(await none.readUrl('US_WEST_OREGON', 'pg-primary:5432'), { url: 'pg-primary:5432', region: 'PRIMARY', replica: false });
  const down = new DatabaseReplicaService({ databaseReplicaNode: { findMany: async () => { throw new Error('db down'); } } });
  assert.deepEqual((await down.readUrl('ASIA_EAST_TOKYO', 'pg-primary:5432')).replica, false);
  ok('4. Row verdicts (lag/unhealthy/unknown skip) + primary fallback');
}

// ---------- 5. Edge Redis cluster (region-tagged lanes) ----------
{
  const kv = new Map<string, string>();
  const lane = new EdgeRedisClusterService({
    get: async (k: string) => kv.get(k) ?? null,
    set: async (k: string, v: string) => { kv.set(k, v); },
  });
  assert.equal(lane.regionFor('TH'), 'ASIA_SOUTHEAST_BANGKOK');
  await lane.set('ASIA_EAST_TOKYO', 'acme', 'rights:U1', 'GRANTED', 60);
  assert.equal(await lane.get('ASIA_EAST_TOKYO', 'acme', 'rights:U1'), 'GRANTED');
  assert.equal(await lane.get('US_WEST_OREGON', 'acme', 'rights:U1'), null);
  assert.ok([...kv.keys()].every((k) => k.startsWith('edge:')), 'region-tagged keys');
  // setex arg-order adapter (pool service).
  const calls: unknown[][] = [];
  const pool = new EdgeRegionCacheService({ get: async () => null, setex: async (...a: unknown[]) => { calls.push(a); }, del: async () => undefined } as never);
  await pool.set('ASIA_SOUTHEAST_SINGAPORE', 'acme', 's', 'v', 90);
  assert.deepEqual(calls, [['edge:ASIA_SOUTHEAST_SINGAPORE:acme:s', 90, 'v']]);
  assert.equal(pool.regionFor('JP'), 'ASIA_EAST_TOKYO');
  ok('5. Namespaced edge cache + setex adapter order');
}

// ---------- 6. Balancers (plan + fetch failover) ----------
{
  const plan = planEdgeRoute('SG', NODES);
  assert.deepEqual([plan.clientRegion, plan.primary!.region], ['ASIA_SOUTHEAST_SINGAPORE', 'ASIA_SOUTHEAST_SINGAPORE']);
  assert.equal(pickRouteHead(plan)!.region, 'ASIA_SOUTHEAST_SINGAPORE');
  assert.equal(pickRouteHead(plan, new Set(['ASIA_SOUTHEAST_SINGAPORE', 'ASIA_SOUTHEAST_BANGKOK']))!.region, 'ASIA_EAST_TOKYO');
  assert.equal(pickRouteHead({ clientRegion: 'US_WEST_OREGON', primary: null, failover: [] }), null);

  const realFetch = globalThis.fetch;
  const streams: unknown[] = [];
  const balancer = new CloudflareBalancer({ xaddPipeline: async (s: string, b: unknown) => { streams.push([s, b]); } });
  // first 2xx wins after one 500 (BDD-2 reroute).
  let calls = 0;
  (globalThis as Record<string, unknown>)['fetch'] = (async (url: unknown) => {
    calls++;
    if (String(url).startsWith('https://sg.edge')) return { status: 500 } as Response;
    return { status: 200 } as Response;
  }) as typeof fetch;
  try {
    const out = await balancer.fetchEdge('SG', NODES, '/api/v1/reader/chunk?x=1');
    assert.deepEqual([out.region, out.attempts, calls], ['ASIA_SOUTHEAST_BANGKOK', 2, 2]);
    assert.ok(streams.some((s) => JSON.stringify(s).includes('edge.failover')), 'failover alert stream');
  } finally {
    (globalThis as Record<string, unknown>)['fetch'] = realFetch;
  }
  // all nodes fail → last error surfaces (never silent).
  (globalThis as Record<string, unknown>)['fetch'] = (async () => ({ status: 503 })) as typeof fetch;
  try {
    await assert.rejects(balancer.fetchEdge('SG', NODES, '/x'), /EDGE_UPSTREAM_503/);
  } finally {
    (globalThis as Record<string, unknown>)['fetch'] = realFetch;
  }
  ok('6. Route plan + 500-reroute + all-down throw + alerts');
}

// ---------- 7. Read/write interceptor (REST-first Gate 7) ----------
{
  const { join } = await import('node:path');
  const rxRequire = eval('require') as (id: string) => { of: (v: unknown) => { subscribe: (a: unknown) => void } };
  const { of } = rxRequire(join(process.cwd(), 'apps', 'backend', 'node_modules', 'rxjs'));
  const interceptor = new ReadWriteInterceptor();
  const run = (req: Record<string, unknown>): Promise<{ flag: unknown; value: unknown }> =>
    new Promise((resolve, reject) => {
      const ctx = { switchToHttp: () => ({ getRequest: () => req }) } as never;
      void Promise.resolve(interceptor.intercept(ctx, { handle: () => of('ok') } as never)).then(
        (obs) => (obs as { subscribe: (a: { next: (v: unknown) => void; error: (e: unknown) => void }) => void }).subscribe({
          next: (v: unknown) => resolve({ flag: v, value: req[READ_REPLICA_FLAG] }),
          error: (e: unknown) => reject(e),
        }),
        (e: unknown) => reject(e),
      );
    });
  assert.equal(READ_REPLICA_FLAG, 'useReadReplica');
  assert.equal((await run({ method: 'GET' })).value, true);
  assert.equal((await run({ method: 'HEAD' })).value, true);
  assert.equal((await run({ method: 'POST' })).value, false);
  assert.equal((await run({ method: 'DELETE' })).value, false);
  // non-HTTP context → primary default, never throws.
  const noHttp = { switchToHttp: () => { throw new Error('no http'); } } as never;
  await new Promise<void>((resolve) => {
    void Promise.resolve(interceptor.intercept(noHttp, { handle: () => of('ok') } as never)).then((obs) =>
      (obs as { subscribe: (a: { next: () => void }) => void }).subscribe({ next: () => resolve() }),
    );
  });
  ok('7. REST read/write flags + non-HTTP primary default');
}

// ---------- 8. Health lane (public shape + redaction) ----------
{
  const svc = new DatabaseReplicaService({ databaseReplicaNode: { findMany: async () => [] } });
  const core = new InfraHealthService(svc);
  const res = (await core.health(undefined)) as Record<string, unknown>;
  assert.equal(res['ok'], true);
  assert.ok(!Number.isNaN(Date.parse(String(res['at']))), 'timestamped');
  const routed = (await core.health('ASIA_SOUTHEAST_SINGAPORE')) as Record<string, unknown>;
  assert.deepEqual((routed['route'] as Record<string, unknown>)['region'], 'PRIMARY');
  const pub = toPublicRow({ regionZone: 'ASIA_EAST_TOKYO', isPrimary: false, isActive: true, currentLagMs: 5 });
  assert.deepEqual(pub, { regionZone: 'ASIA_EAST_TOKYO', readable: true, lagMs: 5, active: true });
  assert.ok(!JSON.stringify(pub).includes('postgres://') && !('url' in pub) && !('connectionString' in pub), 'Gate 4 redaction');
  const shell = readFileSync('apps/backend/src/infra/connection-pool/infra-health.controller.ts', 'utf8');
  assert.ok(shell.includes('this.health.health(region)') && shell.includes("@Get('health')"), 'shell delegates');
  ok('8. Public health shape + secret redaction');
}

// ---------- 9. Frontend edge lanes (static source gates) ----------
{
  const reader = readFileSync('apps/frontend/components/reader/EdgeAwareCanvasReader.tsx', 'utf8');
  assert.ok(reader.includes('/api/edge/reader/chunk') && reader.includes('x-client-intent'), 'edge intent lane');
  assert.ok(reader.includes('servedFromRegion') && reader.includes('Node:'), 'region badge');
  assert.ok(reader.includes('URL.revokeObjectURL') && reader.includes('clearRect'), 'RAM discipline');
  assert.ok(!reader.includes("from 'idb-keyval'"), 'zero-dep reader');
  const proxy = readFileSync('apps/frontend/app/api/edge/reader/chunk/route.ts', 'utf8');
  assert.ok(proxy.includes('/api/reader/chunk') && proxy.includes('servedFromRegion'), 'backend lane + region stamp');
  assert.ok(proxy.includes('EDGE_REGION') && proxy.includes('cf-ipcountry'), 'region hints');
  assert.ok(proxy.includes('x-tenant-id') || proxy.includes('authorization') || proxy.includes('cookie'), 'auth forwarding');
  ok('9. Edge reader shell + proxy (dep-free)');
}

// ---------- 10. Failover spec (CI lane gates) ----------
{
  const spec = readFileSync('apps/backend/src/infra/test/chaos-failover.spec.ts', 'utf8');
  assert.ok(!spec.includes('TODO') && !spec.includes('placeholder'), 'spec implemented');
  assert.ok(spec.includes("from '@playwright/test'"), 'playwright lane');
  assert.ok(spec.includes('toBeLessThan(500)'), 'BDD-2 500ms bound');
  assert.ok(spec.includes('/api/v1/infra/health'), 'health lane');
  assert.ok(spec.includes('postgres://'), 'redaction assert');
  ok('10. Playwright failover spec (bounds + redaction)');
}

// ---------- 11. Prisma Gate 1 (replica registry) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  assert.ok(prisma.includes('model DatabaseReplicaNode'), 'registry model');
  assert.ok(prisma.includes('regionZone       String    @unique'), 'region dedupe key');
  assert.ok(prisma.includes('@@index([regionZone])'), 'region lookup index');
  const datasourceBlock = /datasource db \{[^}]*\}/.exec(prisma)?.[0] ?? '';
  assert.ok(!/directUrl\s*=/.test(datasourceBlock), 'datasource untouched (RISK_CALL lock)');
  assert.ok(!/driverAdapters/.test(datasourceBlock), 'generator untouched (RISK_CALL lock)');
  // 122/123/124 lanes intact (union-not-replace).
  assert.ok(prisma.includes('model IdempotencyLog') && prisma.includes('model StorageBucketPolicy') && prisma.includes('model ChaosTestRun'), '122/123/124 lanes intact');
  ok('11. Prisma Gate 1 (registry + datasource lock)');
}

// ---------- 12. Tree parity + barrel + scope discipline ----------
{
  for (const f of [
    'apps/backend/src/infra/database/replica-router.ts',
    'apps/backend/src/infra/edge/load-balancer.ts',
    'apps/backend/src/infra/edge/cloudflare-balancer.ts',
    'apps/backend/src/infra/redis/edge-cluster.ts',
    'apps/backend/src/infra/connection-pool/database-replica.service.ts',
    'apps/backend/src/infra/connection-pool/edge-redis-cluster.service.ts',
    'apps/backend/src/infra/connection-pool/infra-health.controller.ts',
    'apps/backend/src/infra/connection-pool/read-write-interceptor.ts',
    'apps/backend/src/modules/infra/connection-pool.module.ts',
    'apps/frontend/components/reader/EdgeAwareCanvasReader.tsx',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes('TODO') && !src.includes('placeholder'), `${f} unimplemented`);
  }
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  for (const e of ['RegionZoneEnum', 'ReplicaHealthStatusEnum', 'InfraNodeMetricSchema', 'EdgeRoutingConfigSchema', 'nearestReadableNode', 'regionForCountry', 'EDGE_FAILOVER_BUDGET_MS']) {
    assert.ok(barrel.includes(e), `barrel ${e}`);
  }
  // No read-replicas extension (zero-dep port routing instead; prose
  // mentions in RISK_CALL comments are intentional documentation).
  for (const f of [
    'apps/backend/src/infra/database/replica-router.ts',
    'apps/backend/src/infra/connection-pool/database-replica.service.ts',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes("from '@prisma/extension-read-replicas'") && !src.includes('require("@prisma/extension-read-replicas'), `${f} zero-dep`);
  }
  // Cores untouched: payment webhook, order checkout.
  const slipCore = readFileSync('apps/backend/src/modules/payment/services/slip-verification.service.ts', 'utf8');
  assert.ok(!slipCore.includes('replica') && !slipCore.includes('Replica'), 'payment core untouched');
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('ConnectionPoolModule'), 'module wired');
  const wrangler = readFileSync('apps/backend/wrangler.toml', 'utf8');
  assert.ok(wrangler.includes('EDGE_REGION'), 'edge region hint');
  assert.ok(!wrangler.includes('SECRET_ACCESS_KEY') && !wrangler.includes('DATABASE_URL'), 'no secrets in wrangler');
  const tf = readFileSync('terraform/main.tf', 'utf8');
  assert.ok(tf.includes('replica_regions') && tf.includes('200'), 'terraform registry declared');
  ok('12. 125 tree parity + barrel + core-untouched discipline');
}
}

main()
  .then(() => {
    console.log(`\nPhase 125 contracts: ${passed}/12 groups passed`);
    process.exit(0);
  })
  .catch((err) => {
    console.error('\nPhase 125 contracts FAILED:', err);
    process.exit(1);
  });
