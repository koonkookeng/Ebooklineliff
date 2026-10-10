// SSOT Phase 114 Task 2 §5.1 — settlement double-entry engine
// Canonical: apps/backend/src/modules/clearinghouse/clearinghouse.service.ts
// (legacy src/backend/modules/clearinghouse/clearinghouse.service.ts)
// - Flow (BDD-1, cents-exact): VERIFIED order gate -> idempotency pre-read ->
//   tenant rule (fallback 70/10/20) -> 6-row batch incl. the ESCROW clearing
//   debit (spec §5.2 omits it; Gate 5 invariant cannot hold without it) ->
//   assertSettlementBalanced pre-commit (fail-closed) -> ONE $transaction:
//   ledger rows + SELLER wallet credit (113 escrow.sellerId, fallback first
//   item product.sellerId — spec §5.1 credits order.user (the buyer) which is
//   wrong; documented RISK_CALL) -> stream with elapsedMs.
// - Reads (summary/ledger) power the <100ms dashboard lane. Zero new deps.
import { BadRequestException, Injectable } from '@nestjs/common';
import {
  CLEARINGHOUSE_STREAM,
  SETTLEMENT_DEFAULTS,
  assertSettlementBalanced,
  splitSettlement,
} from '@repo/shared';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';

export interface SettlementResult {
  orderId: string;
  sellerId: string;
  grossAmount: number;
  platformFeeAmount: number;
  creatorAmount: number;
  affiliateAmount: number;
  rows: number;
  existed: boolean;
  elapsedMs: number;
}

type PrismaAny = {
  order: { findUnique(a: unknown): Promise<unknown> };
  orderItem: { findMany(a: unknown): Promise<unknown[]> };
  user: { findUnique(a: unknown): Promise<unknown>; update(a: unknown): Promise<unknown> };
  escrowAccount: { findFirst(a: unknown): Promise<unknown> };
  revenueShareRule: { findFirst(a: unknown): Promise<unknown> };
  financialClearinghouseLedger: {
    findFirst(a: unknown): Promise<unknown>;
    findMany(a: unknown): Promise<unknown[]>;
    create(a: unknown): Promise<unknown>;
  };
  $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
};

type TxAny = {
  financialClearinghouseLedger: { create(a: unknown): Promise<unknown> };
  user: { update(a: unknown): Promise<unknown> };
};

