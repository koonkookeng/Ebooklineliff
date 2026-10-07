// SSOT Phase 031 §10 — contract tests (Zod, entity, use-case, repo, UI wiring)
// Run: npx tsx scripts/test-phase031-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ViewportTypeEnum,
  EbookKeepAliveStateSchema,
  VideoKeepAliveStateSchema,
  CheckoutKeepAliveStateSchema,
  KeepAliveSyncPayloadSchema,
  KeepAliveStatusEnum,
  KEEPALIVE_TTL_SEC,
  KEEPALIVE_SAVE_INTERVAL_MS,
  REHYDRATE_BUDGET_MS,
  KEEPALIVE_DB,
  KEEPALIVE_STORE,
  KEEPALIVE_CHANNEL,
  keepAliveKey,
  keepAliveRedisKey,
  pickViewportState,
} from '../packages/shared/src/schemas/keep-alive-contract';
import { KeepAliveState, KEEPALIVE_STATE_MAX_BYTES } from '../apps/backend/src/modules/keep-alive/domain/keep-alive.entity';
import { syncViewportState, latestViewportState } from '../apps/backend/src/modules/keep-alive/application/sync-state.usecase';
import { KeepAliveRedisRepository } from '../apps/backend/src/infra/redis/keep-alive-redis.repository';
import { KeepAliveService } from '../apps/backend/src/modules/keep-alive/keep-alive.service';
import type { PrismaService } from '../apps/backend/src/infra/database/prisma.service';
import type { RedisClusterService } from '../apps/backend/src/infra/redis/redis-cluster.service';
import { snapshotSizeBytes, releaseBlobUrls, measureRehydrate, KEEPALIVE_STATE_MAX_BYTES as CLIENT_MAX } from '../apps/frontend/lib/keep-alive/keep-alive-client';
// NOTE: KeepAliveResolver/Controller use Nest parameter decorators (@Args/@Body)
// which tsx/esbuild cannot transform — verified via static source parity (§8)
// following the Phase 027–030 precedent.

let passed = 0;
function ok(name: string) {
  passed++;
  console.log(`  ✓ ${name}`);
}

const EBOOK = { productId: 'p-1', currentPage: 42, scrollOffsetTop: 120, zoomScale: 1 };
const VIDEO = { lessonId: 'l-1', playedSeconds: 765, playbackRate: 1.5, volume: 0.8 };
const CHECKOUT = { orderId: 'o-1', step: 'SLIP_UPLOAD', expiresAt: new Date(Date.now() + 900000).toISOString() };

