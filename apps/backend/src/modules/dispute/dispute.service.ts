// SSOT Phase 113 Task 4 §5.2 — dispute arbitration service (atomic escrow)
// Canonical: apps/backend/src/modules/dispute/dispute.service.ts
// (legacy src/backend/modules/dispute/dispute.service.ts)
// - File: Zod gate -> ownership -> escrow HELD + in-window + no-duplicate ->
//   ONE $transaction: escrow DISPUTED_HOLD + dispute + evidences + timelines
//   (DISPUTE_CREATED + ENTITLEMENT_FREEZE_REQUESTED) (Gate 7) -> fraud screen
//   -> Flex (merchant + buyer, fail-open) + stream.
// - Resolve: open-state gate -> ONE $transaction per BDD-3 table (wallet
//   increment / escrow flip / entitlement revoke / stock restore) + timeline
//   -> Flex <1s budget (measured, warned) + stream. Bank (non-wallet) refunds
//   ride a timeline row + `dispute.bankRefund.requested` stream for the 086
//   payout lane (no bank ledger model exists here — Zero Redundant).
// - Entitlement freeze at file-time is a logical gate (timeline +
//   `entitlement.freeze.requested` stream for the 015/073 lane): Entitlement
//   has no frozen flag, and physical deletion only happens on approved refund
//   (revocation). Documented RISK_CALL, asserted in 113 tests.
// - Zero new deps.
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  CreateDisputeInputSchema,
  ResolveDisputeInputSchema,
  DISPUTE_EVENT_STREAM,
  DISPUTE_OPEN_STATES,
  buildDisputeNo,
  claimFrequencyRisk,
  escrowExpired,
  refundCap,
} from '@repo/shared';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { DisputeNotificationService } from './dispute-notify.service';
import { buildDisputeFlex, disputeFlexByteSize, DISPUTE_FLEX_BUDGET_BYTES, type DisputeOutcome } from './dispute-flex.builder';

const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'FINANCE_ADMIN', 'CONTENT_MODERATOR']);

/** Infer evidence lane from URL extension (IMAGE / VIDEO / DOCUMENT). */
export function evidenceFileType(url: string): string {
  const path = url.split('?')[0]!.toLowerCase();
  if (/\.(mp4|mov|webm|m3u8)(\/|$)/.test(path) || path.includes('/video/')) return 'VIDEO';
  if (/\.(pdf|doc|docx|txt)(\/|$)/.test(path)) return 'DOCUMENT';
  return 'IMAGE';
}

type PrismaAny = {
  order: { findUnique(a: unknown): Promise<unknown> };
  orderItem: { findMany(a: unknown): Promise<unknown[]> };
  user: { findUnique(a: unknown): Promise<unknown>; update(a: unknown): Promise<unknown> };
  escrowAccount: { findFirst(a: unknown): Promise<unknown> };
  disputeClaim: {
    findFirst(a: unknown): Promise<unknown>;
    findUnique(a: unknown): Promise<unknown>;
    findMany(a: unknown): Promise<unknown[]>;
    count(a: unknown): Promise<number>;
  };
  $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
};

type TxAny = {
  escrowAccount: { update(a: unknown): Promise<unknown> };
  disputeClaim: { create(a: unknown): Promise<unknown>; update(a: unknown): Promise<unknown> };
  disputeEvidence: { createMany(a: unknown): Promise<unknown> };
  disputeTimeline: { create(a: unknown): Promise<unknown> };
  user: { update(a: unknown): Promise<unknown> };
  entitlement: { deleteMany(a: unknown): Promise<unknown> };
  physicalDetail: { updateMany(a: unknown): Promise<unknown> };
};

export interface DisputeBuyerRisk {
  claims30d: number;
  risk: 'NORMAL' | 'HIGH_RISK_FRAUD';
}

@Injectable()
export class DisputeService {
  private readonly logger = new Logger(DisputeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
    private readonly notify: DisputeNotificationService,
  ) {}

  private get db(): PrismaAny {
    return this.prisma as unknown as PrismaAny;
  }

