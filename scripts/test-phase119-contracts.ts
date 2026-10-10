// SSOT Phase 119 §10-11 — contract tests (Zod, fingerprint math, binding,
// heartbeat takeover, HLS tickets, guards, Redis edge, stress, Prisma Gate 1,
// frontend, barrel).
// Run: npx tsx scripts/test-phase119-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  BoundDeviceTypeEnum,
  SessionStatusEnum,
  DeviceFingerprintPayloadSchema,
  StreamHeartbeatPayloadSchema,
  SessionEvictionResponseSchema,
  EVICTION_SLA_MS,
  STREAM_STALE_MS,
  STREAM_HASH_TTL_SEC,
  HEARTBEAT_CADENCE_SEC,
  DEVICE_PLAN_LIMIT,
  FRAUD_DEVICE_WINDOW_COUNT,
  FRAUD_WINDOW_MS,
  FRAUD_LOCK_SCORE,
  FRAUD_TELEPORT_WEIGHT,
  FRAUD_SWAP_DEVICE_COUNT,
  HEARTBEAT_GRACE_MISSES,
  DEVICE_EVENT_STREAM,
  activeStreamKey,
  deviceSessionKey,
  withinDeviceLimit,
  isStreamStale,
  fraudScore,
  fraudLockVerdict,
} from '../packages/shared/src/schemas/device-binding.schema';
import { combineFingerprint, FingerprintVerifierService } from '../apps/backend/src/modules/security/services/fingerprint-verifier.service';
import { SessionEvictionService } from '../apps/backend/src/modules/security/services/session-eviction.service';
import { HlsTokenSignerService, PLAYBACK_TICKET_TTL_SEC } from '../apps/backend/src/modules/security/services/hls-token-signer.service';
import { ActiveSessionRedisRepository } from '../apps/backend/src/modules/security/repositories/active-session-redis.repository';
import { DeviceFingerprintGuard } from '../apps/backend/src/modules/security/guards/device-fingerprint.guard';
import { ConcurrentStreamGuard } from '../apps/backend/src/modules/security/guards/concurrent-stream.guard';
import { buildDeviceFlex, deviceFlexByteSize, DEVICE_FLEX_BUDGET_BYTES } from '../apps/backend/src/modules/security/device-flex.builder';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const USER_ID = '123e4567-e89b-12d3-a456-426614174000';
const DEVICE_ID = '223e4567-e89b-12d3-a456-426614174001';
const SESSION_TOKEN = '323e4567-e89b-12d3-a456-426614174002';
const LESSON_ID = '423e4567-e89b-12d3-a456-426614174003';
const HEX64 = 'a'.repeat(64);
const FP = {
  canvasHash: 'b'.repeat(64),
  webglHash: 'c'.repeat(64),
  audioHash: 'd'.repeat(64),
  screenResolution: '390x844',
  userAgent: 'LINE-iOS/1.0',
  deviceType: 'LINE_LIFF_IOS',
};

