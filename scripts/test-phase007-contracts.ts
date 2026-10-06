// SSOT Phase 007 §10 — contract + integration tests (QR sync core, TDD loop 3x per skill.md)
// Run: npx tsx scripts/test-phase007-contracts.ts
import assert from 'node:assert/strict';
import {
  QrSessionStatusEnum,
  InitQrSessionResponseSchema,
  ConfirmQrAuthPayloadSchema,
  QrAuthSocketBroadcastSchema,
} from '../packages/shared/src/schemas/auth-contract';
import {
  generateQrToken,
  generateNonce,
  hashNonce,
  sealEnvelope,
  openEnvelope,
  generatePin,
  hashPin,
} from '../apps/backend/src/modules/auth/qr-sync/domain/value-objects/ephemeral-nonce.vo';
import {
  canTransition,
  assertTransition,
  scoreQrRisk,
  requiresPin,
} from '../apps/backend/src/modules/auth/qr-sync/domain/entities/qr-session.entity';
import { RedisQrCacheRepository } from '../apps/backend/src/modules/auth/qr-sync/infrastructure/repositories/redis-qr-cache.repository';
import { QrAuthGateway } from '../apps/backend/src/modules/auth/qr-sync/infrastructure/gateways/qr-auth.gateway';
import { InitQrSessionUseCase } from '../apps/backend/src/modules/auth/qr-sync/application/use-cases/init-qr-session.use-case';
import { ProcessQrScanUseCase } from '../apps/backend/src/modules/auth/qr-sync/application/use-cases/process-qr-scan.use-case';
import { AuthorizeQrSessionUseCase } from '../apps/backend/src/modules/auth/qr-sync/application/use-cases/authorize-qr-session.use-case';
import { TokenService } from '../apps/backend/src/modules/auth/services/token.service';

const TID = '123e4567-e89b-12d3-a456-426614174000';
const UID = '123e4567-e89b-12d3-a456-426614174001';
let passed = 0;
function ok(name: string) {
  passed++;
  console.log(`  ✓ ${name}`);
}

// ---------- 1. Zod QR contracts ----------
{
  assert.deepEqual(QrSessionStatusEnum.options, ['PENDING', 'SCANNED', 'AUTHORIZED', 'EXPIRED', 'REJECTED']);
  assert.equal(
    InitQrSessionResponseSchema.safeParse({ qrToken: UID, encryptedNonce: 'e'.repeat(16), websocketChannel: 'qr:x' }).success,
    true,
  );
  assert.equal(
    ConfirmQrAuthPayloadSchema.safeParse({ qrToken: UID, userAccessToken: 't'.repeat(16), deviceFingerprint: 'fp', userAgent: 'ua', ipAddress: '1.2.3.4' }).success,
    true,
  );
  assert.equal(
    ConfirmQrAuthPayloadSchema.safeParse({ qrToken: 'x', userAccessToken: 't', deviceFingerprint: '', userAgent: 'u', ipAddress: 'nope' }).success,
    false,
  );
  assert.equal(
    QrAuthSocketBroadcastSchema.safeParse({ status: 'AUTHORIZED', oneTimeCode: 'c', userProfile: { id: UID, displayName: 'A', avatarUrl: null, role: 'MEMBER' } }).success,
    true,
  );
  assert.equal(QrAuthSocketBroadcastSchema.safeParse({ status: 'NOPE' }).success, false);
  ok('QR Zod contracts (status/init/confirm/broadcast) validated');
}

// ---------- 2. Nonce VO ----------
{
  const qrToken = generateQrToken();
  const nonce = generateNonce();
  assert.ok(/^[0-9a-f]{64}$/.test(nonce));
  assert.equal(hashNonce(nonce), hashNonce(nonce));
  const env = sealEnvelope({ qrToken, nonce, exp: Math.floor(Date.now() / 1000) + 60 });
  assert.deepEqual(openEnvelope(env, qrToken).nonce, nonce);
  const tampered = env.slice(0, 10) + (env[10] === 'a' ? 'b' : 'a') + env.slice(11);
  assert.throws(() => openEnvelope(tampered, qrToken), /INVALID_QR_ENVELOPE/);
  assert.throws(() => openEnvelope(env, generateQrToken()), /INVALID_QR_ENVELOPE/);
  const stale = sealEnvelope({ qrToken, nonce, exp: Math.floor(Date.now() / 1000) - 61 });
  assert.throws(() => openEnvelope(stale, qrToken), /QR_SESSION_EXPIRED/);
  const pin = generatePin();
  assert.ok(/^\d{6}$/.test(pin) && hashPin(pin) === hashPin(pin));
  ok('envelope seal/open + tamper/expiry + PIN hashing');
}

