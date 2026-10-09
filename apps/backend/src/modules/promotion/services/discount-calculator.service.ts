// SSOT Phase 088 Task 3 — Stackable discount calculator (3-layer quote)
// Canonical: apps/backend/src/modules/promotion/services/discount-calculator.service.ts
// (legacy class name DiscountCalculatorServiceService renamed — no importers.)
// - Flow (§5.2 verbatim): subtotal → shop layer (lookup + lattice) →
//   shipping layer → points layer (cover + rule caps) → net + applied
//   coupon cards. Quote-only (<50ms): quota/points move at order time via
//   coupon.consumeQuota / points.debitPoints (documented seam).
// - Try-guard: 5 code probes/min (§8) before any coupon lookup.
// - Port-based for DB-free tests. Zero new deps.
import { BadRequestException, Injectable } from '@nestjs/common';
import { ApplyCouponInputSchema, DiscountBreakdownSchema, PROMOTION_STREAM } from '@repo/shared';
import { CalculationEngine } from '../domain/calculation-engine';
import { assertCouponEligible } from '../domain/coupon.entity';
import { CouponService } from './coupon.service';
import { PointsService } from './points.service';
import { RedlockService } from './redlock.service';

export interface QuoteBus {
  xadd(stream: string, fields: Record<string, string | number>): Promise<unknown>;
}

@Injectable()
export class DiscountCalculatorService {
  constructor(
    private readonly coupons: CouponService,
    private readonly points: PointsService,
    private readonly locks: RedlockService,
    private readonly engine: CalculationEngine,
    private readonly bus: QuoteBus,
  ) {}

  async calculateStackableDiscount(args: {
    tenantId: string;
    userId: string;
    cartId: string;
    body: { shopCouponCode?: string; freeShippingCouponCode?: string; redeemPoints?: number };
    items: Array<{ productId: string; price: number; quantity: number }>;
    shippingFee: number;
  }): Promise<{
    subtotal: number;
    shopCouponDiscount: number;
    shippingFeeOriginal: number;
    shippingDiscount: number;
    pointsDiscount: number;
    pointsRedeemed: number;
    netAmount: number;
    appliedShopCoupon: { code: string; title: string } | null;
    appliedFreeShippingCoupon: { code: string; title: string } | null;
    isSuccess: boolean;
    errorMessage: string | null;
  }> {
    const t0 = Date.now();
    const parsed = ApplyCouponInputSchema.safeParse({
      tenantId: args.tenantId,
      cartId: args.cartId,
      ...(args.body.shopCouponCode ? { shopCouponCode: args.body.shopCouponCode } : {}),
      ...(args.body.freeShippingCouponCode ? { freeShippingCouponCode: args.body.freeShippingCouponCode } : {}),
      redeemPoints: args.body.redeemPoints ?? 0,
    });
    if (!parsed.success) throw new BadRequestException('Invalid discount input');
    if (args.items.length === 0) throw new BadRequestException('Empty cart cannot be discounted');

    const probes = await this.locks.bumpTry(args.userId);
    if (probes > this.locks.tryLimit()) throw new BadRequestException('TOO_MANY_COUPON_TRIES');

    const subtotal = Math.round(args.items.reduce((s, i) => s + i.price * i.quantity, 0) * 100) / 100;

    let shop: { discountValue: number; isPercent: boolean; maxDiscountAmount: number | null } | null = null;
    let appliedShopCoupon: { code: string; title: string } | null = null;
    if (parsed.data.shopCouponCode) {
      const row = await this.coupons.findByCode(parsed.data.shopCouponCode, args.tenantId);
      if (!row) throw new BadRequestException('INVALID_COUPON_CODE');
      assertCouponEligible(row, {
        subtotal,
        userUsed: await this.coupons.userUsage(args.userId, row.id),
        tenantId: args.tenantId,
        slot: 'SHOP',
      });
      shop = {
        discountValue: row.discountValue,
        isPercent: row.couponType === 'PERCENTAGE',
        maxDiscountAmount: row.maxDiscountAmount,
      };
      appliedShopCoupon = { code: row.code, title: row.title };
    }

    let ship: { maxOffset: number | null } | null = null;
    let appliedFreeShippingCoupon: { code: string; title: string } | null = null;
    if (parsed.data.freeShippingCouponCode) {
      const row = await this.coupons.findByCode(parsed.data.freeShippingCouponCode, args.tenantId);
      if (!row) throw new BadRequestException('INVALID_COUPON_CODE');
      assertCouponEligible(row, {
        subtotal,
        userUsed: await this.coupons.userUsage(args.userId, row.id),
        tenantId: args.tenantId,
        slot: 'SHIPPING',
      });
      ship = { maxOffset: row.maxDiscountAmount };
      appliedFreeShippingCoupon = { code: row.code, title: row.title };
    }

    const wallet = await this.points.balance(args.userId);
    // Points rule = contract defaults (POINTS_PER_THB/MIN/MAX_PCT); the
    // PointRedemptionRule table is the admin-tunable home (117).
    const line = this.engine.calculate({
      subtotal,
      shippingFee: args.shippingFee,
      ...(shop ? { shopCoupon: shop } : {}),
      ...(ship ? { freeShipCoupon: ship } : {}),
      redeemPoints: parsed.data.redeemPoints,
      walletPoints: wallet,
    });

    const breakdown = DiscountBreakdownSchema.safeParse({
      subtotal,
      shopCouponDiscount: line.shopCouponDiscount,
      shippingFeeOriginal: args.shippingFee,
      shippingDiscount: line.shippingDiscount,
      pointsDiscount: line.pointsDiscount,
      pointsRedeemed: line.pointsRedeemed,
      netAmount: line.netAmount,
      appliedShopCoupon,
      appliedFreeShippingCoupon,
    });
    if (!breakdown.success) throw new BadRequestException('Discount breakdown mismatch');

    await this.bus
      .xadd(PROMOTION_STREAM, {
        event: 'coupon.stack.applied',
        userId: args.userId,
        cartId: args.cartId,
        netAmount: line.netAmount,
        tookMs: Date.now() - t0,
        at: Date.now(),
      })
      .catch(() => undefined);

    return { ...breakdown.data, isSuccess: true, errorMessage: null };
  }
}
