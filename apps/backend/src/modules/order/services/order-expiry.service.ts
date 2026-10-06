// SSOT Phase 013 BDD — Order expiry lifecycle (TTL → EXPIRED + slot release + notify)
// Canonical: apps/backend/src/modules/order/services/order-expiry.service.ts
// (legacy src/backend/modules/order/services/order-expiry.service.ts)
// Auto-expiry runs as a sweeper over the indexed `expiresAt` (deterministic on
// any Redis/cluster config); `handleTtlKey` is the entry point if infra later
// enables Redis keyspace notifications. Never expires VERIFIED/COMPLETED money.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';

const PAYABLE = new Set(['PENDING_PAYMENT', 'PAYMENT_VERIFYING']);

type TxDb = {
  order: {
    findUnique: (args: unknown) => Promise<{
      id: string; userId: string; orderNumber: string; orderStatus: string; paymentStatus: string;
    } | null>;
    update: (args: unknown) => Promise<unknown>;
  };
  promptPayTransaction: {
    findFirst: (args: unknown) => Promise<{ id: string; status: string; expiresAt: Date } | null>;
    findMany: (args: unknown) => Promise<Array<{ orderId: string }>>;
    update: (args: unknown) => Promise<unknown>;
  };
};

@Injectable()
export class OrderExpiryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
  ) {}

  /**
   * Atomically expires one order's pending QR (idempotent).
   * Returns true only when this call performed the transition.
   */
  async expireOrder(orderId: string, reason = 'QR_EXPIRED'): Promise<{ expired: boolean; orderId: string }> {
    if (!orderId) return { expired: false, orderId };
    const db = this.prisma as unknown as TxDb;
    const result = await this.prisma.$transaction(async (tx) => {
      const t = tx as unknown as TxDb;
      const order = await t.order.findUnique({ where: { id: orderId } }).catch(() => null);
      if (!order || !PAYABLE.has(order.orderStatus)) return null;
      const txn = await t.promptPayTransaction
        .findFirst({ where: { orderId, status: 'PENDING' } })
        .catch(() => null);
      if (!txn || txn.expiresAt.getTime() > Date.now()) return null;
      await t.promptPayTransaction.update({ where: { id: txn.id }, data: { status: 'EXPIRED' } });
      await t.order.update({ where: { id: orderId }, data: { orderStatus: 'EXPIRED' } });
      return order;
    }).catch(() => null);
    if (!result) return { expired: false, orderId };
    await this.redis.del(`pp_expiry:${orderId}`).catch(() => undefined);
    const payload = { orderId, userId: result.userId, orderNumber: result.orderNumber, reason, at: new Date().toISOString() };
    await this.redis.publish('stream:payment:qr-expired', JSON.stringify(payload)).catch(() => undefined);
    await this.redis.publish('stream:notify:order-expired', JSON.stringify(payload)).catch(() => undefined);
    return { expired: true, orderId };
  }

  /** Sweeps expired PENDING transactions (indexed expiresAt scan). Returns swept orderIds. */
  async sweepExpired(limit = 50): Promise<{ swept: string[] }> {
    const db = this.prisma as unknown as TxDb;
    const rows = await db.promptPayTransaction
      .findMany({
        where: { status: 'PENDING', expiresAt: { lte: new Date() } },
        select: { orderId: true },
        take: Math.max(1, Math.min(200, limit)),
      })
      .catch(() => []);
    const swept: string[] = [];
    for (const row of rows) {
      const r = await this.expireOrder(row.orderId, 'QR_SWEEP');
      if (r.expired) swept.push(row.orderId);
    }
    return { swept };
  }

  /** Starts an in-process sweeper; returns a stopper. Consumers call sweepExpired on schedule. */
  startSweeper(intervalMs = 60_000, limit = 50): () => void {
    const timer = setInterval(() => {
      void this.sweepExpired(limit).catch(() => undefined);
    }, Math.max(10_000, intervalMs));
    if (typeof timer.unref === 'function') timer.unref();
    return () => clearInterval(timer);
  }

  /** Redis keyspace-notification entry point (pp_expiry:<orderId> TTL fired). */
  async handleTtlKey(orderId: string): Promise<void> {
    await this.expireOrder(orderId, 'QR_TTL_KEYSPACE');
  }
}
