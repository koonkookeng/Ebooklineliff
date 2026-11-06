// SSOT Phase 131 §10.1 — Hybrid web identity contract + integration tests
// Run: ./node_modules/.bin/tsx --tsconfig apps/backend/tsconfig.json scripts/test-phase131-web-auth-contracts.ts
//
// Covers: Zod contracts, PKCE (RFC 7636 vector), state/nonce/replay, real
// provider code-exchange mapping, Account-first provisioning, verified-email
// linking, unverified-email takeover guard, legacy LINE migration, email magic
// link single-use, rate limiting, controller helpers and SMTP/API delivery.
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import {
  WebAuthStartInputSchema,
  WebAuthCallbackInputSchema,
  MagicLinkRequestSchema,
  MagicLinkVerifySchema,
  OAuthStateRecordSchema,
  WebAuthSessionResponseSchema,
  sanitizeNextPath,
  pkceChallengeFromVerifier,
} from '../packages/shared/src/schemas/web-auth.schema';
import { TokenService } from '../apps/backend/src/modules/auth/services/token.service';
import { AuthService } from '../apps/backend/src/modules/auth/services/auth.service';
import {
  OAuthCodeExchangeService,
  createCodeChallenge,
  createCodeVerifier,
} from '../apps/backend/src/modules/auth/services/oauth-code-exchange.service';
import { WebAuthService } from '../apps/backend/src/modules/auth/services/web-auth.service';
import { EmailAuthService } from '../apps/backend/src/modules/auth/services/email-auth.service';
import { EmailSenderService } from '../apps/backend/src/modules/auth/services/email-sender.service';
import {
  AuthRateLimitService,
  AUTH_RATE_LIMITS,
} from '../apps/backend/src/modules/auth/services/auth-rate-limit.service';
import {
  webAuthBearerToken,
  webAuthClientMeta,
} from '../apps/backend/src/modules/auth/controllers/web-auth.controller';
import type { PrismaService } from '../apps/backend/src/infra/database/prisma.service';
import type { RedisClusterService } from '../apps/backend/src/infra/redis/redis-cluster.service';
import type { LineOAuthAdapter } from '../apps/backend/src/modules/auth/adapters/line-oauth.adapter';

const TENANT_ID = '123e4567-e89b-12d3-a456-426614174000';
const OTHER_TENANT_ID = '123e4567-e89b-12d3-a456-426614174009';
const REDIRECT = 'https://app.example.com/api/auth/callback/line';
const GOOGLE_REDIRECT = 'https://app.example.com/api/auth/callback/google';
const CTX = { clientIp: '203.0.113.9', userAgent: 'Phase131Test/1.0' };

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const ENV_KEYS = [
  'NODE_ENV',
  'LINE_LOGIN_CHANNEL_ID',
  'LINE_LOGIN_CHANNEL_SECRET',
  'LINE_LOGIN_SCOPE',
  'LINE_EMAIL_VERIFIED',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_OIDC_SCOPE',
  'WEB_APP_URL',
  'EMAIL_API_URL',
  'EMAIL_API_KEY',
  'EMAIL_FROM',
  'EMAIL_FROM_NAME',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USER',
  'SMTP_PASS',
] as const;

function snapshotEnv(): Record<string, string | undefined> {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const key of ENV_KEYS) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
}

// ---------------------------------------------------------------------------
// Fakes (structural, zero external I/O)
// ---------------------------------------------------------------------------
interface FakeUser {
  id: string;
  lineUserId: string | null;
  email: string | null;
  displayName: string;
  avatarUrl: string | null;
  role: string;
  tenantId: string | null;
  walletBalance?: number;
  rewardPoints?: number;
  affiliateCode?: string;
  createdAt?: Date;
}

interface FakeAccount {
  id: string;
  userId: string;
  provider: string;
  providerAccountId: string;
}

interface FakeSession {
  id: string;
  userId: string;
  tenantId: string;
  sessionToken: string;
  refreshToken: string;
  isRevoked: boolean;
  expiresAt: Date;
}

