// SSOT Phase 006 §10 — contract + integration tests (LIFF provision, verifier, facade, me/logout)
// Run: npx tsx scripts/test-phase006-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import {
  LiffAuthInputSchema,
  DecodedLineTokenSchema,
  UserProfileAuthSchema,
  AuthTokenResponseSchema,
  UserRoleEnum,
} from '../packages/shared/src/schemas/auth-contract';
import { UserRoleEnum as IdentityRoles } from '../packages/shared/src/schemas/identity.zod';
import { TokenService } from '../apps/backend/src/modules/auth/services/token.service';
import { JwtTokenService } from '../apps/backend/src/modules/auth/services/jwt-token.service';
import { LineVerifierService } from '../apps/backend/src/modules/auth/services/line-verifier.service';
import { AuthService } from '../apps/backend/src/modules/auth/services/auth.service';

const TID = '123e4567-e89b-12d3-a456-426614174000';
const UID = '123e4567-e89b-12d3-a456-426614174001';
let passed = 0;
function ok(name: string) {
  passed++;
  console.log(`  ✓ ${name}`);
}

// ---------- 1. Phase 006 Zod domain ----------
{
  assert.equal(
    LiffAuthInputSchema.safeParse({ idToken: 'x'.repeat(32), tenantId: TID }).success,
    true,
  );
  assert.equal(
    LiffAuthInputSchema.safeParse({
      idToken: 'x'.repeat(32),
      tenantId: TID,
      referralCode: 'REF-EMERALD-999',
      deviceInfo: { os: 'iOS', ipAddress: '1.2.3.4' },
    }).success,
    true,
  );
  assert.equal(LiffAuthInputSchema.safeParse({ idToken: 'short', tenantId: TID }).success, false);
  assert.equal(
    LiffAuthInputSchema.safeParse({ idToken: 'x'.repeat(32), tenantId: TID, deviceInfo: { ipAddress: 'nope' } }).success,
    false,
  );
  ok('LiffAuthInput (+deviceInfo) validated');

  const now = Math.floor(Date.now() / 1000);
  assert.equal(
    DecodedLineTokenSchema.safeParse({ iss: 'https://access.line.me', sub: 'U1', aud: 'CH', exp: now + 3600, iat: now }).success,
    true,
  );
  assert.equal(DecodedLineTokenSchema.safeParse({ iss: 'x', aud: 'CH', exp: now, iat: now }).success, false);
  ok('DecodedLineToken requires sub/aud/exp/iat');

  assert.equal(
    UserProfileAuthSchema.safeParse({
      id: UID, lineUserId: 'U1', displayName: 'A', avatarUrl: null, email: null,
      role: 'MEMBER', tenantId: TID, walletBalance: 0, rewardPoints: 0,
      affiliateCode: 'AFF', createdAt: new Date().toISOString(),
    }).success,
    true,
  );
  assert.equal(
    AuthTokenResponseSchema.safeParse({
      accessToken: 't'.repeat(16), expiresIn: 900,
      user: {
        id: UID, lineUserId: 'U1', displayName: 'A', avatarUrl: null, email: null,
        role: 'MEMBER', tenantId: TID, walletBalance: 0, rewardPoints: 0,
        affiliateCode: 'AFF', createdAt: new Date().toISOString(),
      },
    }).success,
    true,
  );
  assert.deepEqual(UserRoleEnum.options, IdentityRoles.options, 'single UserRole source (identity.zod)');
  ok('UserProfileAuth + AuthTokenResponse + zero-redundant UserRoleEnum');
}

// ---------- 2. LineVerifierService (mocked LINE platform) ----------
async function main(): Promise<void> {
await Promise.resolve();
function mockFetchOnce(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  const prev = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => handler(String(url), init)) as typeof fetch;
  return () => {
    globalThis.fetch = prev;
  };
}
function jsonRes(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}
function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