  private async publish(event: string, fields: Record<string, string | number>): Promise<void> {
    try {
      await this.redis.xaddPipeline(DISPUTE_EVENT_STREAM, [{ event, ...fields, at: Date.now() }]);
    } catch {
      // Telemetry never breaks dispute flows.
    }
  }

  private async lineOf(userId: string): Promise<string | null> {
    const u = (await this.db.user.findUnique({ where: { id: userId } }).catch(() => null)) as { lineUserId?: string | null } | null;
    return u?.lineUserId ?? null;
  }

  private flex(detail: { outcome: DisputeOutcome; disputeNo: string; tenantName: string; amountThb?: number; detail?: string }): string | null {
    const bubble = buildDisputeFlex(detail);
    if (disputeFlexByteSize(bubble) > DISPUTE_FLEX_BUDGET_BYTES) return null;
    return JSON.stringify(bubble);
  }

  /** §7 fraud screen: trailing-30d buyer claim count. */
  async assessBuyerRisk(buyerId: string): Promise<DisputeBuyerRisk> {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const claims30d = await this.db.disputeClaim.count({ where: { buyerId, createdAt: { gte: since } } }).catch(() => 0);
    const risk = claimFrequencyRisk(claims30d);
    if (risk === 'HIGH_RISK_FRAUD') {
      await this.publish('dispute.fraud.alert', { buyerId, claims30d, risk });
    }
    return { claims30d, risk };
  }

  /** Buyer files a claim inside the 7-day window (BDD-2). */
  async createDisputeClaim(buyerId: string, input: unknown, tenantName = 'default'): Promise<Record<string, unknown>> {
    const parsed = CreateDisputeInputSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException('Invalid dispute payload');
    const { orderId, reason, description, evidenceImageUrls, requestedRefundAmount } = parsed.data;

    const order = (await this.db.order.findUnique({ where: { id: orderId } }).catch(() => null)) as {
      id: string; userId: string; netAmount: unknown;
    } | null;
    if (!order || order.userId !== buyerId) throw new NotFoundException('Order not found or unauthorized');

    const escrow = (await this.db.escrowAccount.findFirst({ where: { orderId } }).catch(() => null)) as {
      id: string; sellerId: string; grossAmount: unknown; holdingUntil: Date; status: string;
    } | null;
    if (!escrow || escrow.status !== 'HELD') throw new BadRequestException('Order is not eligible for dispute claim');
    if (escrowExpired(escrow.holdingUntil, Date.now())) {
      throw new BadRequestException('หมดเวลาร้องเรียน (เกิน 7 วัน)');
    }
    if (requestedRefundAmount > Number(escrow.grossAmount ?? 0)) {
      throw new BadRequestException('Requested refund exceeds escrow amount');
    }
    const dupe = await this.db.disputeClaim.findFirst({ where: { orderId } }).catch(() => null);
    if (dupe) throw new BadRequestException('Order already has a dispute claim');

    const disputeNo = buildDisputeNo(Date.now(), Math.floor(Math.random() * 10000));
    const dispute = await this.db.$transaction(async (txu: unknown) => {
      const tx = txu as unknown as TxAny;
      await tx.escrowAccount.update({ where: { id: escrow.id }, data: { status: 'DISPUTED_HOLD' } });
      const row = (await tx.disputeClaim.create({
        data: {
          disputeNo,
          orderId: order.id,
          escrowId: escrow.id,
          buyerId,
          reason,
          description,
          requestedRefundAmount,
          status: 'SUBMITTED',
        },
        include: { evidences: true },
      })) as { id: string };
      await tx.disputeEvidence.createMany({
        data: evidenceImageUrls.map((url) => ({ disputeId: row.id, fileUrl: url, fileType: evidenceFileType(url) })),
      });
      await tx.disputeTimeline.create({ data: { disputeId: row.id, actorRole: 'BUYER', actionState: 'DISPUTE_CREATED', note: 'Buyer opened dispute claim' } });
      await tx.disputeTimeline.create({ data: { disputeId: row.id, actorRole: 'SYSTEM', actionState: 'ENTITLEMENT_FREEZE_REQUESTED', note: 'Freeze digital entitlements pending arbitration' } });
      return row;
    });

    const risk = await this.assessBuyerRisk(buyerId);
    const payload = this.flex({ outcome: 'FILED', disputeNo, tenantName, amountThb: requestedRefundAmount });
    if (payload) {
      try {
        await this.notify.notify(await this.lineOf(escrow.sellerId), 'FILED', payload);
        await this.notify.notify(await this.lineOf(buyerId), 'FILED', payload);
      } catch {
        // Notify is fail-open — the claim transaction already committed.
      }
    }
    await this.publish('dispute.created', { disputeId: (dispute as { id: string }).id, disputeNo, orderId, buyerId, risk: risk.risk });
    await this.publish('entitlement.freeze.requested', { orderId, buyerId, disputeId: (dispute as { id: string }).id });
    return { ...(dispute as Record<string, unknown>), disputeNo, buyerRisk: risk.risk };
  }