function createRuntime(seed: { users?: FakeUser[]; tenants?: Array<{ id: string; slug: string; isActive: boolean }> } = {}) {
  const users = new Map<string, FakeUser>();
  const accounts = new Map<string, FakeAccount>();
  const sessions = new Map<string, FakeSession>();
  const audits: Array<Record<string, unknown>> = [];
  const tenants = new Map<string, { id: string; slug: string; isActive: boolean }>();
  let seq = 0;
  const uuid = () => `123e4567-e89b-12d3-a456-${String(426614174100 + seq++).padStart(12, '0')}`;

  for (const user of seed.users ?? []) users.set(user.id, { ...user });
  for (const tenant of seed.tenants ?? [TENANT_ID, OTHER_TENANT_ID].map((id, index) => ({
    id,
    slug: index === 0 ? 'default' : `tenant-${index}`,
    isActive: true,
  }))) {
    tenants.set(tenant.id, { ...tenant });
  }

  function cloneUser(user: FakeUser): FakeUser {
    return { ...user };
  }

  function matchUser(where: Record<string, unknown>): FakeUser | null {
    for (const user of users.values()) {
      if (where.id !== undefined && user.id !== where.id) continue;
      if (where.lineUserId !== undefined && user.lineUserId !== where.lineUserId) continue;
      if (where.email !== undefined && user.email !== where.email) continue;
      if (where.affiliateCode !== undefined && user.affiliateCode !== where.affiliateCode) continue;
      return user;
    }
    return null;
  }

  const accountKey = (provider: string, providerAccountId: string) => `${provider}:${providerAccountId}`;

  const tx = {
    user: {
      findUnique: async (args: { where: Record<string, unknown> }) => {
        const user = matchUser(args.where);
        return user ? cloneUser(user) : null;
      },
      create: async (args: { data: Record<string, unknown> }) => {
        const user: FakeUser = {
          id: uuid(),
          lineUserId: (args.data.lineUserId as string | null) ?? null,
          email: (args.data.email as string | null) ?? null,
          displayName: (args.data.displayName as string) ?? 'Member',
          avatarUrl: (args.data.avatarUrl as string | null) ?? null,
          role: (args.data.role as string) ?? 'MEMBER',
          tenantId: (args.data.tenantId as string | null) ?? null,
          walletBalance: 0,
          rewardPoints: 0,
          affiliateCode: uuid(),
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        };
        users.set(user.id, user);
        return cloneUser(user);
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const user = users.get(args.where.id);
        if (!user) throw new Error('user not found');
        const next = { ...user, ...args.data };
        users.set(next.id, next);
        return cloneUser(next);
      },
    },
    account: {
      findUnique: async (args: { where: { provider_providerAccountId: { provider: string; providerAccountId: string } }; include?: { user?: boolean } }) => {
        const { provider, providerAccountId } = args.where.provider_providerAccountId;
        const account = accounts.get(accountKey(provider, providerAccountId));
        if (!account) return null;
        const user = users.get(account.userId);
        return { ...account, ...(args.include?.user ? { user: user ? cloneUser(user) : null } : {}) };
      },
      create: async (args: { data: { userId: string; provider: string; providerAccountId: string } }) => {
        const key = accountKey(args.data.provider, args.data.providerAccountId);
        if (accounts.has(key)) {
          const err = new Error('duplicate') as Error & { code: string };
          err.code = 'P2002';
          throw err;
        }
        const account: FakeAccount = { id: uuid(), ...args.data };
        accounts.set(key, account);
        return { ...account };
      },
      upsert: async (args: {
        where: { provider_providerAccountId: { provider: string; providerAccountId: string } };
        create: { userId: string; provider: string; providerAccountId: string };
      }) => {
        const key = accountKey(args.create.provider, args.create.providerAccountId);
        const existing = accounts.get(key);
        if (existing) return { ...existing };
        const account: FakeAccount = { id: uuid(), ...args.create };
        accounts.set(key, account);
        return { ...account };
      },
    },
    authAuditLog: {
      create: async (args: { data: Record<string, unknown> }) => {
        audits.push(args.data);
        return args.data;
      },
    },
    session: {
      create: async (args: { data: Record<string, unknown> }) => {
        const session: FakeSession = {
          id: uuid(),
          userId: args.data.userId as string,
          tenantId: args.data.tenantId as string,
          sessionToken: args.data.sessionToken as string,
          refreshToken: args.data.refreshToken as string,
          isRevoked: false,
          expiresAt: args.data.expiresAt as Date,
        };
        sessions.set(session.id, session);
        return { ...session };
      },
      findUnique: async (args: { where: Record<string, unknown>; include?: { user?: boolean } }) => {
        for (const session of sessions.values()) {
          if (args.where.id !== undefined && session.id !== args.where.id) continue;
          if (args.where.refreshToken !== undefined && session.refreshToken !== args.where.refreshToken) continue;
          const user = users.get(session.userId);
          return { ...session, ...(args.include?.user ? { user: user ? cloneUser(user) : null } : {}) };
        }
        return null;
      },
      findFirst: async (args: { where: Record<string, unknown> }) => {
        for (const session of sessions.values()) {
          if (args.where.userId !== undefined && session.userId !== args.where.userId) continue;
          return { ...session };
        }
        return null;
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown>; include?: { user?: boolean } }) => {
        const session = sessions.get(args.where.id);
        if (!session) throw new Error('session not found');
        const next = { ...session, ...args.data };
        sessions.set(next.id, next);
        const user = users.get(next.userId);
        return { ...next, ...(args.include?.user ? { user: user ? cloneUser(user) : null } : {}) };
      },
      updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        let count = 0;
        for (const [id, session] of sessions) {
          if (args.where.userId !== undefined && session.userId !== args.where.userId) continue;
          sessions.set(id, { ...session, ...args.data });
          count++;
        }
        return { count };
      },
    },
  };

  const tenant = {
    findUnique: async (args: { where: { id?: string; slug?: string } }) => {
      for (const item of tenants.values()) {
        if (args.where.id !== undefined && item.id !== args.where.id) continue;
        if (args.where.slug !== undefined && item.slug !== args.where.slug) continue;
        return { ...item };
      }
      return null;
    },
    create: async (args: { data: { slug: string; name: string; isActive: boolean } }) => {
      const created = { id: uuid(), slug: args.data.slug, isActive: args.data.isActive };
      tenants.set(created.id, created);
      return { ...created };
    },
  };

  const prisma = {
    ...tx,
    tenant,
    $transaction: async <T>(fn: (client: typeof tx) => Promise<T>): Promise<T> => fn(tx),
  };

  const cache = new Map<string, { value: string; expiresAt: number }>();
  const redis = {
    get: async (key: string) => {
      const item = cache.get(key);
      if (!item) return null;
      if (item.expiresAt <= Date.now()) {
        cache.delete(key);
        return null;
      }
      return item.value;
    },
    setex: async (key: string, ttl: number, value: string) => {
      cache.set(key, { value, expiresAt: Date.now() + ttl * 1000 });
    },
    del: async (key: string) => {
      cache.delete(key);
    },
    getdel: async (key: string) => {
      const item = cache.get(key);
      cache.delete(key);
      return item?.value ?? null;
    },
    incr: async (key: string) => {
      const current = Number((await redis.get(key)) ?? '0') + 1;
      const existing = cache.get(key);
      cache.set(key, { value: String(current), expiresAt: existing?.expiresAt ?? Date.now() + 60_000 });
      return current;
    },
    expire: async (key: string, ttl: number) => {
      const item = cache.get(key);
      if (item) cache.set(key, { value: item.value, expiresAt: Date.now() + ttl * 1000 });
    },
    publish: async () => undefined,
  };

  return { prisma, redis, users, accounts, sessions, audits, cache };
}

