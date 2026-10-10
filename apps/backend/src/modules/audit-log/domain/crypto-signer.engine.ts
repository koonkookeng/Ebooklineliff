// SSOT Phase 118 Task 3 §5.2 — HMAC-SHA256 crypto signer (timing-safe)
// Canonical: apps/backend/src/modules/audit-log/domain/crypto-signer.engine.ts
// (legacy src/backend/modules/audit-log/domain/crypto-signer.engine.ts)
// - Thin domain facade over the SSOT contract primitives (signAuditHash /
//   verifyAuditSignature): same bytes, single implementation.
// - Secret resolution: explicit ctor arg wins, else AUDIT_HMAC_SECRET env,
//   else the documented development fallback (provision the env in prod).
// - Zero new deps (node:crypto via contract).
import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { signAuditHash, verifyAuditSignature } from '@repo/shared';

export function resolveAuditSecret(explicit?: string): string {
  const raw = (explicit ?? process.env['AUDIT_HMAC_SECRET'] ?? '').trim();
  if (raw) return raw;
  return createHash('sha256').update('secret-key-144-xz/audit-fallback', 'utf8').digest('hex');
}

@Injectable()
export class CryptoSignerEngine {
  private readonly secret: string;

  constructor(secret?: string) {
    this.secret = resolveAuditSecret(secret);
    if (!this.secret) throw new Error('Audit HMAC secret must not be empty');
  }

  sign(currentHash: string): string {
    return signAuditHash(currentHash, this.secret);
  }

  verify(currentHash: string, signature: string): boolean {
    return verifyAuditSignature(currentHash, signature, this.secret);
  }
}