  /** Seller responds to an open claim (SUBMITTED → AWAITING_SELLER_RESPONSE). */
  async sellerRespond(sellerId: string, disputeId: string, note: string): Promise<boolean> {
    const dispute = await this.requireDispute(disputeId);
    const escrow = await this.requireEscrow(dispute['escrowId'] as string);
    if ((escrow as { sellerId: string }).sellerId !== sellerId) throw new ForbiddenException('Only the seller may respond');
    if (dispute['status'] !== 'SUBMITTED') throw new BadRequestException(`Dispute in status ${dispute['status']} cannot take seller response`);
    await this.db.$transaction(async (txu: unknown) => {
      const tx = txu as unknown as TxAny;
      await tx.disputeClaim.update({ where: { id: disputeId }, data: { status: 'AWAITING_SELLER_RESPONSE' } });
      await tx.disputeTimeline.create({ data: { disputeId, actorRole: 'SELLER', actionState: 'SELLER_RESPONDED', note: note?.slice(0, 2000) ?? null } });
    });
    await this.publish('dispute.seller.responded', { disputeId, sellerId });
    return true;
  }

  /** Admin pulls a claim into arbitration. */
  async beginArbitration(adminId: string, adminRole: string | undefined, disputeId: string): Promise<boolean> {
    this.assertAdmin(adminRole);
    const dispute = await this.requireDispute(disputeId);
    if (dispute['status'] !== 'SUBMITTED' && dispute['status'] !== 'AWAITING_SELLER_RESPONSE') {
      throw new BadRequestException(`Dispute in status ${dispute['status']} cannot enter arbitration`);
    }
    await this.db.$transaction(async (txu: unknown) => {
      const tx = txu as unknown as TxAny;
      await tx.disputeClaim.update({ where: { id: disputeId }, data: { status: 'UNDER_ADMIN_ARBITRATION' } });
      await tx.disputeTimeline.create({ data: { disputeId, actorRole: 'ADMIN', actionState: 'ARBITRATION_STARTED', note: `Admin ${adminId} opened arbitration` } });
    });
    return true;
  }

