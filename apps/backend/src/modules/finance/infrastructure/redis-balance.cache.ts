// SSOT Phase 081 Task 6 — Redis live-balance cache + wallet broadcast
// Canonical: apps/backend/src/modules/finance/infrastructure/redis-balance.cache.ts
// - Live balances cached with short TTL (edge reads <5ms); every posting
//   refreshes the key and publishes WALLET_BALANCE_UPDATED (<300ms, Gate 6).
// - Payout mutex via SET NX EX (fail-closed: lock failures reject the
//   withdrawal — money paths never fail open).
// - Port-based for DB-free tests. Zero new deps.
import { Injectable } from '@nestjs/common';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import { FINANCE_WALLET_STREAM, financeBalanceKey, financePayoutLockKey } from '@repo/shared';

export interface BalanceCachePort {
  readBalance(userId: string): Promise<number | null>;
  writeBalance(userId: string, balance: number): Promise<void>;
  broadcastBalance(userId: string, newBalance: number): Promise<void>;
  acquirePayoutLock(userId: string, ttlSec?: number): Promise<boolean>;
  releasePayoutLock(userId: string): Promise<void>;
  emit(stream: string, fields: Record<string, string | number>): Promise<void>;
}

const BALANCE_TTL_SEC = 300;

@Injectable()
export class RedisBalanceCache implements BalanceCachePort {
  constructor(private readonly redis: RedisClusterService) {}

  async readBalance(userId: string): Promise<number | null> {
    try {
      const raw = await this.redis.get(financeBalanceKey(userId));
      const n = raw == null ? NaN : Number(raw);
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }

  async writeBalance(userId: string, balance: number): Promise<void> {
    try {
      await this.redis.setex(financeBalanceKey(userId), BALANCE_TTL_SEC, String(balance));
    } catch {
      // Cache is advisory; the ledger stays source of truth.
    }
  }

  async broadcastBalance(userId: string, newBalance: number): Promise<void> {
    await this.writeBalance(userId, newBalance);
    await this.emit(FINANCE_WALLET_STREAM, {
      event: 'WALLET_BALANCE_UPDATED',
      userId,
      newBalance,
      at: Date.now(),
    });
    try {
      await this.redis.publish(
        'wallet_updates',
        JSON.stringify({ userId, newBalance }),
      );
    } catch {
      // Pub/sub is best-effort; the stream + cache carry the update.
    }
  }

  async acquirePayoutLock(userId: string, ttlSec = 15): Promise<boolean> {
    try {
      const res = await this.redis.set(
        financePayoutLockKey(userId),
        `${Date.now()}`,
        'NX',
        'EX',
        ttlSec,
      );
      return res === 'OK';
    } catch {
      return false;
    }
  }

  async releasePayoutLock(userId: string): Promise<void> {
    try {
      await this.redis.del(financePayoutLockKey(userId));
    } catch {
      // TTL expiry releases the lock.
    }
  }

  async emit(stream: string, fields: Record<string, string | number>): Promise<void> {
    try {
      await this.redis.xaddPipeline(stream, [fields]);
    } catch {
      // Telemetry must never break money flows.
    }
  }
}
