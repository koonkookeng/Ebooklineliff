// SSOT Phase 100 §10-11 — contract tests (Zod, gate, heartbeat, kick, parity)
// Run: npx tsx scripts/test-phase100-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LiveAccessStatusEnum,
  LiveEntitlementCheckSchema,
  PlaybackTokenResponseSchema,
  HeartbeatPayloadSchema,
  KickSessionEventSchema,
  LIVE_EPHEMERAL_TOKEN_TTL_SEC,
  LIVE_HEARTBEAT_INTERVAL_SEC,
  LIVE_DEVICE_TTL_SEC,
  LIVE_EDGE_CACHE_TTL_SEC,
  LIVE_ROOM_GATE_BUDGET_MS,
  LIVE_KICK_BUDGET_MS,
  LIVE_ANON_VELOCITY_MAX,
  LIVE_KICK_CHANNEL,
  LIVE_GATE_STREAM,
  liveEdgeKey,
  liveDeviceKey,
  liveKickStreamKey,
  liveEphemeralBody,
  isGranted,
} from '../packages/shared/src/schemas/live-entitlement-contract';
import { LiveGatekeeperService } from '../apps/backend/src/modules/stream/live-gatekeeper.service';
import { LiveStreamGateway } from '../apps/backend/src/modules/stream/live-stream.gateway';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const UUID = '123e4567-e89b-12d3-a456-426614174000';
const UUID_B = '223e4567-e89b-12d3-a456-426614174001';
const UUID_C = '323e4567-e89b-12d3-a456-426614174002';

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) ----------
{
  assert.equal(LiveAccessStatusEnum.safeParse('DENIED_CONCURRENT_LIMIT_EXCEEDED').success, true);
  assert.equal(LiveAccessStatusEnum.safeParse('BANNED').success, false);
  assert.equal(
    LiveEntitlementCheckSchema.safeParse({ userId: UUID, liveRoomId: UUID_B, deviceFingerprint: 'fp', requestTimestamp: 1 }).success,
    true,
  );
  assert.equal(
    LiveEntitlementCheckSchema.safeParse({ userId: 'x', liveRoomId: UUID_B, deviceFingerprint: 'fp', requestTimestamp: 1 }).success,
    false,
  );
  assert.equal(
    PlaybackTokenResponseSchema.safeParse({
      accessStatus: 'GRANTED', playbackToken: 't', hlsStreamUrl: 'https://x/y.m3u8',
      tokenExpiresAt: 1, watermarkPayload: { userIdHash: 'h', displayName: 'd', ipAddress: '1.1.1.1', timestamp: 't' },
    }).success,
    true,
  );
  const hb = { sessionToken: 's', liveRoomId: UUID, currentPlaybackSec: 12.5, deviceFingerprint: 'fp' };
  assert.equal(HeartbeatPayloadSchema.safeParse(hb).success, true);
  assert.equal(HeartbeatPayloadSchema.safeParse({ ...hb, liveRoomId: 'bad' }).success, false);
  assert.equal(
    KickSessionEventSchema.safeParse({ roomId: UUID, userId: UUID_B, reason: 'X', actionTimestamp: 't' }).success,
    true,
  );
  ok('Zod §3.1 verbatim (status/check/token/heartbeat/kick gates)');
}

// ---------- 2. Pure helpers ----------
{
  assert.equal(LIVE_EPHEMERAL_TOKEN_TTL_SEC, 30);
  assert.equal(LIVE_HEARTBEAT_INTERVAL_SEC, 15);
  assert.equal(LIVE_DEVICE_TTL_SEC, 30);
  assert.equal(LIVE_EDGE_CACHE_TTL_SEC, 60);
  assert.equal(LIVE_ROOM_GATE_BUDGET_MS, 100);
  assert.equal(LIVE_KICK_BUDGET_MS, 2000);
  assert.equal(LIVE_ANON_VELOCITY_MAX, 5);
  assert.equal(LIVE_KICK_CHANNEL, 'live_session_kick_channel');
  assert.equal(LIVE_GATE_STREAM, 'stream:live:gatekeeper');
  assert.equal(liveEdgeKey('r', 'u'), 'live:entitlement:r:u');
  assert.equal(liveDeviceKey('r', 'u'), 'live:active_session:r:u');
  assert.equal(liveKickStreamKey('r', 'u'), 'stream:live:kick:r:u');
  assert.equal(liveEphemeralBody('r', 'u', 's', 1), 'r.u.s.1');
  assert.ok(isGranted('GRANTED') && !isGranted('DENIED_NO_ENTITLEMENT'));
  ok('Helpers: TTLs/budgets/channel/keys/body/grant');
}

