// SSOT Phase 005 §5.1 — Google OAuth ID Token verification (tokeninfo, no new deps)
import { Injectable, UnauthorizedException } from '@nestjs/common';

export interface GoogleProfile {
  sub: string;
  name: string | null;
  picture: string | null;
  email: string | null;
}

@Injectable()
export class GoogleOAuthAdapter {
  constructor(private readonly clientId: string = process.env.GOOGLE_CLIENT_ID ?? '') {}

  async verifyIdToken(idToken: string): Promise<GoogleProfile> {
    if (!idToken || idToken.length < 10) throw new UnauthorizedException('Invalid Google ID Token');
    let data: Record<string, unknown>;
    try {
      const res = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
      );
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
    return {
      sub,
      name: typeof data['name'] === 'string' ? (data['name'] as string) : null,
      picture: typeof data['picture'] === 'string' ? (data['picture'] as string) : null,
      email: typeof data['email'] === 'string' ? (data['email'] as string) : null,
    };
  }
}
