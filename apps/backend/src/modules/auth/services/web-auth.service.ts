// SSOT Phase 131 §5.3 — Browser OAuth orchestration (state + PKCE + nonce, single-use)
// Canonical: apps/backend/src/modules/auth/services/web-auth.service.ts
//
// The browser talks to the frontend BFF (same origin), which calls these methods.
// Tokens never travel in a URL: the BFF exchanges the one-shot callback result for
// HttpOnly `__Host-` cookies.
import {
  BadRequestException,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  OAuthStateRecordSchema,
  WebAuthCallbackInputSchema,
  WebAuthStartInputSchema,
  sanitizeNextPath,
  type OAuthStateRecord,
  type WebAuthStartResponse,
  type WebAuthSessionResponse,
} from '@repo/shared';
import { PrismaService } from '../../../infra/database/prisma.service';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import { AuthService, type AuthRequestContext } from './auth.service';
import {
  OAuthCodeExchangeService,
  createCodeChallenge,
  createCodeVerifier,
  createNonce,
} from './oauth-code-exchange.service';
import { AuthRateLimitService, AUTH_RATE_LIMITS } from './auth-rate-limit.service';

const STATE_TTL_SEC = 600; // 10 minutes
const STATE_PREFIX = 'webauth:state:';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class WebAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
    private readonly auth: AuthService,
    private readonly exchange: OAuthCodeExchangeService,
    @Optional() private readonly rateLimit?: AuthRateLimitService,
  ) {}

  async availableProviders(): Promise<{ LINE_WEB: boolean; GOOGLE: boolean }> {
    return {
      LINE_WEB: this.exchange.isConfigured('LINE_WEB'),
      GOOGLE: this.exchange.isConfigured('GOOGLE'),
    };
  }

  async start(rawInput: unknown, ctx: AuthRequestContext): Promise<WebAuthStartResponse> {
    const parsed = WebAuthStartInputSchema.safeParse(rawInput);
    if (!parsed.success) throw new BadRequestException('Invalid OAuth start input');
    const input = parsed.data;
    await this.rateLimit?.assertWithinLimit('start', ctx.clientIp, AUTH_RATE_LIMITS.start);

    if (!this.exchange.isConfigured(input.provider)) {
      throw new BadRequestException(`${input.provider} login is not configured`);
    }
    this.assertAllowedRedirectUri(input.redirectUri, input.provider);
    const tenantId = await this.resolveTenantId(input.tenant);

    const state = randomBytes(32).toString('base64url');
    const nonce = createNonce();
    const codeVerifier = createCodeVerifier();
    const record: OAuthStateRecord = {
      provider: input.provider,
      tenantId,
      redirectUri: input.redirectUri,
      codeVerifier,
      nonce,
      next: sanitizeNextPath(input.next),
      createdAt: Date.now(),
    };
    await this.redis.setex(STATE_PREFIX + state, STATE_TTL_SEC, JSON.stringify(record));

    const authorizeUrl = this.exchange.buildAuthorizeUrl({
      provider: input.provider,
      redirectUri: input.redirectUri,
      state,
      nonce,
      codeChallenge: createCodeChallenge(codeVerifier),
    });

    return { authorizeUrl, state, expiresInSec: STATE_TTL_SEC };
  }

  async handleCallback(
    rawInput: unknown,
    ctx: AuthRequestContext,
  ): Promise<WebAuthSessionResponse> {
    const parsed = WebAuthCallbackInputSchema.safeParse(rawInput);
    if (!parsed.success) throw new BadRequestException('Invalid OAuth callback input');
    const input = parsed.data;
    await this.rateLimit?.assertWithinLimit('callback', ctx.clientIp, AUTH_RATE_LIMITS.callback);

    // GETDEL: an authorization response can be replayed exactly once.
    const raw = await this.redis.getdel(STATE_PREFIX + input.state).catch(() => null);
    if (!raw) throw new UnauthorizedException('OAuth state is invalid or expired');
    let record: OAuthStateRecord;
    try {
      record = OAuthStateRecordSchema.parse(JSON.parse(raw));
    } catch {
      throw new UnauthorizedException('OAuth state is invalid or expired');
    }
    if (record.provider !== input.provider) {
      throw new UnauthorizedException('OAuth provider mismatch');
    }
    if (record.redirectUri !== input.redirectUri) {
      throw new UnauthorizedException('OAuth redirect URI mismatch');
    }

    const identity = await this.exchange.exchange({
      provider: input.provider,
      code: input.code,
      redirectUri: record.redirectUri,
      codeVerifier: record.codeVerifier,
    });
    // Nonce binding (LINE always returns it; Google returns it when supplied).
    if (identity.nonce && identity.nonce !== record.nonce) {
      throw new UnauthorizedException('OAuth nonce mismatch');
    }

    const provisioned = await this.auth.provisionWebIdentity(identity, record.tenantId, ctx);
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

  /**
   * Defense in depth: even if the backend is reachable directly, an attacker
   * cannot point an authorization code at an arbitrary host.
   */
  private assertAllowedRedirectUri(redirectUri: string, provider: 'LINE_WEB' | 'GOOGLE'): void {
    let url: URL;
    try {
      url = new URL(redirectUri);
    } catch {
      throw new BadRequestException('Invalid redirectUri');
    }
    const expectedPath = `/api/auth/callback/${provider === 'LINE_WEB' ? 'line' : 'google'}`;
    if (url.pathname !== expectedPath) throw new BadRequestException('Invalid redirectUri');
    const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
      throw new BadRequestException('redirectUri must use https');
    }
    const configured = (process.env.WEB_APP_URL ?? '').trim();
    if (configured) {
      let allowedOrigin: string;
      try {
        allowedOrigin = new URL(configured).origin;
      } catch {
        throw new BadRequestException('WEB_APP_URL is misconfigured');
      }
      if (url.origin !== allowedOrigin) throw new BadRequestException('Invalid redirectUri origin');
    }
  }

  /**
   * Resolves a tenant slug/UUID to the canonical UUID required by JWT claims.
   * `default` is auto-provisioned for local development (same behaviour as QR init).
   */
  async resolveTenantId(identifier: string): Promise<string> {    const value = identifier.trim();
    const tenant = UUID_RE.test(value)
      ? await this.prisma.tenant.findUnique({ where: { id: value } }).catch(() => null)
      : await this.prisma.tenant.findUnique({ where: { slug: value } }).catch(() => null);

    if (tenant && tenant.isActive) return tenant.id;
    if (!tenant && value === 'default') {
      const created = await this.prisma.tenant
        .create({ data: { slug: 'default', name: 'Default Tenant', isActive: true } })
        .catch(() => null);
      if (created) return created.id;
      const raced = await this.prisma.tenant
        .findUnique({ where: { slug: 'default' } })
        .catch(() => null);
      if (raced?.isActive) return raced.id;
    }
    throw new BadRequestException('Unknown or inactive tenant');
  }
}
