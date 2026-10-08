// SSOT Phase 075 §5.2/Gate 7 — SKU Redis lock adapter (Redlock-style)
// Canonical: apps/backend/src/modules/inventory/infrastructure/redis-lock.adapter.ts
// - setnx + 3s TTL (INVENTORY_LOCK_TTL_SEC); tryLock once (batch lines skip
//   to failedItems on contention); withLock retries 3x backoff (checkout).
// - Mirrors the wallet RedisLockAdapter pattern (Zero Redundant shape).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import { INVENTORY_LOCK_TTL_SEC } from '@repo/shared';

const RETRY_DELAYS_MS = [50, 150, 350];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

@Injectable()
export class InventoryLockAdapter {
  constructor(private readonly redis: RedisClusterService) {}

  async tryLock(key: string): Promise<boolean> {
    try {
      return await this.redis.setnx(key, '1', INVENTORY_LOCK_TTL_SEC);
    } catch {
      return false;
    }
  }

  async release(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch {
      // Best-effort release (TTL bounds the blast radius).
    }
  }

  /** Checkout path: retry 3x, then throw OUT_OF_STOCK-busy (BDD-1 <150ms). */
  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      if (await this.tryLock(key)) {
        try {
          return await fn();
        } finally {
          await this.release(key);
        }
      }
      if (attempt >= RETRY_DELAYS_MS.length) throw new Error('OUT_OF_STOCK');
      await sleep(RETRY_DELAYS_MS[attempt] ?? 350);
    }
  }
}
