// SSOT Phase 131 §5.7 — Hybrid web identity REST endpoints
// Canonical: apps/backend/src/modules/auth/controllers/web-auth.controller.ts
//
// Mounted under the global `api/v1` prefix:
//   POST /api/v1/auth/web/start
//   POST /api/v1/auth/web/callback
//   GET  /api/v1/auth/web/providers
//   GET  /api/v1/auth/web/me
//   POST /api/v1/auth/web/logout
//   POST /api/v1/auth/email/start
//   POST /api/v1/auth/email/verify
//
// These endpoints never set cookies themselves: the frontend BFF is the only
// component that owns the browser origin and therefore the `__Host-` cookies.
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService, type AuthRequestContext } from '../services/auth.service';
import { WebAuthService } from '../services/web-auth.service';
import { EmailAuthService } from '../services/email-auth.service';
import { TokenService } from '../services/token.service';
import { RefreshRotationInputSchema } from '@repo/shared';

interface WebReq {
  ip?: string;
  headers: Record<string, string | undefined>;
  cookies?: Record<string, string | undefined>;
}

function clientMeta(req: WebReq): AuthRequestContext {
  return {
    clientIp: req.ip ?? 'unknown',
    userAgent: (req.headers['user-agent'] ?? 'web-auth').slice(0, 500),
  };
}

function bearerToken(authorization: string | undefined): string {
  const match = /^Bearer\s+(.+)$/i.exec(authorization ?? '');
  if (!match) throw new UnauthorizedException('Missing access token');
  return match[1];
}

@Controller('auth')
export class WebAuthController {
  constructor(
    private readonly webAuth: WebAuthService,
    private readonly emailAuth: EmailAuthService,
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
  ) {}

  @Get('web/providers')
  async providers(): Promise<{ providers: { LINE_WEB: boolean; GOOGLE: boolean } }> {
    return { providers: await this.webAuth.availableProviders() };
  }

  @Post('web/start')
  @HttpCode(200)
  async start(@Body() body: unknown, @Req() req: WebReq) {
    return this.webAuth.start(body, clientMeta(req));
  }

  @Post('web/callback')
  @HttpCode(200)
  async callback(@Body() body: unknown, @Req() req: WebReq) {
    return this.webAuth.handleCallback(body, clientMeta(req));
  }

  @Get('web/me')
  async me(@Headers('authorization') authorization: string | undefined) {
    const payload = this.verify(authorization);
    const profile = await this.auth.getMyProfile(payload.sub);
    if (!profile) throw new UnauthorizedException('User profile not found');
    return { user: profile };
  }

  @Post('web/logout')
  @HttpCode(200)
  async logout(@Headers('authorization') authorization: string | undefined, @Req() req: WebReq) {
    const payload = this.verify(authorization);
    await this.auth.logoutSession(payload.sessionId, clientMeta(req));
    return { ok: true };
  }

  @Post('email/start')
  @HttpCode(200)
  async emailStart(@Body() body: unknown, @Req() req: WebReq) {
    return this.emailAuth.request(body, clientMeta(req));
  }

  @Post('email/verify')
  @HttpCode(200)
  async emailVerify(@Body() body: unknown, @Req() req: WebReq) {
    return this.emailAuth.verify(body, clientMeta(req));
  }

  @Post('web/refresh')
  @HttpCode(200)
  async refresh(@Body() body: unknown, @Req() req: WebReq) {
    const parsed = RefreshRotationInputSchema.safeParse(body);
    if (!parsed.success) throw new UnauthorizedException('Invalid refresh token');
    const result = await this.auth.refreshAccessToken(parsed.data.refreshToken, clientMeta(req));
    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
      sessionId: result.sessionId,
    };
  }

  private verify(authorization: string | undefined) {
    try {
      return this.tokens.verifyAccessToken(bearerToken(authorization));
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }
}

// Re-exported for contract tests that assert validation wiring without booting Nest.
export { clientMeta as webAuthClientMeta, bearerToken as webAuthBearerToken };
