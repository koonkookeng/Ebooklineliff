// SSOT Phase 087 Task 3/§10.2 — Expired-hold sweeper (cron-ready, no new deps)
// Canonical: apps/backend/src/modules/flash-sale/services/reservation-cleanup.cron.ts
// - releaseExpired: HOLD rows past expiresAt → EXPIRED + Redis counters
//   restored (stock +user take) + stream. Idempotent; invoke every minute
//   from your scheduler (no @nestjs/schedule dep — zero-dep rule).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import { FLASH_STREAM, flashStockKey, flashUserKey } from '@repo/shared';

@Injectable()
export class ReservationCleanupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
  ) {}

  async releaseExpired(now = Date.now(), limit = 200): Promise<{ released: number }> {
    const db = this.prisma as unknown as {
      stockReservation: {
        findMany(a: unknown): Promise<Array<{
          id: string; quantity: number; userId: string;
          flashSaleItem: { campaignId: string; productId: string };
        }>>;
        update(a: unknown): Promise<unknown>;
      };
    };
    const stale = await db.stockReservation
      .findMany({
        where: { status: 'HOLD', expiresAt: { lt: new Date(now) } },
        include: { flashSaleItem: true },
        take: limit,
      })
      .catch(() => []);
    let released = 0;
    for (const row of stale) {
      try {
        await db.stockReservation.update({ where: { id: row.id }, data: { status: 'EXPIRED' } });
        const stockKey = flashStockKey(row.flashSaleItem.campaignId, row.flashSaleItem.productId);
        const userKey = flashUserKey(row.flashSaleItem.campaignId, row.flashSaleItem.productId, row.userId);
        await this.redis.incrby(stockKey, row.quantity).catch(() => undefined);
        await this.redis.decrby(userKey, row.quantity).catch(() => undefined);
        released++;
      } catch {
        // Next sweep retries; rows stay HOLD until flipped.
      }
    }
    if (released > 0) {
      try {
        await this.redis.xaddPipeline(FLASH_STREAM, [{ event: 'flash.holds.released', count: released, at: Date.now() }]);
      } catch {
        // Telemetry never breaks the sweep.
      }
    }
    return { released };
  }
}
