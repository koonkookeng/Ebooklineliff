// SSOT Phase 040 §5.2/§8.2 — WatermarkGeneratorService (dynamic forensic payload)
// Canonical: apps/backend/src/modules/reader/services/watermark-generator.service.ts
// (legacy src/backend/modules/reader/services/watermark-generator.service.ts)
// - sha256(userId + APP_SECRET) → 12-hex userIdHash (§5.2 verbatim).
// - Pure + tsx-safe (no Nest parameter decorators; module wires via useFactory).
// - Zero new deps (node:crypto only). Never logs userId (PII guard).
import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { ForensicWatermark } from '@repo/shared';

export const WATERMARK_HASH_LEN = 12;

export function hashUserId(userId: string, appSecret: string): string {
  return createHash('sha256').update(`${userId}-${appSecret}`).digest('hex').slice(0, WATERMARK_HASH_LEN);
}

@Injectable()
export class WatermarkGeneratorService {
  forWatermark(userId: string, appSecret: string): ForensicWatermark {
    return {
      watermarkText: `LICENSED TO USER: ${userId}`,
      userIdHash: hashUserId(userId, appSecret),
      timestamp: new Date().toISOString(),
    };
  }
}