{
  const redis = {
    store: new Map<string, string>(),
    get: async function (k: string) { return this.store.get(k) ?? null; },
    setex: async function (k: string, _t: number, v: string) { this.store.set(k, v); },
    del: async function (k: string) { this.store.delete(k); },
    publish: async () => {},
  };
  const svc = new LineVerifierService(
    redis as unknown as import('../apps/backend/src/infra/redis/redis-cluster.service').RedisClusterService,
    'CH-TEST',
  );
  const now = Math.floor(Date.now() / 1000);
  const goodJwt = `${b64url({ alg: 'RS256', kid: 'kid-1' })}.${b64url({ sub: 'U1' })}.sig`;

  // malformed: not 3 segments / missing kid
  await assert.rejects(() => svc.verifyIdToken('nope'), /INVALID_LINE_TOKEN/);
  await assert.rejects(
    () => svc.verifyIdToken(`${b64url({ alg: 'RS256' })}.x.y`),
    /INVALID_LINE_TOKEN/,
  );
  ok('verifier rejects malformed tokens (segments/kid)');

  // happy path: kid cached + verify endpoint OK
  redis.store.set('line:jwks:kids', JSON.stringify(['kid-1']));
  let restore = mockFetchOnce(async (url) => {
    assert.ok(url.includes('/verify'));
    return jsonRes({ iss: 'https://access.line.me', sub: 'U1', aud: 'CH-TEST', exp: now + 3600, iat: now, name: 'A', picture: 'https://pic.test/a.png', email: 'a@test.dev' });
  });
  const profile = await svc.verifyIdToken(goodJwt);
  assert.equal(profile.sub, 'U1');
  assert.equal(profile.email, 'a@test.dev');
  restore();
  ok('verifier accepts valid token via LINE verify engine');

  // verify endpoint 401 / expired / aud mismatch / stale iat
  restore = mockFetchOnce(async () => jsonRes({ error: 'invalid_token' }, 400));
  await assert.rejects(() => svc.verifyIdToken(goodJwt), /INVALID_LINE_TOKEN/);
  restore();
  restore = mockFetchOnce(async () =>
    jsonRes({ iss: 'i', sub: 'U1', aud: 'CH-TEST', exp: now - 5, iat: now - 7200 }),
  );
  await assert.rejects(() => svc.verifyIdToken(goodJwt), /INVALID_LINE_TOKEN/);
  restore();
  restore = mockFetchOnce(async () =>
    jsonRes({ iss: 'i', sub: 'U1', aud: 'OTHER', exp: now + 3600, iat: now }),
  );
  await assert.rejects(() => svc.verifyIdToken(goodJwt), /INVALID_LINE_TOKEN/);
  restore();
  restore = mockFetchOnce(async () =>
    jsonRes({ iss: 'i', sub: 'U1', aud: 'CH-TEST', exp: now + 3600, iat: now - 301 }),
  );
  await assert.rejects(() => svc.verifyIdToken(goodJwt), /INVALID_LINE_TOKEN/);
  restore();
  ok('verifier rejects 401/expired/audience-mismatch/stale-iat');

  // unknown kid (fresh certs fetch) rejected
  redis.store.delete('line:jwks:kids');
  restore = mockFetchOnce(async (url) => {
    if (String(url).includes('/certs')) return jsonRes({ keys: [{ kid: 'kid-9' }] });
    return jsonRes({ iss: 'i', sub: 'U1', aud: 'CH-TEST', exp: now + 3600, iat: now });
  });
  await assert.rejects(() => svc.verifyIdToken(goodJwt), /INVALID_LINE_TOKEN/);
  restore();
  ok('unknown kid rejected via JWKS certs check');
}

// ---------- 3. JwtTokenService facade ----------
{
  const tokens = new TokenService('test-secret-144-xz-006', null);
  const facade = new JwtTokenService(tokens);
  const gen = facade.generateAccessToken({ userId: UID, lineUserId: 'U1', tenantId: TID, role: 'MEMBER' });
  assert.ok(gen.accessToken.length > 10 && gen.expiresIn === 900);
  assert.equal(facade.verifyAccessToken(gen.accessToken).sub, UID);
  ok('JwtTokenService facade issues/verifies via TokenService core');
}

