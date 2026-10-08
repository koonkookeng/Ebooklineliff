// SSOT Phase 081 Task 3 — Double-entry revenue posting engine
// Canonical: apps/backend/src/modules/finance/application/posting-engine.service.ts
// - Flow (BDD-1): VERIFIED order gate -> idempotency (referenceOrderId) ->
//   CommissionRule resolve (per-product else global else 5/10/2) -> cents-exact
//   split (seller = remainder, equation holds by construction + assert) ->
//   ONE $transaction: journal + accounts + 5 entries (Gate 7) -> Redis live
//   balances + WALLET_BALANCE_UPDATED broadcast (<300ms, Gate 6).
// - Tier beneficiaries resolve via the order buyer's referral chain (079
//   AffiliateReferrals vocabulary, read-only — never writes 079 tables).
// - Port-based for DB-free tests. Zero new deps.
import { BadRequestException, Injectable } from '@nestjs/common';
import {
  CommissionSplitSchema,
  FINANCE_JOURNAL_STREAM,
  splitRevenue,
} from '@repo/shared';
import { assertJournalBalanced } from '../domain/ledger-journal.aggregate';
import { REVENUE_POSTED_EVENT } from '../domain/events/revenue-posted.event';
import type { LedgerRepository } from '../infrastructure/prisma-ledger.repository';
import type { BalanceCachePort } from '../infrastructure/redis-balance.cache';

export interface PostingTx {
  run<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}

export interface ReferralChainPort {
  /** Up to 2 upline userIds for the buyer ([tier1, tier2]), cycle-safe. */
  uplinesOf(buyerId: string): Promise<Array<string | null>>;
}

@Injectable()
export class PostingEngineService {
  constructor(
    private readonly repo: LedgerRepository,
    private readonly cache: BalanceCachePort,
    private readonly tx: PostingTx,
    private readonly referrals: ReferralChainPort,
  ) {}

  async processOrderRevenuePosting(args: {
    orderId: string;
    productId?: string | null;
  }): Promise<{ journalId: string; distributed: boolean }> {
    const order = await this.repo.findOrder(args.orderId);
    if (!order) throw new BadRequestException('Order not found');
    if (order.paymentStatus !== 'VERIFIED') {
      throw new BadRequestException('Order must be verified before revenue posting');
    }
    if (await this.repo.hasJournalForOrder(order.orderId)) {
      return { journalId: '', distributed: false };
    }

    const rule = await this.repo.commissionRule(args.productId ?? null);
    const uplines = await this.referrals.uplinesOf(order.userId);
    const split = splitRevenue(order.netAmount, {
      platformFeePercent: rule.platformFeePercent,
      tier1Percent: uplines[0] ? rule.tier1Percent : 0,
      tier2Percent: uplines[1] ? rule.tier2Percent : 0,
    });
    const parsed = CommissionSplitSchema.safeParse({
      orderId: order.orderId,
      grossAmount: order.netAmount,
      platformFeeAmount: split.platformFeeAmount,
      sellerNetAmount: split.sellerNetAmount,
      affiliateTier1Amount: split.affiliateTier1Amount,
      affiliateTier2Amount: split.affiliateTier2Amount,
    });
    if (!parsed.success) throw new BadRequestException('Invalid revenue split');

    assertJournalBalanced([
      { accountType: 'CASH_EQUIVALENT', entryType: 'DEBIT', amount: order.netAmount },
      { accountType: 'PLATFORM_REVENUE_FEE', entryType: 'CREDIT', amount: split.platformFeeAmount },
      { accountType: 'SELLER_PAYABLE', entryType: 'CREDIT', amount: split.sellerNetAmount },
      ...(split.affiliateTier1Amount > 0
        ? [{ accountType: 'AFFILIATE_PAYABLE', entryType: 'CREDIT' as const, amount: split.affiliateTier1Amount }]
        : []),
      ...(split.affiliateTier2Amount > 0
        ? [{ accountType: 'AFFILIATE_PAYABLE', entryType: 'CREDIT' as const, amount: split.affiliateTier2Amount }]
        : []),
    ]);

    const journalId = await this.tx.run(async (tx) => {
      const repo = this.repo.withTx ? this.repo.withTx(tx) : this.repo;
      const journal = await repo.createJournal({
        referenceOrderId: order.orderId,
        description: `Revenue Settlement for Order ${order.orderId}`,
        eventPayload: { orderId: order.orderId, grossAmount: order.netAmount, ...split },
      });

      const cash = await repo.ensurePlatformAccount('CASH_EQUIVALENT');
      const feeAcc = await repo.ensurePlatformAccount('PLATFORM_REVENUE_FEE');
      const seller = await repo.ensureUserAccount(order.userId, 'SELLER_PAYABLE', 0);

      await repo.postEntry({
        journalId: journal.id,
        debitAccountId: cash.id,
        creditAccountId: null,
        amount: order.netAmount,
        entryType: 'DEBIT',
        runningBalance: cash.balance + order.netAmount,
      });
      await repo.postEntry({
        journalId: journal.id,
        debitAccountId: null,
        creditAccountId: feeAcc.id,
        amount: split.platformFeeAmount,
        entryType: 'CREDIT',
        runningBalance: feeAcc.balance + split.platformFeeAmount,
      });
      const sellerBalance = await repo.adjustUserBalance(order.userId, split.sellerNetAmount);
      await repo.postEntry({
        journalId: journal.id,
        debitAccountId: null,
        creditAccountId: seller.id,
        amount: split.sellerNetAmount,
        entryType: 'CREDIT',
        runningBalance: sellerBalance,
      });

      if (uplines[0] && split.affiliateTier1Amount > 0) {
        const t1 = await repo.ensureUserAccount(uplines[0], 'AFFILIATE_PAYABLE', 0);
        const bal = await repo.adjustUserBalance(uplines[0], split.affiliateTier1Amount);
        await repo.postEntry({
          journalId: journal.id,
          debitAccountId: null,
          creditAccountId: t1.id,
          amount: split.affiliateTier1Amount,
          entryType: 'CREDIT',
          runningBalance: bal,
        });
      }
      if (uplines[1] && split.affiliateTier2Amount > 0) {
        const t2 = await repo.ensureUserAccount(uplines[1], 'AFFILIATE_PAYABLE', 0);
        const bal = await repo.adjustUserBalance(uplines[1], split.affiliateTier2Amount);
        await repo.postEntry({
          journalId: journal.id,
          debitAccountId: null,
          creditAccountId: t2.id,
          amount: split.affiliateTier2Amount,
          entryType: 'CREDIT',
          runningBalance: bal,
        });
      }
      return journal.id;
    });

    await this.cache.emit(FINANCE_JOURNAL_STREAM, {
      event: REVENUE_POSTED_EVENT,
      journalId,
      orderId: order.orderId,
      sellerUserId: order.userId,
      grossAmount: order.netAmount,
      at: Date.now(),
    });
    await this.cache.broadcastBalance(order.userId, await this.repo.userBalance(order.userId));
    if (uplines[0]) await this.cache.broadcastBalance(uplines[0], await this.repo.userBalance(uplines[0]));
    if (uplines[1]) await this.cache.broadcastBalance(uplines[1], await this.repo.userBalance(uplines[1]));

    return { journalId, distributed: true };
  }
}
