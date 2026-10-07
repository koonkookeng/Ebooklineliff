// SSOT Phase 042 §5.1 — HmacSignature value object (timing-safe compare)
// Canonical: apps/backend/src/modules/watermark/domain/value-objects/hmac-signature.vo.ts
// (legacy src/backend/modules/watermark/domain/value-objects/hmac-signature.vo.ts)
// - Creation/verification live in WatermarkCryptoService; this VO owns the
//   equality semantic (timing-safe, length-guarded) so `===` never leaks
//   prefix information on the seed manifest.
// - Pure + tsx-safe. Zero new deps (node:crypto only).
import { timingSafeEqual } from 'node:crypto';

export class HmacSignature {
  private constructor(readonly value: string) {}

  static create(value: string): HmacSignature {
    if (!value || value.length < 32) throw new Error('Invalid HMAC signature');
    return new HmacSignature(value);
  }

  equals(other: string): boolean {
    const a = Buffer.from(this.value, 'utf8');
    const b = Buffer.from(other, 'utf8');
    if (a.length !== b.length) return false;
    try {
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }
}