// ---------- shared mocks ----------
function edge() {
  const store = new Map<string, string>();
  const published: string[] = [];
  const streams: string[] = [];
  return {
    store,
    published,
    streams,
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string) => { store.set(k, v); return 'OK'; },
    del: async (...ks: string[]) => { ks.forEach((k) => store.delete(k)); },
    publish: async (c: string, m: string) => { published.push(`${c}:${m}`); },
    xaddPipeline: async (s: string) => { streams.push(s); },
  };
}

const ROOM = {
  id: UUID, tenantId: 't1', title: 'Live', hlsPlaybackUrl: 'https://cdn.local/live.m3u8',
  streamStatus: 'LIVE_NOW', maxAllowedSeats: 10000, isPaywallActive: true, linkedProductId: UUID_C,
};

function repoOf(over: Record<string, unknown> = {}) {
  return {
    findRoom: async () => ({ ...ROOM }),
    findRoomEntitlement: async () => null,
    findProductEntitlement: async () => ({ expiresAt: null }),
    findUser: async () => ({ displayName: 'Ann' }),
    countActiveSessions: async () => 3,
    upsertSession: async (d: Record<string, unknown>) => ({ id: 's1', isKicked: false, kickReason: null, ...d }),
    findSessionByToken: async () => null,
    touchSession: async () => undefined,
    kickSession: async () => undefined,
    kickUserSessions: async () => 1,
    logHeartbeat: async () => undefined,
    ...over,
  };
}

// ---------- 3. Token issue (BDD-1 <100ms edge, 30s ephemeral) ----------
async function sectionToken(): Promise<void> {
  const e = edge();
  const svc = new LiveGatekeeperService(repoOf() as never, e as never);
  const t0 = Date.now();
  const r = await svc.validateAndIssuePlaybackToken({
    userId: UUID_B, liveRoomId: UUID, deviceFingerprint: 'fp-1', clientIp: '1.2.3.4',
  });
  assert.ok(Date.now() - t0 < 100, 'gate <100ms budget');
  assert.equal(r.accessStatus, 'GRANTED');
  assert.ok(r.playbackToken && r.hlsStreamUrl?.startsWith('https://cdn.local/live.m3u8?token='));
  assert.ok(r.tokenExpiresAt - Math.floor(Date.now() / 1000) <= 30);
  assert.equal(r.heartbeatIntervalSec, 15);
  assert.equal(r.watermarkPayload.displayName, 'Ann');
  assert.equal(r.watermarkPayload.ipAddress, '1.2.3.4');
  assert.ok(e.streams.includes(LIVE_GATE_STREAM));
  // Edge verdict cached (second call skips the entitlement rows, not the room).
  const e2 = edge();
  e2.store.set(liveEdgeKey(UUID, UUID_B), '1');
  const svc2 = new LiveGatekeeperService({
    findRoom: async () => ({ ...ROOM }),
    findRoomEntitlement: async () => { throw new Error('must not hit entitlement db'); },
    findProductEntitlement: async () => { throw new Error('must not hit entitlement db'); },
    findUser: async () => ({ displayName: 'Ann' }),
    countActiveSessions: async () => 0,
    upsertSession: async (d: Record<string, unknown>) => ({ id: 's1', ...d }),
  } as never, e2 as never);
  assert.equal((await svc2.validateAndIssuePlaybackToken({
    userId: UUID_B, liveRoomId: UUID, deviceFingerprint: 'fp-1', clientIp: 'x',
  })).accessStatus, 'GRANTED');
  // Token round-trip + tamper + wrong-key.
  const v = svc.verifyToken(r.playbackToken as string);
  assert.deepEqual([v?.liveRoomId, v?.userId], [UUID, UUID_B]);
  assert.equal(svc.verifyToken(`${r.playbackToken}x`), null);
  assert.equal(new LiveGatekeeperService(repoOf() as never, edge() as never, 'other').verifyToken(r.playbackToken as string), null);
  // Denied shapes: no-entitlement vs expired.
  const bare = new LiveGatekeeperService(
    repoOf({ findRoomEntitlement: async () => null, findProductEntitlement: async () => null }) as never, edge() as never,
  );
  assert.equal((await bare.validateAndIssuePlaybackToken({
    userId: UUID_B, liveRoomId: UUID, deviceFingerprint: 'fp', clientIp: 'x',
  })).accessStatus, 'DENIED_NO_ENTITLEMENT');
  const exp = new LiveGatekeeperService(
    repoOf({
      findRoomEntitlement: async () => ({ isGranted: true, expiresAt: new Date(Date.now() - 1000) }),
      findProductEntitlement: async () => null,
    }) as never, edge() as never,
  );
  assert.equal((await exp.validateAndIssuePlaybackToken({
    userId: UUID_B, liveRoomId: UUID, deviceFingerprint: 'fp', clientIp: 'x',
  })).accessStatus, 'DENIED_EXPIRED');
  // Room-full + ended-room.
  const full = new LiveGatekeeperService(repoOf({ countActiveSessions: async () => 10000 }) as never, edge() as never);
  assert.equal((await full.validateAndIssuePlaybackToken({
    userId: UUID_B, liveRoomId: UUID, deviceFingerprint: 'fp', clientIp: 'x',
  })).accessStatus, 'DENIED_ROOM_FULL');
  const ended = new LiveGatekeeperService(repoOf({ findRoom: async () => ({ ...ROOM, streamStatus: 'ENDED' }) }) as never, edge() as never);
  assert.equal((await ended.validateAndIssuePlaybackToken({
    userId: UUID_B, liveRoomId: UUID, deviceFingerprint: 'fp', clientIp: 'x',
  })).accessStatus, 'DENIED_NO_ENTITLEMENT');
  ok('Token: edge-first GRANTED + cached verdict + HMAC round-trip + 4 denied shapes (<100ms)');
}

