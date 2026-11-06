// SSOT Phase 005 §5.2 — Core Auth logic & Account Linking Engine
// Dual-token issuance (15m access / 7d single-use refresh), atomic user link/create,
// Redis edge session cache (<1ms verify) with PostgreSQL fallback (self-healing §10.2).
import { Injectable, UnauthorizedException, BadRequestException, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  LineLiffAuthInputSchema,
  LiffAuthInputSchema,
  WebOAuthInputSchema,
  AuthProviderEnum,
  type LineLiffAuthInput,
  type LiffAuthInput,
  type AuthResponse,
  type AuthTokenResponse,
  type WebIdentity,
} from '@repo/shared';
import { PrismaService } from '../../../infra/database/prisma.service';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import { TokenService } from './token.service';
import { LineOAuthAdapter } from '../adapters/line-oauth.adapter';
import { LineVerifierService } from './line-verifier.service';
import { OAuthCodeExchangeService } from './oauth-code-exchange.service';

export interface AuthRequestContext {
  clientIp: string;
  userAgent: string;
}

export interface LinkedUser {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  email: string | null;
  lineUserId: string | null;
  role: string;
  // Phase 006 enrichment (same User row — no extra query)
  tenantId: string | null;
  walletBalance: number;
  rewardPoints: number;
  affiliateCode: string;
  createdAt: Date;
}

export interface WebProvisionResult {
  user: LinkedUser;
  isNew: boolean;
  linked: boolean;
}

/** Structural account delegate (keeps legacy test doubles without `account` working). */
interface AccountDelegateLike {
  findUnique(args: unknown): Promise<{ id: string; userId: string; user?: unknown } | null>;
  create(args: unknown): Promise<unknown>;
  upsert(args: unknown): Promise<unknown>;
}

function accountDelegate(tx: unknown): AccountDelegateLike | null {
  const delegate = (tx as { account?: AccountDelegateLike } | null | undefined)?.account;
  return delegate && typeof delegate.upsert === 'function' ? delegate : null;
}

function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === 'P2002';
}

function toLinkedUser(row: {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  email: string | null;
  lineUserId: string | null;
  role: string;
  tenantId?: string | null;
  walletBalance?: number | { toNumber(): number };
  rewardPoints?: number;
  affiliateCode?: string;
  createdAt?: Date;
}): LinkedUser {
  return {
    id: row.id,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    email: row.email,
    lineUserId: row.lineUserId,
    role: row.role,
    tenantId: row.tenantId ?? null,
    walletBalance: typeof row.walletBalance === 'number' ? row.walletBalance : (row.walletBalance?.toNumber() ?? 0),
    rewardPoints: row.rewardPoints ?? 0,
    affiliateCode: row.affiliateCode ?? '',
    createdAt: row.createdAt ?? new Date(0),
  };
}

const SESSION_TTL_SEC = 900; // 15m edge cache
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7d

