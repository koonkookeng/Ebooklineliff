// SSOT Phase 005 §5.1 — Web OAuth callbacks & SSO handshakes (REST companion to GraphQL intents)
// Sets __Host- HTTP-Only cookies for web fallback; 1-hop redirects only (LIFF constraint).
// Minimal req/reply typing: works on Fastify without importing 'fastify' types.
import { Controller, Get, Post, Query, Body, Req, Res, BadRequestException } from '@nestjs/common';
import { AuthService } from '../services/auth.service';

const SESSION_COOKIE = '__Host-next-auth.session-token';
const REFRESH_COOKIE = '__Host-next-auth.refresh-token';

interface WebReq {
  ip?: string;
  protocol?: string;
  hostname?: string;
  headers: Record<string, string | undefined>;
  cookies?: Record<string, string | undefined>;
}

interface WebReply {
  header: (name: string, value: string | string[]) => unknown;
  redirect: (code: number, url: string) => unknown;
  send: (body: unknown) => unknown;
}

function secureCookie(reply: WebReply, name: string, value: string, maxAgeSec: number): void {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${maxAgeSec}`,
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
  ];
  void reply.header('Set-Cookie', parts.join('; '));
}

function clientMeta(req: WebReq): { clientIp: string; userAgent: string } {
  return { clientIp: req.ip ?? 'unknown', userAgent: req.headers['user-agent'] ?? 'webhook' };
}

interface OAuthCallbackQuery {
  code?: string;
  state?: string;
  tenantId?: string;
}

@Controller('auth')
export class AuthWebhookController {
  constructor(private readonly auth: AuthService) {}

  @Get('line/callback')
  async lineCallback(
    @Query() q: OAuthCallbackQuery,
    @Req() req: WebReq,
    @Res() reply: WebReply,
  ): Promise<void> {
    if (!q.code || !q.state || !q.tenantId) {
      throw new BadRequestException('Invalid OAuth callback parameters');
    }
    const redirectUri = `${req.protocol ?? 'https'}://${req.hostname ?? 'localhost'}/auth/line/callback`;
    const result = await this.auth.authenticateWebOAuth(
      'LINE_WEB',
      q.code,
      q.state,
      redirectUri,
      q.tenantId,
      clientMeta(req),
    );
    secureCookie(reply, SESSION_COOKIE, result.accessToken, result.expiresIn);
    secureCookie(reply, REFRESH_COOKIE, result.refreshToken, 7 * 24 * 60 * 60);
    void reply.redirect(302, `/login/success?tenant=${encodeURIComponent(q.tenantId)}`);
  }

  @Post('refresh')
  async refresh(@Req() req: WebReq, @Res() reply: WebReply): Promise<void> {
    const refreshToken = req.cookies?.[REFRESH_COOKIE];
    if (!refreshToken) throw new BadRequestException('Missing refresh token');
    const result = await this.auth.refreshAccessToken(refreshToken, clientMeta(req));
    secureCookie(reply, SESSION_COOKIE, result.accessToken, result.expiresIn);
    secureCookie(reply, REFRESH_COOKIE, result.refreshToken, 7 * 24 * 60 * 60);
    void reply.send({ accessToken: result.accessToken, expiresIn: result.expiresIn });
  }

  @Post('logout')
  async logout(@Body() body: { sessionId?: string }, @Req() req: WebReq): Promise<{ ok: boolean }> {
    if (!body?.sessionId) throw new BadRequestException('Missing session id');
    await this.auth.logoutSession(body.sessionId, clientMeta(req));
    return { ok: true };
  }
}
