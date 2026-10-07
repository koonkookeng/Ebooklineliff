// SSOT Phase 033 §10 — contract tests (Zod, service, client, wiring, UI)
// Run: npx tsx scripts/test-phase033-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  UpdatePolicyEnum,
  AppVersionSchema,
  VersionPlatformEnum,
  VersionCheckRequestSchema,
  VersionCheckResponseSchema,
  LatestReleaseSchema,
  ClientDeviceLogSchema,
  VERSION_CACHE_TTL_SEC,
  VERSION_CACHE_PREFIX,
  UPDATE_LOOP_MAX,
  UPDATE_LOOP_KEY,
  versionCacheKey,
  compareSemver,
  evaluateUpdate,
} from '../packages/shared/src/schemas/version-contract';
import { VersionService } from '../apps/backend/src/modules/version/version.service';
import type { PrismaService } from '../apps/backend/src/infra/database/prisma.service';
import type { RedisClusterService } from '../apps/backend/src/infra/redis/redis-cluster.service';
import {
  cacheBustedUrl,
  canAutoReload,
  checkForUpdate,
  updateLoopCount,
} from '../apps/frontend/lib/updater/update-client';
import { registerUpdateChannel, resetUpdateChannelForTests } from '../apps/frontend/service-workers/sw-update-handler';
// NOTE: VersionController uses Nest parameter decorators (@Body) which
// tsx/esbuild cannot transform — verified via static source parity (§6)
// following the Phase 027–032 precedent.

let passed = 0;
function ok(name: string) {
  passed++;
  console.log(`  ✓ ${name}`);
}

// ---------- 1. Zod release/check/response/device boundaries (§3.1 Gate 1) ----------
{
  for (const p of ['OPTIONAL', 'RECOMMENDED', 'FORCE_IMMEDIATE']) assert.equal(UpdatePolicyEnum.safeParse(p).success, true);
  for (const p of ['LINE_LIFF', 'WEB_DESKTOP', 'MOBILE_PWA']) assert.equal(VersionPlatformEnum.safeParse(p).success, true);
  const app = {
    tenantId: 'default', version: '1.4.0', buildHash: 'b39f1c88', minSupportedVersion: '1.2.0',
    updatePolicy: 'RECOMMENDED', releasedAt: new Date().toISOString(),
  };
  assert.equal(AppVersionSchema.safeParse(app).success, true);
  assert.equal(AppVersionSchema.safeParse({ ...app, version: '1.4' }).success, false);
  assert.equal(AppVersionSchema.safeParse({ ...app, minSupportedVersion: 'latest' }).success, false);
  assert.equal(AppVersionSchema.safeParse({ ...app, buildHash: 'short' }).success, false);
  assert.equal(AppVersionSchema.safeParse({ ...app, tenantId: '' }).success, false);
  const req = { tenantId: 't', clientVersion: '1.3.0', clientBuildHash: 'aaaabbbb', platform: 'LINE_LIFF' };
  assert.equal(VersionCheckRequestSchema.safeParse(req).success, true);
  assert.equal(VersionCheckRequestSchema.safeParse({ ...req, platform: 'SMS' }).success, false);
  assert.equal(LatestReleaseSchema.safeParse({ version: '1.4.0', buildHash: 'b39f1c88', minSupportedVersion: '1.2.0', updatePolicy: 'FORCE_IMMEDIATE' }).success, true);
  assert.equal(LatestReleaseSchema.safeParse({ version: 'x', buildHash: 'b39f1c88', minSupportedVersion: '1.2.0', updatePolicy: 'FORCE_IMMEDIATE' }).success, false);
  const log = { tenantId: 't', clientVersion: '1.3.0', clientBuildHash: 'aaaabbbb', platform: 'MOBILE_PWA' };
  assert.equal(ClientDeviceLogSchema.safeParse(log).success, true);
  assert.equal(VERSION_CACHE_TTL_SEC, 300);
  assert.equal(VERSION_CACHE_PREFIX, 'version:latest');
  assert.equal(UPDATE_LOOP_MAX, 2);
  assert.equal(UPDATE_LOOP_KEY, 'app-update-count');
  assert.equal(versionCacheKey('company-a'), 'version:latest:company-a');
  ok('Zod policy/platform/release/check/device + cache/loop constants');
}