function defaultDisplayName(identity: WebIdentity): string {
  if (identity.email) return identity.email.split('@')[0] || 'Member';
  if (identity.provider === 'LINE_LIFF' || identity.provider === 'LINE_WEB') return 'LINE User';
  if (identity.provider === 'GOOGLE') return 'Google User';
  return 'Member';
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
    private readonly tokens: TokenService,
    private readonly lineAdapter: LineOAuthAdapter,
    @Optional() private readonly lineVerifier?: LineVerifierService,
    @Optional() private readonly oauthExchange?: OAuthCodeExchangeService,
  ) {}

  async authenticateLineLiff(
    rawInput: LineLiffAuthInput,
    ctx: AuthRequestContext,
  ): Promise<AuthResponse & { refreshToken: string; sessionId: string }> {
    const parsed = LineLiffAuthInputSchema.safeParse(rawInput);
    if (!parsed.success) throw new BadRequestException('Invalid LINE LIFF authentication input');
    const input = parsed.data;

    const lineProfile = await this.lineAdapter.verifyIdToken(input.idToken);
    if (!lineProfile?.sub) throw new UnauthorizedException('Invalid LINE ID Token Signature');

    const lineUserId = lineProfile.sub;
    const email = lineProfile.email ?? null;

    // Atomic transaction: find-or-link-or-create (Gate 7)
    const provisioned = (await this.prisma.$transaction(async (tx) => {
      let existing = await tx.user.findUnique({ where: { lineUserId } });
      // Phase 131 identity convergence: a user who first signed up through
      // LINE Web OAuth owns an Account row but may not have User.lineUserId yet.
      if (!existing) {
        const account = accountDelegate(tx);
        if (account) {
          const webLink = await account.findUnique({
            where: {
              provider_providerAccountId: { provider: 'LINE_WEB', providerAccountId: lineUserId },
            },
            include: { user: true },
          });
          const linkedId = (webLink?.user as { id?: string } | null | undefined)?.id;
          if (linkedId) {
            existing = await tx.user.update({
              where: { id: linkedId },
              data: { lineUserId, avatarUrl: lineProfile.picture ?? undefined },
            });
          }
        }
      }
      if (!existing && email) {
        const byEmail = await tx.user.findUnique({ where: { email } });
        if (byEmail) {
          existing = await tx.user.update({
            where: { id: byEmail.id },
            data: { lineUserId, avatarUrl: byEmail.avatarUrl ?? lineProfile.picture },
          });
          await tx.authAuditLog
            .create({
              data: {
                userId: byEmail.id,
                tenantId: input.tenantId,
                event: 'ACCOUNT_LINKED',
                ipAddress: ctx.clientIp,
                userAgent: ctx.userAgent,
                metadata: { provider: 'LINE_LIFF' },
              },
            })
            .catch(() => undefined);
        }
      }
      if (!existing) {
        existing = await tx.user.create({
          data: {
            lineUserId,
            email,
            displayName: lineProfile.name ?? 'LINE User',
            avatarUrl: lineProfile.picture,
            role: 'MEMBER',
            ...(input.referralCode
              ? { referredById: await this.resolveReferralId(tx, input.referralCode) }
              : {}),
          },
        });
      }
      // Phase 131: every authenticated identity is also recorded in `Account`
      // so web/QR/LIFF sessions converge on a single User row.
      const account = accountDelegate(tx);
      if (account) {
        await account.upsert({
          where: {
            provider_providerAccountId: { provider: 'LINE_LIFF', providerAccountId: lineUserId },
          },
          update: {},
          create: { userId: existing.id, provider: 'LINE_LIFF', providerAccountId: lineUserId },
        });
      }
      return existing;
    })) as unknown as Parameters<typeof toLinkedUser>[0];
    const user = toLinkedUser(provisioned);

    return this.issueSessionForUser(user, input.tenantId, ctx);
  }

  /**
   * Phase 006 §5.3 — LIFF seamless auto-provisioning (tenant-gated, profile-synced).
   * New LINE user: atomic User + LineAuthProfile create (+ referral). Returning user:
   * LineAuthProfile displayName/picture/lastLoginAt sync + referral bind when unset.
   */
  async authenticateLiffUser(
    rawInput: LiffAuthInput,
    ctx: AuthRequestContext,
  ): Promise<AuthTokenResponse & { refreshToken: string; sessionId: string }> {
    const parsed = LiffAuthInputSchema.safeParse(rawInput);
    if (!parsed.success) throw new BadRequestException('Invalid LIFF authentication input');
    if (!this.lineVerifier) throw new UnauthorizedException('INVALID_LINE_TOKEN');
    const input = parsed.data;

    const tenant = await this.prisma.tenant.findUnique({ where: { id: input.tenantId } }).catch(() => null);
    if (!tenant || !tenant.isActive) {
      throw new UnauthorizedException('Tenant not found or inactive');
    }

    const lineProfile = await this.lineVerifier.verifyIdToken(input.idToken, tenant.lineChannelId ?? undefined);

    const provisioned = (await this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({
        where: { lineUserId: lineProfile.sub },
        include: { lineProfile: true },
      });

      if (!existing) {
        const created = await tx.user.create({
          data: {
            tenantId: tenant.id,
            lineUserId: lineProfile.sub,
            displayName: lineProfile.name ?? 'LINE User',
            avatarUrl: lineProfile.picture ?? null,
            email: lineProfile.email ?? null,
            role: 'MEMBER',
            ...(input.referralCode
              ? { referredById: await this.resolveReferralId(tx, input.referralCode) }
              : {}),
            lineProfile: {
              create: {
                lineSub: lineProfile.sub,
                displayName: lineProfile.name ?? 'LINE User',
                pictureUrl: lineProfile.picture ?? null,
                email: lineProfile.email ?? null,
                rawPayload: { ...lineProfile },
              },
            },
          },
          include: { lineProfile: true },
        });
        const account = accountDelegate(tx);
        if (account) {
          await account.upsert({
            where: {
              provider_providerAccountId: { provider: 'LINE_LIFF', providerAccountId: lineProfile.sub },
            },
            update: {},
            create: { userId: created.id, provider: 'LINE_LIFF', providerAccountId: lineProfile.sub },
          });
        }
        await tx.authAuditLog
          .create({
            data: {
              userId: created.id,
              tenantId: tenant.id,
              event: 'LINE_LIFF_AUTO_PROVISION_SUCCESS',
              ipAddress: ctx.clientIp,
              userAgent: ctx.userAgent,
              // NOTE: device ipAddress intentionally omitted (already in ipAddress column; minimal PII)
              metadata: {
                referralCode: input.referralCode ?? null,
                deviceOs: input.deviceInfo?.os ?? null,
                deviceBrowser: input.deviceInfo?.browser ?? null,
              },
            },
          })
          .catch(() => undefined);
        return { row: created, isNew: true as const };
      }

      await tx.lineAuthProfile.upsert({
        where: { userId: existing.id },
        update: {
          displayName: lineProfile.name ?? existing.displayName,
          pictureUrl: lineProfile.picture ?? existing.avatarUrl,
          email: lineProfile.email ?? existing.email,
          lastLoginAt: new Date(),
          rawPayload: { ...lineProfile },
        },
        create: {
          userId: existing.id,
          lineSub: lineProfile.sub,
          displayName: lineProfile.name ?? existing.displayName,
          pictureUrl: lineProfile.picture ?? existing.avatarUrl,
          email: lineProfile.email ?? existing.email,
          rawPayload: { ...lineProfile },
        },
      });
      // Referral bind when unset (deep-link attribution for returning users)
      if (!existing.referredById && input.referralCode) {
        const referrerId = await this.resolveReferralId(tx, input.referralCode);
        if (referrerId) {
          await tx.user.update({ where: { id: existing.id }, data: { referredById: referrerId } }).catch(() => undefined);
        }
      }
      // Tenant bind when unset (expand-contract backfill happens on login)
      if (!existing.tenantId) {
        await tx.user.update({ where: { id: existing.id }, data: { tenantId: tenant.id } }).catch(() => undefined);
      }
      const account = accountDelegate(tx);
      if (account) {
        await account.upsert({
          where: {
            provider_providerAccountId: { provider: 'LINE_LIFF', providerAccountId: lineProfile.sub },
          },
          update: {},
          create: { userId: existing.id, provider: 'LINE_LIFF', providerAccountId: lineProfile.sub },
        });
      }
      await tx.authAuditLog
        .create({
          data: {
            userId: existing.id,
            tenantId: tenant.id,
            event: 'LINE_LIFF_LOGIN_SUCCESS',
            ipAddress: ctx.clientIp,
            userAgent: ctx.userAgent,
            metadata: { referralCode: input.referralCode ?? null },
          },
        })
        .catch(() => undefined);
      return { row: existing, isNew: false as const };
    })) as unknown as { row: Parameters<typeof toLinkedUser>[0]; isNew: boolean };
    const user = toLinkedUser(provisioned.row);

    await this.publishAuthEvent(
      provisioned.isNew ? 'user.registered' : 'user.logged_in',
      { userId: user.id, tenantId: tenant.id, referralCode: input.referralCode ?? null, provider: 'LINE_LIFF' },
    ).catch(() => undefined);

    const session = await this.issueSessionForUser(user, tenant.id, ctx);
    return {
      accessToken: session.accessToken,
      expiresIn: session.expiresIn,
      user: {
        id: user.id,
        lineUserId: user.lineUserId ?? '',
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        email: user.email,
        role: user.role as AuthTokenResponse['user']['role'],
        tenantId: tenant.id,
        walletBalance: user.walletBalance,
        rewardPoints: user.rewardPoints,
        affiliateCode: user.affiliateCode,
        createdAt: user.createdAt.toISOString(),
      },
      refreshToken: session.refreshToken,
      sessionId: session.sessionId,
    };
  }

  /** Phase 006 §3.2 Query.me — full auth profile for the verified session owner. */
  async getMyProfile(userId: string): Promise<AuthTokenResponse['user'] | null> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } }).catch(() => null);
    if (!user) return null;
    const linked = toLinkedUser(user as unknown as Parameters<typeof toLinkedUser>[0]);
    return {
      id: linked.id,
      lineUserId: linked.lineUserId ?? '',
      displayName: linked.displayName,
      avatarUrl: linked.avatarUrl,
      email: linked.email,
      role: linked.role as AuthTokenResponse['user']['role'],
      tenantId: linked.tenantId ?? '',
      walletBalance: linked.walletBalance,
      rewardPoints: linked.rewardPoints,
      affiliateCode: linked.affiliateCode,
      createdAt: linked.createdAt.toISOString(),
    };
  }

  /**
   * Phase 131 — authorization-code login for the GraphQL contract.
   * The browser flow uses `WebAuthService` (state + PKCE + nonce in Redis);
   * this entry point is kept for API clients that already hold a code and
   * therefore cannot replay the Redis state record.
   */
  async authenticateWebOAuth(
    provider: string,
    code: string,
    state: string,
    redirectUri: string,
    tenantId: string,
    ctx: AuthRequestContext,
  ): Promise<AuthResponse & { refreshToken: string; sessionId: string }> {
    const parsed = WebOAuthInputSchema.safeParse({ code, state, redirectUri, tenantId });
    if (!parsed.success) throw new BadRequestException('Invalid Web OAuth input');
    const providerParsed = AuthProviderEnum.safeParse(provider);
    if (providerParsed.data !== 'LINE_WEB' && providerParsed.data !== 'GOOGLE') {
      throw new BadRequestException('Unsupported OAuth provider for this endpoint');
    }
    if (!this.oauthExchange) {
      throw new BadRequestException('OAuth code exchange is not configured');
    }
    const identity = await this.oauthExchange.exchange({
      provider: providerParsed.data,
      code: parsed.data.code,
      redirectUri: parsed.data.redirectUri,
      // No PKCE verifier exists for API clients that did not start via
      // /auth/web/start; providers only require it when code_challenge was sent.
      codeVerifier: '',
    });
    const provisioned = await this.provisionWebIdentity(identity, parsed.data.tenantId, ctx);
    return this.createSessionForUser(provisioned.user, parsed.data.tenantId, ctx);
  }

  /**
   * Phase 131 §5.3 — identity provisioning engine (Account-first).
   *
   * Rules (account-takeover safe):
   * 1. `Account(provider, providerAccountId)` is the primary key of identity.
   * 2. A legacy `User.lineUserId` row is linked for LINE identities (migration).
   * 3. An existing `User.email` is linked ONLY when the provider asserted
   *    `email_verified === true` (Google). Unverified emails never auto-link.
   * 4. Otherwise a new `User` + `Account` is created atomically.
   */
  async provisionWebIdentity(
    identity: WebIdentity,
    tenantId: string,
    ctx: AuthRequestContext,
  ): Promise<WebProvisionResult> {
    try {
      return await this.provisionWebIdentityTx(identity, tenantId, ctx);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // Concurrent first-login race: the other transaction won. Re-read the
      // winning Account instead of surfacing a 500.
      const delegate = accountDelegate(this.prisma);
      const existing = delegate
        ? await delegate
            .findUnique({
              where: {
                provider_providerAccountId: {
                  provider: identity.provider,
                  providerAccountId: identity.providerAccountId,
                },
              },
              include: { user: true },
            })
            .catch(() => null)
        : null;
      const row = (existing as { user?: unknown } | null)?.user;
      if (row) {
        return {
          user: toLinkedUser(row as unknown as Parameters<typeof toLinkedUser>[0]),
          isNew: false,
          linked: false,
        };
      }
      throw err;
    }
  }

  private async provisionWebIdentityTx(
    identity: WebIdentity,
    tenantId: string,
    ctx: AuthRequestContext,
  ): Promise<WebProvisionResult> {
    const provisioned = await this.prisma.$transaction(async (tx) => {
      const delegate = accountDelegate(tx);
      const existingAccount = delegate
        ? await delegate.findUnique({
            where: {
              provider_providerAccountId: {
                provider: identity.provider,
                providerAccountId: identity.providerAccountId,
              },
            },
            include: { user: true },
          })
        : null;

      if (existingAccount?.user) {
        let row = existingAccount.user as unknown as {
          id: string;
          avatarUrl: string | null;
          email: string | null;
          tenantId?: string | null;
        };
        const patch: Record<string, unknown> = {};
        if (!row.avatarUrl && identity.avatarUrl) patch.avatarUrl = identity.avatarUrl;
        if (!row.email && identity.email && identity.emailVerified) patch.email = identity.email;
        if (!row.tenantId) patch.tenantId = tenantId;
        if (Object.keys(patch).length > 0) {
          row = await tx.user.update({ where: { id: row.id }, data: patch });
        }
        return { row, isNew: false, linked: false };
      }

      let linked = false;
      let createdNewUser = false;
      let existingUser: { id: string; avatarUrl: string | null; email: string | null; tenantId?: string | null } | null =
        null;

      // (2) Legacy LINE rows predate the Account table.
      if (identity.provider === 'LINE_WEB' || identity.provider === 'LINE_LIFF') {
        existingUser = await tx.user.findUnique({
          where: { lineUserId: identity.providerAccountId },
        });
        if (existingUser) {
          linked = true;
          await tx.authAuditLog
            .create({
              data: {
                userId: existingUser.id,
                tenantId,
                event: 'ACCOUNT_LINKED',
                ipAddress: ctx.clientIp,
                userAgent: ctx.userAgent,
                metadata: { provider: identity.provider, reason: 'legacy_line_user' },
              },
            })
            .catch(() => undefined);
        }
      }

      // (3) Verified-email auto-link (never for unverified emails).
      if (!existingUser && identity.email && identity.emailVerified) {
        existingUser = await tx.user.findUnique({ where: { email: identity.email } });
        if (existingUser) {
          linked = true;
          await tx.authAuditLog
            .create({
              data: {
                userId: existingUser.id,
                tenantId,
                event: 'ACCOUNT_LINKED',
                ipAddress: ctx.clientIp,
                userAgent: ctx.userAgent,
                metadata: { provider: identity.provider, reason: 'verified_email' },
              },
            })
            .catch(() => undefined);
        }
      }

      if (existingUser) {
        const patch: Record<string, unknown> = {};
        if (!existingUser.avatarUrl && identity.avatarUrl) patch.avatarUrl = identity.avatarUrl;
        if (!existingUser.email && identity.email && identity.emailVerified) patch.email = identity.email;
        if (!existingUser.tenantId) patch.tenantId = tenantId;
        if (Object.keys(patch).length > 0) {
          existingUser = await tx.user.update({ where: { id: existingUser.id }, data: patch });
        }
      } else {
        // Unverified email must not collide with (or hijack) an existing row.
        let email = identity.email;
        if (email && !identity.emailVerified) {
          const taken = await tx.user.findUnique({ where: { email } });
          if (taken) email = null;
        }
        existingUser = await tx.user.create({
          data: {
            email,
            displayName: identity.displayName ?? defaultDisplayName(identity),
            avatarUrl: identity.avatarUrl,
            role: 'MEMBER',
            tenantId,
          },
        });
        createdNewUser = true;
      }

      if (delegate) {
        await delegate.create({
          data: {
            userId: existingUser.id,
            provider: identity.provider,
            providerAccountId: identity.providerAccountId,
          },
        });
      }

      return {
        row: existingUser,
        isNew: createdNewUser,
        linked,
      };
    });

    const user = toLinkedUser(provisioned.row as unknown as Parameters<typeof toLinkedUser>[0]);
    return { user, isNew: provisioned.isNew, linked: provisioned.linked };
  }

  /** Public session factory used by LIFF, web OAuth and email magic-link flows. */
  async createSessionForUser(
    user: LinkedUser,
    tenantId: string,
    ctx: AuthRequestContext,
  ): Promise<AuthResponse & { refreshToken: string; sessionId: string }> {
    return this.issueSessionForUser(user, tenantId, ctx);
  }

  async refreshAccessToken(
    refreshToken: string,
    ctx: AuthRequestContext,
  ): Promise<AuthResponse & { refreshToken: string; sessionId: string }> {
    if (!refreshToken) throw new UnauthorizedException('Missing refresh token');
    // Reuse detection: rotated tokens leave a tombstone; reuse => breach => revoke all (Breach Recovery §8.1)
    const tombstone = await this.cacheGet(`refresh-used:${refreshToken}`).catch(() => null);
    const session = await this.prisma.session
      .findUnique({ where: { refreshToken }, include: { user: true } })
      .catch(() => null);
    if (!session || session.isRevoked || session.expiresAt.getTime() < Date.now()) {
      if (tombstone) {
        const ownerId = typeof tombstone === 'string' && tombstone ? tombstone : undefined;
        if (ownerId) await this.revokeAllSessions(ownerId, ctx).catch(() => undefined);
      }
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    const nextRefresh = randomUUID();
    const updated = await this.prisma.session.update({
      where: { id: session.id },
      data: { refreshToken: nextRefresh, expiresAt: new Date(Date.now() + REFRESH_TTL_MS) },
      include: { user: true },
    });
    await this.cacheSet(`refresh-used:${refreshToken}`, session.userId, REFRESH_TTL_MS / 1000).catch(
      () => undefined,
    );
    const u = toLinkedUser(updated.user as unknown as Parameters<typeof toLinkedUser>[0]);
    return this.issueTokensForSession(u, updated.tenantId, updated.id, nextRefresh, ctx);
  }

  async logoutSession(sessionId: string, ctx: AuthRequestContext): Promise<boolean> {
    if (!sessionId) throw new BadRequestException('Missing session id');
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } }).catch(() => null);
    await this.prisma.session.updateMany({ where: { id: sessionId }, data: { isRevoked: true } }).catch(() => undefined);
    await this.cacheDel(`session:${sessionId}`).catch(() => undefined);
    await this.prisma.authAuditLog
      .create({
        data: { userId: session?.userId ?? null, tenantId: session?.tenantId ?? 'default', event: 'LOGOUT', ipAddress: ctx.clientIp, userAgent: ctx.userAgent, metadata: { sessionId } },
      })
      .catch(() => undefined);
    return true;
  }

  private async issueSessionForUser(
    user: LinkedUser,
    tenantId: string,
    ctx: AuthRequestContext,
  ): Promise<AuthResponse & { refreshToken: string; sessionId: string }> {
    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        tenantId,
        sessionToken: randomUUID(),
        refreshToken: randomUUID(),
        ipAddress: ctx.clientIp,
        userAgent: ctx.userAgent.slice(0, 500),
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      },
    });
    return this.issueTokensForSession(user, tenantId, session.id, session.refreshToken, ctx);
  }

  private async issueTokensForSession(
    user: LinkedUser,
    tenantId: string,
    sessionId: string,
    refreshToken: string,
    ctx: AuthRequestContext,
  ): Promise<AuthResponse & { refreshToken: string; sessionId: string }> {
    const pair = this.tokens.issueDualToken(
      { id: user.id, lineUserId: user.lineUserId, email: user.email, role: user.role },
      tenantId,
      sessionId,
    );
    // Edge cache (<1ms verification); failure falls back to PostgreSQL (self-healing §10.2)
    await this.cacheSet(
      `session:${sessionId}`,
      JSON.stringify({ userId: user.id, role: user.role, tenantId }),
      SESSION_TTL_SEC,
    ).catch(() => undefined);
    await this.prisma.authAuditLog
      .create({
        data: { userId: user.id, tenantId, event: 'LOGIN_SUCCESS', ipAddress: ctx.clientIp, userAgent: ctx.userAgent, metadata: { sessionId } },
      })
      .catch(() => undefined);
    return {
      accessToken: pair.accessToken,
      expiresIn: pair.expiresIn,
      user: {
        id: user.id,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        email: user.email,
        lineUserId: user.lineUserId,
        role: user.role,
        // Phase 006 enrichment (same row, no extra query)
        tenantId: tenantId,
        walletBalance: user.walletBalance,
        rewardPoints: user.rewardPoints,
        affiliateCode: user.affiliateCode || undefined,
      },
      refreshToken,
      sessionId,
    };
  }

  private publishAuthEvent(event: string, payload: Record<string, unknown>): Promise<void> {
    return this.redis.publish('auth-events', JSON.stringify({ event, ...payload })).catch(() => undefined).then(() => undefined);
  }

  private async revokeAllSessions(userId: string, ctx: AuthRequestContext): Promise<void> {
    const anyActive = await this.prisma.session
      .findFirst({ where: { userId } })
      .catch(() => null);
    await this.prisma.session.updateMany({ where: { userId }, data: { isRevoked: true } }).catch(() => undefined);
    await this.prisma.authAuditLog
      .create({
        data: { userId, tenantId: anyActive?.tenantId ?? 'default', event: 'SESSIONS_REVOKED_REUSE', ipAddress: ctx.clientIp, userAgent: ctx.userAgent },
      })
      .catch(() => undefined);
  }

  private async resolveReferralId(
    tx: Pick<PrismaService, 'user'>,
    code: string,
  ): Promise<string | undefined> {
    const referrer = await tx.user.findUnique({ where: { affiliateCode: code } }).catch(() => null);
    return referrer?.id;
  }

  private cacheGet(key: string): Promise<string | null> {
    return this.redis.get(key).catch(() => null);
  }

  private cacheSet(key: string, value: string, ttlSec: number): Promise<void> {
    return this.redis.setex(key, ttlSec, value).catch(() => undefined).then(() => undefined);
  }

  private cacheDel(key: string): Promise<void> {
    return this.redis.del(key).catch(() => undefined).then(() => undefined);
  }
}