// ---------- 3. Entity transitions + risk ----------
{
  assert.ok(canTransition('PENDING', 'SCANNED') && canTransition('PENDING', 'AUTHORIZED'));
  assert.ok(canTransition('SCANNED', 'AUTHORIZED') && !canTransition('SCANNED', 'PENDING'));
  assert.ok(!canTransition('AUTHORIZED', 'SCANNED') && !canTransition('EXPIRED', 'PENDING'));
  assert.throws(() => assertTransition('AUTHORIZED', 'SCANNED'), /INVALID_QR_TRANSITION/);
  assert.equal(scoreQrRisk({ desktopIp: '1.1.1.1', mobileIp: '1.1.1.1', fingerprintKnown: true, attempts: 0 }), 0);
  assert.equal(scoreQrRisk({ desktopIp: '1.1.1.1', mobileIp: '2.2.2.2', fingerprintKnown: false, attempts: 0 }), 85);
  assert.equal(scoreQrRisk({ desktopIp: '1.1.1.1', mobileIp: '2.2.2.2', fingerprintKnown: false, attempts: 3 }), 100);
  assert.ok(!requiresPin(79) && requiresPin(80));
  ok('state machine guards + risk scoring + PIN threshold');
}

// ---------- 4. Use-case integration (fakes) ----------
interface FakeUser { id: string; displayName: string; avatarUrl: string | null; role: string; lineUserId: string | null; email: string | null }
function buildFakes007() {
  const store = new Map<string, { v: string; exp: number }>();
  const published: Array<{ ch: string; msg: string }> = [];
  const redis = {
    get: async (k: string) => {
      const e = store.get(k);
      if (!e || e.exp < Date.now()) {
        store.delete(k);
        return null;
      }
      return e.v;
    },
    setex: async (k: string, t: number, v: string) => { store.set(k, { v, exp: Date.now() + t * 1000 }); },
    getdel: async (k: string) => {
      const e = store.get(k);
      store.delete(k);
      if (!e || e.exp < Date.now()) return null;
      return e.v;
    },
    setnx: async (k: string, v: string, t: number) => {
      if (store.has(k)) return false;
      store.set(k, { v, exp: Date.now() + t * 1000 });
      return true;
    },
    set: async (k: string, v: string, _ex: string, t: number, nx: string) => {
      if (nx === 'NX' && store.has(k)) return null;
      store.set(k, { v, exp: Date.now() + t * 1000 });
      return 'OK';
    },
    del: async (k: string) => { store.delete(k); },
    publish: async (ch: string, msg: string) => { published.push({ ch, msg }); },
    subscribe: async () => () => {},
  };
  const users = new Map<string, FakeUser>([[UID, { id: UID, displayName: 'QR User', avatarUrl: null, role: 'MEMBER', lineUserId: 'U_QR', email: null }]]);
  const qrRows: Array<Record<string, unknown>> = [];
  const deviceRows: Array<Record<string, unknown>> = [];
  const sessionRows: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];
  let sessionSeq = 0;
  const prisma = {
    tenant: {
      findUnique: async (args: { where: { id: string } }) =>
        args.where.id === TID ? { id: TID, isActive: true, lineChannelId: 'CH' } : null,
    },
    qrSessionNonce: {
      create: async (args: { data: Record<string, unknown> }) => { qrRows.push(args.data); return args.data; },
      updateMany: async (args: { where: Record<string, string>; data: Record<string, unknown> }) => {
        let count = 0;
        for (const r of qrRows) {
          if (args.where.qrToken !== undefined && r['qrToken'] !== args.where.qrToken) continue;
          Object.assign(r, args.data);
          count++;
        }
        return { count };
      },
    },
    user: {
      findUnique: async (args: { where: { id: string } }) => users.get(args.where.id) ?? null,
    },
    userDeviceSession: {
      findFirst: async (args: { where: Record<string, string> }) =>
        deviceRows.find((d) => d['userId'] === args.where.userId && d['deviceFingerprint'] === args.where.deviceFingerprint) ?? null,
      create: async (args: { data: Record<string, unknown> }) => { deviceRows.push(args.data); return args.data; },
    },
    session: {
      create: async (args: { data: Record<string, unknown> }) => {
        sessionSeq++;
        const s = { id: `sess-${sessionSeq}`, ...args.data };
        sessionRows.push(s);
        return s;
      },
    },
    authAuditLog: { create: async (args: { data: Record<string, unknown> }) => { audits.push(args.data); return args.data; } },
  };
  return { redis, prisma, users, qrRows, deviceRows, sessionRows, audits, published, store };
}

