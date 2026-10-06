// SSOT Phase 005 §5.2 — Core Auth logic & Account Linking Engine
// Dual-token issuance (15m access / 7d single-use refresh), atomic user link/create,
// Redis edge session cache (<1ms verify) with PostgreSQL fallback (self-healing §10.2).
import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  LineLiffAuthInputSchema,
  WebOAuthInputSchema,
  AuthProviderEnum,
  type LineLiffAuthInput,
  type AuthResponse,
} from '@repo/shared';
import { PrismaService } from '../../../infra/database/prisma.service';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import { TokenService } from './token.service';
import { LineOAuthAdapter } from '../adapters/line-oauth.adapter';

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
    const user = (await this.prisma.$transaction(async (tx) => {
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
    })) as unknown as LinkedUser;

    return this.issueSessionForUser(user, input.tenantId, ctx);
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
    const u = updated.user as unknown as LinkedUser;
    return this.issueTokensForSession(
      { id: u.id, displayName: u.displayName, avatarUrl: u.avatarUrl, email: u.email, lineUserId: u.lineUserId, role: u.role },
      updated.tenantId,
      updated.id,
      nextRefresh,
      ctx,
    );
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
      },
      refreshToken,
      sessionId,
    };
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
