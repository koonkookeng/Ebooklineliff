// SSOT Phase 006 §5.2 — LINE ID Token verifier (verify-endpoint primary, kid/certs check, Zod-validated)
// Zero-dep: global fetch + manual base64url decode (no jsonwebtoken / jwks-rsa / node-fetch).
// Fail-fast 401 INVALID_LINE_TOKEN on malformed signature, audience mismatch, expiry, or stale iat.
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { DecodedLineTokenSchema, type DecodedLineToken } from '@repo/shared';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';

const VERIFY_URL = 'https://api.line.me/oauth2/v2.1/verify';
const CERTS_URL = 'https://api.line.me/oauth2/v2.1/certs';
const CERTS_CACHE_KEY = 'line:jwks:kids';
const CERTS_CACHE_TTL_SEC = 24 * 60 * 60; // 24h edge cache (§8.1)
const MAX_TOKEN_AGE_SEC = 300; // replay guard: reject tokens minted >5min ago (§8.1)

function b64urlDecodeJson(segment: string): unknown {
  const pad = segment.length % 4 === 0 ? '' : '='.repeat(4 - (segment.length % 4));
  const b64 = segment.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as unknown;
}

interface JwtHeader {
  kid?: string;
  alg?: string;
}

@Injectable()
export class LineVerifierService {
  constructor(
    private readonly redis: RedisClusterService,
    private readonly channelId: string = process.env.LINE_LOGIN_CHANNEL_ID ?? '',
  ) {}

  async verifyIdToken(idToken: string, expectedChannelId?: string): Promise<DecodedLineToken> {
    if (!idToken || idToken.split('.').length !== 3) {
      throw new UnauthorizedException('INVALID_LINE_TOKEN');
    }
    // 1. Header sanity: require kid (malformed otherwise)
    let header: JwtHeader;
    try {
      header = b64urlDecodeJson(idToken.split('.')[0]) as JwtHeader;
    } catch {
      throw new UnauthorizedException('INVALID_LINE_TOKEN');
    }
    if (!header.kid) throw new UnauthorizedException('INVALID_LINE_TOKEN');

    // 2. kid must exist in LINE certs (24h Redis edge cache).
    // Definitive mismatch rejects; fetch/cache failures fail open to the verify endpoint.
    const kids = await this.getKnownKids().catch(() => null);
    if (kids && kids.length > 0 && !kids.includes(header.kid)) {
      throw new UnauthorizedException('INVALID_LINE_TOKEN');
    }

    // 3. Primary verification via LINE OAuth2 verify engine
    const channelId = expectedChannelId || this.channelId;
    let payload: Record<string, unknown>;
    try {
      const res = await fetch(VERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ id_token: idToken, client_id: channelId }).toString(),
      });
      if (!res.ok) throw new UnauthorizedException('INVALID_LINE_TOKEN');
      payload = (await res.json()) as Record<string, unknown>;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('INVALID_LINE_TOKEN');
    }

    // 4. Zod validation + freshness (exp/aud/iat)
    const parsed = DecodedLineTokenSchema.safeParse({
      iss: payload['iss'],
      sub: payload['sub'],
      aud: payload['aud'],
      exp: Number(payload['exp']),
      iat: Number(payload['iat']),
      nonce: payload['nonce'],
      name: payload['name'],
      picture: payload['picture'],
      email: payload['email'],
    });
    if (!parsed.success) throw new UnauthorizedException('INVALID_LINE_TOKEN');
    const nowSec = Math.floor(Date.now() / 1000);
    if (parsed.data.exp <= nowSec) throw new UnauthorizedException('INVALID_LINE_TOKEN');
    if (channelId && parsed.data.aud !== channelId) throw new UnauthorizedException('INVALID_LINE_TOKEN');
    if (nowSec - parsed.data.iat > MAX_TOKEN_AGE_SEC) throw new UnauthorizedException('INVALID_LINE_TOKEN');
    return parsed.data;
  }

  private async getKnownKids(): Promise<string[] | null> {
    try {
      const cached = await this.redis.get(CERTS_CACHE_KEY);
      if (cached) return JSON.parse(cached) as string[];
    } catch {
      return null;
    }
    const res = await fetch(CERTS_URL);
    if (!res.ok) return null; // fail open: verify endpoint remains authoritative
    const certs = (await res.json()) as { keys?: Array<{ kid?: string }> };
    const kids = (certs.keys ?? []).map((k) => k.kid).filter((k): k is string => !!k);
    if (kids.length > 0) {
      await this.redis.setex(CERTS_CACHE_KEY, CERTS_CACHE_TTL_SEC, JSON.stringify(kids)).catch(() => undefined);
    }
    return kids.length > 0 ? kids : null;
  }
}
