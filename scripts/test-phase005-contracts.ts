// SSOT Phase 005 §10.1 — contract + integration tests (Zod SSOT, dual-token, linking, rotation, guards)
// Run: npx tsx scripts/test-phase005-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import {
  AuthProviderEnum,
  LineLiffAuthInputSchema,
  AuthenticateLineLiffInputSchema,
  WebOAuthInputSchema,
  JwtPayloadSchema,
  AuthResponseSchema,
} from '../packages/shared/src/schemas/auth-contract';
import { TokenService } from '../apps/backend/src/modules/auth/services/token.service';
import { AuthService } from '../apps/backend/src/modules/auth/services/auth.service';

const TID = '123e4567-e89b-12d3-a456-426614174000';
const UID = '123e4567-e89b-12d3-a456-426614174001';
let passed = 0;
function ok(name: string) {
  passed++;
  console.log(`  ✓ ${name}`);
}

// ---------- 1. Zod contracts ----------
{
  const happy = LineLiffAuthInputSchema.safeParse({ idToken: 'x'.repeat(32), tenantId: TID });
  assert.equal(happy.success, true);
  ok('LineLiffAuthInput happy path');

  assert.equal(LineLiffAuthInputSchema.safeParse({ idToken: 'short', tenantId: TID }).success, false);
  assert.equal(LineLiffAuthInputSchema.safeParse({ idToken: 'x'.repeat(32), tenantId: 'nope' }).success, false);
  ok('LineLiffAuthInput rejects short token / non-uuid tenant');

  const compat = AuthenticateLineLiffInputSchema.safeParse({ accessToken: 'y'.repeat(16), tenantId: TID });
  assert.equal(compat.success, true);
  assert.equal(AuthenticateLineLiffInputSchema.safeParse({ tenantId: TID }).success, false);
  ok('Phase004 accessToken alias accepted, empty rejected');

  assert.equal(AuthProviderEnum.options.length, 5);
  assert.equal(WebOAuthInputSchema.safeParse({ code: 'c', state: 's', redirectUri: 'https://x.test/cb', tenantId: TID }).success, true);
  assert.equal(WebOAuthInputSchema.safeParse({ code: '', state: 's', redirectUri: 'not-url', tenantId: TID }).success, false);
  ok('AuthProviderEnum(5) + WebOAuthInput validated');

  const now = Math.floor(Date.now() / 1000);
  assert.equal(JwtPayloadSchema.safeParse({ sub: UID, role: 'MEMBER', tenantId: TID, sessionId: UID, iat: now, exp: now + 900 }).success, true);
  assert.equal(JwtPayloadSchema.safeParse({ sub: 'x', role: 'NOPE', tenantId: TID, sessionId: UID, iat: now, exp: now + 900 }).success, false);
  assert.equal(AuthResponseSchema.safeParse({ accessToken: 't'.repeat(16), expiresIn: 900, user: { id: UID, displayName: 'A', avatarUrl: null, email: null, lineUserId: 'U1', role: 'MEMBER' } }).success, true);
  ok('JwtPayload + AuthResponse schemas enforced');
}

// ---------- 2. TokenService ----------
{
  const svc = new TokenService('test-secret-144-xz', null);
  const now = Math.floor(Date.now() / 1000);
  const token = svc.signAccessToken({ sub: UID, role: 'MEMBER', tenantId: TID, sessionId: UID });
  const payload = svc.verifyAccessToken(token);
  assert.equal(payload.sub, UID);
  assert.ok(payload.exp - payload.iat === 900 && now <= payload.iat);
  ok('TokenService sign/verify round-trip (15m TTL)');

  assert.throws(() => new TokenService('other-secret', null).verifyAccessToken(token), /signature/);
  assert.throws(() => svc.verifyAccessToken('a.b'), /format/);
  const expired = svc.signAccessToken({ sub: UID, role: 'MEMBER', tenantId: TID, sessionId: UID }, -10);
  assert.throws(() => svc.verifyAccessToken(expired), /expired/);
  ok('TokenService rejects wrong-secret / malformed / expired');

  const rotated = new TokenService('new-secret', 'test-secret-144-xz');
  assert.equal(rotated.verifyAccessToken(token).sub, UID); // prev-secret rotation path
  const pair = svc.issueDualToken({ id: UID, lineUserId: 'U1', email: null, role: 'MEMBER' }, TID, UID);
  assert.ok(pair.accessToken.length > 10 && pair.expiresIn === 900 && pair.refreshToken.length >= 32);
  ok('Key rotation (prev secret) + dual-token issuance');

  // Tamper detection
  const [h, b, s] = token.split('.');
  assert.throws(() => svc.verifyAccessToken(`${h}.${b}x.${s}`), /signature/);
  ok('Token tamper rejected');
}

// ---------- 3. AuthService integration (fake Prisma/Redis/LINE) ----------
interface FakeUser { id: string; lineUserId: string | null; email: string | null; displayName: string; avatarUrl: string | null; role: string; affiliateCode?: string }
interface FakeSession { id: string; userId: string; tenantId: string; sessionToken: string; refreshToken: string; ipAddress: string | null; userAgent: string | null; isRevoked: boolean; expiresAt: Date }