  /** Hybrid arbitration verdict (BDD-3 atomic table, <1s budget). */
  async resolveArbitration(admin: { id: string; role: string | undefined }, input: unknown, tenantName = 'default'): Promise<Record<string, unknown>> {
    this.assertAdmin(admin.role);
    const parsed = ResolveDisputeInputSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException('Invalid resolution payload');
    const { disputeId, resolutionStatus, adminComment, approvedRefundAmount, refundToWallet } = parsed.data;
    // Only terminal verdicts arbitrate (buyer cancel rides cancelDispute).
    if (resolutionStatus !== 'APPROVED_REFUND_BUYER' && resolutionStatus !== 'REJECTED_RELEASE_SELLER') {
      throw new BadRequestException(`Resolution status ${resolutionStatus} is not arbitrable`);
    }

    const dispute = await this.requireDispute(disputeId);
    if (!DISPUTE_OPEN_STATES.includes(dispute['status'] as (typeof DISPUTE_OPEN_STATES)[number])) {
      throw new BadRequestException('Dispute claim not in actionable state');
    }
    const escrow = await this.requireEscrow(dispute['escrowId'] as string);
    const items = (await this.db.orderItem.findMany({ where: { orderId: dispute['orderId'] as string } }).catch(() => [])) as Array<{ productId: string; quantity: number }>;
    const gross = Number((escrow as { grossAmount: unknown }).grossAmount ?? 0);
    const startedAt = Date.now();

    if (resolutionStatus === 'APPROVED_REFUND_BUYER') {
      const capped = refundCap(Number(dispute['requestedRefundAmount'] ?? 0), gross, approvedRefundAmount);
      const full = capped >= gross;
      const row = await this.db.$transaction(async (txu: unknown) => {
        const tx = txu as unknown as TxAny;
        if (refundToWallet) {
          await tx.user.update({ where: { id: dispute['buyerId'] as string }, data: { walletBalance: { increment: capped } } });
        } else {
          await tx.disputeTimeline.create({ data: { disputeId, actorRole: 'SYSTEM', actionState: 'BANK_TRANSFER_PENDING', note: `Bank refund ฿${capped} queued for payout lane` } });
        }
        await tx.escrowAccount.update({
          where: { id: dispute['escrowId'] as string },
          data: { status: full ? 'REFUNDED_TO_BUYER' : 'PARTIALLY_REFUNDED', refundedAt: new Date() },
        });
        for (const item of items) {
          await tx.entitlement.deleteMany({ where: { userId: dispute['buyerId'] as string, productId: item.productId } });
          await tx.physicalDetail.updateMany({ where: { productId: item.productId }, data: { stockQty: { increment: Math.max(1, item.quantity) } } });
        }
        await tx.disputeTimeline.create({ data: { disputeId, actorRole: 'ADMIN', actionState: 'APPROVED_REFUND_BUYER', note: adminComment } });
        return tx.disputeClaim.update({
          where: { id: disputeId },
          data: { status: 'APPROVED_REFUND_BUYER', approvedRefundAmount: capped, adminComment, resolvedById: admin.id },
        });
      });
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs > 1000) this.logger.warn(`Refund SLA breach for ${disputeId}: ${elapsedMs}ms`);
      const payload = this.flex({ outcome: 'REFUND_APPROVED', disputeNo: dispute['disputeNo'] as string, tenantName, amountThb: capped });
      if (payload) {
        try {
          await this.notify.notify(await this.lineOf(dispute['buyerId'] as string), 'REFUND_APPROVED', payload);
        } catch {
          // Notify is fail-open.
        }
      }
      if (!refundToWallet) {
        await this.publish('dispute.bankRefund.requested', { disputeId, buyerId: dispute['buyerId'] as string, amount: capped });
      }
      await this.publish('dispute.refunded', { disputeId, orderId: dispute['orderId'] as string, amount: capped, elapsedMs });
      return { ...(row as Record<string, unknown>), elapsedMs };
    }

