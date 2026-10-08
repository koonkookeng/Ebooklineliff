// SSOT Phase 070 §10-11 — contract tests (Zod, clock, state, handshake, parity)
// Run: npx tsx scripts/test-phase070-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DeviceTypeEnum,
  ContentTypeEnum,
  DeviceSessionSchema,
  CrossDeviceSyncPayloadSchema,
  SessionHandshakeQrPayloadSchema,
  CROSS_DEVICE_LATENCY_MS,
  HANDSHAKE_TTL_SEC,
  SYNC_STATE_TTL_SEC,
  MAX_ACTIVE_VIEWPORTS,
  CROSS_DEVICE_EVENT,
  crossDeviceStateKey,
  crossDeviceChannel,
  handshakeRedisKey,
  resolveCrossDeviceConflict,
} from '../packages/shared/src/schemas/cross-device-sync.schema';
import { CrossDeviceStateService } from '../apps/backend/src/modules/sync/cross-device-state.service';
import { SessionHandshakeService } from '../apps/backend/src/modules/auth/session-handshake.service';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const USER = '123e4567-e89b-12d3-a456-426614174000';
const OTHER = '223e4567-e89b-12d3-a456-426614174000';
const PRODUCT = '333e4567-e89b-12d3-a456-426614174000';

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) + clock/keys/budgets ----------
{
  assert.equal(DeviceTypeEnum.safeParse('WEB_DESKTOP').success, true);
  assert.equal(ContentTypeEnum.safeParse('COURSE_LESSON_VIDEO').success, true);
  assert.equal(
    DeviceSessionSchema.safeParse({
      sessionId: '444e4567-e89b-12d3-a456-426614174000', userId: USER, deviceType: 'LINE_LIFF_MOBILE',
      userAgent: 'LIFF', ipAddress: '1.2.3.4', lastActiveAt: new Date().toISOString(), isActive: true,
    }).success,
    true,
  );
  const payload = {
    userId: USER, productId: PRODUCT, contentType: 'EBOOK_PAGE', contentId: PRODUCT,
    positionMarker: { pageNumber: 42, vectorClock: 5 },
    sourceDevice: 'LINE_LIFF_MOBILE', timestamp: new Date().toISOString(),
  };
  assert.equal(CrossDeviceSyncPayloadSchema.safeParse(payload).success, true);
  assert.equal(
    SessionHandshakeQrPayloadSchema.safeParse({
      handshakeToken: '555e4567-e89b-12d3-a456-426614174000', lineUserId: 'line-1',
      expiresAt: new Date().toISOString(), targetRedirectUrl: 'https://app.example.com/reader/x',
    }).success,
    true,
  );
  assert.equal(CROSS_DEVICE_LATENCY_MS, 500);
  assert.equal(HANDSHAKE_TTL_SEC, 120);
  assert.equal(SYNC_STATE_TTL_SEC, 30 * 24 * 60 * 60);
  assert.equal(MAX_ACTIVE_VIEWPORTS, 2);
  assert.equal(CROSS_DEVICE_EVENT, 'position_changed');
  assert.equal(crossDeviceStateKey('u', 'p'), 'sync:state:u:p');
  assert.equal(crossDeviceChannel('u'), 'channel:cross-device:u');
  assert.equal(handshakeRedisKey('t'), 'handshake:token:t');
  // §10 spec test: clock 5 beats clock 3.
  assert.deepEqual(resolveCrossDeviceConflict(5, 3), { accept: true, conflictResolved: true, nextClock: 6 });
  assert.deepEqual(resolveCrossDeviceConflict(3, 5), { accept: false, conflictResolved: true, nextClock: 5 });
  assert.deepEqual(resolveCrossDeviceConflict(5, 5), { accept: true, conflictResolved: false, nextClock: 6 });
  ok('Zod handoff contracts verbatim + clock resolver + keys/budgets');
}

