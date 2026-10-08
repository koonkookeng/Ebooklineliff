// SSOT Phase 079 §5 — Prisma affiliate repository (tenant-scoped ledger)
// Canonical: apps/backend/src/modules/affiliate/infrastructure/prisma-affiliate.repository.ts
// - Structural typing (078 precedent); money math uses Decimal-safe floats
//   at the service (bank rounding), Prisma Decimal columns persist.
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';
import type { AffiliateOrderRow, AffiliateRepository, AffiliateUserRow } from '../domain/affiliate.repository';

type Db = Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>>;

const toNum = (v: unknown): number => Number((v as { toString(): string } | null)?.toString?.() ?? 0);

function toRepo(db: Db): AffiliateRepository {
  return {
    async findUser(userId: string): Promise<AffiliateUserRow | null> {
      const u = (await db['user'].findUnique({ where: { id: userId } }).catch(() => null)) as {
        id: string; tenantId: string | null; affiliateCode: string; referredById: string | null;
        lineUserId: string | null; walletBalance: unknown;
      } | null;
      if (!u) return null;
      return { ...u, walletBalance: toNum(u.walletBalance) };
    },

    async findUserByCode(affiliateCode: string): Promise<AffiliateUserRow | null> {
      const u = (await db['user'].findUnique({ where: { affiliateCode } }).catch(() => null)) as {
        id: string; tenantId: string | null; affiliateCode: string; referredById: string | null;
        lineUserId: string | null; walletBalance: unknown;
      } | null;
      if (!u) return null;
      return { ...u, walletBalance: toNum(u.walletBalance) };
    },

    async findOrder(orderId: string): Promise<AffiliateOrderRow | null> {
      const o = (await db['order'].findUnique({
        where: { id: orderId },
        include: { user: true },
      }).catch(() => null)) as {
        id: string; orderNumber: string; tenantId: string | null; userId: string;
        paymentStatus: string; netAmount: unknown;
        user: { lineUserId: string | null } | null;
      } | null;
      if (!o) return null;
      return {
        orderId: o.id,
        orderNumber: o.orderNumber,
        tenantId: o.tenantId,
        buyerId: o.userId,
        buyerLineUserId: o.user?.lineUserId ?? null,
        paymentStatus: o.paymentStatus,
        netAmount: toNum(o.netAmount),
      };
    },

    async tierConfig(productId: string | null) {
      type RateRow = { tier1RatePercent: unknown; tier2RatePercent: unknown; tier3RatePercent: unknown } | null;
      const scoped: RateRow = productId
        ? ((await db['affiliateTierConfig'].findUnique({ where: { productId } }).catch(() => null)) as RateRow)
        : null;
      if (scoped) {
        return { t1: toNum(scoped.tier1RatePercent), t2: toNum(scoped.tier2RatePercent), t3: toNum(scoped.tier3RatePercent) };
      }
      const global = (await db['affiliateTierConfig'].findFirst({ where: { isActive: true } }).catch(() => null)) as {
        tier1RatePercent: unknown; tier2RatePercent: unknown; tier3RatePercent: unknown;
      } | null;
      if (global) {
        return { t1: toNum(global.tier1RatePercent), t2: toNum(global.tier2RatePercent), t3: toNum(global.tier3RatePercent) };
      }
      return { t1: 10, t2: 3, t3: 1 };
    },

    async hasCommissionForOrder(orderId: string): Promise<boolean> {
      const count = (await db['commissionLog'].count({ where: { orderId } }).catch(() => 0)) as number;
      return (count ?? 0) > 0;
    },

    async createCommission(args: {
      orderId: string; beneficiaryId: string; originBuyerId: string; tierLevel: string;
      orderAmount: number; commissionRate: number; commissionAmount: number; status: string; fraudReason?: string | null;
    }): Promise<void> {
      await db['commissionLog'].create({ data: { ...args } });
    },

    async creditWallet(userId: string, amount: number): Promise<void> {
      await db['user'].update({ where: { id: userId }, data: { walletBalance: { increment: amount } } });
    },

    async approvedEarnings(userId: string): Promise<number> {
      const agg = (await db['commissionLog'].aggregate({
        where: { beneficiaryId: userId, status: 'APPROVED' },
        _sum: { commissionAmount: true },
      }).catch(() => ({ _sum: { commissionAmount: 0 } }))) as { _sum: { commissionAmount: unknown } };
      return toNum(agg._sum.commissionAmount);
    },

    async createPayout(args: {
      payoutNo: string; userId: string; requestedAmount: number; taxWithheldAmount: number;
      netPayoutAmount: number; bankName: string; bankAccountNumber: string; bankAccountName: string;
    }) {
      return (await db['affiliatePayout'].create({ data: { ...args } })) as { id: string };
    },

    async createShareEvent(args: { userId: string; productId: string; refToken: string }) {
      return (await db['shareEvent'].create({ data: { ...args } })) as { id: string };
    },

    async dashboard(userId: string) {
      const [total, pending, me, t1] = (await Promise.all([
        db['commissionLog'].aggregate({ where: { beneficiaryId: userId, status: { in: ['APPROVED', 'PAID'] } }, _sum: { commissionAmount: true } }),
        db['commissionLog'].aggregate({ where: { beneficiaryId: userId, status: 'PENDING' }, _sum: { commissionAmount: true } }),
        db['user'].findUnique({ where: { id: userId } }),
        db['user'].count({ where: { referredById: userId } }),
      ]).catch(() => [{ _sum: {} }, { _sum: {} }, null, 0])) as unknown as [
        { _sum: { commissionAmount: unknown } },
        { _sum: { commissionAmount: unknown } },
        { affiliateCode: string } | null,
        number,
      ];
      return {
        totalEarnings: toNum(total._sum.commissionAmount),
        pendingEarnings: toNum(pending._sum.commissionAmount),
        tier1Count: (t1 as number) ?? 0,
        tier2Count: 0,
        affiliateCode: me?.affiliateCode ?? '',
      };
    },
  };
}

@Injectable()
export class PrismaAffiliateRepository implements AffiliateRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get root(): AffiliateRepository {
    return toRepo(this.prisma as unknown as Db);
  }

  withTx(tx: unknown): AffiliateRepository {
    return toRepo(tx as Db);
  }

  findUser(userId: string) { return this.root.findUser(userId); }
  findUserByCode(affiliateCode: string) { return this.root.findUserByCode(affiliateCode); }
  findOrder(orderId: string) { return this.root.findOrder(orderId); }
  tierConfig(productId: string | null) { return this.root.tierConfig(productId); }
  hasCommissionForOrder(orderId: string) { return this.root.hasCommissionForOrder(orderId); }
  createCommission(args: {
    orderId: string; beneficiaryId: string; originBuyerId: string; tierLevel: string;
    orderAmount: number; commissionRate: number; commissionAmount: number; status: string; fraudReason?: string | null;
  }) { return this.root.createCommission(args); }
  creditWallet(userId: string, amount: number) { return this.root.creditWallet(userId, amount); }
  approvedEarnings(userId: string) { return this.root.approvedEarnings(userId); }
  createPayout(args: {
    payoutNo: string; userId: string; requestedAmount: number; taxWithheldAmount: number;
    netPayoutAmount: number; bankName: string; bankAccountNumber: string; bankAccountName: string;
  }) { return this.root.createPayout(args); }
  createShareEvent(args: { userId: string; productId: string; refToken: string }) {
    return this.root.createShareEvent(args);
  }
  dashboard(userId: string) { return this.root.dashboard(userId); }
}