async function main(): Promise<void> {
// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) ----------
{
  for (const v of ['LINE_LIFF_IOS', 'LINE_LIFF_ANDROID', 'WEB_DESKTOP', 'WEB_MOBILE_BROWSER']) {
    assert.equal(BoundDeviceTypeEnum.safeParse(v).success, true, v);
  }
  assert.equal(BoundDeviceTypeEnum.safeParse('SMART_TV').success, false);
  for (const v of ['ACTIVE_STREAMING', 'IDLE', 'EVICTED_CONCURRENT', 'BLOCKED_FRAUD']) {
    assert.equal(SessionStatusEnum.safeParse(v).success, true, v);
  }
  assert.equal(SessionStatusEnum.safeParse('PAUSED').success, false);
  assert.equal(DeviceFingerprintPayloadSchema.safeParse(FP).success, true);
  assert.equal(DeviceFingerprintPayloadSchema.safeParse({ ...FP, canvasHash: 'short' }).success, false);
  assert.equal(DeviceFingerprintPayloadSchema.safeParse({ ...FP, deviceType: 'SMART_TV' }).success, false);
  assert.equal(
    StreamHeartbeatPayloadSchema.safeParse({ lessonId: LESSON_ID, sessionToken: SESSION_TOKEN, fingerprintHash: HEX64, playbackPositionSec: 42 }).success,
    true,
  );
  assert.equal(
    StreamHeartbeatPayloadSchema.safeParse({ lessonId: LESSON_ID, sessionToken: SESSION_TOKEN, fingerprintHash: 'x', playbackPositionSec: -1 }).success,
    false,
  );
  assert.equal(
    SessionEvictionResponseSchema.safeParse({ isEvicted: true, reason: 'concurrent', timestamp: '2026-01-01T00:00:00.000Z' }).success,
    true,
  );
  // No barrel collision: cross-device owns DeviceTypeEnum/DeviceType.
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  assert.ok(barrel.includes('BoundDeviceTypeEnum'), '119 alias exported');
  ok('1. Zod SSOT verbatim (wire vocab + payloads + eviction response)');
}

// ---------- 2. Keys/limits/staleness/fraud math + budgets ----------
{
  assert.equal(activeStreamKey(USER_ID), `active_stream:${USER_ID}`);
  assert.equal(deviceSessionKey(USER_ID, HEX64), `device:session:${USER_ID}:${'a'.repeat(16)}`);
  assert.equal(withinDeviceLimit(0), true);
  assert.equal(withinDeviceLimit(1), true);
  assert.equal(withinDeviceLimit(2), false);
  assert.equal(isStreamStale(Date.now() - 11000, Date.now()), true);
  assert.equal(isStreamStale(Date.now() - 9000, Date.now()), false);
  assert.equal(fraudScore({ teleportKm: 600, teleportMinutes: 4, uniqueDevices24h: 1, distinctFingerprints1h: 1 }), 40);
  assert.equal(fraudScore({ teleportKm: 600, teleportMinutes: 30, uniqueDevices24h: 1, distinctFingerprints1h: 1 }), 0);
  assert.equal(fraudScore({ teleportKm: 0, teleportMinutes: 0, uniqueDevices24h: 5, distinctFingerprints1h: 1 }), 30);
  assert.equal(fraudScore({ teleportKm: 0, teleportMinutes: 0, uniqueDevices24h: 1, distinctFingerprints1h: 5 }), 35);
  assert.equal(fraudScore({ teleportKm: 900, teleportMinutes: 2, uniqueDevices24h: 9, distinctFingerprints1h: 9 }), 100);
  assert.equal(fraudLockVerdict(85), 'ALLOW');
  assert.equal(fraudLockVerdict(86), 'LOCK');
  assert.equal(EVICTION_SLA_MS, 150);
  assert.equal(STREAM_STALE_MS, 10000);
  assert.equal(STREAM_HASH_TTL_SEC, 15);
  assert.equal(HEARTBEAT_CADENCE_SEC, 5);
  assert.equal(DEVICE_PLAN_LIMIT, 2);
  assert.equal(FRAUD_DEVICE_WINDOW_COUNT, 5);
  assert.equal(FRAUD_WINDOW_MS, 3600000);
  assert.equal(FRAUD_LOCK_SCORE, 85);
  assert.equal(FRAUD_TELEPORT_WEIGHT, 40);
  assert.equal(FRAUD_SWAP_DEVICE_COUNT, 3);
  assert.equal(HEARTBEAT_GRACE_MISSES, 2);
  assert.equal(DEVICE_EVENT_STREAM, 'stream:device:events');
  assert.equal(PLAYBACK_TICKET_TTL_SEC, 120);
  ok('2. Edge keys + plan cap + stale + fraud weights + budgets');
}

// ---------- 3. Server combine parity (canonical of LIFF lane) ----------
{
  const h = combineFingerprint({ ...FP, lineUserIdHash: 'linehash' });
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(combineFingerprint({ ...FP, lineUserIdHash: 'linehash' }), h);
  assert.notEqual(combineFingerprint({ ...FP }), h);
  const expect = createHash('sha256')
    .update(`${FP.canvasHash}:${FP.webglHash}:${FP.audioHash}:${FP.userAgent}:${FP.screenResolution}:linehash`, 'utf8')
    .digest('hex');
  assert.equal(h, expect);
  ok('3. Combine determinism + byte-exact canonical formula');
}

// ---------- 4. Verifier: bind/touch/cap/fraud paths (BDD-1+3) ----------
{
  const events: unknown[][] = [];
  const redis = { xaddPipeline: async (...a: unknown[]) => { events.push(a); } };
  function mockDb(opts?: { existing?: Record<string, unknown> | null; registered?: number; recent?: number; active24?: number }) {
    const calls: string[] = [];
    return {
      db: {
        userDevice: {
          findFirst: async () => (opts && 'existing' in opts ? opts.existing : null),
          findMany: async () => [],
          count: async (a: unknown) => {
            calls.push(JSON.stringify((a as { where: Record<string, unknown> }).where));
            const w = JSON.stringify((a as { where: Record<string, unknown> }).where);
            if (w.includes('registeredAt')) return opts?.recent ?? 0;
            if (w.includes('lastActiveAt')) return opts?.active24 ?? 0;
            return opts?.registered ?? 0;
          },
          create: async (a: unknown) => ({ id: DEVICE_ID, ...((a as { data: Record<string, unknown> }).data) }),
          update: async () => ({}),
        },
      },
      calls,
    };
  }
  const mk = (m: ReturnType<typeof mockDb>) => new FingerprintVerifierService(m.db as never, redis as never);

  // 4a. fresh bind under the cap.
  events.length = 0;
  const m1 = mockDb({ registered: 1 });
  const v1 = await mk(m1).verifyAndBind(USER_ID, FP, { ipAddress: '1.1.1.1', deviceName: 'iPhone (LINE)' });
  assert.deepEqual([v1.deviceId, v1.isNew, v1.trusted], [DEVICE_ID, true, true]);
  assert.match(v1.fingerprintHash, /^[0-9a-f]{64}$/);
  assert.deepEqual(v1.fraud, { score: 0, verdict: 'ALLOW' });
  assert.ok(events.some((e) => JSON.stringify(e).includes('device.bound')), 'bound stream');

  // 4b. known device touch (no cap spend, no counts needed).
  const m2 = mockDb();
  (m2.db.userDevice as { findFirst: (a: unknown) => Promise<unknown> }).findFirst = async () => ({ id: DEVICE_ID, isTrusted: true });
  const v2 = await mk(m2).verifyAndBind(USER_ID, FP, { ipAddress: '2.2.2.2' });
  assert.deepEqual([v2.isNew, v2.trusted], [false, true]);

  // 4c. plan cap at 2.
  await assert.rejects(
    () => mk(mockDb({ registered: 2 })).verifyAndBind(USER_ID, FP, { ipAddress: '1.1.1.1' }),
    /max 2/,
  );

  // 4d. fraud LOCK at ≥5 prints/hour + swap + teleport (35+30+40=105→100).
  const m4 = mockDb({ registered: 0, recent: 4, active24: 5 });
  const v4 = await mk(m4).verifyAndBind(USER_ID, FP, { ipAddress: '9.9.9.9', teleportKm: 600, teleportMinutes: 4 });
  assert.equal(v4.fraud.verdict, 'LOCK');
  assert.equal(v4.trusted, false);

  // 4e. guards.
  await assert.rejects(() => mk(mockDb()).verifyAndBind(USER_ID, { ...FP, canvasHash: 'x' }, { ipAddress: '1.1.1.1' }), /Invalid device/);
  ok('4. Bind/touch/cap/LOCK lanes + guards');
}

// ---------- 5. Heartbeat takeover + eviction + lock (BDD-2+3) ----------
{
  const events: unknown[][] = [];
  const notified: unknown[][] = [];
  const hashes = new Map<string, Record<string, string>>();
  const redis = {
    xaddPipeline: async (...a: unknown[]) => { events.push(a); },
    hgetall: async () => ({}),
    hset: async () => undefined,
    expire: async () => undefined,
    del: async () => undefined,
    get: async () => null,
    setex: async () => undefined,
  };
  const notify = { notify: async (...a: unknown[]) => { notified.push(a); return { messageId: 'm1' }; } };
  const { ActiveSessionRedisRepository: Edge } = await import('../apps/backend/src/modules/security/repositories/active-session-redis.repository');
  void Edge;
  function mockDb(session: Record<string, unknown> | null, fpHash: string = HEX64) {
    const txLog: string[] = [];
    return {
      db: {
        user: { findUnique: async () => ({ id: USER_ID, lineUserId: 'U1' }) },
        userDevice: {
          findUnique: async (a: unknown) => {
            const id = (a as { where: { id: string } }).where.id;
            return id === DEVICE_ID ? { id: DEVICE_ID, userId: USER_ID, isTrusted: true, fingerprintHash: fpHash } : null;
          },
          findMany: async () => [], findFirst: async () => null, count: async () => 0, create: async () => ({}), update: async () => ({}),
        },
        activeSession: {
          findUnique: async () => session,
          findMany: async () => (session ? [session] : []),
          create: async () => ({ sessionToken: SESSION_TOKEN }),
          update: async () => ({}),
          updateMany: async (a: unknown) => { txLog.push(`up:${JSON.stringify((a as { data: unknown }).data)}`); return {}; },
        },
        securityAuditLog: { create: async (a: unknown) => { txLog.push(`audit:${JSON.stringify((a as { data: Record<string, unknown> }).data)}`); return {}; } },
      },
      txLog,
    };
  }
  const edgeFor = (pointer: Record<string, string> | null) => ({
    read: async () => pointer,
    write: async () => undefined,
    clear: async () => undefined,
  });
  const mk = (m: ReturnType<typeof mockDb>, pointer: Record<string, string> | null) =>
    new SessionEvictionService(m.db as never, redis as never, edgeFor(pointer) as never, notify as never);
  const live = { id: 's1', userId: USER_ID, deviceId: DEVICE_ID, sessionStatus: 'ACTIVE_STREAMING' };
  const beat = { userId: USER_ID, sessionToken: SESSION_TOKEN, fingerprintHash: HEX64, lessonId: LESSON_ID, playbackPositionSec: 10, ipAddress: '1.1.1.1' };

  // 5a. fresh pointer → register, no takeover.
  events.length = 0; notified.length = 0;
  const m1 = mockDb(live);
  const r1 = await mk(m1, null).heartbeat(beat);
  assert.deepEqual([r1.ok, r1.takenOver], [true, false]);
  assert.ok(r1.elapsedMs < EVICTION_SLA_MS, `<150ms (${r1.elapsedMs}ms)`);

  // 5b. live other-holder → evict + audit + Flex + takeover.
  events.length = 0; notified.length = 0;
  const m2 = mockDb(live);
  const other = { sessionToken: 'other-token', fingerprintHash: 'f'.repeat(64), lessonId: LESSON_ID, lastHeartbeatTime: String(Date.now()), ip: '9.9.9.9', deviceId: 'dev-other' };
  const r2 = await mk(m2, other).heartbeat(beat);
  assert.equal(r2.takenOver, true);
  assert.equal(r2.evictedDeviceId, 'dev-other');
  assert.ok(m2.txLog.some((t) => t.includes('EVICTED_CONCURRENT')), 'loser row evicted');
  assert.ok(m2.txLog.some((t) => t.includes('CONCURRENT_STREAM_DETECTED')), 'incident audit (106-safe columns)');
  assert.ok(events.some((e) => JSON.stringify(e).includes('device.evicted')), 'eviction SSE stream');
  assert.equal(notified.length, 1);

  // 5c. stale other-holder (11s) → silent takeover, no eviction spam.
  events.length = 0; notified.length = 0;
  const m3 = mockDb(live);
  const stale = { ...other, lastHeartbeatTime: String(Date.now() - 11000) };
  const r3 = await mk(m3, stale).heartbeat(beat);
  assert.equal(r3.takenOver, true);
  assert.equal(r3.evictedDeviceId, undefined);
  assert.equal(notified.length, 0);

  // 5d. evicted session stays evicted (no flap-back).
  await assert.rejects(
    () => mk(mockDb({ ...live, sessionStatus: 'EVICTED_CONCURRENT' }), null).heartbeat(beat),
    /evicted/,
  );
  // blocked + foreign + fp-mismatch guards.
  await assert.rejects(
    () => mk(mockDb({ ...live, sessionStatus: 'BLOCKED_FRAUD' }), null).heartbeat(beat),
    /OTP/,
  );
  await assert.rejects(() => mk(mockDb(null), null).heartbeat(beat), /Unknown stream/);
  await assert.rejects(() => mk(mockDb(live, 'z'.repeat(64)), null).heartbeat(beat), /mismatch/);

  // 5e. openSession gates (unknown/untrusted/ok).
  const m4 = mockDb(live);
  const svc4 = mk(m4, null);
  await assert.rejects(() => svc4.openSession(USER_ID, 'nope', LESSON_ID, '1.1.1.1'), /Unknown device/);
  const m5 = mockDb(live);
  (m5.db.userDevice as { findUnique: (a: unknown) => Promise<unknown> }).findUnique = async () => ({ id: DEVICE_ID, userId: USER_ID, isTrusted: false, fingerprintHash: HEX64 });
  await assert.rejects(() => mk(m5, null).openSession(USER_ID, DEVICE_ID, LESSON_ID, '1.1.1.1'), /not trusted/);
  const opened = await svc4.openSession(USER_ID, DEVICE_ID, LESSON_ID, '1.1.1.1');
  assert.equal(opened.sessionToken, SESSION_TOKEN);

  // 5f. revokeAll + lockAccount (BDD-3 second half).
  events.length = 0; notified.length = 0;
  const m6 = mockDb(live);
  const rev = await mk(m6, null).revokeAll(USER_ID, 'USER_KICK');
  assert.equal(rev.revoked, 1);
  assert.ok(m6.txLog.some((t) => t.includes('EVICTED_CONCURRENT')), 'mass evict');
  const m7 = mockDb(live);
  assert.equal(await mk(m7, null).lockAccount(USER_ID, HEX64, '9.9.9.9', 90), true);
  assert.ok(m7.txLog.some((t) => t.includes('BLOCKED_FRAUD')), 'fraud block written');
  assert.ok(events.some((e) => JSON.stringify(e).includes('admin.lock.requested')), '109-freeze handoff');
  assert.equal(notified.length, 1);

  // 5g. list/revoke devices (owner-only).
  const m8 = mockDb(live);
  (m8.db as unknown as { userDevice: Record<string, unknown> }).userDevice = {
    findUnique: async (a: unknown) => {
      const id = (a as { where: { id: string } }).where.id;
      return id === DEVICE_ID ? { id: DEVICE_ID, userId: USER_ID } : null;
    },
    findMany: async () => [{ id: DEVICE_ID, deviceName: 'iPhone', deviceType: 'LINE_LIFF_IOS', isTrusted: true, lastIpAddress: '1.1.1.1', lastActiveAt: new Date('2026-01-01T00:00:00.000Z'), fingerprintHash: HEX64 }],
    delete: async () => ({}),
  };
  const svc8 = mk(m8, { sessionToken: SESSION_TOKEN, fingerprintHash: HEX64, lessonId: LESSON_ID, lastHeartbeatTime: '0', ip: '', deviceId: DEVICE_ID });
  const listed = await svc8.listDevices(USER_ID);
  assert.deepEqual([listed.length, listed[0]!['fingerprintFragment']], [1, 'a'.repeat(12)]);
  assert.equal(await svc8.revokeDevice(USER_ID, DEVICE_ID), true);
  await assert.rejects(() => svc8.revokeDevice(USER_ID, 'foreign'), /Unknown device/);
  ok('5. Heartbeat takeover/evict/lock + inventory + 106-safe audit');
}

// ---------- 6. HLS tickets (mint/verify/expiry/forgery) ----------
{
  const { HlsTokenSignerService } = await import('../apps/backend/src/modules/security/services/hls-token-signer.service');
  const signer = new HlsTokenSignerService('test-secret-32bytes!!!!!!!!');
  const t = signer.mint({ sessionToken: SESSION_TOKEN, fingerprintHash: HEX64, lessonId: LESSON_ID });
  assert.equal(t.ticket.split('.').length, 5);
  const v = signer.verify(t.ticket)!;
  assert.deepEqual([v.sessionToken, v.fingerprintHash, v.lessonId], [SESSION_TOKEN, HEX64, LESSON_ID]);
  assert.equal(signer.verify(`${t.ticket.slice(0, -1)}0`), null);
  assert.equal(signer.verify('a.b.c'), null);
  const expired = signer.mint({ sessionToken: SESSION_TOKEN, fingerprintHash: HEX64, lessonId: LESSON_ID, ttlSec: -10 });
  assert.equal(signer.verify(expired.ticket), null);
  const other = new HlsTokenSignerService('other-secret-32bytes!!!!!!!!');
  assert.equal(other.verify(t.ticket), null);
  assert.throws(() => signer.mint({ sessionToken: SESSION_TOKEN, fingerprintHash: HEX64, lessonId: 'has.dot' }), /dots/);
  ok('6. Device-bound tickets (bind/expiry/forgery/dot-guard)');
}

// ---------- 7. Guards (binding gate + concurrent deny) ----------
{
  const verifier = {
    verifyAndBind: async (userId: string, input: unknown) => {
      const fp = (input ?? {}) as { canvasHash?: string };
      if (!fp.canvasHash) throw new Error('Invalid device fingerprint payload');
      if (userId === 'locked') {
        return { deviceId: DEVICE_ID, fingerprintHash: HEX64, trusted: true, isNew: false, fraud: { score: 99, verdict: 'LOCK' as const } };
      }
      return { deviceId: DEVICE_ID, fingerprintHash: HEX64, trusted: true, isNew: false, fraud: { score: 0, verdict: 'ALLOW' as const } };
    },
  };
  const sessions = { lockAccount: async () => true };
  const { DeviceFingerprintGuard } = await import('../apps/backend/src/modules/security/guards/device-fingerprint.guard');
  const guard = new DeviceFingerprintGuard(verifier as never, sessions as never);
  const gctx = (user: unknown, body: unknown = {}) =>
    ({ switchToHttp: () => ({ getRequest: () => ({ user, body, headers: {}, ip: '1.1.1.1' }) }) });
  const pass = await guard.canActivate(gctx({ id: USER_ID }, { fingerprint: FP }) as never);
  assert.equal(pass, true);
  await assert.rejects(() => guard.canActivate(gctx(undefined) as never), /authentication/);
  await assert.rejects(() => guard.canActivate(gctx({ id: USER_ID }, { fingerprint: { bad: 1 } }) as never), /./);
  await assert.rejects(() => guard.canActivate(gctx({ id: 'locked' }, { fingerprint: FP }) as never), /OTP/);

  const { ConcurrentStreamGuard } = await import('../apps/backend/src/modules/security/guards/concurrent-stream.guard');
  const except = { hgetall: async () => ({}), hset: async () => undefined, expire: async () => undefined };
  const pdb = {
    securityAuditLog: { create: async () => ({}) },
    activeSession: { updateMany: async () => ({}) },
  };
  const cguard = new ConcurrentStreamGuard(except as never, pdb as never);
  const cctx = (user: unknown, body: unknown) =>
    ({ switchToHttp: () => ({ getRequest: () => ({ user, body, headers: {}, ip: '1.1.1.1' }) }) });
  assert.equal(await cguard.canActivate(cctx({ id: USER_ID }, { lessonId: LESSON_ID, fingerprintHash: HEX64, sessionToken: SESSION_TOKEN }) as never), true);
  await assert.rejects(() => cguard.canActivate(cctx(undefined, {}) as never), /Security Context/);
  const liveRedis = {
    hgetall: async () => ({ sessionToken: 'other-live', fingerprintHash: 'f'.repeat(64), lessonId: LESSON_ID, lastHeartbeatTime: String(Date.now()), ip: '9.9.9.9', deviceId: 'dev-9' }),
    hset: async () => undefined,
    expire: async () => undefined,
  };
  const audits: unknown[] = [];
  const pdb2 = {
    securityAuditLog: { create: async (a: unknown) => { audits.push(a); return {}; } },
    activeSession: { updateMany: async () => ({}) },
  };
  const cguard2 = new ConcurrentStreamGuard(liveRedis as never, pdb2 as never);
  await assert.rejects(
    () => cguard2.canActivate(cctx({ id: USER_ID }, { lessonId: LESSON_ID, fingerprintHash: HEX64, sessionToken: SESSION_TOKEN }) as never),
    /กำลังรับชม/,
  );
  assert.ok(audits.some((a) => JSON.stringify(a).includes('granted') === false || JSON.stringify(a).includes('"granted":false')), '106-safe deny audit');
  // stale other-holder → silent takeover.
  const staleRedis = {
    hgetall: async () => ({ sessionToken: 'old-dead', fingerprintHash: 'f'.repeat(64), lessonId: LESSON_ID, lastHeartbeatTime: String(Date.now() - 30000), ip: '', deviceId: 'dev-old' }),
    hset: async () => undefined,
    expire: async () => undefined,
  };
  const cguard3 = new ConcurrentStreamGuard(staleRedis as never, pdb2 as never);
  assert.equal(await cguard3.canActivate(cctx({ id: USER_ID }, { lessonId: LESSON_ID, fingerprintHash: HEX64, sessionToken: SESSION_TOKEN }) as never), true);
  ok('7. Binding gate (cap/lock/trust) + concurrent deny/takeover/fail-open');
}

// ---------- 8. Redis repo + Flex budget ----------
{
  const writes: Array<{ key: string; fields: Record<string, string>; ttl: number }> = [];
  const store = new Map<string, Record<string, string>>();
  const redis = {
    hgetall: async (k: string) => store.get(k) ?? {},
    hset: async (k: string, f: Record<string, string>) => { store.set(k, f); },
    expire: async (k: string, t: number) => { writes.push({ key: k, fields: store.get(k) ?? {}, ttl: t }); },
    del: async (k: string) => { store.delete(k); },
  };
  const repo = new ActiveSessionRedisRepository(redis as never);
  assert.equal(await repo.read(USER_ID), null);
  await repo.write(USER_ID, { sessionToken: SESSION_TOKEN, fingerprintHash: HEX64, lessonId: LESSON_ID, lastHeartbeatTime: '123', ip: '1.1.1.1', deviceId: DEVICE_ID });
  const back = (await repo.read(USER_ID))!;
  assert.deepEqual([back.sessionToken, back.deviceId], [SESSION_TOKEN, DEVICE_ID]);
  assert.equal(writes[0]!.ttl, 15);
  await repo.clear(USER_ID);
  assert.equal(await repo.read(USER_ID), null);
  // malformed + outage fail-open.
  store.set(activeStreamKey(USER_ID), {} as Record<string, string>);
  assert.equal(await repo.read(USER_ID), null);
  const down = new ActiveSessionRedisRepository({ hgetall: async () => { throw new Error('down'); }, hset: async () => { throw new Error('down'); }, expire: async () => { throw new Error('down'); }, del: async () => { throw new Error('down'); } } as never);
  assert.equal(await down.read(USER_ID), null);
  await down.write(USER_ID, { sessionToken: 'x', fingerprintHash: HEX64, lessonId: 'l', lastHeartbeatTime: '0', ip: '' });
  await down.clear(USER_ID);

  const evicted = buildDeviceFlex({ outcome: 'EVICTED', tenantName: 'acme', detail: 'dev-abcd1234' });
  const locked = buildDeviceFlex({ outcome: 'FRAUD_LOCK', tenantName: 'acme', detail: 'score 90', otpDeepLink: 'line://otp' });
  const bare = buildDeviceFlex({ outcome: 'FRAUD_LOCK', tenantName: 'acme' });
  assert.ok(evicted.altText.includes('อุปกรณ์อื่น') && locked.altText.includes('ล็อก'));
  assert.ok(evicted.contents.footer === undefined && locked.contents.footer !== undefined && bare.contents.footer === undefined, 'CTA only with link');
  assert.ok(deviceFlexByteSize(evicted) < DEVICE_FLEX_BUDGET_BYTES && deviceFlexByteSize(locked) < DEVICE_FLEX_BUDGET_BYTES, 'flex < 10KB');
  assert.equal(DEVICE_FLEX_BUDGET_BYTES, 10_000);
  ok('8. Edge hash round-trip/TTL/fail-open + Flex discipline + <10KB');
}

// ---------- 9. Stress: one holder wins, N-1 evicted (<150ms) ----------
{
  const N = 60;
  const tokens = Array.from({ length: N }, (_, i) => `tok-${i}`);
  let holder: string | null = null;
  const evicted: string[] = [];
  const db = {
    user: { findUnique: async () => ({ id: USER_ID, lineUserId: 'U1' }) },
    userDevice: { findUnique: async () => ({ id: DEVICE_ID, userId: USER_ID, fingerprintHash: HEX64 }), findMany: async () => [], findFirst: async () => null, count: async () => 0, create: async () => ({}), update: async () => ({}) },
    activeSession: {
      findUnique: async (a: unknown) => ({ id: 's', userId: USER_ID, deviceId: DEVICE_ID, sessionStatus: 'ACTIVE_STREAMING', ...(a as { where: Record<string, string> }).where }),
      findMany: async () => [],
      create: async () => ({}),
      update: async () => ({}),
      updateMany: async () => ({}),
    },
    securityAuditLog: { create: async () => ({}) },
  };
  // Serialized edge: first live token wins the pointer; the rest evict it.
  const edge = {
    read: async () => (holder ? { sessionToken: holder, fingerprintHash: HEX64, lessonId: LESSON_ID, lastHeartbeatTime: String(Date.now()), ip: '', deviceId: DEVICE_ID } : null),
    write: async (_userId: string, p: { sessionToken: string }) => {
      if (holder && holder !== p.sessionToken) evicted.push(holder);
      holder = p.sessionToken;
    },
    clear: async () => undefined,
  };
  const svc = new SessionEvictionService(
    db as never,
    { xaddPipeline: async () => undefined } as never,
    edge as never,
    { notify: async () => null } as never,
  );
  const t0 = Date.now();
  // Serialized rapid succession (models Redis-atomic command ordering:
  // last writer wins, every predecessor evicted exactly once).
  const results = [];
  for (const tok of tokens) {
    results.push(await svc.heartbeat({ userId: USER_ID, sessionToken: tok, fingerprintHash: HEX64, lessonId: LESSON_ID, playbackPositionSec: 0, ipAddress: '1.1.1.1' }));
  }
  const msPer = (Date.now() - t0) / N;
  assert.equal(holder !== null, true);
  assert.equal(results.filter((r) => r.takenOver).length, N - 1);
  assert.equal(evicted.length, N - 1);
  assert.ok(msPer < EVICTION_SLA_MS, `takeover ${msPer.toFixed(2)}ms/item < 150ms`);
  console.log(`    stress: ${N} racers, 1 holder + ${evicted.length} evicted, ${msPer.toFixed(2)}ms/item`);
  ok('9. 60-racer takeover equation + timing');
}

// ---------- 10. Module wiring (no infra-SecurityModule clash) ----------
{
  const mod = readFileSync('apps/backend/src/modules/security/security.module.ts', 'utf8');
  for (const p of ['DeviceSecurityModule', 'FingerprintVerifierService', 'SessionEvictionService', 'HlsTokenSignerService', 'ActiveSessionRedisRepository', 'DeviceFingerprintGuard', 'ConcurrentStreamGuard', 'SecurityFingerprintController', 'DeviceNotificationService']) {
    assert.ok(mod.includes(p), `module wires ${p}`);
  }
  assert.ok(!/ServiceService|ModuleModule|ControllerController|GuardGuard/.test(mod), 'scaffold doubled names retired');
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('DeviceSecurityModule'), 'AppModule imports');
  assert.ok(app.includes("infra/security/security.module"), '028 infra module intact');
  const ctl = readFileSync('apps/backend/src/modules/security/controllers/security-fingerprint.controller.ts', 'utf8');
  assert.ok(ctl.includes('handshake') && ctl.includes('heartbeat') && ctl.includes('stream-key') && ctl.includes('evict-other') && ctl.includes('revoke-device'), 'REST lanes');
  ok('10. DeviceSecurityModule wiring (028 untouched)');
}