// ---------- 2. State service: BDD-1/3 push + latest ----------
function makeStatePorts() {
  const edge = new Map<string, Record<string, string>>();
  const rows = new Map<string, { vectorClock: number; lastPage: number | null; lastWatchedSec: number | null; lastDevice: string }>();
  const rooms: Array<{ channel: string; event: string }> = [];
  const streams: Array<{ key: string }> = [];
  return {
    tables: {
      crossDeviceSyncState: {
        findUnique: async ({ where }: { where: { userId_productId_contentType: { userId: string; productId: string; contentType: string } } }) => {
          const k = where.userId_productId_contentType;
          return rows.get(`${k.userId}:${k.productId}:${k.contentType}`) ?? null;
        },
        upsert: async ({ where, update, create }: { where: { userId_productId_contentType: { userId: string; productId: string; contentType: string } }; update: Record<string, unknown>; create: Record<string, unknown> }) => {
          const k = where.userId_productId_contentType;
          const key = `${k.userId}:${k.productId}:${k.contentType}`;
          const prev = rows.get(key);
          const next = prev
            ? { ...prev, lastPage: (update['lastPage'] as number | undefined) ?? prev.lastPage, lastWatchedSec: (update['lastWatchedSec'] as number | undefined) ?? prev.lastWatchedSec, vectorClock: update['vectorClock'] as number, lastDevice: update['lastDevice'] as string }
            : { vectorClock: create['vectorClock'] as number, lastPage: create['lastPage'] as number | null, lastWatchedSec: create['lastWatchedSec'] as number | null, lastDevice: create['lastDevice'] as string };
          rows.set(key, next);
          return next;
        },
      },
    },
    cache: {
      hgetall: async (k: string) => edge.get(k) ?? {},
      hset: async (k: string, f: Record<string, string>) => {
        edge.set(k, { ...(edge.get(k) ?? {}), ...f });
      },
      expire: async () => undefined,
    },
    bus: {
      publishRoom: async (channel: string, event: string) => {
        rooms.push({ channel, event });
      },
    },
    stream: {
      xaddPipeline: async (key: string) => {
        streams.push({ key });
      },
    },
    edge, rows, rooms, streams,
  };
}

const pushBody = (clock: number, page = 42) => ({
  userId: USER, productId: PRODUCT, contentType: 'EBOOK_PAGE', contentId: PRODUCT,
  positionMarker: { pageNumber: page, vectorClock: clock },
  sourceDevice: 'LINE_LIFF_MOBILE', timestamp: new Date().toISOString(),
});

async function sectionState(): Promise<void> {
  // BDD-1: push accepted, edge+DB+room fan-out.
  {
    const { tables, cache, bus, stream, edge, rows, rooms } = makeStatePorts();
    const svc = new CrossDeviceStateService(tables as never, cache, bus as never, stream);
    const res = await svc.pushPosition(USER, pushBody(1));
    assert.equal(res.ok, true);
    assert.equal(res.resolvedPosition, 42);
    assert.equal(res.vectorClock, 2);
    assert.equal(edge.get(`sync:state:${USER}:${PRODUCT}`)?.['vectorClock'], '2');
    assert.ok(rows.size === 1);
    assert.equal(rooms.length, 1);
    assert.equal(rooms[0].channel, `channel:cross-device:${USER}`);
  }
  // BDD-3: stale loses (server truth), newer wins with flag.
  {
    const { tables, cache, bus, stream } = makeStatePorts();
    const svc = new CrossDeviceStateService(tables as never, cache, bus as never, stream);
    await svc.pushPosition(USER, pushBody(5));
    const stale = await svc.pushPosition(USER, pushBody(3, 40));
    assert.equal(stale.conflictResolved, true);
    assert.equal(stale.vectorClock, 6);
    const latest = await svc.getLatest(USER, PRODUCT, 'EBOOK_PAGE');
    assert.equal((latest as { pageNumber: number }).pageNumber, 42);
    const fresh = await svc.pushPosition(USER, pushBody(9, 51));
    assert.equal(fresh.conflictResolved, true);
    assert.equal((await svc.getLatest(USER, PRODUCT, 'EBOOK_PAGE') as { pageNumber: number }).pageNumber, 51);
  }
  // Ownership: foreign userId rejected.
  {
    const { tables, cache, bus, stream } = makeStatePorts();
    const svc = new CrossDeviceStateService(tables as never, cache, bus as never, stream);
    const res = await svc.pushPosition(USER, { ...pushBody(1), userId: OTHER });
    assert.equal(res.error, 'INVALID_INPUT');
  }
  ok('State: BDD-1 push fan-out + BDD-3 clock reconcile + ownership');
}

