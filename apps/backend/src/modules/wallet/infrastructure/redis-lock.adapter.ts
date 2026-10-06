// SSOT Phase 017 §5 — Redlock distributed concurrency handler (Redis-backed mutex)
// Canonical: apps/backend/src/modules/wallet/infrastructure/redis-lock.adapter.ts
// Contract: acquireLock returns true on first claim, false on contention;
// releaseLock is best-effort; withLock retries 3x with exponential backoff (§10).
import { Injectable } from '@nestjs/common';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import { walletLockKey, WALLET_LOCK_TTL_SEC } from '@repo/shared';

const RETRY_DELAYS_MS = [50, 150, 350];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

@Injectable()
export class RedisLockAdapter {
  constructor(private readonly redis: RedisClusterService) {}

  keyFor(userId: string): string {
    return walletLockKey(userId);
  }

  async acquireLock(userId: string, ttlSec = WALLET_LOCK_TTL_SEC): Promise<boolean> {
    try {
      return await this.redis.setnx(this.keyFor(userId), '1', ttlSec);
    } catch {
      return true;
    }
  }

  async releaseLock(userId: string): Promise<void> {
    await this.redis.del(this.keyFor(userId)).catch(() => undefined);
  }

  /** Runs fn under the user mutex; throws 409-style Error on lock timeout. */
  async withLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const acquired = await this.acquireLock(userId);
      if (acquired) {
        try {
          return await fn();
        } finally {
          await this.releaseLock(userId);
        }
      }
      if (attempt >= RETRY_DELAYS_MS.length) {
        throw new Error('ระบบกำลังประมวลผลทำรายการอื่นอยู่ กรุณาลองใหม่อีกครั้ง');
      }
      await sleep(RETRY_DELAYS_MS[attempt] ?? 350);
    }
  }
}
