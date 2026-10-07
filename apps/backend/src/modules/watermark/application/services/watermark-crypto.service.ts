// SSOT Phase 042 Task 3 — WatermarkCryptoService (§5.2, tsx-safe shape)
// Canonical: apps/backend/src/modules/watermark/application/services/watermark-crypto.service.ts
// (legacy src/backend/modules/watermark/application/services/watermark-crypto.service.ts)
// - §5.2 verbatim semantics: sha256(`${userId}:${secret}`) 64-hex identity +
//   HMAC over `seedId:userIdHash:timestamp` (shared watermarkHmacMessage).
// - RISK_CALL: secret arrives via constructor (default dev seed) instead of
//   ConfigService — @nestjs/config is not a backend dep and services stay
//   tsx-importable (no Nest parameter decorators; module wires via useFactory).
// - Verification is timing-safe through the HmacSignature VO.
// - Zero new deps (node:crypto only). Never logs ids or secrets.
import { Injectable } from '@nestjs/common';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { watermarkHmacMessage } from '@repo/shared';
import { HmacSignature } from '../../domain/value-objects/hmac-signature.vo';

export const WATERMARK_DEV_SECRET = 'AHONG_EMERALD_SECRET_KEY_999';

@Injectable()
export class WatermarkCryptoService {
  // NOTE: Module wires via useFactory (no param decorators — tsx-safe).
  constructor(private readonly hmacSecret: string = process.env.WATERMARK_HMAC_SECRET || WATERMARK_DEV_SECRET) {}

  newSeedId(): string {
    return randomUUID();
  }

  generateUserIdHash(userId: string): string {
    return createHash('sha256').update(`${userId}:${this.hmacSecret}`).digest('hex');
  }

  generateHMACSignature(seedId: string, userIdHash: string, timestamp: string): string {
    return createHmac('sha256', this.hmacSecret).update(watermarkHmacMessage(seedId, userIdHash, timestamp)).digest('hex');
  }

  verifyHMACSignature(seedId: string, userIdHash: string, timestamp: string, signature: string): boolean {
    const expected = this.generateHMACSignature(seedId, userIdHash, timestamp);
    try {
      return HmacSignature.create(expected).equals(signature);
    } catch {
      return false;
    }
  }
}
