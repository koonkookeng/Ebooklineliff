// SSOT Phase 117 Task 4 — flash-sale distributed lock use-case
// Canonical: apps/backend/src/modules/campaign/application/use-cases/execute-flash-sale-lock.use-case.ts
// (legacy src/backend/modules/campaign/application/use-cases/execute-flash-sale-lock.use-case.ts)
// - Token-owned SKU locks for Mega Flash Sale contention (setnx + TTL,
//   token-checked Lua release, 3x backoff). Stock mutation itself stays in
//   the 087 flash-sale lane — this is the campaign lock primitive.
// - Zero new deps.
import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CouponCacheRepository, withCouponLock } from '../../infrastructure/redis/coupon-cache.repository';

export interface FlashLockResult {
  locked: boolean;
  token: string;
  key: string;
}

@Injectable()
export class ExecuteFlashSaleLockUseCase {
  constructor(private readonly cache: CouponCacheRepository) {}

  lockKey(productId: string, campaignSlug?: string): string {
    return campaignSlug ? `flash:lock:${campaignSlug}:${productId}` : `flash:lock:${productId}`;
  }

  async acquire(productId: string, campaignSlug?: string, ttlSec = 30): Promise<FlashLockResult> {
    if (!productId) throw new BadRequestException('Missing productId');
    const key = this.lockKey(productId, campaignSlug);
    const token = randomUUID();
    const locked = await this.cache.reserveHold(key, token, ttlSec);
    return { locked, token, key };
  }

  async release(key: string, token: string): Promise<void> {
    await this.cache.releaseHold(key, token);
  }

  /** Run fn under the SKU lock (contention → COUPON_CONTENTION). */
  runLocked<T>(productId: string, fn: () => Promise<T>, campaignSlug?: string): Promise<T> {
    return withCouponLock(this.cache, this.lockKey(productId, campaignSlug), randomUUID(), fn);
  }
}
