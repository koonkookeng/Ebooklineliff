// SSOT Phase 005 §8.1 + §5.2 — Dual-token issuance (HS256, kid rotation, single-use refresh)
// No new deps: Node crypto only. RS256/JWKS is the documented target; HS256 ships as the
// zero-dep default and the verifier accepts key rotation via JWT_SECRET_PREV.
import { Injectable } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { JwtPayloadSchema, type JwtPayload } from '@repo/shared';

const ACCESS_TTL_SEC = 900; // 15m

function b64urlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64urlDecode(input: string): Buffer {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

export interface DualTokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

@Injectable()
export class TokenService {
  private readonly currentSecret: string;
  private readonly prevSecret: string | null;

  constructor(secret?: string, prevSecret?: string | null) {
    this.currentSecret =
      secret ?? process.env.JWT_SECRET ?? 'secret-key-144-xz-dev-only-change-me';
    const prev = prevSecret ?? process.env.JWT_SECRET_PREV ?? null;
    this.prevSecret = prev && prev !== this.currentSecret ? prev : null;
  }

  randomToken(): string {
    return randomUUID();
  }

  signAccessToken(input: Omit<JwtPayload, 'iat' | 'exp'>, ttlSec = ACCESS_TTL_SEC): string {
    const now = Math.floor(Date.now() / 1000);
    const payload: JwtPayload = { ...input, iat: now, exp: now + ttlSec };
    const header = b64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: 'current' }));
    const body = b64urlEncode(JSON.stringify(payload));
    const sig = b64urlEncode(
      createHmac('sha256', this.currentSecret).update(`${header}.${body}`).digest(),
    );
    return `${header}.${body}.${sig}`;
  }

  verifyAccessToken(token: string): JwtPayload {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid token format');
    const [header, body, sig] = parts;
    const candidates = [this.currentSecret, ...(this.prevSecret ? [this.prevSecret] : [])];
    const sigBuf = b64urlDecode(sig);
    let matched = false;
    for (const secret of candidates) {
      const expected = createHmac('sha256', secret).update(`${header}.${body}`).digest();
      if (expected.length === sigBuf.length && timingSafeEqual(expected, sigBuf)) {
        matched = true;
        break;
      }
    }
    if (!matched) throw new Error('Invalid token signature');
    const payload = JSON.parse(b64urlDecode(body).toString('utf8')) as unknown;
    const parsed = JwtPayloadSchema.safeParse(payload);
    if (!parsed.success) throw new Error('Invalid token payload');
    if (parsed.data.exp * 1000 < Date.now()) throw new Error('Token expired');
    return parsed.data;
  }

  issueDualToken(
    user: { id: string; lineUserId: string | null; email: string | null; role: string },
    tenantId: string,
    sessionId: string,
  ): DualTokenPair {
    const accessToken = this.signAccessToken({
      sub: user.id,
      lineUserId: user.lineUserId ?? null,
      email: user.email ?? null,
      role: user.role as JwtPayload['role'],
      tenantId,
      sessionId,
    });
    return { accessToken, refreshToken: this.randomToken(), expiresIn: ACCESS_TTL_SEC };
  }
}
