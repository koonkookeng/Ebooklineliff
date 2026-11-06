// SSOT Phase 131 §5.1 — Authorization-code → identity exchange (LINE Web OAuth 2.1 + Google OIDC)
// Canonical: apps/backend/src/modules/auth/services/oauth-code-exchange.service.ts
//
// Zero new dependencies: global fetch + Node crypto only. Every provider returns a
// normalized `WebIdentity`, which is the ONLY shape the provisioning engine accepts.
// PKCE (S256), state and nonce are produced/validated by `WebAuthService`; this
// service is a pure code→identity translator so it can be unit-tested with fakes.
import { Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { WebIdentity } from '@repo/shared';
import { LineVerifierService } from './line-verifier.service';
import { GoogleOAuthAdapter } from '../adapters/google-oauth.adapter';

const LINE_TOKEN_URL = 'https://api.line.me/oauth2/v2.1/token';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** RFC 7636 §4.1 — 32 random bytes encoded as base64url (43 chars, no padding). */
export function createCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

/** RFC 7636 §4.2 — BASE64URL(SHA256(ASCII(verifier))). */
export function createCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

export function createNonce(): string {
  return randomBytes(24).toString('base64url');
}

interface TokenEndpointResponse {
  id_token?: unknown;
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
}

@Injectable()
export class OAuthCodeExchangeService {
  // Env is read at construction time (see LineOAuthAdapter for the Nest
  // "String injection" rationale). Optional constructor args keep the service
  // unit-testable without a Nest container.
  private readonly lineChannelId: string;
  private readonly lineChannelSecret: string;
  private readonly lineScope: string;
  private readonly lineEmailVerified: boolean;
  private readonly googleClientId: string;
  private readonly googleClientSecret: string;
  private readonly googleScope: string;

  constructor(
    @Optional() private readonly lineVerifier?: LineVerifierService,
    @Optional() private readonly googleAdapter?: GoogleOAuthAdapter,
  ) {
    this.lineChannelId =
      process.env.LINE_LOGIN_CHANNEL_ID ?? process.env.LINE_MINI_APP_CHANNEL_ID_DEVELOPING ?? '';
    // The LINE Login client secret MUST come from the MINI App / Login channel,
    // never from the Messaging API webhook secret (`LINE_CHANNEL_SECRET`).
    this.lineChannelSecret =
      process.env.LINE_LOGIN_CHANNEL_SECRET ??
      process.env.LINE_MINI_APP_CHANNEL_SECRET_DEVELOPING ??
      '';
    this.lineScope = (process.env.LINE_LOGIN_SCOPE ?? 'openid profile').trim();
    // LINE id_tokens do not carry `email_verified`. Default to NOT trusting the
    // email for auto-linking (account-takeover guard); opt in only after LINE
    // has approved the email scope and the channel is verified.
    this.lineEmailVerified = process.env.LINE_EMAIL_VERIFIED === 'true';
    this.googleClientId = process.env.GOOGLE_CLIENT_ID ?? '';
    this.googleClientSecret = process.env.GOOGLE_CLIENT_SECRET ?? '';
    this.googleScope = (process.env.GOOGLE_OIDC_SCOPE ?? 'openid email profile').trim();
  }

  isConfigured(provider: 'LINE_WEB' | 'GOOGLE'): boolean {
    if (provider === 'LINE_WEB') return !!this.lineChannelId && !!this.lineChannelSecret;
    return !!this.googleClientId && !!this.googleClientSecret;
  }

  buildAuthorizeUrl(input: {
    provider: 'LINE_WEB' | 'GOOGLE';
    redirectUri: string;
    state: string;
    nonce: string;
    codeChallenge: string;
  }): string {
    if (!this.isConfigured(input.provider)) {
      throw new UnauthorizedException(
        input.provider === 'LINE_WEB'
          ? 'LINE Login is not configured'
          : 'Google Login is not configured',
      );
    }
    if (input.provider === 'LINE_WEB') {
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: this.lineChannelId,
        redirect_uri: input.redirectUri,
        state: input.state,
        scope: this.lineScope,
        nonce: input.nonce,
        code_challenge: input.codeChallenge,
        code_challenge_method: 'S256',
      });
      return `https://access.line.me/oauth2/v2.1/authorize?${params.toString()}`;
    }
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.googleClientId,
      redirect_uri: input.redirectUri,
      scope: this.googleScope,
      state: input.state,
      nonce: input.nonce,
      code_challenge: input.codeChallenge,
      code_challenge_method: 'S256',
      access_type: 'online',
      prompt: 'select_account',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  /**
   * Exchanges an authorization code for a verified identity.
   * `redirectUri` MUST be byte-identical to the value used at authorize time.
   */
  async exchange(input: {
    provider: 'LINE_WEB' | 'GOOGLE';
    code: string;
    redirectUri: string;
    codeVerifier: string;
  }): Promise<WebIdentity> {
    if (input.provider === 'LINE_WEB') return this.exchangeLine(input);
    return this.exchangeGoogle(input);
  }

  private async exchangeLine(input: {
    code: string;
    redirectUri: string;
    codeVerifier: string;
  }): Promise<WebIdentity> {
    if (!this.isConfigured('LINE_WEB') || !this.lineVerifier) {
      throw new UnauthorizedException('LINE Login is not configured');
    }
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: this.lineChannelId,
      client_secret: this.lineChannelSecret,
    });
    // Only send PKCE material when the flow actually used it (RFC 7636 §4.5).
    if (input.codeVerifier) body.set('code_verifier', input.codeVerifier);
    const data = await this.postTokenEndpoint(LINE_TOKEN_URL, body);
    const idToken = typeof data.id_token === 'string' ? data.id_token : '';
    if (!idToken) throw new UnauthorizedException('LINE token exchange failed');

    const profile = await this.lineVerifier.verifyIdToken(idToken, this.lineChannelId);
    return {
      provider: 'LINE_WEB',
      providerAccountId: profile.sub,
      email: profile.email ?? null,
      emailVerified: !!profile.email && this.lineEmailVerified,
      displayName: profile.name ?? null,
      avatarUrl: profile.picture ?? null,
      nonce: profile.nonce ?? null,
    };
  }

  private async exchangeGoogle(input: {
    code: string;
    redirectUri: string;
    codeVerifier: string;
  }): Promise<WebIdentity> {
    if (!this.isConfigured('GOOGLE') || !this.googleAdapter) {
      throw new UnauthorizedException('Google Login is not configured');
    }
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: this.googleClientId,
      client_secret: this.googleClientSecret,
    });
    if (input.codeVerifier) body.set('code_verifier', input.codeVerifier);
    const data = await this.postTokenEndpoint(GOOGLE_TOKEN_URL, body);
    const idToken = typeof data.id_token === 'string' ? data.id_token : '';
    if (!idToken) throw new UnauthorizedException('Google token exchange failed');

    const profile = await this.googleAdapter.verifyIdToken(idToken);
    return {
      provider: 'GOOGLE',
      providerAccountId: profile.sub,
      email: profile.email ?? null,
      emailVerified: profile.emailVerified && !!profile.email,
      displayName: profile.name ?? null,
      avatarUrl: profile.picture ?? null,
      nonce: profile.nonce ?? null,
    };
  }

  private async postTokenEndpoint(url: string, body: URLSearchParams): Promise<TokenEndpointResponse> {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: body.toString(),
      });
    } catch {
      throw new UnauthorizedException('OAUTH_PROVIDER_UNREACHABLE');
    }
    if (!res.ok) throw new UnauthorizedException('OAUTH_CODE_EXCHANGE_FAILED');
    try {
      return (await res.json()) as TokenEndpointResponse;
    } catch {
      throw new UnauthorizedException('OAUTH_CODE_EXCHANGE_FAILED');
    }
  }
}
