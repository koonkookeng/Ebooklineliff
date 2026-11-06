// SSOT Phase 005 §5.1 + Phase 131 §5.2 — Google OAuth ID Token verification (tokeninfo, no new deps)
import { Injectable, UnauthorizedException } from '@nestjs/common';

export interface GoogleProfile {
  sub: string;
  name: string | null;
  picture: string | null;
  email: string | null;
  /** Google asserts `email_verified`; used as the ONLY safe auto-link signal. */
  emailVerified: boolean;
  /** Echoed OIDC nonce (present when the authorize request supplied one). */
  nonce: string | null;
}

const TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';

@Injectable()
export class GoogleOAuthAdapter {
  // Env read at construction time; see LineOAuthAdapter for why this is a
  // field instead of a constructor parameter (Nest would inject "String").
  private readonly clientId: string = process.env.GOOGLE_CLIENT_ID ?? '';

  async verifyIdToken(idToken: string): Promise<GoogleProfile> {
    if (!idToken || idToken.length < 10) throw new UnauthorizedException('Invalid Google ID Token');
    let data: Record<string, unknown>;
    try {
      const res = await fetch(`${TOKENINFO_URL}?id_token=${encodeURIComponent(idToken)}`, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new UnauthorizedException('Invalid Google ID Token');
      data = (await res.json()) as Record<string, unknown>;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('Invalid Google ID Token');
    }
    if (this.clientId && data['aud'] !== this.clientId) {
      throw new UnauthorizedException('Invalid Google ID Token audience');
    }
    const sub = typeof data['sub'] === 'string' ? (data['sub'] as string) : '';
    if (!sub) throw new UnauthorizedException('Invalid Google ID Token');
    const email = typeof data['email'] === 'string' ? (data['email'] as string) : null;
    return {
      sub,
      name: typeof data['name'] === 'string' ? (data['name'] as string) : null,
      picture: typeof data['picture'] === 'string' ? (data['picture'] as string) : null,
      email,
      // tokeninfo serialises booleans as strings ("true"/"false") in some
      // deployments; accept both representations.
      emailVerified: email !== null && String(data['email_verified']).toLowerCase() === 'true',
      nonce: typeof data['nonce'] === 'string' ? (data['nonce'] as string) : null,
    };
  }
}