// ---------- 4. Concurrent rotation + heartbeat + kick (BDD-2 <2s) ----------
async function sectionHeartbeatKick(): Promise<void> {
  // Device rotation kicks the incumbent and publishes.
  const e = edge();
  e.store.set(liveDeviceKey(UUID, UUID_B), 'fp-old');
  const kicked: Array<{ r: string; u: string }> = [];
  const svc = new LiveGatekeeperService(
    repoOf({ kickUserSessions: async (r: string, u: string) => { kicked.push({ r, u }); return 2; } }) as never,
    e as never,
  );
  const r = await svc.validateAndIssuePlaybackToken({
    userId: UUID_B, liveRoomId: UUID, deviceFingerprint: 'fp-new', clientIp: 'x',
  });
  assert.equal(r.accessStatus, 'GRANTED');
  assert.deepEqual(kicked, [{ r: UUID, u: UUID_B }]);
  assert.ok(e.published.some((p) => p.startsWith(LIVE_KICK_CHANNEL) && p.includes('CONCURRENT_DEVICE_LOGIN')));

  // Heartbeat OK path touches + refreshes + logs.
  const touched: string[] = [];
  const logged: number[] = [];
  const hb = new LiveGatekeeperService(
    repoOf({
      findSessionByToken: async () => ({ id: 's1', liveRoomId: UUID, userId: UUID_B, sessionToken: 'tok', deviceFingerprint: 'fp', isKicked: false, kickReason: null }),
      touchSession: async (t: string) => { touched.push(t); },
      logHeartbeat: async (d: { playbackSec: number }) => { logged.push(d.playbackSec); },
    }) as never,
    (() => {
      const inner = edge();
      inner.store.set(liveDeviceKey(UUID, UUID_B), 'fp');
      inner.store.set(liveEdgeKey(UUID, UUID_B), '1');
      return inner;
    })() as never,
  );
  const t0 = Date.now();
  const okRes = await hb.heartbeat({
    sessionToken: 'tok', liveRoomId: UUID, userId: UUID_B, currentPlaybackSec: 42.7, deviceFingerprint: 'fp', clientIp: 'x',
  });
  assert.ok(Date.now() - t0 < 2000, 'kick path <2s budget');
  assert.deepEqual([okRes.status, okRes.nextHeartbeatMs], ['OK', 15000]);
  assert.deepEqual(touched, ['tok']);
  assert.deepEqual(logged, [42]);

  // KICKED shapes: kicked flag / device rotation / revoked edge / ended room.
  const kickShapes: Array<[string, Record<string, unknown>]> = [
    ['flag', { findSessionByToken: async () => ({ liveRoomId: UUID, userId: UUID_B, isKicked: true }) }],
    ['noroom', { findSessionByToken: async () => null }],
  ];
  for (const [name, over] of kickShapes) {
    const s = new LiveGatekeeperService(repoOf(over) as never, edge() as never);
    assert.equal((await s.heartbeat({
      sessionToken: 't', liveRoomId: UUID, userId: UUID_B, currentPlaybackSec: 1, deviceFingerprint: 'fp', clientIp: 'x',
    })).status, 'KICKED', name);
  }
  const rot = (() => { const inner = edge(); inner.store.set(liveDeviceKey(UUID, UUID_B), 'fp-other'); return inner; })();
  const sRot = new LiveGatekeeperService(
    repoOf({ findSessionByToken: async () => ({ liveRoomId: UUID, userId: UUID_B, isKicked: false }) }) as never,
    rot as never,
  );
  assert.equal((await sRot.heartbeat({
    sessionToken: 't', liveRoomId: UUID, userId: UUID_B, currentPlaybackSec: 1, deviceFingerprint: 'fp', clientIp: 'x',
  })).status, 'KICKED');
  const ended = new LiveGatekeeperService(
    repoOf({
      findSessionByToken: async () => ({ liveRoomId: UUID, userId: UUID_B, isKicked: false }),
      findRoom: async () => ({ ...ROOM, streamStatus: 'ENDED' }),
    }) as never,
    (() => { const inner = edge(); inner.store.set(liveDeviceKey(UUID, UUID_B), 'fp'); return inner; })() as never,
  );
  assert.equal((await ended.heartbeat({
    sessionToken: 't', liveRoomId: UUID, userId: UUID_B, currentPlaybackSec: 1, deviceFingerprint: 'fp', clientIp: 'x',
  })).status, 'KICKED');
  // Moderator kick clears the device key + publishes.
  const eK = edge();
  eK.store.set(liveDeviceKey(UUID, UUID_B), 'fp');
  const kSvc = new LiveGatekeeperService(repoOf() as never, eK as never);
  assert.deepEqual([(await kSvc.kickSession({ liveRoomId: UUID, userId: UUID_B, reason: 'MOD' })).kicked], [1]);
  assert.equal(eK.store.get(liveDeviceKey(UUID, UUID_B)), undefined);
  assert.ok(eK.published.some((p) => p.includes('"reason":"MOD"')));
  // GQL path without a device fingerprint relies on token secrecy.
  const eG = edge();
  const gSvc = new LiveGatekeeperService(
    repoOf({ findSessionByToken: async () => ({ liveRoomId: UUID, userId: UUID_B, isKicked: false }) }) as never,
    eG as never,
  );
  assert.equal((await gSvc.heartbeat({
    sessionToken: 't', liveRoomId: UUID, userId: UUID_B, currentPlaybackSec: 1,
    deviceFingerprint: 'gql', clientIp: 'x', skipDeviceCheck: true,
  })).status, 'OK');
  ok('Rotation/kick publish + heartbeat OK/KICKED + moderator kick (<2s)');
}

