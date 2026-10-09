// SSOT Phase 084 Task 4 — Delayed-queue producer (Redis transport, no BullMQ package)
// Canonical: apps/backend/src/modules/messaging/queues/abandoned-cart.queue.ts
// - RISK_CALL (documented): no @nestjs/bullmq (spec §5.2 asks it) — delays
//   emerge from lastActivityAt math + the 15-min watch key; the sweeper
//   (processor.drainDue) is cron/admin invocable. Same observable behavior,
//   zero new deps (026–083 stream precedent).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import { ABANDON_STEP1_IDLE_MIN, CART_RECOVERY_STREAM, abandonWatchKey } from '@repo/shared';

@Injectable()
export class AbandonedCartQueue {
  constructor(private readonly redis: RedisClusterService) {}

  /** Arm the 15-min abandonment watch for a cart (idempotent). */
  async schedule(cartId: string, userId: string): Promise<void> {
    try {
      await this.redis.setex(abandonWatchKey(cartId), ABANDON_STEP1_IDLE_MIN * 60, '1');
    } catch {
      // Advisory only; the sweeper compares timestamps.
    }
    try {
      await this.redis.xaddPipeline(CART_RECOVERY_STREAM, [
        { event: 'cart.watch.armed', cartId, userId, at: Date.now() },
      ]);
    } catch {
      // Telemetry never breaks cart flows.
    }
  }
}