// ---------- 4. authenticateLiffUser integration (fakes) ----------
interface FakeUser {
  id: string; lineUserId: string | null; email: string | null; displayName: string;
  avatarUrl: string | null; role: string; tenantId: string | null; walletBalance: number;
  rewardPoints: number; affiliateCode: string; referredById: string | null; createdAt: Date;
}
function buildFakes006(seedUsers: FakeUser[] = [], tenantActive = true) {
  const uuid = (n: number) => `123e4567-e89b-12d3-a456-42661417${String(4000 + n).padStart(4, '0')}`;
  let userSeq = 100;
  let sessionSeq = 200;
  const users = new Map<string, FakeUser>(seedUsers.map((u) => [u.id, { ...u }]));
  const profiles = new Map<string, Record<string, unknown>>();
  const sessions = new Map<string, Record<string, unknown>>();
  const cache = new Map<string, string>();
  const events: Array<Record<string, unknown>> = [];
  const tx = {
    user: {
      findUnique: async (args: { where: Record<string, string>; include?: unknown }) => {
        for (const u of users.values()) {
          if (args.where.lineUserId !== undefined && u.lineUserId !== args.where.lineUserId) continue;
          if (args.where.email !== undefined && u.email !== args.where.email) continue;
          if (args.where.affiliateCode !== undefined && u.affiliateCode !== args.where.affiliateCode) continue;
          if (args.where.id !== undefined && u.id !== args.where.id) continue;
          return { ...u };
        }
        return null;
      },
      create: async (args: { data: Record<string, unknown>; include?: unknown }) => {
        userSeq++;
        const d = args.data;
        const nested = (d.lineProfile as { create: Record<string, unknown> } | undefined)?.create;
        const u: FakeUser = {
          id: uuid(userSeq), lineUserId: (d.lineUserId as string | null) ?? null,
          email: (d.email as string | null) ?? null, displayName: d.displayName as string,
          avatarUrl: (d.avatarUrl as string | null) ?? null, role: (d.role as string) ?? 'MEMBER',
          tenantId: (d.tenantId as string | null) ?? null, walletBalance: 0, rewardPoints: 0,
          affiliateCode: uuid(900 + userSeq), referredById: (d.referredById as string | null) ?? null,
          createdAt: new Date(),
        };
        users.set(u.id, u);
        if (nested) profiles.set(u.id, { ...nested, userId: u.id, lastLoginAt: new Date() });
        return { ...u };
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const u = users.get(args.where.id);
        if (!u) throw new Error('not found');
        const next = { ...u, ...(args.data as Partial<FakeUser>) };
        users.set(u.id, next);
        return { ...next };
      },
    },
    lineAuthProfile: {
      upsert: async (args: { where: { userId: string }; update: Record<string, unknown>; create: Record<string, unknown> }) => {
        const next = { ...(profiles.get(args.where.userId) ?? {}), ...args.create, ...args.update, userId: args.where.userId };
        profiles.set(args.where.userId, next);
        return next;
      },
    },
    authAuditLog: { create: async (args: { data: Record<string, unknown> }) => args.data },
  };
  const prisma = {
    tenant: {
      findUnique: async (args: { where: { id: string } }) =>
        args.where.id === TID
          ? { id: TID, slug: 'ahong', name: 'Ahong', isActive: tenantActive, lineChannelId: 'CH-TEST' }
          : null,
    },
    $transaction: async <T>(fn: (t: typeof tx) => Promise<T>): Promise<T> => fn(tx),
    user: {
      findUnique: async (args: { where: { id: string } }) => {
        const u = users.get(args.where.id);
        return u ? { ...u } : null;
      },
    },
    session: {
      create: async (args: { data: Record<string, unknown> }) => {
        sessionSeq++;
        const s = { id: uuid(sessionSeq), isRevoked: false, ...args.data };
        sessions.set(s.id as string, s);
        return s;
      },
    },
    authAuditLog: tx.authAuditLog,
  };
  const redis = {
    get: async (k: string) => cache.get(k) ?? null,
    setex: async (k: string, _t: number, v: string) => { cache.set(k, v); },
    del: async (k: string) => { cache.delete(k); },
    publish: async (ch: string, msg: string) => { events.push({ ch, ...(JSON.parse(msg) as Record<string, unknown>) }); },
  };
  return { prisma, redis, users, profiles, sessions, events };
}

