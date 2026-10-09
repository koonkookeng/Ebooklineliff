// SSOT Phase 088 — Coupon service (lookup + locked quota consume)
// Canonical: apps/backend/src/modules/promotion/services/coupon.service.ts
// - findByCode (tenant-scoped, uppercased) + per-user usage count.
// - consumeQuota: Redlock → re-read → quota/per-user guards → atomic
//   usedQuota++ + redemption row (BDD-2: exactly one winner).
// - Structural Prisma (078–087 precedent). Zero new deps.
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';
import { assertCouponEligible, type CouponRow } from '../domain/coupon.entity';
import { RedlockService } from './redlock.service';

type Db = Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>>;

const toNum = (v: unknown): number => Number((v as { toString(): string } | null)?.toString?.() ?? 0);

export interface RedemptionHandle {
  couponId: string;
  code: string;
  title: string;
  discounted: number;
}

@Injectable()
export class CouponService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly locks: RedlockService,
  ) {}

  private get db(): Db {
    return this.prisma as unknown as Db;
  }

  async findByCode(code: string, tenantId: string): Promise<(CouponRow & { id: string }) | null> {
    const row = (await this.db['coupon'].findUnique({ where: { code: code.toUpperCase() } }).catch(() => null)) as {
      id: string; code: string; title: string; couponType: string; discountValue: unknown;
      maxDiscountAmount: unknown; minOrderAmount: unknown; totalQuota: number; usedQuota: number;
      perUserLimit: number; startAt: Date; expireAt: Date; isActive: boolean; tenantId: string | null;
    } | null;
    if (!row) return null;
    if (row.tenantId && row.tenantId !== tenantId) return null;
    return {
      id: row.id,
      code: row.code,
      title: row.title,
      couponType: row.couponType,
      discountValue: toNum(row.discountValue),
      maxDiscountAmount: row.maxDiscountAmount == null ? null : toNum(row.maxDiscountAmount),
      minOrderAmount: toNum(row.minOrderAmount),
      totalQuota: row.totalQuota,
      usedQuota: row.usedQuota,
      perUserLimit: row.perUserLimit,
      startAt: new Date(row.startAt).getTime(),
      expireAt: new Date(row.expireAt).getTime(),
      isActive: row.isActive,
      tenantId: row.tenantId,
    };
  }

  async userUsage(userId: string, couponId: string): Promise<number> {
    return ((await this.db['couponRedemption'].count({ where: { userId, couponId } }).catch(() => 0)) as number) ?? 0;
  }

  /** Tenant-scoped live coupons affordable at a subtotal (drawer listing). */
  async eligible(tenantId: string, subtotal: number): Promise<Array<{
    code: string; title: string; couponType: string; discountValue: number;
  }>> {
    const now = new Date();
    const rows = (await this.db['coupon'].findMany({
      where: {
        isActive: true,
        startAt: { lte: now },
        expireAt: { gte: now },
        OR: [{ tenantId: null }, { tenantId }],
      },
      orderBy: { discountValue: 'desc' },
      take: 50,
    }).catch(() => [])) as Array<{
      code: string; title: string; couponType: string; discountValue: unknown;
      minOrderAmount: unknown; totalQuota: number; usedQuota: number;
    }>;
    return rows
      .filter((r) => subtotal >= toNum(r.minOrderAmount) && r.usedQuota < r.totalQuota)
      .map((r) => ({ code: r.code, title: r.title, couponType: r.couponType, discountValue: toNum(r.discountValue) }));
  }

  /** Locked quota consume for an order (BDD-2 race semantics). */
  async consumeQuota(args: {
    userId: string;
    orderId: string;
    code: string;
    tenantId: string;
    subtotal: number;
    discounted: number;
    slot: 'SHOP' | 'SHIPPING';
  }): Promise<RedemptionHandle> {
    const code = args.code.toUpperCase();
    const locked = await this.locks.acquireCoupon(code);
    if (!locked) throw new BadRequestException('COUPON_LOCKED_RETRY');
    try {
      const coupon = await this.findByCode(code, args.tenantId);
      assertCouponEligible(coupon, {
        subtotal: args.subtotal,
        userUsed: await this.userUsage(args.userId, (coupon as { id: string }).id),
        tenantId: args.tenantId,
        slot: args.slot,
      });
      const row = coupon as CouponRow & { id: string };
      await this.db['coupon'].update({
        where: { id: row.id },
        data: { usedQuota: { increment: 1 } },
      });
      await this.db['couponRedemption'].create({
        data: {
          couponId: row.id,
          userId: args.userId,
          orderId: args.orderId,
          discounted: args.discounted,
        },
      });
      return { couponId: row.id, code: row.code, title: row.title, discounted: args.discounted };
    } finally {
      await this.locks.releaseCoupon(code);
    }
  }
}
