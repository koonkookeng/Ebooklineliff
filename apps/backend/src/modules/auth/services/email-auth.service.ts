// SSOT Phase 131 §5.6 — Passwordless email magic link (single-use, hashed at rest)
// Canonical: apps/backend/src/modules/auth/services/email-auth.service.ts
//
// Security properties:
// - 256-bit random token; only its SHA-256 hash is persisted in Redis.
// - GETDEL guarantees single use (replay returns 401).
// - Responses never reveal whether an email is registered.
// - Rate limited per IP and per email address.
import {
  BadRequestException,
  Injectable,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import {
  MagicLinkRecordSchema,
  MagicLinkRequestSchema,
  MagicLinkVerifySchema,
  sanitizeNextPath,
  type MagicLinkRecord,
  type WebAuthSessionResponse,
} from '@repo/shared';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import { AuthService, type AuthRequestContext } from './auth.service';
import { EmailSenderService } from './email-sender.service';
import { AuthRateLimitService, AUTH_RATE_LIMITS } from './auth-rate-limit.service';
import { WebAuthService } from './web-auth.service';

const MAGIC_TTL_SEC = 900; // 15 minutes
const MAGIC_PREFIX = 'webauth:magic:';

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export interface MagicLinkAccepted {
  ok: true;
  expiresInSec: number;
}

@Injectable()
export class EmailAuthService {
  constructor(
    private readonly redis: RedisClusterService,
    private readonly auth: AuthService,
    private readonly sender: EmailSenderService,
    private readonly webAuth: WebAuthService,
    @Optional() private readonly rateLimit?: AuthRateLimitService,
  ) {}

  async request(rawInput: unknown, ctx: AuthRequestContext): Promise<MagicLinkAccepted> {
    const parsed = MagicLinkRequestSchema.safeParse(rawInput);
    if (!parsed.success) throw new BadRequestException('Invalid email address');
    const input = parsed.data;

    await this.rateLimit?.assertWithinLimit('email-ip', ctx.clientIp, AUTH_RATE_LIMITS.emailRequest);
    await this.rateLimit?.assertWithinLimit(
      'email-address',
      input.email,
      { limit: 3, windowSec: 300 },
    );

    const tenantId = await this.webAuth.resolveTenantId(input.tenant);
    const token = randomBytes(32).toString('base64url');
    const record: MagicLinkRecord = {
      email: input.email,
      tenantId,
      next: sanitizeNextPath(input.next),
      createdAt: Date.now(),
    };
    await this.redis.setex(
      MAGIC_PREFIX + hashToken(token),
      MAGIC_TTL_SEC,
      JSON.stringify(record),
    );

    const base = this.resolvePublicBaseUrl(input.appUrl);
    const link = `${base}/api/auth/email/verify?token=${encodeURIComponent(token)}`;
    try {
      await this.sender.sendMagicLink(input.email, link, MAGIC_TTL_SEC);
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      throw new ServiceUnavailableException('Email delivery failed');
    }
    return { ok: true, expiresInSec: MAGIC_TTL_SEC };
  }

  async verify(rawInput: unknown, ctx: AuthRequestContext): Promise<WebAuthSessionResponse> {
    const parsed = MagicLinkVerifySchema.safeParse(rawInput);
    if (!parsed.success) throw new BadRequestException('Invalid magic link token');
    await this.rateLimit?.assertWithinLimit('email-verify', ctx.clientIp, AUTH_RATE_LIMITS.emailVerify);

    const raw = await this.redis
      .getdel(MAGIC_PREFIX + hashToken(parsed.data.token))
      .catch(() => null);
    if (!raw) throw new UnauthorizedException('Magic link is invalid or expired');
    let record: MagicLinkRecord;
    try {
      record = MagicLinkRecordSchema.parse(JSON.parse(raw));
    } catch {
      throw new UnauthorizedException('Magic link is invalid or expired');
    }

    const provisioned = await this.auth.provisionWebIdentity(
      {
        provider: 'EMAIL',
        providerAccountId: record.email,
        email: record.email,
        emailVerified: true,
        displayName: record.email.split('@')[0] || 'Member',
        avatarUrl: null,
      },
      record.tenantId,
      ctx,
    );
    const session = await this.auth.createSessionForUser(provisioned.user, record.tenantId, ctx);

    return {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresIn: session.expiresIn,
      sessionId: session.sessionId,
      isNewUser: provisioned.isNew,
      next: sanitizeNextPath(record.next),
      user: {
        id: session.user.id,
        displayName: session.user.displayName,
        avatarUrl: session.user.avatarUrl,
        email: session.user.email,
        role: session.user.role,
        tenantId: record.tenantId,
      },
    };
  }

  private resolvePublicBaseUrl(requestAppUrl: string): string {
    const configured = (process.env.WEB_APP_URL ?? '').trim();
    const candidate = configured || requestAppUrl;
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      throw new BadRequestException('Invalid application URL');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new BadRequestException('Invalid application URL');
    }
    return url.origin;
  }
}
