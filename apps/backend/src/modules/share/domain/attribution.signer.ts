// SSOT Phase 080 §5.2/§8.1 — HMAC-SHA256 referral token signer
// Canonical: apps/backend/src/modules/share/domain/attribution.signer.ts
// - Wraps the flex-share.schema.ts pure sign/verify with an injectable
//   secret (JWT_SECRET env-first, spec §5.2 fallback 'secret-key-144-xz').
// - verify() enforces the 30-day attribution window (BDD-2) and rejects
//   tampered tokens via timing-safe comparison.
// - Zero new deps (node:crypto only).
import { Injectable } from '@nestjs/common';
import { signRefToken, verifyRefToken, FLEX_REF_TOKEN_TTL_SEC } from '@repo/shared';

export interface RefTokenClaims {
  userId: string;
  productId: string;
  affiliateCode: string;
  issuedAt: number;
}

@Injectable()
export class AttributionSigner {
  constructor(private readonly secret: string = process.env['JWT_SECRET'] || 'secret-key-144-xz') {}

  sign(args: { userId: string; productId: string; affiliateCode: string; issuedAt?: number }): string {
    return signRefToken(this.secret, args);
  }

  verify(refToken: string, now = Date.now()): RefTokenClaims | null {
    return verifyRefToken(this.secret, refToken, now);
  }

  expiresAt(issuedAt = Date.now()): string {
    return new Date(issuedAt + FLEX_REF_TOKEN_TTL_SEC * 1000).toISOString();
  }
}