// ---------- 3. Handshake: issue/consume/guard (§10 QR test + BDD-4) ----------
function makeHandshakePorts(recentViewports = 0) {
  const kv = new Map<string, string>();
  const audit: unknown[] = [];
  return {
    tables: {
      handshakeToken: {
        create: async (args: unknown) => {
          audit.push(args);
          return {};
        },
        findUnique: async () => null,
        update: async () => ({}),
      },
      activeDeviceSession: {
        countRecent: async () => recentViewports,
      },
    },
    cache: {
      setex: async (k: string, _t: number, v: string) => {
        kv.set(k, v);
      },
      getdel: async (k: string) => {
        const v = kv.get(k) ?? null;
        kv.delete(k);
        return v;
      },
    },
    kv, audit,
  };
}

async function sectionHandshake(): Promise<void> {
  // §10: issue → valid consume.
  {
    const { tables, cache, kv, audit } = makeHandshakePorts(0);
    const svc = new SessionHandshakeService(tables as never, cache);
    const issued = await svc.issueHandshake(USER, 'line-1', 'https://app.example.com/reader/x');
    assert.equal(issued.ok, true);
    assert.ok(issued.handshakeToken);
    assert.ok(kv.size === 1);
    assert.equal(audit.length, 1);
    const consumed = await svc.authorizeHandshake(USER, String(issued.handshakeToken), 'web-abc');
    assert.equal(consumed.ok, true);
    assert.ok(consumed.sessionFingerprint);
    // Single-use: replay fails.
    const replay = await svc.authorizeHandshake(USER, String(issued.handshakeToken), 'web-abc');
    assert.equal(replay.error, 'TOKEN_INVALID_OR_CONSUMED');
  }
  // BDD-4: third viewport rejected; foreign user rejected.
  {
    const { tables, cache } = makeHandshakePorts(2);
    const svc = new SessionHandshakeService(tables as never, cache);
    const issued = await svc.issueHandshake(USER, 'line-1', 'https://app.example.com/reader/x');
    const limited = await svc.authorizeHandshake(USER, String(issued.handshakeToken), 'web-abc');
    assert.equal(limited.error, 'DEVICE_LIMIT');
  }
  {
    const { tables, cache } = makeHandshakePorts(0);
    const svc = new SessionHandshakeService(tables as never, cache);
    const issued = await svc.issueHandshake(USER, 'line-1', 'https://app.example.com/reader/x');
    const mismatch = await svc.authorizeHandshake(OTHER, String(issued.handshakeToken), 'web-abc');
    assert.equal(mismatch.error, 'TOKEN_USER_MISMATCH');
  }
  ok('Handshake: §10 QR single-use + BDD-4 viewport guard + owner match');
}

// ---------- 4. Prisma additive ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of ['model CrossDeviceSyncState', 'model HandshakeToken', 'crossDeviceStates   CrossDeviceSyncState[]']) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  assert.ok(!prisma.includes('deviceSessions      ActiveDeviceSession'), '057 model must stay untouched');
  ok('Prisma: sync state + handshake token (additive, 057 untouched)');
}