@Injectable()
export class ClearinghouseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
  ) {}

  private get db(): PrismaAny {
    return this.prisma as unknown as PrismaAny;
  }

  private async publish(event: string, fields: Record<string, string | number>): Promise<void> {
    try {
      await this.redis.xaddPipeline(CLEARINGHOUSE_STREAM, [{ event, ...fields, at: Date.now() }]);
    } catch {
      // Telemetry never breaks settlement flows.
    }
  }

  /** Settle a VERIFIED order into the 6-row double-entry batch (idempotent). */
  async processOrderSettlement(orderId: string, tenantId = 'default'): Promise<SettlementResult> {
    if (!orderId) throw new BadRequestException('Missing orderId');
    const startedAt = Date.now();
    const order = (await this.db.order.findUnique({ where: { id: orderId } }).catch(() => null)) as {
      id: string; orderNumber: string; netAmount: unknown; paymentStatus: string; userId: string;
    } | null;
    if (!order || order.paymentStatus !== 'VERIFIED') {
      throw new BadRequestException('Order not eligible for settlement');
    }
    const prior = await this.db.financialClearinghouseLedger.findFirst({ where: { orderId } }).catch(() => null);
    if (prior) {
      return { orderId, sellerId: '', grossAmount: 0, platformFeeAmount: 0, creatorAmount: 0, affiliateAmount: 0, rows: 0, existed: true, elapsedMs: Date.now() - startedAt };
    }

    const items = (await this.db.orderItem.findMany({ where: { orderId } }).catch(() => [])) as Array<{
      productId: string; quantity: number; product?: { productType: string; sellerId: string };
    }>;
    const productType = items[0]?.product?.productType ?? 'EBOOK';
    const ruleRow = (await this.db.revenueShareRule.findFirst({ where: { tenantId, productType } }).catch(() => null)) as {
      platformFeePercent: unknown; creatorSharePercent: unknown; affiliateSharePercent: unknown;
    } | null;
    const split = splitSettlement(Number(order.netAmount ?? 0), ruleRow ? {
      platformFeePercent: Number(ruleRow.platformFeePercent),
      creatorSharePercent: Number(ruleRow.creatorSharePercent),
      affiliateSharePercent: Number(ruleRow.affiliateSharePercent),
    } : { ...SETTLEMENT_DEFAULTS });

    const escrow = (await this.db.escrowAccount.findFirst({ where: { orderId } }).catch(() => null)) as { sellerId: string } | null;
    const sellerId = escrow?.sellerId ?? items[0]?.product?.sellerId ?? '';
    if (!sellerId) throw new BadRequestException('No seller attributable to order');

    const ref = (account: string): string => `STL-${orderId.slice(0, 8)}-${account}`;
    const batch: Array<{ accountType: string; entryType: 'DEBIT' | 'CREDIT'; amount: number; description: string; referenceCode: string }> = [
      { accountType: 'CASH_ASSET', entryType: 'DEBIT', amount: split.grossAmount, description: `Cash inflow PromptPay Order #${order.orderNumber}`, referenceCode: ref('CASH') },
      { accountType: 'ESCROW_LIABILITY', entryType: 'CREDIT', amount: split.grossAmount, description: `Escrow hold Order #${order.orderNumber}`, referenceCode: ref('ESCROW-CR') },
      { accountType: 'ESCROW_LIABILITY', entryType: 'DEBIT', amount: split.grossAmount, description: `Escrow clearing Order #${order.orderNumber}`, referenceCode: ref('ESCROW-DR') },
      { accountType: 'CREATOR_PAYABLE', entryType: 'CREDIT', amount: split.creatorAmount, description: `Creator earnings Order #${order.orderNumber}`, referenceCode: ref('CREATOR') },
      { accountType: 'AFFILIATE_PAYABLE', entryType: 'CREDIT', amount: split.affiliateAmount, description: `Affiliate commission Order #${order.orderNumber}`, referenceCode: ref('AFFILIATE') },
      { accountType: 'PLATFORM_REVENUE', entryType: 'CREDIT', amount: split.platformFeeAmount, description: `Platform fee Order #${order.orderNumber}`, referenceCode: ref('PLATFORM') },
    ];
    assertSettlementBalanced(batch);

    await this.db.$transaction(async (txu: unknown) => {
      const tx = txu as unknown as TxAny;
      for (const row of batch) {
        await tx.financialClearinghouseLedger.create({
          data: { tenantId, orderId, accountType: row.accountType, entryType: row.entryType, amount: row.amount, currency: 'THB', description: row.description, referenceCode: row.referenceCode },
        });
      }
      await tx.user.update({ where: { id: sellerId }, data: { walletBalance: { increment: split.creatorAmount } } });
    });

    const elapsedMs = Date.now() - startedAt;
    await this.publish('clearinghouse.settled', { orderId, sellerId, tenantId, grossAmount: split.grossAmount, elapsedMs });
    return { orderId, sellerId, ...split, rows: batch.length, existed: false, elapsedMs };
  }

  /** Real-time cashflow summary (<100ms budget, single batched read). */
  async getSummary(tenantId = 'default'): Promise<Record<string, number>> {
    const rows = (await this.db.financialClearinghouseLedger.findMany({ where: { tenantId } }).catch(() => [])) as Array<{
      accountType: string; entryType: string; amount: unknown;
    }>;
    const net: Record<string, number> = {};
    for (const r of rows) {
      const signed = Number(r.amount ?? 0) * (r.entryType === 'CREDIT' ? 1 : -1);
      net[r.accountType] = Math.round(((net[r.accountType] ?? 0) + signed) * 100) / 100;
    }
    return {
      totalGrossCashflow: Math.abs(net['CASH_ASSET'] ?? 0),
      totalEscrowHeld: Math.max(0, net['ESCROW_LIABILITY'] ?? 0),
      totalPlatformRevenue: Math.max(0, net['PLATFORM_REVENUE'] ?? 0),
      totalCreatorPayable: Math.max(0, net['CREATOR_PAYABLE'] ?? 0),
      totalAffiliatePayable: Math.max(0, net['AFFILIATE_PAYABLE'] ?? 0),
      totalTaxWithheld: Math.max(0, net['TAX_WITHHOLDING_PAYABLE'] ?? 0),
      totalRefunded: Math.abs(Math.min(0, net['REFUND_RESERVE'] ?? 0)),
    };
  }

  /** Paginated ledger stream (latest first). */
  async getLedgerEntries(tenantId = 'default', limit = 20, offset = 0): Promise<Record<string, unknown>[]> {
    const rows = (await this.db.financialClearinghouseLedger.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      skip: Math.max(0, offset),
      take: Math.min(100, Math.max(1, limit)),
    }).catch(() => [])) as Record<string, unknown>[];
    return rows;
  }
}
