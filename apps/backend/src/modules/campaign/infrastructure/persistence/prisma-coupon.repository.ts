// SSOT Phase 117 Task 4 — prisma coupon repository (structural adapter)
// Canonical: apps/backend/src/modules/campaign/infrastructure/persistence/prisma-coupon.repository.ts
// (legacy src/backend/modules/campaign/infrastructure/persistence/prisma-coupon.repository.ts)
// - Quota commits are conditional atomic increments (updateMany with a
//   floor guard → matched 0 means exhausted: the hard double-spend guard;
//   Redis Lua is the fast-path mirror). Claims rely on the
//   @@unique([userId, couponId]) ledger (exact one-time guarantee).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../infra/database/prisma.service';

type PrismaAny = {
  coupon: {
    findUnique(a: unknown): Promise<unknown>;
    findMany(a: unknown): Promise<unknown[]>;
    updateMany(a: unknown): Promise<{ count: number }>;
  };
  couponTargetProduct: { findMany(a: unknown): Promise<unknown[]> };
  userCouponClaim: {
    findFirst(a: unknown): Promise<unknown>;
    findMany(a: unknown): Promise<unknown[]>;
    count(a: unknown): Promise<number>;
    create(a: unknown): Promise<unknown>;
    updateMany(a: unknown): Promise<{ count: number }>;
  };
  couponRedemption: { create(a: unknown): Promise<unknown> };
  campaign: { findMany(a: unknown): Promise<unknown[]>; findUnique(a: unknown): Promise<unknown> };
};

@Injectable()
export class PrismaCouponRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get db(): PrismaAny {
    return this.prisma as unknown as PrismaAny;
  }

  findByCode(code: string): Promise<unknown> {
    return this.db.coupon.findUnique({ where: { code }, include: { campaign: true } });
  }

  targetProductIds(couponId: string): Promise<Set<string>> {
    return (this.db.couponTargetProduct.findMany({ where: { couponId }, select: { productId: true } }) as Promise<Array<{ productId: string }>>).then(
      (rows) => new Set(rows.map((r) => r.productId)),
    );
  }

  /** Conditional atomic quota commit (117 lane, fallback 088 lane). */
  async commitQuota117(couponId: string): Promise<boolean> {
    const row = (await this.db.coupon.findUnique({ where: { id: couponId } }).catch(() => null)) as {
      globalUsageLimit: number | null; currentUsageCount: number | null; totalQuota: number | null; usedQuota: number | null;
    } | null;
    if (!row) return false;
    const use117 = row.globalUsageLimit !== null && row.globalUsageLimit !== undefined;
    const res = await (use117
      ? this.db.coupon.updateMany({
          where: { id: couponId, currentUsageCount: { lt: row.globalUsageLimit as number } },
          data: { currentUsageCount: { increment: 1 } },
        })
      : this.db.coupon.updateMany({
          where: { id: couponId, usedQuota: { lt: row.totalQuota as number } },
          data: { usedQuota: { increment: 1 } },
        })
    ).catch(() => ({ count: 0 }));
    return res.count > 0;
  }

  userClaimCount(userId: string, couponId: string): Promise<number> {
    return this.db.userCouponClaim.count({ where: { userId, couponId } }).catch(() => 0);
  }

  listClaims(userId: string): Promise<unknown[]> {
    return this.db.userCouponClaim.findMany({
      where: { userId },
      include: { coupon: true },
      orderBy: { claimedAt: 'desc' },
      take: 100,
    }).catch(() => []);
  }

  claimCoupon(userId: string, couponId: string): Promise<{ id: string } | null> {
    return (this.db.userCouponClaim.create({ data: { userId, couponId, isUsed: false } }).catch(() => null)) as Promise<{ id: string } | null>;
  }

  markClaimUsed(userId: string, couponId: string): Promise<void> {
    return this.db.userCouponClaim
      .updateMany({ where: { userId, couponId }, data: { isUsed: true } })
      .then(() => undefined)
      .catch(() => undefined);
  }

  recordRedemption(args: { couponId: string; userId: string; orderId: string; discountAmount: number }): Promise<unknown> {
    return (this.db.couponRedemption.create({ data: args }) as Promise<unknown>).catch(() => null);
  }

  activeCampaigns(tenantId?: string): Promise<unknown[]> {
    const now = new Date();
    return this.db.campaign.findMany({
      where: { isActive: true, startDate: { lte: now }, endDate: { gte: now }, ...(tenantId ? { OR: [{ tenantId }, { tenantId: null }] } : {}) },
      include: { coupons: true },
      take: 50,
    }).catch(() => []);
  }
}