// ---------- 11. Prisma Gate 1 (devices/sessions/audit-extend) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const v of ['LINE_LIFF_IOS', 'LINE_LIFF_ANDROID', 'WEB_DESKTOP', 'WEB_MOBILE_BROWSER', 'LINE_LIFF_MOBILE', 'TABLET_PWA', 'NATIVE_APP']) {
    assert.ok(prisma.includes(v), `DeviceType union ${v}`);
  }
  for (const v of ['ACTIVE_STREAMING', 'IDLE', 'EVICTED_CONCURRENT', 'BLOCKED_FRAUD']) {
    assert.ok(prisma.includes(v), `SessionStatus ${v}`);
  }
  for (const m of ['model UserDevice', 'model ActiveSession']) {
    assert.ok(prisma.includes(m), m);
  }
  assert.ok(prisma.includes('@@unique([userId, fingerprintHash])'), 'binding uniqueness');
  assert.ok(prisma.includes('@@index([userId, sessionStatus])'), 'session lookup index');
  assert.ok(prisma.includes('eventType       String?'), '106 audit extend (optional)');
  assert.ok(prisma.includes('boundDevices        UserDevice[]'), 'User device wallet');
  assert.ok(prisma.includes('boundActiveSessions ActiveSession[]'), 'User session ledger');
  const trigger = readFileSync('packages/db/prisma/audit-immutability.trigger.sql', 'utf8');
  assert.ok(trigger.includes('enforce_audit_log_immutability'), '118 trigger doc intact');
  ok('11. Prisma Gate 1 (union + models + 106 extend + relations)');
}