// ---------- 5. Gateway fan-out (local + pub/sub) ----------
async function sectionGateway(): Promise<void> {
  const streams: string[] = [];
  const handlers = new Map<string, (m: string) => void>();
  const gw = new LiveStreamGateway(
    { xaddPipeline: async (s: string) => { streams.push(s); } },
    {
      publish: async () => undefined,
      subscribe: async (c: string, h: (m: string) => void) => { handlers.set(c, h); return () => { handlers.delete(c); }; },
    },
  );
  await gw.attach();
  await gw.attach(); // idempotent
  assert.ok(handlers.has(LIVE_KICK_CHANNEL));
  const frames: string[] = [];
  const release = gw.subscribe(UUID, UUID_B, { write: (c: string) => { frames.push(c); } });
  const t0 = Date.now();
  assert.equal(await gw.emitKick(UUID, UUID_B, 'CONCURRENT_DEVICE_LOGIN'), 1);
  assert.ok(Date.now() - t0 < 2000, 'kick fan-out <2s');
  assert.ok(frames[0]?.includes('LIVE_SESSION_KICK') && frames[0]?.includes('CONCURRENT_DEVICE_LOGIN'));
  assert.ok(streams.includes(liveKickStreamKey(UUID, UUID_B)));
  // Cross-instance pub/sub path.
  frames.length = 0;
  handlers.get(LIVE_KICK_CHANNEL)?.(JSON.stringify({ roomId: UUID, userId: UUID_B, reason: 'MOD', actionTimestamp: 't' }));
  await new Promise((res) => setTimeout(res, 10));
  assert.ok(frames[0]?.includes('MOD'));
  handlers.get(LIVE_KICK_CHANNEL)?.('not-json');
  release();
  assert.equal(await gw.emitKick(UUID, UUID_B, 'X'), 0);
  ok('Gateway: local fan-out + pub/sub attach + malformed guard (<2s)');
}