{
  // First-time auto-provisioning (<300ms incl. tenant gate + profile create)
    const { prisma, redis, users, profiles, sessions, events } = buildFakes006();
    const tokens = new TokenService('test-secret-144-xz-006', null);
    const verifier = {
      verifyIdToken: async () => ({ iss: 'https://access.line.me', sub: 'U_NEW_6', aud: 'CH-TEST', exp: 9_999_999_999, iat: Math.floor(Date.now() / 1000), name: 'New Six', picture: null, email: null }),
    };
    const svc = new AuthService(
      prisma as unknown as import('../apps/backend/src/infra/database/prisma.service').PrismaService,
      redis as unknown as import('../apps/backend/src/infra/redis/redis-cluster.service').RedisClusterService,
      tokens,
      {} as unknown as import('../apps/backend/src/modules/auth/adapters/line-oauth.adapter').LineOAuthAdapter,
      verifier as unknown as import('../apps/backend/src/modules/auth/services/line-verifier.service').LineVerifierService,
    );
    const ctx = { clientIp: '127.0.0.1', userAgent: 'Phase006Test/1.0' };
    const t0 = performance.now();
    const res = await svc.authenticateLiffUser(
      { idToken: 'x'.repeat(32), tenantId: TID, referralCode: 'REF-EMERALD-999', deviceInfo: { os: 'iOS' } },
      ctx,
    );
    const dt = performance.now() - t0;
    assert.equal(res.user.role, 'MEMBER');
    assert.equal(res.user.tenantId, TID);
    assert.equal(typeof res.user.walletBalance, 'number');
    assert.ok(res.user.affiliateCode.length > 0 && res.sessionId);
    assert.ok(profiles.size === 1, 'LineAuthProfile auto-created');
    assert.ok(sessions.size === 1 && events.some((e) => e['event'] === 'user.registered'));
    console.log(`  (auto-provision logic ${dt.toFixed(1)}ms with fakes; <300ms gate)`);
    assert.ok(dt < 300, `exceeded 300ms: ${dt}`);
    assert.ok(users.size === 1);
    ok('first-time LIFF user auto-provisioned (User + LineAuthProfile + session + user.registered)');
  }

  {
    // Existing user: profile sync + lastLoginAt + referral bind + entitlements preserved
    const seed: FakeUser = {
      id: UID, lineUserId: 'U_OLD_6', email: 'old@test.dev', displayName: 'Old', avatarUrl: null,
      role: 'MEMBER', tenantId: TID, walletBalance: 150.5, rewardPoints: 40, affiliateCode: 'AFF-OLD',
      referredById: null, createdAt: new Date('2024-01-01'),
    };
    const referrer: FakeUser = {
      id: '223e4567-e89b-12d3-a456-426614174001', lineUserId: null, email: 'ref@test.dev', displayName: 'Ref',
      avatarUrl: null, role: 'MEMBER', tenantId: TID, walletBalance: 0, rewardPoints: 0,
      affiliateCode: 'REF-EMERALD-999', referredById: null, createdAt: new Date('2024-01-01'),
    };
    const { prisma, redis, users, profiles, events } = buildFakes006([seed, referrer]);
    const tokens = new TokenService('test-secret-144-xz-006', null);
    const verifier = {
      verifyIdToken: async () => ({ iss: 'https://access.line.me', sub: 'U_OLD_6', aud: 'CH-TEST', exp: 9_999_999_999, iat: Math.floor(Date.now() / 1000), name: 'Old Updated', picture: 'https://pic.test/u.png', email: 'old@test.dev' }),
    };
    const svc = new AuthService(
      prisma as unknown as import('../apps/backend/src/infra/database/prisma.service').PrismaService,
      redis as unknown as import('../apps/backend/src/infra/redis/redis-cluster.service').RedisClusterService,
      tokens,
      {} as unknown as import('../apps/backend/src/modules/auth/adapters/line-oauth.adapter').LineOAuthAdapter,
      verifier as unknown as import('../apps/backend/src/modules/auth/services/line-verifier.service').LineVerifierService,
    );
    const res = await svc.authenticateLiffUser(
      { idToken: 'y'.repeat(32), tenantId: TID, referralCode: 'REF-EMERALD-999' },
      { clientIp: '10.0.0.2', userAgent: 't' },
    );
    assert.equal(res.user.id, UID, 'same UUID (entitlements preserved)');
    assert.equal(res.user.displayName, 'Old');
    assert.equal(res.user.walletBalance, 150.5, 'wallet preserved');
    const after = users.get(UID);
    assert.equal(after?.referredById, referrer.id, 'referral bound when unset');
    const prof = profiles.get(UID) as { lastLoginAt?: Date; displayName?: string } | undefined;
    assert.ok(prof?.lastLoginAt instanceof Date && prof.displayName === 'Old Updated');
    assert.ok(events.some((e) => e['event'] === 'user.logged_in'));
    // me query
    const me = await svc.getMyProfile(UID);
    assert.ok(me && me.id === UID && me.lineUserId === 'U_OLD_6' && me.walletBalance === 150.5);
    assert.equal(await svc.getMyProfile('00000000-0000-0000-0000-000000000000'), null);
    ok('returning user syncs profile/lastLoginAt, binds referral, me returns full profile');
  }

  {
    // Failure: inactive tenant / unknown tenant / bad input / missing verifier
    const { prisma, redis } = buildFakes006([], false);
    const tokens = new TokenService('test-secret-144-xz-006', null);
    const verifier = { verifyIdToken: async () => ({ iss: 'i', sub: 'U', aud: 'a', exp: 1, iat: 1 }) };
    const svc = new AuthService(
      prisma as unknown as import('../apps/backend/src/infra/database/prisma.service').PrismaService,
      redis as unknown as import('../apps/backend/src/infra/redis/redis-cluster.service').RedisClusterService,
      tokens,
      {} as unknown as import('../apps/backend/src/modules/auth/adapters/line-oauth.adapter').LineOAuthAdapter,
      verifier as unknown as import('../apps/backend/src/modules/auth/services/line-verifier.service').LineVerifierService,
    );
    const ctx = { clientIp: '127.0.0.1', userAgent: 't' };
    await assert.rejects(() => svc.authenticateLiffUser({ idToken: 'x'.repeat(32), tenantId: TID }, ctx), /Tenant not found or inactive/);
    await assert.rejects(
      () => svc.authenticateLiffUser({ idToken: 'x'.repeat(32), tenantId: '123e4567-e89b-12d3-a456-426614179999' }, ctx),
      /Tenant not found or inactive/,
    );
    await assert.rejects(() => svc.authenticateLiffUser({ idToken: 'short', tenantId: TID }, ctx), /Invalid LIFF/);
    const noVerifier = new AuthService(
      prisma as unknown as import('../apps/backend/src/infra/database/prisma.service').PrismaService,
      redis as unknown as import('../apps/backend/src/infra/redis/redis-cluster.service').RedisClusterService,
      tokens,
      {} as unknown as import('../apps/backend/src/modules/auth/adapters/line-oauth.adapter').LineOAuthAdapter,
    );
    await assert.rejects(() => noVerifier.authenticateLiffUser({ idToken: 'x'.repeat(32), tenantId: TID }, ctx), /INVALID_LINE_TOKEN/);
    ok('tenant gate + input validation + verifier presence enforced');
  }

  console.log(`\nphase006 contract tests: ${passed} groups passed`);
}

void main();