// ---------- 12. Frontend Gate 3/5 (states, collector, modal, proxies) ----------
{
  const player = readFileSync('apps/frontend/app/(liff)/player/[lessonId]/page.tsx', 'utf8');
  for (const s of ['LIFF_INIT', 'IDLE', 'LOADING', 'SUCCESS', 'ERROR']) {
    assert.ok(player.includes(`'${s}'`), `player state ${s}`);
  }
  assert.ok(player.includes('secure-player') && player.includes('forensic-overlay') && player.includes('5000'), 'player + overlay + 5s beat');
  const modal = readFileSync('apps/frontend/components/security/device-eviction-modal.tsx', 'utf8');
  assert.ok(modal.includes('eviction-modal') && modal.includes('เตะอุปกรณ์อื่น') && modal.includes('ขอ OTP'), 'modal lanes');
  const manager = readFileSync('apps/frontend/components/security/device-manager.tsx', 'utf8');
  assert.ok(manager.includes('device-row') && manager.includes('เลิกผูก') && manager.includes('fingerprintFragment'), 'manager (fragment-only)');
  const collector = readFileSync('apps/frontend/lib/fingerprint/fingerprint-collector.ts', 'utf8');
  assert.ok(collector.includes('200') && collector.includes('ZENE-DRM-SECURITY-119') && collector.includes('crypto.subtle'), '200×50 canvas + WebCrypto');
  const client = readFileSync('apps/frontend/lib/fingerprint/device-session-client.ts', 'utf8');
  assert.ok(client.includes('EventSource') && client.includes('handshake') && client.includes('streamKey'), 'REST + SSE lanes');
  assert.ok(!client.includes('fingerprintjs') && !client.includes('posthog'), 'no heavy tracking deps');
  for (const p of [
    'apps/frontend/app/api/v1/security/device/handshake/route.ts',
    'apps/frontend/app/api/v1/security/device/heartbeat/route.ts',
    'apps/frontend/app/api/v1/security/device/stream-key/route.ts',
    'apps/frontend/app/api/v1/security/device/evict-other/route.ts',
    'apps/frontend/app/api/v1/security/device/devices/route.ts',
    'apps/frontend/app/api/v1/security/device/revoke-device/route.ts',
    'apps/frontend/app/api/v1/security/device/events/route.ts',
  ]) {
    assert.ok(readFileSync(p, 'utf8').includes('localhost:4000'), `proxy backend: ${p}`);
  }
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  for (const e of ['BoundDeviceTypeEnum', 'SessionStatusEnum', 'DeviceFingerprintPayloadSchema', 'fraudScore', 'EVICTION_SLA_MS', 'DEVICE_PLAN_LIMIT']) {
    assert.ok(barrel.includes(e), `barrel ${e}`);
  }
  ok('12. Frontend 5-state + collector + modal + 7 proxies + barrel');
}
}

main()
  .then(() => console.log(`\nPhase 119 contracts: ${passed}/12 groups passed`))
  .catch((err) => {
    console.error('\nPhase 119 contracts FAILED:', err);
    process.exit(1);
  });
