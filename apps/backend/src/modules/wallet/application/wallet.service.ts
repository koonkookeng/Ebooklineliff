// SSOT Phase 017 §5.2 — Wallet Core Service (atomic txn + Redis mutex, <300ms grant)
// Canonical: apps/backend/src/modules/wallet/application/wallet.service.ts
// (legacy src/backend/modules/wallet/application/wallet.service.ts)
// Invariants: bonus-first debit, never-negative, one ledger row per mutation,
// order COMPLETED + entitlement granted in the SAME $transaction (OUT_OF_SCOPE guard).
import { Injectable, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import {
  OneClickBuyInputSchema,
  WalletBalanceResponseSchema,
  WalletLedgerItemSchema,
  WalletTopupInputSchema,
  walletLockKey,
  WALLET_LOCK_TTL_SEC,
  type OneClickBuyResult,
  type WalletBalanceResponse,
  type WalletLedgerItem,
  type WalletTopupResult,
} from '@repo/shared';
import { assertUsable, debitSplit, purchaseDescription, toNum, totalOf } from '../domain/wallet.entity';
import { affiliateReward, topupBonus } from '../domain/wallet-calculator';
import { EntitlementGrantService } from '../../entitlement/services/entitlement-grant.service';

const LOCK_TTL_SEC = WALLET_LOCK_TTL_SEC;
const TOPUP_REPLAY_TTL_SEC = 30 * 24 * 60 * 60;

function orderNumber(): string {
  return `ORD-WLT-${Date.now()}`;
}

@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
    private readonly grants: EntitlementGrantService,
  ) {}

  /** Balance read (auto-provisions a zero wallet on first view). */
  async getBalance(userId: string): Promise<WalletBalanceResponse> {
    if (!userId) throw new BadRequestException('Missing user id');
    const db = this.prisma as unknown as {
      wallet: { upsert: (args: unknown) => Promise<Record<string, unknown>> };
    };
    const row = await db.wallet
      .upsert({
        where: { userId },
        update: {},
        create: { userId, mainBalance: 0, bonusBalance: 0 },
      })
      .catch(() => null);
    if (!row) throw new NotFoundException('Wallet unavailable');
    const main = toNum(row['mainBalance'], 0);
    const bonus = toNum(row['bonusBalance'], 0);
    const parsed = WalletBalanceResponseSchema.safeParse({
      walletId: String(row['id']),
      mainBalance: main,
      bonusBalance: bonus,
      totalBalance: Math.round((main + bonus) * 100) / 100,
      currency: 'THB',
    });
    if (!parsed.success) throw new BadRequestException('Wallet balance contract drift');
    return parsed.data;
  }

  /** Paginated immutable ledger history (newest first). */
  async ledger(userId: string, take = 20): Promise<WalletLedgerItem[]> {
    const wallet = await this.requireWallet(userId);
    const db = this.prisma as unknown as {
      walletLedger: { findMany: (args: unknown) => Promise<Array<Record<string, unknown>>> };
    };
    const rows = await db.walletLedger
      .findMany({ where: { walletId: String(wallet['id']) }, orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(take, 1), 50) })
      .catch(() => []);
    const items: WalletLedgerItem[] = [];
    for (const r of rows) {
      const parsed = WalletLedgerItemSchema.safeParse({
        id: String(r['id']),
        type: String(r['type']),
        amount: toNum(r['amount'], 0),
        balanceAfter: toNum(r['balanceAfter'], 0),
        description: String(r['description'] ?? ''),
        referenceId: (r['referenceId'] as string | null) ?? null,
        createdAt: r['createdAt'] instanceof Date ? (r['createdAt'] as Date).toISOString() : String(r['createdAt'] ?? new Date().toISOString()),
      });
      if (parsed.success) items.push(parsed.data);
    }
    return items;
  }

  /**
   * BDD scenario 1: instant One-Click Buy with sufficient Credits.
   * Redis mutex (5s) → atomic $transaction (wallet debit + ledger + order + entitlement).
   */
  async executeOneClickBuy(userId: string, productId: string, expectedPrice: number, tenantId = 'default'): Promise<OneClickBuyResult> {
    const parsed = OneClickBuyInputSchema.safeParse({ productId, tenantId, expectedPrice });
    if (!parsed.success) throw new BadRequestException('Invalid one-click payload');
    const lockKey = walletLockKey(userId);
    const acquired = await this.redis.setnx(lockKey, '1', LOCK_TTL_SEC).catch(() => true);
    if (!acquired) throw new ConflictException('ระบบกำลังประมวลผลทำรายการอื่นอยู่ กรุณาลองใหม่อีกครั้ง');
    try {
      const price = parsed.data.expectedPrice;
      const result = await this.prisma.$transaction(async (tx) => {
        const db = tx as unknown as {
          wallet: {
            findUnique: (args: unknown) => Promise<Record<string, unknown> | null>;
            update: (args: unknown) => Promise<unknown>;
          };
          walletLedger: { create: (args: unknown) => Promise<unknown> };
          order: { create: (args: unknown) => Promise<{ id: string }> };
          product: { findUnique: (args: unknown) => Promise<{ price: unknown; discountPrice: unknown | null } | null> };
        };
        const wallet = await db.wallet.findUnique({ where: { userId } });
        assertUsable(wallet);
        // Price guard: live product price wins when it exceeds the client quote.
        const live = await db.product?.findUnique({ where: { id: productId } }).catch(() => null);
        const livePrice = live ? toNum(live.discountPrice ?? live.price, price) : price;
        const charge = Math.max(price, livePrice > 0 ? livePrice : price);
        const main = toNum(wallet['mainBalance'], 0);
        const bonus = toNum(wallet['bonusBalance'], 0);
        if (totalOf(main, bonus) < charge) throw new BadRequestException('ยอดเงินในกระเป๋าไม่เพียงพอ กรุณาเติมเงิน');
        const { newMain, newBonus } = debitSplit(main, bonus, charge);
        const newTotal = totalOf(newMain, newBonus);
        await db.wallet.update({ where: { id: String(wallet['id']) }, data: { mainBalance: newMain, bonusBalance: newBonus } });
        await db.walletLedger.create({
          data: {
            walletId: String(wallet['id']),
            type: 'PURCHASE_DEBIT',
            amount: -charge,
            balanceAfter: newTotal,
            description: purchaseDescription(productId),
            referenceId: productId,
          },
        });
        const order = await db.order.create({
          data: {
            orderNumber: orderNumber(),
            tenantId,
            userId,
            totalAmount: charge,
            netAmount: charge,
            orderStatus: 'COMPLETED',
            paymentStatus: 'VERIFIED',
            orderItems: { create: { productId, price: charge, quantity: 1 } },
          },
        });
        await this.grants.grantForOrder(tx as never, userId, [productId], 'FULL_PURCHASE');
        return { orderId: order.id, remainingBalance: newTotal };
      });
      await this.emit('stream:wallet:transaction-executed', { event: 'wallet_transaction_executed', kind: 'PURCHASE_DEBIT', userId, productId, amount: expectedPrice });
      return { success: true, orderId: result.orderId, remainingBalance: result.remainingBalance };
    } finally {
      await this.redis.del(lockKey).catch(() => undefined);
    }
  }

  /**
   * BDD scenario 2: top-up via verified PromptPay slip (EasySlip-approved).
   * Idempotent on transRef (30-day Redis claim); writes TOPUP_CREDIT + BONUS_CREDIT.
   */
  async topupFromSlip(userId: string, amount: number, transRef: string, opts?: { promotionCode?: string; bonusRate?: number }): Promise<WalletTopupResult> {
    const parsed = WalletTopupInputSchema.safeParse({ amount, promotionCode: opts?.promotionCode });
    if (!parsed.success) throw new BadRequestException(parsed.error.errors[0]?.message ?? 'Invalid top-up amount');
    if (!transRef) throw new BadRequestException('Missing slip transaction reference');
    const replayKey = `wallet:topup:${transRef}`;
    const first = await this.redis.setnx(replayKey, userId, TOPUP_REPLAY_TTL_SEC).catch(() => true);
    if (!first) throw new ConflictException('สลิปนี้เคยถูกใช้เติมเงินแล้ว (TOPUP_ALREADY_USED)');
    const lockKey = walletLockKey(userId);
    const acquired = await this.redis.setnx(lockKey, '1', LOCK_TTL_SEC).catch(() => true);
    if (!acquired) throw new ConflictException('ระบบกำลังประมวลผลทำรายการอื่นอยู่ กรุณาลองใหม่อีกครั้ง');
    try {
      const bonus = topupBonus(parsed.data.amount, opts?.bonusRate);
      const out = await this.prisma.$transaction(async (tx) => {
        const db = tx as unknown as {
          wallet: {
            findUnique: (args: unknown) => Promise<Record<string, unknown> | null>;
            create: (args: unknown) => Promise<Record<string, unknown>>;
            update: (args: unknown) => Promise<unknown>;
          };
          walletLedger: { create: (args: unknown) => Promise<unknown> };
        };
        let wallet = await db.wallet.findUnique({ where: { userId } });
        if (!wallet) {
          wallet = await db.wallet.create({ data: { userId, mainBalance: 0, bonusBalance: 0 } });
        }
        assertUsable(wallet);
        const main = toNum(wallet['mainBalance'], 0);
        const prevBonus = toNum(wallet['bonusBalance'], 0);
        const newMain = Math.round((main + parsed.data.amount) * 100) / 100;
        const afterTopup = totalOf(newMain, prevBonus);
        await db.wallet.update({ where: { id: String(wallet['id']) }, data: { mainBalance: newMain } });
        await db.walletLedger.create({
          data: { walletId: String(wallet['id']), type: 'TOPUP_CREDIT', amount: parsed.data.amount, balanceAfter: afterTopup, description: `เติมเงิน ${parsed.data.amount} บาท (slip ${transRef})`, referenceId: transRef },
        });
        let newBonus = prevBonus;
        if (bonus > 0) {
          newBonus = Math.round((prevBonus + bonus) * 100) / 100;
          const afterBonus = totalOf(newMain, newBonus);
          await db.wallet.update({ where: { id: String(wallet['id']) }, data: { bonusBalance: newBonus } });
          await db.walletLedger.create({
            data: { walletId: String(wallet['id']), type: 'BONUS_CREDIT', amount: bonus, balanceAfter: afterBonus, description: `โบนัสเติมเงิน ${bonus} Credits`, referenceId: transRef },
          });
        }
        return { walletId: String(wallet['id']), total: totalOf(newMain, newBonus) };
      });
      await this.emit('stream:wallet:transaction-executed', { event: 'wallet_transaction_executed', kind: 'TOPUP_CREDIT', userId, amount, transRef });
      await this.emit('stream:notify:flex-topup', { userId, amount, bonus, transRef });
      return { success: true, walletId: out.walletId, creditedAmount: parsed.data.amount, bonusAmount: bonus, totalBalance: out.total, transRef };
    } finally {
      await this.redis.del(lockKey).catch(() => undefined);
    }
  }

  /** Affiliate commission → wallet credit (AFFILIATE_REWARD_CREDIT, idempotent per order). */
  async creditAffiliateReward(userId: string, netAmount: number, orderId: string, tier: 1 | 2 | 3 = 1): Promise<number> {
    const reward = affiliateReward(netAmount, tier);
    if (reward <= 0) return 0;
    const claim = await this.redis.setnx(`wallet:affiliate:${orderId}:${userId}`, '1', TOPUP_REPLAY_TTL_SEC).catch(() => true);
    if (!claim) return 0;
    await this.prisma.$transaction(async (tx) => {
      const db = tx as unknown as {
        wallet: {
          findUnique: (args: unknown) => Promise<Record<string, unknown> | null>;
          create: (args: unknown) => Promise<Record<string, unknown>>;
          update: (args: unknown) => Promise<unknown>;
        };
        walletLedger: { create: (args: unknown) => Promise<unknown> };
      };
      let wallet = await db.wallet.findUnique({ where: { userId } });
      if (!wallet) wallet = await db.wallet.create({ data: { userId, mainBalance: 0, bonusBalance: 0 } });
      assertUsable(wallet);
      const main = toNum(wallet['mainBalance'], 0);
      const bonus = toNum(wallet['bonusBalance'], 0);
      const newMain = Math.round((main + reward) * 100) / 100;
      await db.wallet.update({ where: { id: String(wallet['id']) }, data: { mainBalance: newMain } });
      await db.walletLedger.create({
        data: { walletId: String(wallet['id']), type: 'AFFILIATE_REWARD_CREDIT', amount: reward, balanceAfter: totalOf(newMain, bonus), description: `ค่าคอมมิชชัน Tier${tier} จากออเดอร์ ${orderId}`, referenceId: orderId },
      });
    });
    return reward;
  }

  private async requireWallet(userId: string): Promise<Record<string, unknown>> {
    if (!userId) throw new BadRequestException('Missing user id');
    const db = this.prisma as unknown as {
      wallet: { upsert: (args: unknown) => Promise<Record<string, unknown>> };
    };
    return db.wallet.upsert({ where: { userId }, update: {}, create: { userId, mainBalance: 0, bonusBalance: 0 } });
  }

  private async emit(stream: string, payload: Record<string, unknown>): Promise<void> {
    await this.redis.publish(stream, JSON.stringify({ ...payload, at: new Date().toISOString() })).catch(() => undefined);
  }
}
