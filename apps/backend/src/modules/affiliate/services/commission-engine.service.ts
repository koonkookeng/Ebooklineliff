// SSOT Phase 079 BDD-2/Task 2 — Atomic multi-tier commission engine
// Canonical: apps/backend/src/modules/affiliate/services/commission-engine.service.ts
// - processOrderCommissions: VERIFIED gate -> idempotency (orderId) ->
//   ancestor resolve -> anti-fraud screen -> one $transaction writes
//   CommissionLog rows + wallet increments (<500ms). Fraud hits write
//   BLOCKED_FRAUD rows and skip money movement (order still processes).
// - Port-based for DB-free tests. Zero new deps.
import { BadRequestException, Injectable } from '@nestjs/common';
import { AFFILIATE_COMMISSION_STREAM, CommissionCalculateSchema, tierCommission } from '@repo/shared';
import { assertNoSelfReferral } from '../domain/affiliate.entity';
import type { AffiliateRepository } from '../domain/affiliate.repository';
import { AffiliateTreeService } from './affiliate-tree.service';
import { AntiFraudService } from './anti-fraud.service';

export interface CommissionTx {
  run<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}

export interface CommissionBus {
  xadd(stream: string, fields: Record<string, string | number>): Promise<unknown>;
}

@Injectable()
export class CommissionEngineService {
  constructor(
    private readonly repo: AffiliateRepository,
    private readonly tx: CommissionTx,
    private readonly tree: AffiliateTreeService,
    private readonly fraud: AntiFraudService,
    private readonly bus: CommissionBus,
  ) {}

  async processOrderCommissions(raw: { orderId: string; fingerprint?: string | null }): Promise<{
    distributed: boolean;
    tiers: number;
    reason: string | null;
  }> {
    const order = await this.repo.findOrder(raw.orderId);
    if (!order) throw new BadRequestException('Order not found');
    const parsed = CommissionCalculateSchema.safeParse({
      orderId: order.orderId,
      orderNetAmount: order.netAmount,
      buyerUserId: order.buyerId,
    });
    if (!parsed.success || order.paymentStatus !== 'VERIFIED') {
      throw new BadRequestException('Order must be verified before processing commission');
    }
    if (await this.repo.hasCommissionForOrder(order.orderId)) {
      return { distributed: false, tiers: 0, reason: 'ALREADY_DISTRIBUTED' };
    }

    const ancestors = await this.tree.ancestorsOf(order.buyerId);
    if (ancestors.length === 0) return { distributed: false, tiers: 0, reason: 'NO_REFERRER' };
    assertNoSelfReferral(order.buyerId, ancestors.map((a) => a.user.id));

    const verdict = await this.fraud.screenOrder(order.orderId, {
      buyerUserId: order.buyerId,
      buyerLineUserId: order.buyerLineUserId,
      buyerFingerprint: raw.fingerprint ?? null,
      ancestors: ancestors.map((a) => ({ id: a.user.id, lineUserId: a.user.lineUserId, fingerprint: null })),
    });

    const rates = await this.repo.tierConfig(null);
    const rateOf = (tier: string): number =>
      tier === 'TIER_1_DIRECT' ? rates.t1 : tier === 'TIER_2_INDIRECT' ? rates.t2 : rates.t3;

    await this.tx.run(async (tx) => {
      const repo = this.repo.withTx ? this.repo.withTx(tx) : this.repo;
      for (const a of ancestors) {
        const rate = rateOf(a.tier);
        const amount = verdict.clean ? tierCommission(order.netAmount, rate) : 0;
        await repo.createCommission({
          orderId: order.orderId,
          beneficiaryId: a.user.id,
          originBuyerId: order.buyerId,
          tierLevel: a.tier,
          orderAmount: order.netAmount,
          commissionRate: rate,
          commissionAmount: amount,
          status: verdict.clean ? 'APPROVED' : 'BLOCKED_FRAUD',
          fraudReason: verdict.reason,
        });
        if (verdict.clean && amount > 0) {
          await repo.creditWallet(a.user.id, amount);
        }
      }
    });

    if (verdict.clean) {
      await this.bus.xadd(AFFILIATE_COMMISSION_STREAM, {
        event: 'affiliate.commission.distributed',
        orderId: order.orderId,
        tiers: ancestors.length,
        at: Date.now(),
      }).catch(() => undefined);
    }
    return { distributed: verdict.clean, tiers: ancestors.length, reason: verdict.reason };
  }
}