// ---------- 2. Semver + update decision matrix (single source) ----------
{
  assert.equal(compareSemver('1.4.0', '1.4.0'), 0);
  assert.equal(compareSemver('1.10.0', '1.9.9'), 1);
  assert.equal(compareSemver('1.2.0', '1.2.1'), -1);
  assert.equal(compareSemver('2.0', '2.0.0'), 0);
  const latest = { version: '1.4.0', buildHash: 'new-hash-1', minSupportedVersion: '1.2.0', updatePolicy: 'RECOMMENDED' as const };
  assert.deepEqual(evaluateUpdate('1.4.0', 'new-hash-1', latest), { isLatest: true, needsForceUpdate: false, updatePolicy: 'RECOMMENDED' });
  assert.deepEqual(evaluateUpdate('1.3.0', 'old-hash-1', latest), { isLatest: false, needsForceUpdate: false, updatePolicy: 'RECOMMENDED' });
  assert.deepEqual(evaluateUpdate('1.1.9', 'old-hash-1', latest), { isLatest: false, needsForceUpdate: true, updatePolicy: 'RECOMMENDED' });
  assert.deepEqual(
    evaluateUpdate('1.3.9', 'old-hash-1', { ...latest, updatePolicy: 'FORCE_IMMEDIATE' }),
    { isLatest: false, needsForceUpdate: true, updatePolicy: 'FORCE_IMMEDIATE' },
  );
  ok('Semver ordering + latest/stale/below-min/force matrix');
}

function stubCluster(store: Map<string, string> = new Map(), setexCalls: Array<{ k: string; ttl: number }> = []): RedisClusterService {
  return {
    get: async (k: string) => store.get(k) ?? null,
    setex: async (k: string, ttl: number, v: string) => { setexCalls.push({ k, ttl }); store.set(k, v); },
    del: async (k: string) => { store.delete(k); },
    publish: async () => undefined,
  } as unknown as RedisClusterService;
}

const RELEASE = { version: '1.4.0', buildHash: 'edge-hash-9', minSupportedVersion: '1.2.0', updatePolicy: 'RECOMMENDED', releaseNotes: 'notes' };

