// SSOT Phase 048 §5.1 — DigitalSignature value object (HMAC-SHA256)
// Canonical: apps/backend/src/modules/certificate/domain/value-objects/digital-signature.vo.ts
// (legacy src/backend/modules/certificate/domain/value-objects/digital-signature.vo.ts)
// - Encapsulates HMAC-SHA256 signature logic with timing-safe verification.
// - Pure + tsx-safe. Zero new deps (node:crypto only).
import { createHmac, timingSafeEqual } from 'node:crypto';

export class DigitalSignature {
  private constructor(readonly value: string) {}

  static create(payload: string, secret: string): DigitalSignature {
    const signature = createHmac('sha256', secret).update(payload).digest('hex');
    return new DigitalSignature(signature);
  }

  static verify(payload: string, secret: string, signature: string): boolean {
    const expected = createHmac('sha256', secret).update(payload).digest('hex');
    return timingSafeEquals(signature, expected);
  }

  toString(): string {
    return this.value;
  }
}

/** §8.2 payload format: certNo:userId:courseId:displayName */
export function buildHmacPayload(certNo: string, userId: string, courseId: string, displayName: string): string {
  return `${certNo}:${userId}:${courseId}:${displayName}`;
}

/** Timing-safe equality check using node:crypto (length-mismatch safe). */
export function timingSafeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}