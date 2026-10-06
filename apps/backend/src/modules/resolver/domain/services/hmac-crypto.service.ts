// SSOT Phase 025 §5.2 — HMAC-SHA256 deep-link crypto service
// Canonical: apps/backend/src/modules/resolver/domain/services/hmac-crypto.service.ts
// (legacy src/backend/modules/resolver/domain/services/hmac-crypto.service.ts)
// - Zero new deps (node:crypto only). timingSafeEqual anti-forgery (Gate 4).
// - Canonical JSON: sorted keys, undefined-stripped, then HMAC hex.
import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

function canonicalize(data: Record<string, unknown>): string {
  const clean: Record<string, unknown> = {};
  for (const key of Object.keys(data).sort()) {
    const v = data[key];
    if (v !== undefined) clean[key] = v;
  }
  return JSON.stringify(clean);
}

@Injectable()
export class HmacCryptoService {
  private readonly secret: string =
    process.env.HMAC_DEEP_LINK_SECRET || 'AHONG_EMERALD_SECRET_KEY';

  generateSignature(data: Record<string, unknown>): string {
    return createHmac('sha256', this.secret).update(canonicalize(data)).digest('hex');
  }

  /** Sign a resolved-state payload (signature field excluded from the MAC input). */
  signPayload(payload: Record<string, unknown>): string {
    const { signature: _ignored, ...rest } = payload;
    return this.generateSignature(rest as Record<string, unknown>);
  }

  /** Constant-time signature comparison (fail-closed on length mismatch). */
  verifySignature(payload: Record<string, unknown>, signature: string): boolean {
    const expected = this.signPayload(payload);
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(signature, 'utf8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  /** Encode a signed payload as base64url `liff.state` (for miniapp.line.me links). */
  encodeState(payload: Record<string, unknown>): string {
    const signature = this.signPayload(payload);
    return Buffer.from(JSON.stringify({ ...payload, signature }), 'utf-8').toString('base64url');
  }
}
