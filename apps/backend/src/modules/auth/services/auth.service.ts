// SSOT Phase 005 §5.2 — Core Auth logic & Account Linking Engine
// Dual-token issuance (15m access / 7d single-use refresh), atomic user link/create,
// Redis edge session cache (<1ms verify) with PostgreSQL fallback (self-healing §10.2).
import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
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
} from '@repo/shared';
import { PrismaService } from '../../../infra/database/prisma.service';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import { TokenService } from './token.service';
import { LineOAuthAdapter } from '../adapters/line-oauth.adapter';
import { LineVerifierService } from './line-verifier.service';

export interface AuthRequestContext {
  clientIp: string;
  userAgent: string;
}

interface LinkedUser {
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

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
    private readonly tokens: TokenService,
    private readonly lineAdapter: LineOAuthAdapter,
    private readonly lineVerifier?: LineVerifierService,
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
    if (!providerParsed.success || providerParsed.data === 'REFRESH_TOKEN') {
      throw new BadRequestException('Unsupported OAuth provider');
    }
    // LINE_WEB reuses the ID-token verifier (code here is the LINE ID Token from LIFF-less web flow
    // after the channel code->token exchange at the edge). Full server-side code exchange with
    // channel secret is intentionally out of scope here (no external secrets in repo).
    if (providerParsed.data !== 'LINE_WEB' && providerParsed.data !== 'LINE_LIFF') {
      throw new BadRequestException('Unsupported OAuth provider for this tenant');
    }
    return this.authenticateLineLiff(
      { idToken: code, tenantId: parsed.data.tenantId },
      ctx,
    );
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