    // REJECTED_RELEASE_SELLER — release funds to seller, entitlements stand.
    const row = await this.db.$transaction(async (txu: unknown) => {
      const tx = txu as unknown as TxAny;
      await tx.escrowAccount.update({ where: { id: dispute['escrowId'] as string }, data: { status: 'RELEASED_TO_SELLER', releasedAt: new Date() } });
      await tx.disputeTimeline.create({ data: { disputeId, actorRole: 'ADMIN', actionState: 'REJECTED_RELEASE_SELLER', note: adminComment } });
      return tx.disputeClaim.update({
        where: { id: disputeId },
        data: { status: 'REJECTED_RELEASE_SELLER', approvedRefundAmount: 0, adminComment, resolvedById: admin.id },
      });
    });
    const payload = this.flex({ outcome: 'RELEASED_SELLER', disputeNo: dispute['disputeNo'] as string, tenantName });
    if (payload) {
      try {
        await this.notify.notify(await this.lineOf((escrow as { sellerId: string }).sellerId), 'RELEASED_SELLER', payload);
        await this.notify.notify(await this.lineOf(dispute['buyerId'] as string), 'RELEASED_SELLER', payload);
      } catch {
        // Notify is fail-open.
      }
    }
    await this.publish('dispute.released', { disputeId, orderId: dispute['orderId'] as string });
    return row as Record<string, unknown>;
  }

  /** Buyer cancels their own open claim (escrow returns to HELD). */
  async cancelDispute(buyerId: string, disputeId: string): Promise<boolean> {
    const dispute = await this.requireDispute(disputeId);
    if (dispute['buyerId'] !== buyerId) throw new ForbiddenException('Only the buyer may cancel');
    if (!DISPUTE_OPEN_STATES.includes(dispute['status'] as (typeof DISPUTE_OPEN_STATES)[number])) {
      throw new BadRequestException('Dispute claim not in actionable state');
    }
    await this.db.$transaction(async (txu: unknown) => {
      const tx = txu as unknown as TxAny;
      await tx.disputeClaim.update({ where: { id: disputeId }, data: { status: 'CANCELLED_BY_BUYER' } });
      await tx.escrowAccount.update({ where: { id: dispute['escrowId'] as string }, data: { status: 'HELD' } });
      await tx.disputeTimeline.create({ data: { disputeId, actorRole: 'BUYER', actionState: 'CANCELLED_BY_BUYER', note: 'Buyer cancelled the claim; escrow hold resumed' } });
    });
    await this.publish('dispute.cancelled', { disputeId, buyerId });
    return true;
  }

  /** Owner/admin/seller-scoped dispute read with evidences + timeline. */
  async getByOrder(orderId: string, actor: { id: string; role: string | undefined }): Promise<Record<string, unknown> | null> {
    const dispute = (await this.db.disputeClaim.findFirst({ where: { orderId } }).catch(() => null)) as Record<string, unknown> | null;
    if (!dispute) return null;
    const order = (await this.db.order.findUnique({ where: { id: orderId } }).catch(() => null)) as { userId: string } | null;
    const escrow = (await this.db.escrowAccount.findFirst({ where: { orderId } }).catch(() => null)) as { sellerId: string } | null;
    const isAdmin = !!actor.role && ADMIN_ROLES.has(actor.role);
    if (!isAdmin && order?.userId !== actor.id && escrow?.sellerId !== actor.id && dispute['buyerId'] !== actor.id) {
      throw new ForbiddenException('Not your dispute');
    }
    return dispute;
  }

  /** Paginated admin arbitration queue. */
  async getQueue(actorRole: string | undefined, args: { status?: string; page?: number; limit?: number }): Promise<{ items: Record<string, unknown>[]; totalCount: number; openCount: number; refundedCount: number }> {
    this.assertAdmin(actorRole);
    const page = Math.max(1, args.page ?? 1);
    const limit = Math.min(100, Math.max(1, args.limit ?? 20));
    const where: Record<string, unknown> = args.status ? { status: args.status } : { status: { in: [...DISPUTE_OPEN_STATES] } };
    const [rows, totalCount, openCount, refundedCount] = await Promise.all([
      this.db.disputeClaim.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.db.disputeClaim.count({ where }),
      this.db.disputeClaim.count({ where: { status: { in: [...DISPUTE_OPEN_STATES] } } }),
      this.db.disputeClaim.count({ where: { status: 'APPROVED_REFUND_BUYER' } }),
    ]);
    return { items: rows as Record<string, unknown>[], totalCount, openCount, refundedCount };
  }

  private assertAdmin(role: string | undefined): void {
    if (!role || !ADMIN_ROLES.has(role)) throw new ForbiddenException('Dispute arbitration requires an admin role');
  }

  private async requireDispute(disputeId: string): Promise<Record<string, unknown>> {
    if (!disputeId) throw new BadRequestException('Missing disputeId');
    const row = (await this.db.disputeClaim.findUnique({ where: { id: disputeId } }).catch(() => null)) as Record<string, unknown> | null;
    if (!row) throw new BadRequestException('Dispute claim not found');
    return row;
  }

  private async requireEscrow(escrowId: string): Promise<Record<string, unknown>> {
    const row = (await this.db.escrowAccount.findFirst({ where: { id: escrowId } }).catch(() => null)) as Record<string, unknown> | null;
    if (!row) throw new BadRequestException('Escrow account not found');
    return row;
  }
}
