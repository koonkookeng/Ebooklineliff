// SSOT Phase 122 Task 2 §5.1 — Redis idempotency store (SET NX PX <3ms)
// Canonical: apps/backend/src/modules/resilience/stores/redis-idempotency.store.ts
// (legacy src/backend/modules/resilience/stores/redis-idempotency.store.ts)
// - Record lane (24h TTL) + lock lane (10s PX) over a structural Redis port
//   (RedisClusterService satisfies it; tests inject an in-memory fake).
//   Lock acquire uses SET key LOCKED PX <ms> NX and resolves 'OK'.
// - SHA-256 body hashing lives here (single implementation; the
//   interceptor delegates). Never throws on cache faults (fail-open reads
//   return null; writes are best-effort). Zero new deps.
import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  IDEMPOTENCY_DATA_TTL_SEC,
  IDEMPOTENCY_LOCK_TTL_MS,
  IdempotencyRecordSchema,
  idempotencyDataKey,
  idempotencyLockKey,
  type IdempotencyRecord,
} from '@repo/shared';

/** Minimal Redis surface the store needs (structural; no hard import). */
export interface IdempotencyRedisPort {
  get(key: string): Promise<string | null>;
  set(key: string, value: string | Buffer, ...args: Array<string | number>): Promise<unknown>;
  setnx(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  del(...keys: string[]): Promise<void>;
}

@Injectable()
export class RedisIdempotencyStore {
  constructor(private readonly redis: IdempotencyRedisPort) {}

  /** Stable SHA-256 hex of a request body (keyed-field order preserved). */
  static bodyHash(body: unknown): string {
    return createHash('sha256').update(JSON.stringify(body ?? {})).digest('hex');
  }

  /** Cached record for a key (null on miss / corrupt / fault). */
  async getRecord(key: string): Promise<IdempotencyRecord | null> {
    try {
      const raw = await this.redis.get(idempotencyDataKey(key));
      if (!raw) return null;
      const parsed = IdempotencyRecordSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  /** Cache a handler result (24h TTL; best-effort). */
  async putRecord(record: IdempotencyRecord, ttlSec = IDEMPOTENCY_DATA_TTL_SEC): Promise<void> {
    try {
      await this.redis.set(idempotencyDataKey(record.key), JSON.stringify(record), 'EX', ttlSec);
    } catch {
      // Cache writes never break request handling.
    }
  }

  /**
   * Acquire the distributed lock (BDD-1 <3ms edge budget; true = owner).
   * Uses SET NX PX; falls back to setnx (second precision) when the
   * variadic form is unavailable.
   */
  async acquireLock(key: string, ttlMs = IDEMPOTENCY_LOCK_TTL_MS): Promise<boolean> {
    try {
      const res = await this.redis.set(idempotencyLockKey(key), 'LOCKED', 'PX', ttlMs, 'NX');
      if (res === 'OK') return true;
      if (res === null || res === undefined) {
        return this.redis.setnx(idempotencyLockKey(key), 'LOCKED', Math.max(1, Math.ceil(ttlMs / 1000)));
      }
      return false;
    } catch {
      return false;
    }
  }

  /** Release the distributed lock (best-effort). */
  async releaseLock(key: string): Promise<void> {
    try {
      await this.redis.del(idempotencyLockKey(key));
    } catch {
      // Lock TTL bounds the blast radius; release is best-effort.
    }
  }
}
