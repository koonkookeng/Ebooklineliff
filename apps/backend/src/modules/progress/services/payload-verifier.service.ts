// SSOT Phase 064 §8.1 — PayloadVerifierService (HMAC + idempotency guard)
// Canonical: apps/backend/src/modules/progress/services/payload-verifier.service.ts
// (legacy src/backend/modules/progress/services/payload-verifier.service.ts)
// - claimBatch: Redis SETNX on syncBatchId (24h) — replays return
//   DUPLICATE without touching rows (primary anti-tamper, enforced).
// - verifyItemSignature: HMAC over the canonical body; web clients queue
//   unsigned items (zero-trust ownership still applies) so missing/invalid
//   signatures are flagged, never silently trusted.
// - Pure timing-safe compare; tsx-safe. Zero new deps.
import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { SYNC_IDEMPOTENCY_TTL_SEC, syncBatchDedupeKey } from '@repo/shared';

export interface DedupeCache {
  setnx(key: string, value: string, ttlSeconds: number): Promise<boolean>;
}

function hmacEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length || ba.length === 0) return false;
  try {
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

@Injectable()
export class PayloadVerifierService {
  constructor(
    private readonly cache?: DedupeCache,
    private readonly secretKey: string = process.env.APP_SECRET || 'AHONG_EMERALD_SECRET_KEY_999',
  ) {}

  signCanonical(canonical: string): string {
    return createHmac('sha256', this.secretKey).update(canonical).digest('hex');
  }

  verifyItemSignature(canonical: string, signature: string): boolean {
    if (!signature) return false;
    return hmacEqual(this.signCanonical(canonical), signature);
  }

  /** True when this batch was already processed (replay → skip rows). */
  async claimBatch(syncBatchId: string): Promise<boolean> {
    if (!this.cache) return true;
    try {
      return await this.cache.setnx(syncBatchDedupeKey(syncBatchId), '1', SYNC_IDEMPOTENCY_TTL_SEC);
    } catch {
      return true;
    }
  }
}