type Prisma007 = ReturnType<typeof buildFakes007>['prisma'];
type Redis007 = ReturnType<typeof buildFakes007>['redis'];

async function main(): Promise<void> {
  await Promise.resolve();
  const tokens = new TokenService('test-secret-144-xz-007', null);
  const userToken = tokens.signAccessToken({ sub: UID, role: 'MEMBER', tenantId: TID, sessionId: UID });

  {
    // init -> scan -> authorize (low risk) -> complete, end-to-end <500ms
    const f = buildFakes007();
    const repo = new RedisQrCacheRepository(f.redis as unknown as import('../apps/backend/src/infra/redis/redis-cluster.service').RedisClusterService);
    const gateway = new QrAuthGateway(f.redis as unknown as import('../apps/backend/src/infra/redis/redis-cluster.service').RedisClusterService);
    const init = new InitQrSessionUseCase(f.prisma as unknown as Prisma007 & import('../apps/backend/src/infra/database/prisma.service').PrismaService, repo);
    const scan = new ProcessQrScanUseCase(
      f.prisma as unknown as Prisma007 & import('../apps/backend/src/infra/database/prisma.service').PrismaService,
      repo, tokens, gateway,
    );
    const authz = new AuthorizeQrSessionUseCase(
      f.prisma as unknown as Prisma007 & import('../apps/backend/src/infra/database/prisma.service').PrismaService,
      repo, tokens, gateway,
    );
    const t0 = performance.now();
    const created = await init.init({ desktopIp: '1.1.1.1', tenantId: TID });
    assert.ok(created.qrToken && created.encryptedNonce.length > 10 && created.expiresInSec === 60);
    assert.equal(f.qrRows.length, 1, 'durable audit row written');
    await assert.rejects(() => init.init({ desktopIp: null, tenantId: 'bad-tenant' }), /Invalid tenant/);

    const scanned = await scan.scan({ qrToken: created.qrToken, accessToken: userToken, mobileIp: '1.1.1.1' });
    assert.equal(scanned.status, 'SCANNED');
    await assert.rejects(
      () => scan.scan({ qrToken: created.qrToken, accessToken: userToken, mobileIp: '1.1.1.1' }),
      /QR_INVALID_STATE/,
      'double scan rejected',
    );
    await assert.rejects(() => scan.scan({ qrToken: created.qrToken, accessToken: 'bad' }, ), /INVALID_LINE_TOKEN/);

    const opened = openEnvelope(created.encryptedNonce, created.qrToken);
    const authed = await authz.authorize({
      qrToken: created.qrToken,
      userAccessToken: userToken,
      deviceFingerprint: 'fp-desktop-1',
      userAgent: 'test',
      ipAddress: '1.1.1.1',
      envelope: created.encryptedNonce,
    });
    assert.equal(authed.success, true);
    assert.ok(!authed.requirePin, 'same-IP known flow skips PIN');
    void opened;

    const code = (JSON.parse(f.published[f.published.length - 1].msg) as { oneTimeCode?: string }).oneTimeCode;
    assert.ok(code, 'SSE broadcast carries one-time code');
    const done = await authz.complete({ qrToken: created.qrToken, code: code as string, deviceFingerprint: 'fp-desktop-1', ipAddress: '1.1.1.1', userAgent: 'test' });
    assert.ok(done.accessToken.length > 10 && done.userId === UID);
    assert.ok(
      f.deviceRows.some((d) => d['deviceType'] === 'DESKTOP_WEB' && d['deviceFingerprint'] === 'fp-desktop-1'),
      'desktop device bound',
    );
    assert.ok(
      f.deviceRows.some((d) => d['deviceType'] === 'LINE_LIFF'),
      'mobile device bound at authorize',
    );
    await assert.rejects(
      () => authz.complete({ qrToken: created.qrToken, code: code as string, deviceFingerprint: 'fp', ipAddress: '1.1.1.1', userAgent: 't' }),
      /QR_INVALID_STATE/,
      'single-use handoff enforced',
    );
    const dt = performance.now() - t0;
    console.log(`  (qr handshake logic ${dt.toFixed(1)}ms with fakes; <500ms gate)`);
    assert.ok(dt < 500, `exceeded 500ms: ${dt}`);
    ok('init -> scan -> authorize -> complete end-to-end (single-use, device-bound)');
  }

  {
    // high-risk flow: PIN step-up (wrong PIN rejected, correct PIN authorizes) + reject path
    const f = buildFakes007();
    const cast = (v: unknown) => v as unknown as import('../apps/backend/src/infra/database/prisma.service').PrismaService;
    const castR = (v: unknown) => v as unknown as import('../apps/backend/src/infra/redis/redis-cluster.service').RedisClusterService;
    const repo = new RedisQrCacheRepository(castR(f.redis));
    const gateway = new QrAuthGateway(castR(f.redis));
    const init = new InitQrSessionUseCase(cast(f.prisma), repo);
    const authz = new AuthorizeQrSessionUseCase(cast(f.prisma), repo, tokens, gateway);
    const created = await init.init({ desktopIp: '9.9.9.9', tenantId: TID });

    const stepUp = await authz.authorize({
      qrToken: created.qrToken,
      userAccessToken: userToken,
      deviceFingerprint: 'fp-unknown-mobile',
      userAgent: 'test',
      ipAddress: '8.8.8.8',
    });
    assert.equal(stepUp.requirePin, true, 'IP mismatch + unknown fingerprint forces PIN');
    assert.equal(stepUp.pin, undefined, 'PIN never returned to LIFF (desktop channel only)');
    const desktopPin = (
      JSON.parse(f.published[f.published.length - 1].msg) as { pinDisplay?: string }
    ).pinDisplay;
    assert.ok(desktopPin && /^\d{6}$/.test(desktopPin), 'PIN issued once on the desktop SSE channel');
    await assert.rejects(
      () => authz.authorize({ qrToken: created.qrToken, userAccessToken: userToken, deviceFingerprint: 'fp-unknown-mobile', userAgent: 't', ipAddress: '8.8.8.8', pin: '000000' }),
      /QR_INVALID_PIN/,
    );
    const authed = await authz.authorize({
      qrToken: created.qrToken,
      userAccessToken: userToken,
      deviceFingerprint: 'fp-unknown-mobile',
      userAgent: 't',
      ipAddress: '8.8.8.8',
      pin: desktopPin,
    });
    assert.equal(authed.success, true);
    ok('high-risk login gated by 6-digit PIN step-up');

    const created2 = await init.init({ desktopIp: '9.9.9.9', tenantId: TID });
    assert.equal(await authz.reject({ qrToken: created2.qrToken, accessToken: userToken }), true);
    await assert.rejects(
      () => authz.authorize({ qrToken: created2.qrToken, userAccessToken: userToken, deviceFingerprint: 'fp', userAgent: 't', ipAddress: '9.9.9.9' }),
      /QR_INVALID_STATE/,
      'rejected sessions cannot authorize',
    );
    await assert.rejects(() => authz.reject({ qrToken: created2.qrToken, accessToken: 'bad' }), /INVALID_LINE_TOKEN/);
    ok('LIFF reject path invalidates the session');
  }

  {
    // expiry + tamper edges
    const f = buildFakes007();
    const cast = (v: unknown) => v as unknown as import('../apps/backend/src/infra/database/prisma.service').PrismaService;
    const castR = (v: unknown) => v as unknown as import('../apps/backend/src/infra/redis/redis-cluster.service').RedisClusterService;
    const repo = new RedisQrCacheRepository(castR(f.redis));
    const gateway = new QrAuthGateway(castR(f.redis));
    const init = new InitQrSessionUseCase(cast(f.prisma), repo);
    const authz = new AuthorizeQrSessionUseCase(cast(f.prisma), repo, tokens, gateway);
    const created = await init.init({ desktopIp: null, tenantId: TID });
    // simulate TTL lapse
    f.store.delete(`qr_session:${created.qrToken}`);
    await assert.rejects(
      () => authz.authorize({ qrToken: created.qrToken, userAccessToken: userToken, deviceFingerprint: 'fp', userAgent: 't', ipAddress: '1.1.1.1' }),
      /QR_SESSION_EXPIRED/,
    );
    const created2 = await init.init({ desktopIp: null, tenantId: TID });
    await assert.rejects(
      () => authz.authorize({ qrToken: created2.qrToken, userAccessToken: userToken, deviceFingerprint: 'fp', userAgent: 't', ipAddress: '1.1.1.1', envelope: 'tampered.payload' }),
      /INVALID_QR_ENVELOPE/,
    );
    await assert.rejects(
      () => authz.authorize({ qrToken: '123e4567-e89b-12d3-a456-426614179999', userAccessToken: userToken, deviceFingerprint: 'fp', userAgent: 't', ipAddress: '1.1.1.1' }),
      /QR_SESSION_EXPIRED/,
    );
    ok('expired/tampered/unknown sessions fail fast');
  }

  console.log(`\nphase007 contract tests: ${passed} groups passed`);
}

void main();