function buildAuth(runtime: ReturnType<typeof createRuntime>) {
  return new AuthService(
    runtime.prisma as unknown as PrismaService,
    runtime.redis as unknown as RedisClusterService,
    new TokenService('phase131-test-secret', null),
    {} as LineOAuthAdapter,
  );
}

function peekState(redis: ReturnType<typeof createRuntime>['redis'], state: string) {
  return redis.get(`webauth:state:${state}`).then((raw) => (raw ? JSON.parse(raw) : null));
}

async function main(): Promise<void> {
  const envSnapshot = snapshotEnv();
  let realFetch: typeof fetch = globalThis.fetch;
  process.env.NODE_ENV = 'test';
  process.env.LINE_LOGIN_CHANNEL_ID = 'test-line-channel';
  process.env.LINE_LOGIN_CHANNEL_SECRET = 'test-line-secret';
  process.env.GOOGLE_CLIENT_ID = 'test-google-client';
  process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret';
  process.env.EMAIL_FROM = 'no-reply@test.dev';
  delete process.env.WEB_APP_URL;
  delete process.env.SMTP_HOST;
  delete process.env.EMAIL_API_URL;

  try {
    // -----------------------------------------------------------------------
    // 1. Zod contracts + pure helpers
    // -----------------------------------------------------------------------
    {
      assert.equal(
        WebAuthStartInputSchema.safeParse({
          provider: 'LINE_WEB',
          tenant: 'default',
          redirectUri: REDIRECT,
          next: '/library',
        }).success,
        true,
      );
      assert.equal(
        WebAuthStartInputSchema.safeParse({ provider: 'FACEBOOK', tenant: 'default', redirectUri: REDIRECT }).success,
        false,
      );
      assert.equal(
        WebAuthStartInputSchema.safeParse({ provider: 'GOOGLE', tenant: '', redirectUri: REDIRECT }).success,
        false,
      );
      assert.equal(
        WebAuthStartInputSchema.safeParse({ provider: 'GOOGLE', tenant: 'default', redirectUri: 'not-a-url' }).success,
        false,
      );
      ok('WebAuthStartInputSchema enforces provider / tenant / redirectUri');

      assert.equal(
        WebAuthCallbackInputSchema.safeParse({
          provider: 'GOOGLE',
          code: 'code',
          state: 'x'.repeat(32),
          redirectUri: GOOGLE_REDIRECT,
        }).success,
        true,
      );
      assert.equal(
        WebAuthCallbackInputSchema.safeParse({ provider: 'GOOGLE', code: '', state: 'short', redirectUri: GOOGLE_REDIRECT })
          .success,
        false,
      );
      ok('WebAuthCallbackInputSchema rejects empty code / short state');

      assert.equal(MagicLinkRequestSchema.parse({ email: ' USER@Example.COM ', tenant: 'default', appUrl: 'https://a.dev' }).email, 'user@example.com');
      assert.equal(MagicLinkRequestSchema.safeParse({ email: 'nope', tenant: 'default', appUrl: 'https://a.dev' }).success, false);
      assert.equal(MagicLinkVerifySchema.safeParse({ token: 'short' }).success, false);
      ok('MagicLink schemas normalise email + enforce token length');

      assert.equal(sanitizeNextPath('/library?x=1'), '/library?x=1');
      assert.equal(sanitizeNextPath('//evil.example'), '/');
      assert.equal(sanitizeNextPath('https://evil.example'), '/');
      assert.equal(sanitizeNextPath('/\\evil'), '/');
      assert.equal(sanitizeNextPath('/ok\\bad'), '/');
      assert.equal(sanitizeNextPath('/\u0000bad'), '/');
      assert.equal(sanitizeNextPath(undefined), '/');
      ok('sanitizeNextPath blocks open redirects and control characters');

      // RFC 7636 Appendix B test vector
      const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
      assert.equal(pkceChallengeFromVerifier(verifier), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
      assert.equal(createCodeChallenge(verifier), pkceChallengeFromVerifier(verifier));
      assert.ok(createCodeVerifier().length >= 43);
      ok('PKCE S256 matches RFC 7636 test vector');

      assert.equal(
        OAuthStateRecordSchema.safeParse({
          provider: 'LINE_WEB',
          tenantId: TENANT_ID,
          redirectUri: REDIRECT,
          codeVerifier: 'v'.repeat(43),
          nonce: 'n'.repeat(16),
          next: '/',
          createdAt: Date.now(),
        }).success,
        true,
      );
      ok('OAuthStateRecordSchema validates server records');
    }

    // -----------------------------------------------------------------------
    // 2. OAuthCodeExchangeService (URL builders + token exchange mapping)
    // -----------------------------------------------------------------------
    let lineProfile: Record<string, unknown> = {};
    let googleProfile: Record<string, unknown> = {};
    const fakeLineVerifier = { verifyIdToken: async () => lineProfile };
    const fakeGoogle = { verifyIdToken: async () => googleProfile };
    const exchange = new OAuthCodeExchangeService(
      fakeLineVerifier as never,
      fakeGoogle as never,
    );

    const lineUrl = new URL(
      exchange.buildAuthorizeUrl({
        provider: 'LINE_WEB',
        redirectUri: REDIRECT,
        state: 'state-value',
        nonce: 'nonce-value',
        codeChallenge: 'challenge-value',
      }),
    );
    assert.equal(lineUrl.origin + lineUrl.pathname, 'https://access.line.me/oauth2/v2.1/authorize');
    assert.equal(lineUrl.searchParams.get('client_id'), 'test-line-channel');
    assert.equal(lineUrl.searchParams.get('response_type'), 'code');
    assert.equal(lineUrl.searchParams.get('state'), 'state-value');
    assert.equal(lineUrl.searchParams.get('nonce'), 'nonce-value');
    assert.equal(lineUrl.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(lineUrl.searchParams.get('client_secret'), null);
    assert.ok((lineUrl.searchParams.get('scope') ?? '').includes('openid'));
    ok('LINE authorize URL carries PKCE/state/nonce and never the client secret');

    const googleUrl = new URL(
      exchange.buildAuthorizeUrl({
        provider: 'GOOGLE',
        redirectUri: GOOGLE_REDIRECT,
        state: 's',
        nonce: 'n',
        codeChallenge: 'c',
      }),
    );
    assert.equal(googleUrl.origin + googleUrl.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(googleUrl.searchParams.get('client_id'), 'test-google-client');
    assert.equal(googleUrl.searchParams.get('prompt'), 'select_account');
    assert.ok((googleUrl.searchParams.get('scope') ?? '').includes('email'));
    ok('Google authorize URL requests OIDC email scope');

    realFetch = globalThis.fetch;
    let tokenResponse: Record<string, unknown> = { id_token: 'line.id.token' };    let tokenStatus = 200;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      assert.ok(url.includes('token'));
      return new Response(JSON.stringify(tokenResponse), { status: tokenStatus });
    }) as typeof fetch;

    lineProfile = {
      iss: 'https://access.line.me',
      sub: 'U_LINE_WEB_1',
      aud: 'test-line-channel',
      exp: Math.floor(Date.now() / 1000) + 300,
      iat: Math.floor(Date.now() / 1000),
      nonce: 'nonce-1',
      name: 'LINE Web User',
      picture: 'https://img.example/line.png',
      email: 'line@example.com',
    };
    const lineIdentity = await exchange.exchange({
      provider: 'LINE_WEB',
      code: 'auth-code',
      redirectUri: REDIRECT,
      codeVerifier: 'v'.repeat(43),
    });
    assert.equal(lineIdentity.provider, 'LINE_WEB');
    assert.equal(lineIdentity.providerAccountId, 'U_LINE_WEB_1');
    assert.equal(lineIdentity.email, 'line@example.com');
    assert.equal(lineIdentity.emailVerified, false, 'LINE email is never auto-link trusted');
    assert.equal(lineIdentity.nonce, 'nonce-1');
    ok('LINE code exchange maps a verified id_token into WebIdentity (email unverified)');

    googleProfile = {
      sub: 'google-sub-1',
      name: 'Google User',
      picture: 'https://img.example/google.png',
      email: 'google@example.com',
      emailVerified: true,
      nonce: 'nonce-2',
    };
    const googleIdentity = await exchange.exchange({
      provider: 'GOOGLE',
      code: 'auth-code',
      redirectUri: GOOGLE_REDIRECT,
      codeVerifier: 'v'.repeat(43),
    });
    assert.equal(googleIdentity.provider, 'GOOGLE');
    assert.equal(googleIdentity.emailVerified, true);
    ok('Google code exchange keeps email_verified=true');

    tokenStatus = 400;
    await assert.rejects(
      () =>
        exchange.exchange({
          provider: 'GOOGLE',
          code: 'bad',
          redirectUri: GOOGLE_REDIRECT,
          codeVerifier: 'v'.repeat(43),
        }),
      /OAUTH_CODE_EXCHANGE_FAILED/,
    );
    tokenStatus = 200;
    ok('Token endpoint failures are surfaced as OAUTH_CODE_EXCHANGE_FAILED');
    tokenResponse = { id_token: 'line.id.token' };
    // -----------------------------------------------------------------------
    // 3. WebAuthService: state, PKCE, nonce, replay, provisioning
    // -----------------------------------------------------------------------
    {
      const runtime = createRuntime();
      const auth = buildAuth(runtime);
      const rateLimit = new AuthRateLimitService(runtime.redis as unknown as RedisClusterService);
      const webAuth = new WebAuthService(
        runtime.prisma as unknown as PrismaService,
        runtime.redis as unknown as RedisClusterService,
        auth,
        exchange,
        rateLimit,
      );

      await assert.rejects(
        () => webAuth.start({ provider: 'LINE_WEB', tenant: 'missing', redirectUri: REDIRECT }, CTX),
        /Unknown or inactive tenant/,
      );
      ok('start rejects unknown tenants');

      const started = await webAuth.start(
        { provider: 'LINE_WEB', tenant: 'default', redirectUri: REDIRECT, next: '//evil.example' },
        CTX,
      );
      assert.ok(started.authorizeUrl.startsWith('https://access.line.me/oauth2/v2.1/authorize?'));
      assert.ok(started.state.length >= 32);
      const record = await peekState(runtime.redis, started.state);
      assert.ok(record);
      assert.equal(record.provider, 'LINE_WEB');
      assert.equal(record.tenantId, TENANT_ID);
      assert.equal(record.redirectUri, REDIRECT);
      assert.equal(record.next, '/', 'unsafe next is sanitised at start');
      assert.equal(createCodeChallenge(record.codeVerifier), new URL(started.authorizeUrl).searchParams.get('code_challenge'));
      ok('start persists a single-use state record with PKCE challenge + sanitised next');

      lineProfile = { ...lineProfile, nonce: record.nonce };
      const session = await webAuth.handleCallback(
        { provider: 'LINE_WEB', code: 'auth-code', state: started.state, redirectUri: REDIRECT },
        CTX,
      );
      const parsed = WebAuthSessionResponseSchema.parse(session);
      assert.equal(parsed.isNewUser, true);
      assert.equal(parsed.next, '/');
      assert.equal(parsed.user.tenantId, TENANT_ID);
      assert.equal(parsed.user.email, 'line@example.com');
      assert.equal(await runtime.redis.get(`webauth:state:${started.state}`), null, 'state is consumed');
      assert.ok(runtime.accounts.has('LINE_WEB:U_LINE_WEB_1'));
      assert.equal(runtime.sessions.size, 1);
      ok('callback provisions User + Account + session and consumes state');

      await assert.rejects(
        () => webAuth.handleCallback({ provider: 'LINE_WEB', code: 'auth-code', state: started.state, redirectUri: REDIRECT }, CTX),
        /state is invalid or expired/,
      );
      ok('replayed authorization response is rejected (GETDEL)');

      // Returning identity → same user, no duplicate Account.
      const second = await webAuth.start({ provider: 'LINE_WEB', tenant: 'default', redirectUri: REDIRECT }, CTX);
      const secondRecord = await peekState(runtime.redis, second.state);
      lineProfile = { ...lineProfile, nonce: secondRecord.nonce, name: 'Renamed' };
      const secondSession = await webAuth.handleCallback(
        { provider: 'LINE_WEB', code: 'auth-code', state: second.state, redirectUri: REDIRECT },
        CTX,
      );
      assert.equal(secondSession.user.id, session.user.id);
      assert.equal(secondSession.isNewUser, false);
      assert.equal(runtime.accounts.size, 1);
      ok('returning Account login reuses the same User UUID');

      // Provider mismatch
      const mismatch = await webAuth.start({ provider: 'LINE_WEB', tenant: 'default', redirectUri: REDIRECT }, CTX);
      await assert.rejects(
        () => webAuth.handleCallback({ provider: 'GOOGLE', code: 'c', state: mismatch.state, redirectUri: REDIRECT }, CTX),
        /provider mismatch/,
      );
      ok('callback rejects a state minted for another provider');

      // Redirect URI mismatch
      const redirectMismatch = await webAuth.start({ provider: 'LINE_WEB', tenant: 'default', redirectUri: REDIRECT }, CTX);
      await assert.rejects(
        () =>
          webAuth.handleCallback(
            { provider: 'LINE_WEB', code: 'c', state: redirectMismatch.state, redirectUri: 'https://evil.example/cb' },
            CTX,
          ),
        /redirect URI mismatch/,
      );
      ok('callback rejects a redirectUri that differs from the authorize request');

      // Nonce mismatch
      const nonceState = await webAuth.start({ provider: 'LINE_WEB', tenant: 'default', redirectUri: REDIRECT }, CTX);
      lineProfile = { ...lineProfile, nonce: 'attacker-nonce' };
      await assert.rejects(
        () =>
          webAuth.handleCallback(
            { provider: 'LINE_WEB', code: 'c', state: nonceState.state, redirectUri: REDIRECT },
            CTX,
          ),
        /nonce mismatch/,
      );
      ok('callback binds the id_token nonce to the stored state');
    }

    // -----------------------------------------------------------------------
    // 4. Provisioning safety: verified-email link / unverified no-link / legacy
    // -----------------------------------------------------------------------
    {
      const emailUser: FakeUser = {
        id: '223e4567-e89b-12d3-a456-426614174001',
        lineUserId: null,
        email: 'shared@example.com',
        displayName: 'Existing Email User',
        avatarUrl: null,
        role: 'MEMBER',
        tenantId: TENANT_ID,
      };
      const runtime = createRuntime({ users: [emailUser] });
      const auth = buildAuth(runtime);
      googleProfile = {
        sub: 'google-shared',
        name: 'Google Shared',
        picture: null,
        email: 'shared@example.com',
        emailVerified: true,
        nonce: null,
      };
      const linked = await auth.provisionWebIdentity(
        {
          provider: 'GOOGLE',
          providerAccountId: 'google-shared',
          email: 'shared@example.com',
          emailVerified: true,
          displayName: 'Google Shared',
          avatarUrl: null,
        },
        TENANT_ID,
        CTX,
      );
      assert.equal(linked.user.id, emailUser.id, 'verified email links to existing user');
      assert.equal(linked.isNew, false);
      assert.equal(linked.linked, true);
      assert.ok(runtime.accounts.has('GOOGLE:google-shared'));
      assert.ok(runtime.audits.some((a) => a.event === 'ACCOUNT_LINKED' && (a.metadata as { reason?: string })?.reason === 'verified_email'));
      ok('verified email auto-links to the existing User (audit written)');

      const runtime2 = createRuntime({ users: [{ ...emailUser }] });
      const auth2 = buildAuth(runtime2);
      const unverified = await auth2.provisionWebIdentity(
        {
          provider: 'LINE_WEB',
          providerAccountId: 'U_UNVERIFIED',
          email: 'shared@example.com',
          emailVerified: false,
          displayName: 'LINE Unverified',
          avatarUrl: null,
        },
        TENANT_ID,
        CTX,
      );
      assert.notEqual(unverified.user.id, emailUser.id, 'unverified email must not take over an account');
      assert.equal(unverified.user.email, null, 'colliding unverified email is not stored');
      ok('unverified email never auto-links or collides');

      const legacyUser: FakeUser = {
        id: '323e4567-e89b-12d3-a456-426614174002',
        lineUserId: 'U_LEGACY',
        email: null,
        displayName: 'Legacy LINE',
        avatarUrl: null,
        role: 'MEMBER',
        tenantId: TENANT_ID,
      };
      const runtime3 = createRuntime({ users: [legacyUser] });
      const auth3 = buildAuth(runtime3);
      const migrated = await auth3.provisionWebIdentity(
        {
          provider: 'LINE_WEB',
          providerAccountId: 'U_LEGACY',
          email: null,
          emailVerified: false,
          displayName: 'Legacy LINE',
          avatarUrl: null,
        },
        TENANT_ID,
        CTX,
      );
      assert.equal(migrated.user.id, legacyUser.id);
      assert.equal(migrated.linked, true);
      assert.ok(runtime3.accounts.has('LINE_WEB:U_LEGACY'));
      ok('legacy User.lineUserId rows are migrated into Account on first web login');
    }

    // -----------------------------------------------------------------------
    // 5. Email magic link (hashed at rest, single use, rate limited)
    // -----------------------------------------------------------------------
    {
      const runtime = createRuntime();
      const auth = buildAuth(runtime);
      const rateLimit = new AuthRateLimitService(runtime.redis as unknown as RedisClusterService);
      const webAuth = new WebAuthService(
        runtime.prisma as unknown as PrismaService,
        runtime.redis as unknown as RedisClusterService,
        auth,
        exchange,
        rateLimit,
      );
      const sent: Array<{ to: string; link: string; ttl: number }> = [];
      const sender = {
        sendMagicLink: async (to: string, link: string, ttl: number) => {
          sent.push({ to, link, ttl });
        },
      };
      const emailAuth = new EmailAuthService(
        runtime.redis as unknown as RedisClusterService,
        auth,
        sender as never,
        webAuth,
        rateLimit,
      );

      const accepted = await emailAuth.request(
        { email: 'Magic@Example.com', tenant: 'default', appUrl: 'https://app.example.com', next: '/library' },
        CTX,
      );
      assert.equal(accepted.ok, true);
      assert.equal(sent.length, 1);
      assert.equal(sent[0].to, 'magic@example.com');
      assert.ok(sent[0].link.startsWith('https://app.example.com/api/auth/email/verify?token='));
      const token = new URL(sent[0].link).searchParams.get('token') ?? '';
      assert.ok(token.length >= 40);
      assert.equal(await runtime.redis.get(`webauth:magic:${token}`), null, 'raw token is never a Redis key');
      assert.ok(runtime.cache.size >= 2, 'hash key + rate-limit counters exist');
      ok('magic link request stores only a SHA-256 hash and emails the one-time link');

      const session = await emailAuth.verify({ token }, CTX);
      assert.equal(session.isNewUser, true);
      assert.equal(session.next, '/library');
      assert.equal(session.user.email, 'magic@example.com');
      assert.ok(runtime.accounts.has('EMAIL:magic@example.com'));
      await assert.rejects(() => emailAuth.verify({ token }, CTX), /invalid or expired/);
      ok('magic link verification creates the account and rejects replay');

      // 3/5min per address: the 4th request must be HTTP 429.
      const rateRuntime = createRuntime();
      const rateAuth = buildAuth(rateRuntime);
      const rateLimit2 = new AuthRateLimitService(rateRuntime.redis as unknown as RedisClusterService);
      const rateWeb = new WebAuthService(
        rateRuntime.prisma as unknown as PrismaService,
        rateRuntime.redis as unknown as RedisClusterService,
        rateAuth,
        exchange,
        rateLimit2,
      );
      const sent2: string[] = [];
      const emailAuth2 = new EmailAuthService(
        rateRuntime.redis as unknown as RedisClusterService,
        rateAuth,
        { sendMagicLink: async (_to: string, link: string) => void sent2.push(link) } as never,
        rateWeb,
        rateLimit2,
      );
      let limited: unknown = null;
      for (let i = 0; i < 4; i++) {
        try {
          await emailAuth2.request(
            { email: 'rate@example.com', tenant: 'default', appUrl: 'https://app.example.com' },
            CTX,
          );
        } catch (err) {
          limited = err;
          break;
        }
      }
      assert.ok(limited && typeof (limited as { getStatus?: () => number }).getStatus === 'function');
      assert.equal((limited as { getStatus: () => number }).getStatus(), 429);
      assert.equal(sent2.length, 3);
      ok('email requests are rate limited per address (HTTP 429)');
    }

    // -----------------------------------------------------------------------
    // 6. Rate limiter behaviour + fail-open
    // -----------------------------------------------------------------------
    {
      const runtime = createRuntime();
      const limiter = new AuthRateLimitService(runtime.redis as unknown as RedisClusterService);
      for (let i = 0; i < AUTH_RATE_LIMITS.start.limit; i++) {
        assert.equal(await limiter.consume('start', CTX.clientIp, AUTH_RATE_LIMITS.start), true);
      }
      assert.equal(await limiter.consume('start', CTX.clientIp, AUTH_RATE_LIMITS.start), false);
      const broken = new AuthRateLimitService({ incr: async () => { throw new Error('down'); } } as never);
      assert.equal(await broken.consume('start', 'ip', AUTH_RATE_LIMITS.start), true);
      ok('rate limiter counts per window, blocks overage and fails open on Redis outage');
    }

    // -----------------------------------------------------------------------
    // 7. EmailSenderService: dev fallback, HTTP API, SMTP transport
    // -----------------------------------------------------------------------
    {
      // Provider token-exchange stubs end here; delivery uses the real fetch.
      globalThis.fetch = realFetch;
      const sender = new EmailSenderService();
      await sender.sendMail({ to: 'dev@example.com', subject: 'Dev', text: 'body' });
      ok('email sender falls back to console logging outside production');

      // HTTP API provider
      let apiPayload: Record<string, unknown> | null = null;
      let apiAuth = '';
      const apiServer = http.createServer((req, res) => {
        apiAuth = String(req.headers.authorization ?? '');
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          apiPayload = JSON.parse(body) as Record<string, unknown>;
          res.statusCode = 200;
          res.end('{}');
        });
      });
      await new Promise<void>((resolve) => apiServer.listen(0, '127.0.0.1', resolve));
      const apiPort = (apiServer.address() as net.AddressInfo).port;
      process.env.EMAIL_API_URL = `http://127.0.0.1:${apiPort}/send`;
      process.env.EMAIL_API_KEY = 'api-key';
      const apiSender = new EmailSenderService();
      await apiSender.sendMagicLink('api@example.com', 'https://app.example.com/api/auth/email/verify?token=t', 900);
      assert.equal(apiAuth, 'Bearer api-key');
      assert.ok(apiPayload);
      assert.deepEqual((apiPayload as { to: string[] }).to, ['api@example.com']);
      assert.ok(String((apiPayload as { html?: string }).html).includes('Sign in'));
      await new Promise<void>((resolve) => apiServer.close(() => resolve()));
      delete process.env.EMAIL_API_URL;
      delete process.env.EMAIL_API_KEY;
      ok('HTTP email API receives from/to/subject/html with bearer auth');

      // SMTP provider (fake server, no TLS/auth)
      let smtpMessage = '';
      let smtpRcpt = '';
      const smtpServer = net.createServer((socket) => {
        socket.write('220 fake.smtp ESMTP\r\n');
        let buffer = '';
        let dataMode = false;
        socket.on('data', (chunk) => {
          buffer += chunk.toString('utf8');
          for (;;) {
            if (dataMode) {
              const end = buffer.indexOf('\r\n.\r\n');
              if (end === -1) return;
              smtpMessage += buffer.slice(0, end);
              buffer = buffer.slice(end + 5);
              dataMode = false;
              socket.write('250 2.0.0 stored\r\n');
              continue;
            }
            const newline = buffer.indexOf('\r\n');
            if (newline === -1) return;
            const line = buffer.slice(0, newline);
            buffer = buffer.slice(newline + 2);
            if (/^EHLO/i.test(line)) socket.write('250-fake.smtp\r\n250 8BITMIME\r\n');
            else if (/^MAIL FROM/i.test(line)) socket.write('250 2.1.0 ok\r\n');
            else if (/^RCPT TO/i.test(line)) {
              smtpRcpt = line;
              socket.write('250 2.1.5 ok\r\n');
            } else if (/^DATA/i.test(line)) {
              dataMode = true;
              socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
            } else if (/^QUIT/i.test(line)) {
              socket.write('221 2.0.0 bye\r\n');
              socket.end();
            } else socket.write('250 2.0.0 ok\r\n');
          }
        });
      });
      await new Promise<void>((resolve) => smtpServer.listen(0, '127.0.0.1', resolve));
      const smtpPort = (smtpServer.address() as net.AddressInfo).port;
      process.env.SMTP_HOST = '127.0.0.1';
      process.env.SMTP_PORT = String(smtpPort);
      process.env.SMTP_SECURE = 'false';
      const smtpSender = new EmailSenderService();
      await smtpSender.sendMail({
        to: 'smtp@example.com',
        subject: 'SMTP subject',
        text: 'SMTP body',
        html: '<p>SMTP body</p>',
      });
      await new Promise<void>((resolve) => smtpServer.close(() => resolve()));
      assert.ok(smtpRcpt.includes('<smtp@example.com>'));
      assert.ok(smtpMessage.includes('Subject: SMTP subject'));
      assert.ok(smtpMessage.includes('multipart/alternative'));
      delete process.env.SMTP_HOST;
      delete process.env.SMTP_PORT;
      ok('SMTP transport performs EHLO/MAIL/RCPT/DATA with a multipart message');

      process.env.NODE_ENV = 'production';
      const unconfigured = new EmailSenderService();
      await assert.rejects(
        () => unconfigured.sendMail({ to: 'x@example.com', subject: 'x', text: 'x' }),
        /Email delivery is not configured/,
      );
      process.env.NODE_ENV = 'test';
      ok('production refuses to silently drop email when unconfigured');
    }

    // -----------------------------------------------------------------------
    // 8. Controller helpers
    // -----------------------------------------------------------------------
    {
      assert.deepEqual(
        webAuthClientMeta({ ip: '1.2.3.4', headers: { 'user-agent': 'UA' } }),
        { clientIp: '1.2.3.4', userAgent: 'UA' },
      );
      assert.equal(webAuthClientMeta({ headers: {} }).clientIp, 'unknown');
      assert.equal(webAuthClientMeta({ headers: { 'user-agent': 'x'.repeat(900) } }).userAgent.length, 500);
      assert.equal(webAuthBearerToken('Bearer abc.def'), 'abc.def');
      assert.throws(() => webAuthBearerToken(undefined), /Missing access token/);
      assert.throws(() => webAuthBearerToken('Basic abc'), /Missing access token/);
      ok('controller helpers normalise client metadata and bearer tokens');
    }
  } finally {
    globalThis.fetch = realFetch;
    restoreEnv(envSnapshot);
  }

  console.log(`\nphase131 web-auth contract tests: ${passed} groups passed`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