// ---------- 5. Static parity ----------
function sectionParity(): void {
  const svc = readFileSync('apps/backend/src/modules/sync/cross-device-state.service.ts', 'utf8');
  for (const t of ['CrossDeviceStateService', 'pushPosition', 'getLatest', 'resolveCrossDeviceConflict', 'DEVICE_SWITCH_STREAM']) {
    assert.ok(svc.includes(t), `state service missing: ${t}`);
  }
  const hs = readFileSync('apps/backend/src/modules/auth/session-handshake.service.ts', 'utf8');
  assert.ok(hs.includes('SessionHandshakeService') && hs.includes('getdel') && hs.includes('MAX_ACTIVE_VIEWPORTS'));
  const res = readFileSync('apps/backend/src/modules/sync/cross-device.resolver.ts', 'utf8');
  for (const t of ['getLatestCrossDeviceState', 'generateDesktopHandshakeQr', 'syncCrossDevicePosition', 'authorizeDesktopSession']) {
    assert.ok(res.includes(t), `resolver missing: ${t}`);
  }
  const ctrl = readFileSync('apps/backend/src/modules/sync/handshake.controller.ts', 'utf8');
  assert.ok(ctrl.includes('handshake/issue') && ctrl.includes('cross-device-stream') && ctrl.includes('@Sse'));
  const mod = readFileSync('apps/backend/src/modules/sync/sync.module.ts', 'utf8');
  assert.ok(mod.includes('CrossDeviceStateService') && mod.includes('HandshakeController') && mod.includes('CrossDeviceResolver'));
  const rg = readFileSync('apps/backend/src/modules/reader/reader-sync.gateway.ts', 'utf8');
  assert.ok(rg.includes('progress-sync.gateway'));
  const sg = readFileSync('apps/backend/src/modules/stream/stream-sync.gateway.ts', 'utf8');
  assert.ok(sg.includes('progress-sync.gateway'));
  const api = readFileSync('apps/backend/src/api/graphql/sync.resolver.ts', 'utf8');
  assert.ok(api.includes('cross-device.resolver'));
  const sdl = readFileSync('apps/backend/src/api/graphql/schemas/cross-device.graphql', 'utf8');
  assert.ok(sdl.includes('syncCrossDevicePosition') && sdl.includes('onCrossDeviceStateChanged'));
  const hook = readFileSync('apps/frontend/hooks/useCrossDeviceSync.ts', 'utf8');
  for (const t of ['useCrossDeviceSync', 'EventSource', 'SUCCESS_TRANSITION', 'SYNC_ERROR_FALLBACK', 'pushPosition']) {
    assert.ok(hook.includes(t), `hook missing: ${t}`);
  }
  assert.ok(!hook.includes("from 'socket.io-client'"), 'handoff hook must not import socket.io-client');
  const toast = readFileSync('apps/frontend/components/sync/CrossDeviceSyncToast.tsx', 'utf8');
  assert.ok(toast.includes('CrossDeviceSyncToast'));
  const handoff = readFileSync('apps/frontend/components/sync/CrossDeviceHandoff.tsx', 'utf8');
  assert.ok(handoff.includes('CrossDeviceHandoff') && handoff.includes('scanHandshakeToken'));
  const qr = readFileSync('apps/frontend/components/sync/HandshakeQrButton.tsx', 'utf8');
  assert.ok(qr.includes('react-qr-code'));
  const client = readFileSync('apps/frontend/lib/cross-device/handshake-client.ts', 'utf8');
  assert.ok(client.includes('issueHandshakeQr') && client.includes('authorizeHandshake'));
  const liff = readFileSync('apps/frontend/app/(liff)/reader/[productId]/page.tsx', 'utf8');
  assert.ok(liff.includes('CrossDeviceHandoff'));
  const web = readFileSync('apps/frontend/app/(web)/reader/[productId]/page.tsx', 'utf8');
  assert.ok(web.includes('CrossDeviceHandoff') && web.includes('HandshakeQrButton'));
  for (const p of [
    'apps/frontend/app/api/v1/sync/position/route.ts',
    'apps/frontend/app/api/v1/sync/cross-device-stream/route.ts',
    'apps/frontend/app/api/v1/sync/handshake/issue/route.ts',
    'apps/frontend/app/api/v1/sync/handshake/authorize/route.ts',
  ]) {
    assert.ok(readFileSync(p, 'utf8').includes('/api/v1/sync'), `proxy missing: ${p}`);
  }
  assert.ok(readFileSync('docs/adr/ADR-070-cross-device-handoff.md', 'utf8').includes('Handoff'));
  ok('Parity: state/handshake/GQL/REST+SSE + hook/toast/handoff/QR + pages + proxies + ADR');
}

async function main(): Promise<void> {
  await sectionState();
  await sectionHandshake();
  sectionParity();
}

void main().then(
  () => console.log(`\nPhase070 contracts: ${passed + 5} checks passed`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