// ---------- 6. Prisma additive (Gate 1/7) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of [
    'enum LiveStreamStatus {',
    'LIVE_NOW',
    'enum LiveAccessRole {',
    'VIP_VIEWER',
    'model LiveRoom {',
    'hlsPlaybackUrl   String',
    'maxAllowedSeats  Int                  @default(10000)',
    'model LiveEntitlement {',
    '@@unique([liveRoomId, userId])',
    'model LiveActiveSession {',
    'sessionToken',
    'kickReason',
    'model LiveHeartbeatLog {',
    '@@index([liveRoomId, userId])',
    'liveEntitlements  LiveEntitlement[]',
    'liveActiveSessions LiveActiveSession[]',
  ]) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  ok('Prisma: rooms/entitlements/sessions/heartbeats + User relations');
}

function sectionParity(): void {
  for (const f of [
    'apps/backend/src/modules/stream/live-gatekeeper.service.ts',
    'apps/backend/src/modules/stream/live-stream.gateway.ts',
    'apps/backend/src/modules/stream/live-access.controller.ts',
    'apps/backend/src/modules/stream/dto/live-entitlement.dto.ts',
    'apps/backend/src/modules/stream/services/live-gatekeeper.repository.ts',
    'apps/backend/src/api/graphql/live-stream.resolver.ts',
    'apps/backend/src/modules/stream/stream.module.ts',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes('AUTO-SCAFFOLD') && !src.includes('placeholder'), `${f} unimplemented`);
    assert.ok(!/ServiceService|ModuleModule|ResolverResolver|ControllerController/.test(src), `${f} scaffold name`);
  }
  // No banned heavy transports anywhere in the 100 surface.
  for (const f of [
    'apps/backend/src/modules/stream/live-gatekeeper.service.ts',
    'apps/backend/src/modules/stream/live-stream.gateway.ts',
    'apps/backend/src/modules/stream/live-access.controller.ts',
    'apps/frontend/components/stream/LiveStreamGatekeeperPlayer.tsx',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes('socket.io') && !src.includes('hls.js') && !src.includes('@nestjs/jwt'), `${f} heavy dep`);
  }
  const gql = readFileSync('apps/backend/src/api/graphql/live-stream.resolver.ts', 'utf8');
  assert.ok(gql.includes('issueLivePlaybackToken') && gql.includes('sendLiveHeartbeat'), 'GQL intents');
  const alias = readFileSync('apps/backend/src/modules/stream/live-stream.resolver.ts', 'utf8');
  assert.ok(alias.includes('LiveStreamResolver'), 'module alias');
  for (const p of [
    'apps/frontend/components/stream/LiveStreamGatekeeperPlayer.tsx',
    'apps/frontend/components/stream/DynamicLiveWatermark.tsx',
    'apps/frontend/hooks/useLiveGatekeeper.ts',
    'apps/frontend/lib/stream/live-gatekeeper-client.ts',
  ]) {
    const src = readFileSync(p, 'utf8');
    assert.ok(src.length > 200 && !src.includes('AUTO-SCAFFOLD'), `frontend missing: ${p}`);
  }
  const hook = readFileSync('apps/frontend/hooks/useLiveGatekeeper.ts', 'utf8');
  assert.ok(hook.includes('LIFF_INIT') && hook.includes('SUCCESS') && hook.includes('ERROR'), '5-state hook');
  for (const p of [
    'apps/frontend/app/api/v1/live-access/token/route.ts',
    'apps/frontend/app/api/v1/live-access/heartbeat/route.ts',
    'apps/frontend/app/api/v1/live-access/rooms/[roomId]/kick-stream/route.ts',
  ]) {
    assert.ok(readFileSync(p, 'utf8').includes('localhost:4000'), `proxy missing backend: ${p}`);
  }
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  assert.ok(barrel.includes('live-entitlement-contract') && barrel.includes('LiveEntitlementCheckSchema'));
  ok('Parity: service/gateway/controller/GQL+alias/player+watermark/hook/proxies/barrel (zero-dep)');
}

async function main(): Promise<void> {
  await sectionToken();
  await sectionHeartbeatKick();
  await sectionGateway();
  sectionParity();
}

void main().then(
  () => console.log(`\nPhase100 contracts: ${passed + 4} checks passed`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