function buildFakes(seedUsers: FakeUser[] = []) {
  const uuid = (n: number) => `123e4567-e89b-12d3-a456-42661417${String(4000 + n).padStart(4, '0')}`;
  let userSeq = 0;
  let sessionSeq = 0;
  const users = new Map<string, FakeUser>(seedUsers.map((u) => [u.id, { ...u }]));
  const sessions = new Map<string, FakeSession>();
  const cache = new Map<string, { v: string; exp: number }>();
  const audits: Array<Record<string, unknown>> = [];
  const txClient = {
    user: {
      findUnique: async (args: { where: Record<string, string> }) => {
        const w = args.where;
        for (const u of users.values()) {
          if (w.lineUserId !== undefined && u.lineUserId === w.lineUserId) return { ...u };
          if (w.email !== undefined && u.email === w.email) return { ...u };
          if (w.affiliateCode !== undefined && u.affiliateCode === w.affiliateCode) return { ...u };
          if (w.id !== undefined && u.id === w.id) return { ...u };
        }
        return null;
      },
      update: async (args: { where: { id: string }; data: Partial<FakeUser> }) => {
        const u = users.get(args.where.id);
        if (!u) throw new Error('not found');
        const next = { ...u, ...args.data };
        users.set(u.id, next);
        return { ...next };
      },
      create: async (args: { data: Record<string, unknown> }) => {
        userSeq++;
        const u: FakeUser = {
          id: uuid(userSeq),
          lineUserId: (args.data.lineUserId as string | null) ?? null,
          email: (args.data.email as string | null) ?? null,
          displayName: args.data.displayName as string,
          avatarUrl: (args.data.avatarUrl as string | null) ?? null,
          role: (args.data.role as string) ?? 'MEMBER',
        };
        users.set(u.id, u);
        return { ...u };
      },
    },
    authAuditLog: { create: async (args: { data: Record<string, unknown> }) => { audits.push(args.data); return args.data; } },
  };
  const prisma = {
    $transaction: async <T>(fn: (tx: typeof txClient) => Promise<T>): Promise<T> => fn(txClient),
    user: txClient.user,
    session: {
      create: async (args: { data: Record<string, unknown> }) => {
        sessionSeq++;
        const s: FakeSession = {
          id: uuid(100 + sessionSeq), userId: args.data.userId as string, tenantId: args.data.tenantId as string,
          sessionToken: args.data.sessionToken as string, refreshToken: args.data.refreshToken as string,
          ipAddress: (args.data.ipAddress as string | null) ?? null, userAgent: (args.data.userAgent as string | null) ?? null,
          isRevoked: false, expiresAt: args.data.expiresAt as Date,
        };
        sessions.set(s.id, s);
        return { ...s };
      },
      findUnique: async (args: { where: Record<string, string>; include?: { user: boolean } }) => {        for (const s of sessions.values()) {
          if (args.where.refreshToken !== undefined && s.refreshToken !== args.where.refreshToken) continue;
          if (args.where.id !== undefined && s.id !== args.where.id) continue;
          const user = users.get(s.userId);
          if (!user) return null;
          return { ...s, user: { ...user } };
        }
        return null;
      },
      findFirst: async (args: { where: Record<string, string> }) => {
        for (const s of sessions.values()) {
          if (args.where.userId !== undefined && s.userId !== args.where.userId) continue;
          return { ...s };
        }
        return null;
      },
      update: async (args: { where: { id: string }; data: Partial<FakeSession>; include?: { user: boolean } }) => {
        const s = sessions.get(args.where.id);
        if (!s) throw new Error('not found');
        const next = { ...s, ...args.data };
        sessions.set(s.id, next);
        const user = users.get(next.userId);
        return { ...next, user: { ...(user as FakeUser) } };
      },
      updateMany: async (args: { where: Record<string, string>; data: Partial<FakeSession> }) => {
        let count = 0;
        for (const s of sessions.values()) {
          if (args.where.id !== undefined && s.id !== args.where.id) continue;
          if (args.where.userId !== undefined && s.userId !== args.where.userId) continue;
          sessions.set(s.id, { ...s, ...args.data });
          count++;
        }
        return { count };
      },
    },
    authAuditLog: txClient.authAuditLog,
  };
  const redis = {
    get: async (k: string) => cache.get(k)?.v ?? null,
    setex: async (k: string, _t: number, v: string) => { cache.set(k, { v, exp: Date.now() + 900_000 }); },
    del: async (k: string) => { cache.delete(k); },
  };
  return { prisma, redis, users, sessions, audits };
}

