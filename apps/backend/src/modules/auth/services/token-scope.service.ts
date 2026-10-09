// SSOT Phase 106 Task 4 — TokenScopeService (scoped JWT issue/rotate/revoke/introspect)
// Canonical: apps/backend/src/modules/auth/services/token-scope.service.ts
// (legacy src/backend/modules/auth/services/token-scope.service.ts)
// - HS256 zero-dep JWT (Node crypto only), kid rotation via JWT_SECRET_PREV.
// - Payload: sub/userId, tenantId, bitmask (decimal string), scopes[], jti, iat/exp.
// - Revocation rides RedisTokenBlacklistAdapter (<1s edge fan-out, BDD Scenario 3).
// - hydrate() is the LIFF_INIT entry: verifies + returns introspection for client memory.
import { Injectable, ForbiddenException } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  BitwiseMatrixPayloadSchema,
  SCOPED_TOKEN_TTL_SEC,
  TokenIntrospectionResponseSchema,
  type TokenIntrospectionResponse,
} from '@repo/shared';
import { RedisTokenBlacklistAdapter } from '../../../infrastructure/adapters/redis-token-blacklist.adapter';

function b64urlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64urlDecode(input: string): Buffer {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

export interface ScopedTokenClaims {
  sub: string;
  tenantId: string;
  bitmask: string;
  scopes: string[];
  jti: string;
  iat: number;
  exp: number;
}

@Injectable()
export class TokenScopeService {
  private readonly currentSecret: string;
  private readonly prevSecret: string | null;

  constructor(private readonly blacklist: RedisTokenBlacklistAdapter, secret?: string, prevSecret?: string | null) {
    this.currentSecret = secret ?? process.env.JWT_SECRET ?? 'secret-key-144-xz-dev-only-change-me';
    const prev = prevSecret ?? process.env.JWT_SECRET_PREV ?? null;
    this.prevSecret = prev && prev !== this.currentSecret ? prev : null;
  }

  /** Issue a short-lived scoped token for exactly one tenant (blast-radius minimization). */
  issueScopedTemporaryToken(input: {
    userId: string;
    targetTenantId: string;
    bitmask: string;
    requestedScopes: string[];
    ttlSeconds?: number;
  }): string {
    const parsed = BitwiseMatrixPayloadSchema.safeParse({
      roleId: randomUUID(),
      tenantId: input.targetTenantId,
      permissionBitmask: input.bitmask,
      scopes: input.requestedScopes,
    });
    if (!parsed.success) throw new ForbiddenException('Invalid scope issuance request');
    const now = Math.floor(Date.now() / 1000);
    const ttl = Math.min(Math.max(input.ttlSeconds ?? SCOPED_TOKEN_TTL_SEC, 60), 3600);
    const claims: ScopedTokenClaims = {
      sub: input.userId,
      tenantId: input.targetTenantId,
      bitmask: input.bitmask,
      scopes: [...input.requestedScopes],
      jti: randomUUID(),
      iat: now,
      exp: now + ttl,
    };
    const header = b64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: 'current' }));
    const body = b64urlEncode(JSON.stringify(claims));
    const sig = b64urlEncode(createHmac('sha256', this.currentSecret).update(`${header}.${body}`).digest());
    return `${header}.${body}.${sig}`;
  }

  verifyScopedToken(token: string): ScopedTokenClaims {
    const parts = token.split('.');
    if (parts.length !== 3) throw new ForbiddenException('Invalid token format');
    const [header, body, sig] = parts;
    const sigBuf = b64urlDecode(sig);
    const candidates = [this.currentSecret, ...(this.prevSecret ? [this.prevSecret] : [])];
    let matched = false;
    for (const secret of candidates) {
      const expected = createHmac('sha256', secret).update(`${header}.${body}`).digest();
      if (expected.length === sigBuf.length && timingSafeEqual(expected, sigBuf)) {
        matched = true;
        break;
      }
    }
    if (!matched) throw new ForbiddenException('Invalid token signature');
    const claims = JSON.parse(b64urlDecode(body).toString('utf8')) as ScopedTokenClaims;
    if (typeof claims.exp !== 'number' || claims.exp * 1000 < Date.now()) {
      throw new ForbiddenException('Scoped token expired');
    }
    return claims;
  }

  /** LIFF_INIT hydration: verify signature + revocation + return introspection. */
  async hydrate(token: string): Promise<TokenIntrospectionResponse> {
    const claims = this.verifyScopedToken(token);
    const revoked = await this.blacklist.isRevoked(claims.jti);
    const payload = {
      active: !revoked,
      userId: claims.sub,
      tenantId: claims.tenantId,
      bitmask: claims.bitmask,
      scopes: claims.scopes,
      jti: claims.jti,
      exp: claims.exp,
    };
    return TokenIntrospectionResponseSchema.parse(payload);
  }

  /** BDD Scenario 3: revoke JTI to the edge blacklist (<1s propagation). */
  async revokeScope(jti: string, userId: string, reason: string, ttlSeconds = SCOPED_TOKEN_TTL_SEC): Promise<boolean> {
    if (!jti || !userId) throw new ForbiddenException('Invalid revocation request');
    return this.blacklist.revoke(jti, ttlSeconds);
  }
}
