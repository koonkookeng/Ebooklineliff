// SSOT Phase 113 Task 3 §4.1/BDD-1 — escrow fund holding service
// Canonical: apps/backend/src/modules/escrow/escrow.service.ts
// (legacy src/backend/modules/escrow/escrow.service.ts)
// - holdForOrder: idempotent HELD creation (7-day window, net = gross - fee).
//   The 012 checkout lane calls this on COMPLETED (single writer; P2002-safe
//   via pre-read + orderId @unique). Platform fee defaults to 0 — the 081
//   finance ledger owns revenue splits (Zero Redundant policy).
// - releaseDue: cron sweep of matured HELD rows → RELEASED_TO_SELLER.
// - Zero new deps.
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { DISPUTE_EVENT_STREAM, escrowExpired, escrowHoldingUntil } from '@repo/shared';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';

const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'FINANCE_ADMIN', 'CONTENT_MODERATOR']);

export interface EscrowHoldResult {
  id: string;
  orderId: string;
  status: string;
  holdingUntil: string;
  existed: boolean;
}

type PrismaAny = {
  order: { findUnique(a: unknown): Promise<unknown> };
  escrowAccount: {
    findFirst(a: unknown): Promise<unknown>;
    findMany(a: unknown): Promise<unknown[]>;
    create(a: unknown): Promise<unknown>;
    update(a: unknown): Promise<unknown>;
  };
};

@Injectable()
export class EscrowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
  ) {}

  private get db(): PrismaAny {
    return this.prisma as unknown as PrismaAny;
  }

  private async publish(event: string, fields: Record<string, string | number>): Promise<void> {
    try {
      await this.redis.xaddPipeline(DISPUTE_EVENT_STREAM, [{ event, ...fields, at: Date.now() }]);
    } catch {
      // Telemetry never breaks escrow flows.
    }
  }

  /** Idempotent hold creation for a completed order (BDD-1). */
  async holdForOrder(orderId: string, args: { sellerId: string; grossAmount: number; platformFee?: number }): Promise<EscrowHoldResult> {
    if (!orderId) throw new BadRequestException('Missing orderId');
    if (!(args.grossAmount > 0)) throw new BadRequestException('Invalid gross amount');
    const order = (await this.db.order.findUnique({ where: { id: orderId } }).catch(() => null)) as { id: string } | null;
    if (!order) throw new BadRequestException('Order not found');
    const existing = (await this.db.escrowAccount.findFirst({ where: { orderId } }).catch(() => null)) as {
      id: string; orderId: string; status: string; holdingUntil: Date;
    } | null;
    if (existing) {
      return { id: existing.id, orderId, status: existing.status, holdingUntil: new Date(existing.holdingUntil).toISOString(), existed: true };
    }
    const fee = Math.max(0, args.platformFee ?? 0);
    const row = (await this.db.escrowAccount.create({
      data: {
        orderId,
        sellerId: args.sellerId,
        grossAmount: args.grossAmount,
        platformFee: fee,
        netSellerPay: Math.max(0, args.grossAmount - fee),
        holdingUntil: escrowHoldingUntil(Date.now()),
        status: 'HELD',
      },
    })) as { id: string; holdingUntil: Date };
    await this.publish('escrow.held', { escrowId: row.id, orderId, sellerId: args.sellerId, grossAmount: args.grossAmount });
    return { id: row.id, orderId, status: 'HELD', holdingUntil: new Date(row.holdingUntil).toISOString(), existed: false };
  }

  /** Cron sweep: release matured HELD rows (per-item fail-open). */
  async releaseDue(nowMs: number, limit = 50): Promise<{ released: number; failed: number }> {
    const due = (await this.db.escrowAccount.findMany({
      where: { status: 'HELD', holdingUntil: { lte: new Date(nowMs) } },
      take: Math.min(200, Math.max(1, limit)),
      orderBy: { holdingUntil: 'asc' },
    }).catch(() => [])) as Array<{ id: string; orderId: string; sellerId: string }>;
    let released = 0;
    let failed = 0;
    for (const row of due) {
      try {
        await this.db.escrowAccount.update({
          where: { id: row.id },
          data: { status: 'RELEASED_TO_SELLER', releasedAt: new Date(nowMs) },
        });
        released++;
        await this.publish('escrow.released', { escrowId: row.id, orderId: row.orderId, sellerId: row.sellerId });
      } catch {
        failed++;
      }
    }
    return { released, failed };
  }

  /** Buyer/seller/admin escrow read (ownership-checked for non-admins). */
  async getStatus(orderId: string, actor: { id: string; role: string | undefined }): Promise<Record<string, unknown>> {
    const escrow = (await this.db.escrowAccount.findFirst({ where: { orderId } }).catch(() => null)) as {
      id: string; orderId: string; sellerId: string; grossAmount: unknown; holdingUntil: Date; status: string;
    } | null;
    if (!escrow) throw new BadRequestException('No escrow hold for order');
    const order = (await this.db.order.findUnique({ where: { id: orderId } }).catch(() => null)) as { userId: string } | null;
    const isAdmin = !!actor.role && ADMIN_ROLES.has(actor.role);
    if (!isAdmin && order?.userId !== actor.id && escrow.sellerId !== actor.id) {
      throw new ForbiddenException('Not your escrow');
    }
    return {
      escrowId: escrow.id,
      orderId,
      grossAmount: Number(escrow.grossAmount ?? 0),
      holdingUntil: new Date(escrow.holdingUntil).toISOString(),
      status: escrow.status,
      expired: escrowExpired(escrow.holdingUntil, Date.now()),
    };
  }
}
