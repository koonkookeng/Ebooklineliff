// SSOT Phase 042 — WatermarkSeedService (reader-side seed facade, 15min memo)
// Canonical: apps/backend/src/modules/reader/watermark-seed.service.ts
// (legacy src/backend/modules/reader/watermark-seed.service.ts)
// - Reader-domain entry to seed issuance: memoizes per (user, product) for
//   the 15-minute TTL so rapid page turns never re-hit the audit log.
// - Delegates to GetWatermarkSeedHandler (WatermarkModule owns crypto/audit).
// - tsx-safe (no param decorators). Zero new deps.
import { Injectable } from '@nestjs/common';
import { WATERMARK_SEED_TTL_SEC, type WatermarkSeedPayload } from '@repo/shared';
import { GetWatermarkSeedHandler, type SeedRequest } from '../watermark/application/queries/get-watermark-seed.handler';

@Injectable()
export class WatermarkSeedService {
  private readonly memo = new Map<string, { payload: WatermarkSeedPayload; expiresAt: number }>();

  // NOTE: Module wires via useFactory (no param decorators — tsx-safe).
  constructor(private readonly handler?: GetWatermarkSeedHandler) {}

  async getSeed(req: SeedRequest, nowMs: number = Date.now()): Promise<WatermarkSeedPayload> {
    if (!this.handler) throw new Error('Watermark service unavailable');
    const key = `${req.userId}::${req.productId}`;
    const hit = this.memo.get(key);
    if (hit && hit.expiresAt > nowMs) return hit.payload;
    const payload = await this.handler.execute(req);
    if (this.memo.size >= 512) this.memo.clear();
    this.memo.set(key, { payload, expiresAt: nowMs + WATERMARK_SEED_TTL_SEC * 1000 });
    return payload;
  }

  clear(): void {
    this.memo.clear();
  }
}
