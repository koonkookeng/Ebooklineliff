// SSOT Phase 021 — LINE LIFF Auth Service (ID Token verification + JWT issuance)
// Canonical: apps/backend/src/modules/auth/liff-auth.service.ts
// (legacy src/backend/modules/auth/liff-auth.service.ts)
// - Zero new deps: global fetch + JwtTokenService facade (Phase 006) + Prisma SSOT User model.
// - Atomic upsert: User + nested LineAuthProfile.lastLoginAt sync (Gate 7).
// - Target: < 800ms end-to-end (verify → upsert → sign).
import { Injectable, UnauthorizedException, Logger, HttpException } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { JwtTokenService } from './services/jwt-token.service';
import { LiffAuthHandshake, LiffAuthResponse } from '@repo/shared';

interface LineVerifyPayload {
  sub: string;
  name?: string;
  picture?: string;
  email?: string;
}

@Injectable()
export class LiffAuthService {
  private readonly logger = new Logger(LiffAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtTokens: JwtTokenService,
  ) {}

  /**
   * Process LIFF handshake: verify ID token with LINE, upsert user, issue JWT
   * Target: < 800ms end-to-end
   */
  async processLiffHandshake(payload: LiffAuthHandshake): Promise<LiffAuthResponse> {
    const { idToken, tenantId, referralCode } = payload;

    // 1. Verify ID Token with LINE Official API
    const lineVerifyUrl = 'https://api.line.me/oauth2/v2.1/verify';
    const channelId = this.getChannelId(tenantId);

    if (!channelId) {
      this.logger.error(`No LINE Channel ID configured for tenant: ${tenantId}`);
      throw new UnauthorizedException('LINE channel not configured for this tenant');
    }

    let lineProfile: LineVerifyPayload;
    try {
      const response = await fetch(lineVerifyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ id_token: idToken, client_id: channelId }).toString(),
      });

      if (!response.ok) {
        this.logger.error(`LINE Token Verification Failed: ${response.status} ${response.statusText}`);
        throw new UnauthorizedException('Invalid or expired LINE ID Token');
      }

      lineProfile = (await response.json()) as LineVerifyPayload;
      if (!lineProfile.sub) throw new UnauthorizedException('Invalid or expired LINE ID Token');
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error(`LINE API Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
      throw new UnauthorizedException('Failed to verify LINE ID Token');
    }

    // 2. Atomic Database Upsert: User + LineAuthProfile.lastLoginAt sync (SSOT schema)
    const displayName = lineProfile.name ?? 'LINE User';
    const user = await this.prisma.user.upsert({
      where: { lineUserId: lineProfile.sub },
      update: {
        displayName,
        avatarUrl: lineProfile.picture ?? null,
        lineProfile: {
          upsert: {
            update: { displayName, pictureUrl: lineProfile.picture ?? null, lastLoginAt: new Date() },
            create: {
              lineSub: lineProfile.sub,
              displayName,
              pictureUrl: lineProfile.picture ?? null,
              email: lineProfile.email ?? null,
              rawPayload: { ...lineProfile },
            },
          },
        },
      },
      create: {
        lineUserId: lineProfile.sub,
        displayName,
        avatarUrl: lineProfile.picture ?? null,
        email: lineProfile.email ?? null,
        tenantId,
        ...(referralCode
          ? {
              referredById: await this.prisma.user
                .findUnique({ where: { affiliateCode: referralCode } })
                .then((r) => r?.id)
                .catch(() => undefined),
            }
          : {}),
        lineProfile: {
          create: {
            lineSub: lineProfile.sub,
            displayName,
            pictureUrl: lineProfile.picture ?? null,
            email: lineProfile.email ?? null,
            rawPayload: { ...lineProfile },
          },
        },
      },
    });

    // 3. Issue Platform JWT Access Token via facade (7 days expiry)
    const lineUserId = user.lineUserId ?? lineProfile.sub;
    const { accessToken, expiresIn } = this.jwtTokens.generateAccessToken({
      userId: user.id,
      lineUserId,
      tenantId: user.tenantId ?? tenantId,
      role: user.role,
    });

    return {
      success: true,
      accessToken,
      user: {
        id: user.id,
        lineUserId,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        role: user.role,
        tenantId: user.tenantId ?? tenantId,
      },
      expiresIn,
    };
  }

  /**
   * Get LINE Channel ID for tenant (supports multi-tenant via env var)
   */
  private getChannelId(tenantId: string): string {
    // Try tenant-specific channel ID first, then fall back to default
    return process.env[`LINE_CHANNEL_ID_${tenantId.toUpperCase()}`] ?? process.env.LINE_CHANNEL_ID ?? '';
  }
}