// ---------- 1. Zod viewport states + sync payload + machine (§3.1/§2.2) ----------
{
  for (const t of ['EBOOK_READER', 'VIDEO_PLAYER', 'CHECKOUT_FORM', 'CATALOG_DISCOVERY']) {
    assert.equal(ViewportTypeEnum.safeParse(t).success, true);
  }
  assert.equal(EbookKeepAliveStateSchema.safeParse(EBOOK).success, true);
  assert.equal(EbookKeepAliveStateSchema.safeParse({ ...EBOOK, currentPage: 0 }).success, false);
  assert.equal(EbookKeepAliveStateSchema.safeParse({ ...EBOOK, productId: '' }).success, false);
  assert.equal(VideoKeepAliveStateSchema.safeParse(VIDEO).success, true);
  assert.equal(VideoKeepAliveStateSchema.safeParse({ ...VIDEO, volume: 2 }).success, false);
  assert.equal(CheckoutKeepAliveStateSchema.safeParse(CHECKOUT).success, true);
  assert.equal(CheckoutKeepAliveStateSchema.safeParse({ ...CHECKOUT, step: 'DONE' }).success, false);
  assert.equal(CheckoutKeepAliveStateSchema.safeParse({ ...CHECKOUT, draftSlipBase64: 'x'.repeat(700001) }).success, false);
  assert.equal(CheckoutKeepAliveStateSchema.safeParse({ ...CHECKOUT, draftSlipBase64: 'aGVsbG8=' }).success, true);

  const payload = { userId: 'u', tenantId: 't', viewportType: 'EBOOK_READER', timestamp: 1700000000, ebookState: EBOOK };
  assert.equal(KeepAliveSyncPayloadSchema.safeParse(payload).success, true);
  assert.equal(KeepAliveSyncPayloadSchema.safeParse({ ...payload, userId: '' }).success, false);
  for (const s of ['LIFF_INIT', 'ACTIVE', 'BACKGROUND_PRESERVED', 'HYDRATING', 'ERROR_FALLBACK']) {
    assert.equal(KeepAliveStatusEnum.safeParse(s).success, true);
  }
  assert.equal(KEEPALIVE_TTL_SEC, 900);
  assert.equal(KEEPALIVE_SAVE_INTERVAL_MS, 2000);
  assert.equal(REHYDRATE_BUDGET_MS, 150);
  assert.equal(KEEPALIVE_DB, 'zene-keepalive');
  assert.equal(KEEPALIVE_STORE, 'viewport_states');
  assert.equal(KEEPALIVE_CHANNEL, 'liff.app_switch');
  assert.equal(keepAliveKey('EBOOK_READER', 'p-1'), 'viewport:EBOOK_READER:p-1');
  assert.equal(keepAliveRedisKey('u', 't', 'VIDEO_PLAYER'), 'keepalive:u:t:VIDEO_PLAYER');
  const parsed = KeepAliveSyncPayloadSchema.parse(payload);
  assert.deepEqual(pickViewportState(parsed), { ...EBOOK, scrollOffsetTop: 120, zoomScale: 1 });
  assert.equal(pickViewportState({ ...parsed, viewportType: 'VIDEO_PLAYER' }), null);
  ok('Zod states/caps/datetime + sync payload + 5-state + keys/channels/budget');
}

// ---------- 2. Entity invariants (Gate 5 budget) ----------
{
  const e = KeepAliveState.create({ userId: 'u', tenantId: 't', viewportType: 'EBOOK_READER', stateJson: EBOOK, timestamp: 1 });
  assert.equal(e.props.viewportType, 'EBOOK_READER');
  assert.throws(() => KeepAliveState.create({ userId: '', tenantId: 't', viewportType: 'EBOOK_READER', stateJson: {}, timestamp: 1 }), /identity/);
  assert.throws(() => KeepAliveState.create({ userId: 'u', tenantId: 't', viewportType: 'NOPE' as never, stateJson: {}, timestamp: 1 }), /viewport/);
  assert.throws(() => KeepAliveState.create({ userId: 'u', tenantId: 't', viewportType: 'EBOOK_READER', stateJson: {}, timestamp: -1 }), /timestamp/);
  assert.throws(
    () => KeepAliveState.create({ userId: 'u', tenantId: 't', viewportType: 'EBOOK_READER', stateJson: { pad: 'x'.repeat(KEEPALIVE_STATE_MAX_BYTES + 1) }, timestamp: 1 }),
    /32KB/,
  );
  assert.equal(KEEPALIVE_STATE_MAX_BYTES, 32768);
  assert.equal(CLIENT_MAX, KEEPALIVE_STATE_MAX_BYTES);
  ok('Entity identity/vocab/timestamp/32KB guards + client mirror constant');
}

function stubCluster(store: Map<string, string> = new Map(), published: Array<{ c: string; m: string }> = []): RedisClusterService {
  return {
    get: async (k: string) => store.get(k) ?? null,
    setex: async (k: string, _t: number, v: string) => { store.set(k, v); },
    del: async (k: string) => { store.delete(k); },
    publish: async (c: string, m: string) => { published.push({ c, m }); },
  } as unknown as RedisClusterService;
}

function portsWith(over: { row?: { stateJson: unknown; lastActiveAt: Date } | null; store?: Map<string, string>; published?: Array<{ c: string; m: string }>; warnings?: string[]; upserted?: unknown[] }) {
  const store = over.store ?? new Map<string, string>();
  const published = over.published ?? [];
  const warnings = over.warnings ?? [];
  const upserted = over.upserted ?? [];
  return {
    ports: {
      upsert: async (args: { whereUser: string; tenantId: string; viewportType: string; stateJson: unknown }) => {
        upserted.push(args);
        return { lastActiveAt: new Date('2026-01-02T00:00:00.000Z') };
      },
      findLatest: async () => over.row ?? null,
      cacheSet: async (u: string, t: string, v: string, s: string) => { store.set(`keepalive:${u}:${t}:${v}`, s); },
      cacheGet: async (u: string, t: string, v: string) => store.get(`keepalive:${u}:${t}:${v}`) ?? null,
      publish: async (c: string, m: string) => { published.push({ c, m }); },
      warn: (m: string) => { warnings.push(m); },
    },
    store, published, warnings, upserted,
  };
}