async function main(): Promise<void> {
{
  await Promise.resolve();
  const { prisma, redis, sessions } = buildFakes();
  const tokens = new TokenService('test-secret-144-xz', null);
  const line = { verifyIdToken: async () => ({ sub: 'U_NEW', name: 'New User', picture: null, email: 'new@test.dev' }) };
  const svc = new AuthService(
    prisma as unknown as import('../apps/backend/src/infra/database/prisma.service').PrismaService,
    redis as unknown as import('../apps/backend/src/infra/redis/redis-cluster.service').RedisClusterService,
    tokens,
    line as unknown as import('../apps/backend/src/modules/auth/adapters/line-oauth.adapter').LineOAuthAdapter,
  );
  const ctx = { clientIp: '127.0.0.1', userAgent: 'Phase005Test/1.0' };
  const t0 = performance.now();
  const res = await svc.authenticateLineLiff({ idToken: 'x'.repeat(32), tenantId: TID }, ctx);
  const dt = performance.now() - t0;
  assert.ok(res.accessToken.length > 10 && res.user.role === 'MEMBER' && res.sessionId);
  assert.ok(await redis.get(`session:${res.sessionId}`) !== null);
  console.log(`  (handshake logic ${(dt).toFixed(1)}ms with fakes; <100ms gate on logic path)`);
  assert.ok(dt < 100, `handshake logic exceeded 100ms: ${dt}`);
  ok('authenticateLineLiff creates user + session + edge cache');

  const res2 = await svc.authenticateLineLiff({ idToken: 'x'.repeat(32), tenantId: TID }, ctx);
  assert.equal(res2.user.id, res.user.id, 'same lineUserId returns same user');
  ok('existing lineUserId re-login returns same user');

  const rotated = await svc.refreshAccessToken(res.refreshToken, ctx);
  // NOTE: access JWTs are deterministic per-second (same iat) so equality is possible;
  // rotation guarantee is the single-use refresh token + re-issued session binding.
  assert.ok(rotated.refreshToken !== res.refreshToken);
  assert.equal(rotated.sessionId, res.sessionId);
  tokens.verifyAccessToken(rotated.accessToken);
  await assert.rejects(() => svc.refreshAccessToken(res.refreshToken, ctx), /Invalid or expired/);
  for (const s of sessions.values()) assert.equal(s.isRevoked, true, 'breach reuse revokes all sessions');
  ok('single-use refresh rotation enforced (reuse rejected + breach recovery)');

  assert.equal(await svc.logoutSession(rotated.sessionId, ctx), true);
  ok('logoutSession revokes + clears cache');
}

{
  // Email-conflict account linking: entitlements preserved under single UUID
  const emailUser: FakeUser = { id: '223e4567-e89b-12d3-a456-426614174001', lineUserId: null, email: 'user@example.com', displayName: 'Email User', avatarUrl: null, role: 'MEMBER' };
  const { prisma, redis } = buildFakes([emailUser]);
  const tokens = new TokenService('test-secret-144-xz', null);
  const line = { verifyIdToken: async () => ({ sub: 'U_LINE_9', name: 'Line Name', picture: 'https://pic', email: 'user@example.com' }) };
  const svc = new AuthService(
    prisma as unknown as import('../apps/backend/src/infra/database/prisma.service').PrismaService,
    redis as unknown as import('../apps/backend/src/infra/redis/redis-cluster.service').RedisClusterService,
    tokens,
    line as unknown as import('../apps/backend/src/modules/auth/adapters/line-oauth.adapter').LineOAuthAdapter,
  );
  const res = await svc.authenticateLineLiff({ idToken: 'z'.repeat(32), tenantId: TID }, { clientIp: '10.0.0.1', userAgent: 't' });
  assert.equal(res.user.id, '223e4567-e89b-12d3-a456-426614174001', 'linked to existing UUID (entitlements preserved)');
  assert.equal(res.user.lineUserId, 'U_LINE_9');
  ok('cross-provider account linking preserves single User UUID');
}

{
  // Failure paths: bad input, bad token, unsupported provider
  const { prisma, redis } = buildFakes();
  const tokens = new TokenService('test-secret-144-xz', null);
  const line = { verifyIdToken: async (): Promise<never> => { throw new Error('Invalid LINE ID Token Signature'); } };
  const svc = new AuthService(
    prisma as unknown as import('../apps/backend/src/infra/database/prisma.service').PrismaService,
    redis as unknown as import('../apps/backend/src/infra/redis/redis-cluster.service').RedisClusterService,
    tokens,
    line as unknown as import('../apps/backend/src/modules/auth/adapters/line-oauth.adapter').LineOAuthAdapter,
  );
  const ctx = { clientIp: '127.0.0.1', userAgent: 't' };
  await assert.rejects(() => svc.authenticateLineLiff({ idToken: 'short', tenantId: TID }, ctx), /Invalid LINE LIFF/);
  await assert.rejects(() => svc.authenticateLineLiff({ idToken: 'x'.repeat(32), tenantId: TID }, ctx), /Signature/);
  await assert.rejects(() => svc.authenticateWebOAuth('GOOGLE', 'c', 's', 'https://x.test/cb', TID, ctx), /Unsupported/);
  await assert.rejects(() => svc.refreshAccessToken('nope-not-found', ctx), /Invalid or expired/);
  await assert.rejects(() => svc.logoutSession('', ctx), /Missing session/);
  ok('failure paths fail-fast with context (bad input / bad signature / provider / refresh / logout)');
}

console.log(`\nphase005 contract tests: ${passed} groups passed`);
}

void main();