async function main(): Promise<void> {
// ---------- 3. Service: edge-first, refill, echo, guards, fleet log ----------
{
  const created: unknown[] = [];
  const prisma = {
    appVersion: { findFirst: async () => ({ ...RELEASE }) },
    clientDeviceLog: { create: async (a: unknown) => { created.push(a); return {}; } },
  } as unknown as PrismaService;

  // Edge hit (<20ms path): no DB read, decision + device log.
  let dbReads = 0;
  const hitPrisma = {
    appVersion: { findFirst: async () => { dbReads++; return { ...RELEASE }; } },
    clientDeviceLog: { create: async (a: unknown) => { created.push(a); return {}; } },
  } as unknown as PrismaService;
  const hitSvc = new VersionService(hitPrisma, stubCluster(new Map([['version:latest:t', JSON.stringify(RELEASE)]])));
  const hit = await hitSvc.evaluateClientVersion({ tenantId: 't', clientVersion: '1.4.0', clientBuildHash: 'edge-hash-9', platform: 'LINE_LIFF' }, { ipAddress: '1.2.3.4', userAgent: 'UA' });
  assert.equal(hit.isLatest, true);
  assert.equal(hit.needsForceUpdate, false);
  assert.equal(dbReads, 0);
  assert.equal((created[created.length - 1] as { data: Record<string, unknown> }).data.ipAddress, '1.2.3.4');

  // Miss → DB refill (300s TTL) + stale verdict + force on below-min.
  const setexCalls: Array<{ k: string; ttl: number }> = [];
  const missSvc = new VersionService(prisma, stubCluster(new Map(), setexCalls));
  const stale = await missSvc.evaluateClientVersion({ tenantId: 't', clientVersion: '1.3.0', clientBuildHash: 'old', platform: 'WEB_DESKTOP' });
  assert.equal(stale.isLatest, false);
  assert.equal(stale.latestBuildHash, 'edge-hash-9');
  assert.equal(setexCalls[0].k, 'version:latest:t');
  assert.equal(setexCalls[0].ttl, 300);
  const forced = await missSvc.evaluateClientVersion({ tenantId: 't', clientVersion: '1.0.0', clientBuildHash: 'old', platform: 'WEB_DESKTOP' });
  assert.equal(forced.needsForceUpdate, true);

  // No release anywhere → echo-client OPTIONAL (never force).
  const emptySvc = new VersionService(
    { appVersion: { findFirst: async () => null }, clientDeviceLog: { create: async () => ({}) } } as unknown as PrismaService,
    stubCluster(),
  );
  const echo = await emptySvc.evaluateClientVersion({ tenantId: 'ghost', clientVersion: '9.9.9', clientBuildHash: 'zzz', platform: 'LINE_LIFF' });
  assert.deepEqual(echo, { isLatest: true, needsForceUpdate: false, latestVersion: '9.9.9', latestBuildHash: 'zzz', updatePolicy: 'OPTIONAL' });

  // Poisoned edge (valid JSON, wrong shape) → DB refill, not a 500.
  const poisonSvc = new VersionService(prisma, stubCluster(new Map([['version:latest:t', JSON.stringify({ nope: 1 })]])));
  const healed = await poisonSvc.evaluateClientVersion({ tenantId: 't', clientVersion: '1.4.0', clientBuildHash: 'edge-hash-9', platform: 'LINE_LIFF' });
  assert.equal(healed.isLatest, true);

  // DB policy garbage → OPTIONAL (fail-closed, response stays Zod-clean).
  const garbageSvc = new VersionService(
    {
      appVersion: { findFirst: async () => ({ ...RELEASE, updatePolicy: 'WHATEVER' }) },
      clientDeviceLog: { create: async () => ({}) },
    } as unknown as PrismaService,
    stubCluster(),
  );
  const coerced = await garbageSvc.evaluateClientVersion({ tenantId: 't', clientVersion: '1.3.0', clientBuildHash: 'old', platform: 'LINE_LIFF' });
  assert.equal(coerced.updatePolicy, 'OPTIONAL');
  assert.equal(coerced.needsForceUpdate, false);

  // Malformed release rows (empty/garbage versions) → echo, never force.
  for (const bad of [
    { ...RELEASE, version: '' },
    { ...RELEASE, buildHash: '' },
    { ...RELEASE, minSupportedVersion: 'latest' },
  ]) {
    const malformedSvc = new VersionService(
      {
        appVersion: { findFirst: async () => bad },
        clientDeviceLog: { create: async () => ({}) },
      } as unknown as PrismaService,
      stubCluster(),
    );
    const echoed = await malformedSvc.evaluateClientVersion({ tenantId: 't', clientVersion: '1.3.0', clientBuildHash: 'old', platform: 'LINE_LIFF' });
    assert.equal(echoed.isLatest, true);
    assert.equal(echoed.needsForceUpdate, false);
    assert.equal(echoed.latestVersion, '1.3.0');
  }

  await assert.rejects(() => missSvc.evaluateClientVersion({ tenantId: '', clientVersion: '1.0.0', clientBuildHash: 'x', platform: 'LINE_LIFF' }), /Invalid version check/);

  // Device-log outage: check still resolves (fleet log never blocks).
  const deadSvc = new VersionService(
    {
      appVersion: { findFirst: async () => ({ ...RELEASE }) },
      clientDeviceLog: { create: async () => { throw new Error('db down'); } },
    } as unknown as PrismaService,
    stubCluster(new Map([['version:latest:t', JSON.stringify(RELEASE)]])),
  );
  assert.equal((await deadSvc.evaluateClientVersion({ tenantId: 't', clientVersion: '1.4.0', clientBuildHash: 'edge-hash-9', platform: 'LINE_LIFF' })).isLatest, true);
  ok('Service edge-first/refill/echo/poison-heal/policy-coerce/fleet-log fail-open + 400');
}

// ---------- 4. Client pure units: loop guard, reload URL, check fetch ----------
{
  assert.equal(updateLoopCount(), 0);
  assert.equal(canAutoReload(), true);
  assert.equal(cacheBustedUrl('https://liff.example.com/catalog?a=1', 'hash9'), 'https://liff.example.com/catalog?a=1&_v=hash9');
  assert.equal(cacheBustedUrl('https://x.example/?_v=old', 'new'), 'https://x.example/?_v=new');

  const realFetch = globalThis.fetch;
  (globalThis as unknown as { fetch: unknown }).fetch = async () => ({
    ok: true,
    json: async () => ({ isLatest: false, needsForceUpdate: true, latestVersion: '2.0.0', latestBuildHash: 'h2h2h2h2', updatePolicy: 'FORCE_IMMEDIATE' }),
  });
  const res = await checkForUpdate({ tenantId: 't', clientVersion: '1.0.0', clientBuildHash: 'oldoldold', platform: 'LINE_LIFF' });
  assert.equal(res?.needsForceUpdate, true);
  (globalThis as unknown as { fetch: unknown }).fetch = async () => ({ ok: false, json: async () => null });
  assert.equal(await checkForUpdate({ tenantId: 't', clientVersion: '1.0.0', clientBuildHash: 'oldoldold', platform: 'LINE_LIFF' }), null);
  (globalThis as unknown as { fetch: unknown }).fetch = async () => { throw new Error('offline'); };
  assert.equal(await checkForUpdate({ tenantId: 't', clientVersion: '1.0.0', clientBuildHash: 'oldoldold', platform: 'LINE_LIFF' }), null);
  (globalThis as unknown as { fetch: unknown }).fetch = realFetch;
  ok('Client loop guard + cache-bust URL + check happy/HTTP-fail/offline');
}

// ---------- 5. SW update channel: noop off-platform, filtered fan-out ----------
{
  resetUpdateChannelForTests();
  const noop = registerUpdateChannel(() => { throw new Error('must not fire'); });
  noop();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const listeners = new Map<string, Array<(e: MessageEvent) => void>>();
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      serviceWorker: {
        addEventListener: (t: string, fn: (e: MessageEvent) => void) => { listeners.set(t, [...(listeners.get(t) ?? []), fn]); },
        removeEventListener: (t: string, fn: (e: MessageEvent) => void) => { listeners.set(t, (listeners.get(t) ?? []).filter((f) => f !== fn)); },
      },
    },
  });
  resetUpdateChannelForTests();
  const seen: unknown[] = [];
  const unregister = registerUpdateChannel((info) => { seen.push(info); });
  const fire = (data: unknown) => { for (const fn of listeners.get('message') ?? []) fn({ data } as MessageEvent); };
  fire({ type: 'OTHER' });
  fire(null);
  fire({ type: 'VERSION_RELEASED', version: '2.0.0', buildHash: 'h2' });
  assert.deepEqual(seen, [{ version: '2.0.0', buildHash: 'h2' }]);
  unregister();
  fire({ type: 'VERSION_RELEASED', version: '3.0.0' });
  assert.equal(seen.length, 1);
  if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
  resetUpdateChannelForTests();
  ok('SW channel noop without SW; filters noise; unregisters cleanly');
}