async function main(): Promise<void> {
// ---------- 3. Use-case: sync happy/400s + latest edge/DB/miss ----------
{
  const ctx = portsWith({});
  const out = await syncViewportState(ctx.ports, { userId: 'u', tenantId: 't', viewportType: 'EBOOK_READER', timestamp: 5, ebookState: EBOOK });
  assert.equal(out.success, true);
  assert.equal(out.restoredTimestamp, '2026-01-02T00:00:00.000Z');
  assert.deepEqual((ctx.upserted[0] as { whereUser: string }).whereUser, 'u');
  assert.ok((ctx.store.get('keepalive:u:t:EBOOK_READER') ?? '').includes('"currentPage":42'));
  assert.ok((ctx.published[0].m as string).includes('liff.app_switch_out'));

  await assert.rejects(() => syncViewportState(ctx.ports, { userId: '', tenantId: 't', viewportType: 'EBOOK_READER', timestamp: 5, ebookState: EBOOK }), /Invalid keep-alive sync/);
  await assert.rejects(() => syncViewportState(ctx.ports, { userId: 'u', tenantId: 't', viewportType: 'VIDEO_PLAYER', timestamp: 5, ebookState: EBOOK }), /branch missing/);
  await assert.rejects(
    () => syncViewportState(ctx.ports, { userId: 'u', tenantId: 't', viewportType: 'EBOOK_READER', timestamp: 5, ebookState: { ...EBOOK, currentPage: -2 } }),
    /Invalid keep-alive sync/,
  );

  const edge = portsWith({ store: new Map([['keepalive:u:t:VIDEO_PLAYER', JSON.stringify(VIDEO)]]) });
  const hit = await latestViewportState(edge.ports, 'u', 't', 'VIDEO_PLAYER');
  assert.equal(hit.success, true);
  assert.deepEqual((hit.stateJson as typeof VIDEO).playedSeconds, 765);

  const corrupt = portsWith({ store: new Map([['keepalive:u:t:VIDEO_PLAYER', 'bad{{{']]), row: { stateJson: VIDEO, lastActiveAt: new Date('2026-03-01T00:00:00.000Z') } });
  const healed = await latestViewportState(corrupt.ports, 'u', 't', 'VIDEO_PLAYER');
  assert.equal(healed.success, true);
  assert.equal(healed.restoredTimestamp, '2026-03-01T00:00:00.000Z');

  const miss = portsWith({ row: null });
  const none = await latestViewportState(miss.ports, 'u', 't', 'CHECKOUT_FORM');
  assert.equal(none.success, false);
  assert.equal(none.stateJson, null);
  await assert.rejects(() => latestViewportState(miss.ports, '', 't', 'EBOOK_READER'), /identity/);
  ok('Use-case sync persists+caches+publishes; 400s; latest edge/corrupt-heal/miss');
}

// ---------- 4. Redis repo: key/CRUD/publish + fail-open ----------
{
  const repo = new KeepAliveRedisRepository(stubCluster());
  assert.equal(repo.key('u', 't', 'EBOOK_READER'), 'keepalive:u:t:EBOOK_READER');
  await repo.set('u', 't', 'EBOOK_READER', '{"page":42}');
  assert.equal(await repo.get('u', 't', 'EBOOK_READER'), '{"page":42}');
  await repo.del('u', 't', 'EBOOK_READER');
  assert.equal(await repo.get('u', 't', 'EBOOK_READER'), null);
  const published: Array<{ c: string; m: string }> = [];
  const pub = new KeepAliveRedisRepository(stubCluster(new Map(), published));
  await pub.publish('liff.app_switch', '{}');
  assert.equal(published[0].c, 'liff.app_switch');
  const dead = new KeepAliveRedisRepository({
    get: async () => { throw new Error('down'); },
    setex: async () => { throw new Error('down'); },
    del: async () => { throw new Error('down'); },
    publish: async () => { throw new Error('down'); },
  } as unknown as RedisClusterService);
  assert.equal(await dead.get('u', 't', 'V'), null);
  await dead.set('u', 't', 'V', '{}');
  await dead.del('u', 't', 'V');
  await dead.publish('c', 'm');
  ok('Redis repo key/CRUD/publish + total-outage fail-open');
}

// ---------- 5. Service: HTTP semantics (400 validation, 404 unknown) ----------
{
  const prisma = {
    userLiffSessionState: {
      upsert: async () => ({ lastActiveAt: new Date('2026-01-02T00:00:00.000Z') }),
      findUnique: async () => null,
    },
  } as unknown as PrismaService;
  const svc = new KeepAliveService(prisma, new KeepAliveRedisRepository(stubCluster()));
  const okOut = await svc.syncState({ userId: 'u', tenantId: 't', viewportType: 'VIDEO_PLAYER', timestamp: 9, videoState: VIDEO });
  assert.equal(okOut.success, true);
  await assert.rejects(() => svc.syncState({ nope: true }), /Invalid keep-alive sync/);
  await assert.rejects(() => svc.latestState('u', 't', 'CHECKOUT_FORM'), /No keep-alive state found/);
  await assert.rejects(() => svc.latestState('', 't', 'EBOOK_READER'), /Missing keep-alive identity/);
  ok('Service maps validation→400, unknown row→404');
}

// ---------- 6. Client pure units: size cap, blob release, rehydrate timing ----------
{
  assert.ok(snapshotSizeBytes({ page: 42 }) < 1024);
  assert.ok(snapshotSizeBytes({ pad: 'x'.repeat(40000) }) > 32768);
  const revoked: string[] = [];
  const realRevoke = URL.revokeObjectURL;
  (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = (u: string) => { revoked.push(u); };
  const registry = new Map<unknown, string>([[1, 'blob:a'], [2, 'blob:b']]);
  assert.equal(releaseBlobUrls(registry), 2);
  assert.deepEqual(revoked, ['blob:a', 'blob:b']);
  assert.equal(registry.size, 0);
  (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = realRevoke;
  const timed = await measureRehydrate(() => 42);
  assert.equal(timed.result, 42);
  assert.ok(typeof timed.ms === 'number' && timed.ms < REHYDRATE_BUDGET_MS);
  ok('Client size gate + blob sweep + sub-150ms rehydrate measure');
}

// ---------- 7. Provider + hook source: 5-state machine, cadence, validation ----------
{
  const provider = readFileSync('apps/frontend/components/keep-alive/KeepAliveProvider.tsx', 'utf8');
  for (const t of ['LIFF_INIT', 'ACTIVE', 'BACKGROUND_PRESERVED', 'HYDRATING', 'ERROR_FALLBACK', 'visibilitychange', 'KeepAliveContext', 'useKeepAlive must be used within KeepAliveProvider']) {
    assert.ok(provider.includes(t), `provider missing ${t}`);
  }
  assert.ok(provider.includes('zene-keepalive') || provider.includes('saveViewportState'));
  const hook = readFileSync('apps/frontend/components/keep-alive/useKeepAlive.ts', 'utf8');
  for (const t of ['useViewportKeepAlive', 'KEEPALIVE_SAVE_INTERVAL_MS', 'EbookKeepAliveStateSchema', 'VideoKeepAliveStateSchema', 'CheckoutKeepAliveStateSchema', 'KEEPALIVE_STATE_MAX_BYTES', 'measureRehydrate', 'visibilitychange', 'ERROR_FALLBACK', 'release']) {
    assert.ok(hook.includes(t), `hook missing ${t}`);
  }
  assert.ok(!hook.includes("from 'idb'"), 'zero new deps: no idb import');
  ok('Provider 5-state + visibility machine; hook cadence + Zod + budget + single-point rule');
}

// ---------- 8. Component integration + layout + proxies + wiring ----------
{
  const reader = readFileSync('apps/frontend/components/reader/CanvasReader.tsx', 'utf8');
  for (const t of ['useViewportKeepAlive', 'EBOOK_READER', 'releaseBlobUrls', 'HYDRATING', 'กู้คืนหน้าจอล่าสุดสำเร็จ', 'currentPage']) {
    assert.ok(reader.includes(t), `reader missing ${t}`);
  }
  assert.ok(reader.includes('loadSlidingWindow'), 'engine logic untouched');
  const hls = readFileSync('apps/frontend/components/player/HlsVideoPlayer.tsx', 'utf8');
  for (const t of ['VIDEO_PLAYER', 'playedSeconds', 'playbackRate', '.pause()', '/api/stream/progress', 'HYDRATING', 'resumed']) {
    assert.ok(hls.includes(t), `hls shell missing ${t}`);
  }
  const checkout = readFileSync('apps/frontend/components/checkout/PromptPayCheckout.tsx', 'utf8');
  for (const t of ['CHECKOUT_FORM', 'SLIP_DRAFT_EVENT', "'ADDRESS'", "'PROMPTPAY_QR'", "'SLIP_UPLOAD'", 'expiresAt', 'promptpay-checkout']) {
    assert.ok(checkout.includes(t), `checkout shell missing ${t}`);
  }
  const layout = readFileSync('apps/frontend/app/(liff)/layout.tsx', 'utf8');
  assert.ok(layout.includes('KeepAliveProvider'));
  for (const [f, marker] of [
    ['apps/frontend/app/api/v1/keep-alive/sync/route.ts', '/api/v1/keep-alive/sync'],
    ['apps/frontend/app/api/v1/keep-alive/state/route.ts', 'Missing viewport type'],
  ] as Array<[string, string]>) {
    assert.ok(readFileSync(f, 'utf8').includes(marker), `${f} missing ${marker}`);
  }

  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of ['model UserLiffSessionState', '@@unique([userId, tenantId, viewportType])', '@@index([userId, tenantId])', '@@index([lastActiveAt])', 'liffSessionStates']) {
    assert.ok(prisma.includes(t), `prisma missing ${t}`);
  }
  const sdl = readFileSync('apps/backend/src/api/graphql/schemas/keep-alive.graphql/schema.graphql', 'utf8');
  for (const t of ['ViewportType', 'EbookStateInput', 'VideoStateInput', 'KeepAliveSyncInput', 'KeepAliveSyncResponse', 'getLatestKeepAliveState', 'syncKeepAliveState']) {
    assert.ok(sdl.includes(t), `SDL missing ${t}`);
  }
  const mod = readFileSync('apps/backend/src/modules/keep-alive/keep-alive.module.ts', 'utf8');
  for (const t of ['KeepAliveService', 'KeepAliveController', 'KeepAliveResolver', 'KeepAliveRedisRepository']) {
    assert.ok(mod.includes(t), `module missing ${t}`);
  }
  assert.ok(readFileSync('apps/backend/src/app.module.ts', 'utf8').includes('KeepAliveModule'));
  const alias = readFileSync('apps/backend/src/api/graphql/resolvers/keep-alive.resolver.ts', 'utf8');
  assert.ok(alias.includes('modules/keep-alive/keep-alive.resolver'));
  const resolverSrc = readFileSync('apps/backend/src/modules/keep-alive/keep-alive.resolver.ts', 'utf8');
  for (const t of ['getLatestKeepAliveState', 'syncKeepAliveState', 'KeepAliveSyncResponse', 'Missing keep-alive identity']) {
    assert.ok(resolverSrc.includes(t), `resolver missing ${t}`);
  }
  const ctlSrc = readFileSync('apps/backend/src/modules/keep-alive/keep-alive.controller.ts', 'utf8');
  for (const t of ['api/v1/keep-alive', "'sync'", "'state'", 'JwtAuthGuard', 'userId mismatch']) {
    assert.ok(ctlSrc.includes(t), `controller missing ${t}`);
  }
  ok('Reader/HLS/checkout keep-alive tracks; layout+proxies; Prisma/SDL/module/alias parity');
}

console.log(`\nPhase 031 contracts: ${passed} checks passed`);
}

void main();
