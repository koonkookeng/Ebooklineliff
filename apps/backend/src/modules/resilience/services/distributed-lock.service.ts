// SSOT Phase 122 Task 2 §5.1 — distributed lock service (Redis SET NX PX)
// Canonical: apps/backend/src/modules/resilience/services/distributed-lock.service.ts
// - tryLock/withLock facade over RedisIdempotencyStore lock lane.
//   withLock always releases in finally (TTL bounds crashes). Contention
//   resolves to false (callers map to 409) instead of throwing.
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { IDEMPOTENCY_LOCK_TTL_MS } from '@repo/shared';
import { RedisIdempotencyStore } from '../stores/redis-idempotency.store';

@Injectable()
export class DistributedLockService {
  constructor(private readonly store: RedisIdempotencyStore) {}

  /** Attempt ownership (true = this caller owns the lock). */
  tryLock(key: string, ttlMs = IDEMPOTENCY_LOCK_TTL_MS): Promise<boolean> {
    return this.store.acquireLock(key, ttlMs);
  }

  /** Release ownership (best-effort). */
  unlock(key: string): Promise<void> {
    return this.store.releaseLock(key);
  }

  /**
   * Run fn exactly once per key: contention throws a 409-shaped error the
   * interceptor maps to ConflictException (no double entitlement/charge).
   */
  async withLock<T>(key: string, fn: () => Promise<T>, ttlMs = IDEMPOTENCY_LOCK_TTL_MS): Promise<T> {
    const owned = await this.store.acquireLock(key, ttlMs);
    if (!owned) {
      const err = new Error('Concurrent transaction in progress. Please retry in 1 second.');
      (err as { status?: number }).status = 409;
      throw err;
    }
    try {
      return await fn();
    } finally {
      await this.store.releaseLock(key);
    }
  }
}

/** Backward-compat alias for the Phase-000 auto-scaffold name. */
export { DistributedLockService as DistributedLockServiceService };