// ---------- 6. Wiring + checker/UI parity (Gates 1-6) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of ['model AppVersion', 'model ClientDeviceLog', 'clientDeviceLogs', '@@index([tenantId, isActive])', '@@index([tenantId, clientVersion])']) {
    assert.ok(prisma.includes(t), `prisma missing ${t}`);
  }
  const mod = readFileSync('apps/backend/src/modules/version/version.module.ts', 'utf8');
  assert.ok(mod.includes('VersionService') && mod.includes('VersionController'));
  assert.ok(readFileSync('apps/backend/src/app.module.ts', 'utf8').includes('VersionModule'));
  const ctlSrc = readFileSync('apps/backend/src/modules/version/version.controller.ts', 'utf8');
  for (const t of ['api/v1/version', "'check'", '@HttpCode', 'OK', 'x-forwarded-for']) {
    assert.ok(ctlSrc.includes(t), `controller missing ${t}`);
  }
  for (const [f, marker] of [
    ['apps/backend/src/modules/version/dto/check-version.dto.ts', "from '@repo/shared'"],
    ['apps/backend/src/modules/version/dto/create-version.dto.ts', 'AppVersionSchema'],
  ] as Array<[string, string]>) {
    assert.ok(readFileSync(f, 'utf8').includes(marker), `${f} missing ${marker}`);
  }

  const checker = readFileSync('apps/frontend/components/updater/AutoUpdateChecker.tsx', 'utf8');
  for (const t of ['LIFF_INIT', 'IDLE', 'LOADING', 'SUCCESS', 'ERROR', 'visibilitychange', 'registerUpdateChannel', 'purgeServiceWorkers', 'clearAllCaches', '_v', 'canAutoReload', 'เวอร์ชันใหม่พร้อมใช้งานแล้ว', 'อัปเดตทันที']) {
    assert.ok(checker.includes(t), `checker missing ${t}`);
  }
  assert.ok(!checker.includes("from '@line/liff'"), 'RAM guard: no static SDK import');
  const sw = readFileSync('apps/frontend/service-workers/sw-update-handler.ts', 'utf8');
  assert.ok(sw.includes('VERSION_RELEASED') && sw.includes('serviceWorker'));
  const layout = readFileSync('apps/frontend/app/(liff)/layout.tsx', 'utf8');
  assert.ok(layout.includes('AutoUpdateChecker') && layout.includes('NEXT_PUBLIC_APP_VERSION'));
  const mw = readFileSync('apps/frontend/middleware.ts', 'utf8');
  assert.ok(mw.includes("'/api/v1/version/check'"));
  const proxy = readFileSync('apps/frontend/app/api/v1/version/check/route.ts', 'utf8');
  assert.ok(proxy.includes('/api/v1/version/check') && proxy.includes('no-cache'));
  ok('Prisma/module wired; controller/DTO parity; checker 5-state + purge + loop guard; layout/middleware/proxy');
}

console.log(`\nPhase 033 contracts: ${passed} checks passed`);
}

void main();
