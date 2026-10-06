// SSOT Phase 005 §5.1 — LINE ID Token verification (LINE verify endpoint, JWKS rotation-ready)
// Uses global fetch only (no new deps). Fail-fast on invalid signature.
import { Injectable, UnauthorizedException } from '@nestjs/common';

export interface LineProfile {
  sub: string; // lineUserId
  name: string | null;
  picture: string | null;
  email: string | null;
}

const VERIFY_URL = 'https://api.line.me/oauth2/v2.1/verify';

@Injectable()
export class LineOAuthAdapter {
  constructor(private readonly channelId: string = process.env.LINE_LOGIN_CHANNEL_ID ?? '') {}

  async verifyIdToken(idToken: string): Promise<LineProfile> {
    if (!idToken || idToken.length < 10) {
      throw new UnauthorizedException('Invalid LINE ID Token Signature');
    }
    let data: Record<string, unknown>;
    try {
      const res = await fetch(VERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ id_token: idToken, client_id: this.channelId }).toString(),
      });
      if (!res.ok) throw new UnauthorizedException('Invalid LINE ID Token Signature');
      data = (await res.json()) as Record<string, unknown>;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('Invalid LINE ID Token Signature');
    }
    const sub = typeof data['sub'] === 'string' ? (data['sub'] as string) : '';
    if (!sub) throw new UnauthorizedException('Invalid LINE ID Token Signature');
    return {
      sub,
      name: typeof data['name'] === 'string' ? (data['name'] as string) : null,
      picture: typeof data['picture'] === 'string' ? (data['picture'] as string) : null,
      email: typeof data['email'] === 'string' ? (data['email'] as string) : null,
    };
  }
}
