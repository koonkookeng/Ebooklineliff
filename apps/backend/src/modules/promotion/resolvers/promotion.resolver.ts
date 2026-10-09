// SSOT Phase 088 §3.2/Gate 1 — Promotion intents (code-first)
// Canonical: apps/backend/src/modules/promotion/resolvers/promotion.resolver.ts
// (legacy class name PromotionResolverResolver renamed — no importers.)
// - Query.getEligibleCoupons / getUserPointBalance.
// - Mutation.calculateStackableDiscount.
// - Zero new deps.
import { Args, Field, Float, Int, ObjectType, Query, Mutation, Resolver, Context } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { DiscountCalculatorService } from '../services/discount-calculator.service';
import { CouponService } from '../services/coupon.service';
import { PointsService } from '../services/points.service';

@ObjectType('CouponScheme')
class CouponSchemeGql {
  @Field() code!: string;
  @Field() title!: string;
  @Field() couponType!: string;
  @Field(() => Float) discountValue!: number;
}

@ObjectType('AppliedCouponDetail')
class AppliedCouponDetailGql {
  @Field() code!: string;
  @Field() title!: string;
  @Field(() => Float) discountAmount!: number;
}

@ObjectType('DiscountCalculationResult')
class DiscountCalculationResultGql {
  @Field(() => Float) subtotal!: number;
  @Field(() => Float) shopCouponDiscount!: number;
  @Field(() => Float) shippingFeeOriginal!: number;
  @Field(() => Float) shippingDiscount!: number;
  @Field(() => Float) pointsDiscount!: number;
  @Field(() => Int) pointsRedeemed!: number;
  @Field(() => Float) netAmount!: number;
  @Field(() => AppliedCouponDetailGql, { nullable: true }) appliedShopCoupon!: AppliedCouponDetailGql | null;
  @Field(() => AppliedCouponDetailGql, { nullable: true }) appliedFreeShippingCoupon!: AppliedCouponDetailGql | null;
  @Field() isSuccess!: boolean;
  @Field({ nullable: true }) errorMessage!: string | null;
}

type LooseCtx = Record<string, unknown>;

function ctxOf(ctx: LooseCtx): { userId: string; tenantId: string } {
  const req = (ctx['req'] as Record<string, unknown> | undefined) ?? {};
  const user = (req['user'] as { id?: string } | undefined) ?? {};
  const headers = (req['headers'] as Record<string, string> | undefined) ?? {};
  const tenantId = (((req['tenantId'] as string | undefined) ?? headers['x-tenant-id'] ?? '') as string).trim();
  if (!user.id || !tenantId) throw new BadRequestException('Missing promotion context');
  return { userId: user.id, tenantId };
}

@Resolver('Promotion')
export class PromotionResolver {
  constructor(
    private readonly calc: DiscountCalculatorService,
    private readonly coupons: CouponService,
    private readonly points: PointsService,
  ) {}

  @Query('getEligibleCoupons')
  getEligibleCoupons(@Args('subtotal') subtotal: number, @Context() ctx: LooseCtx) {
    const c = ctxOf(ctx);
    return this.coupons.eligible(c.tenantId, Number(subtotal) || 0);
  }

  @Query('getUserPointBalance')
  getUserPointBalance(@Context() ctx: LooseCtx) {
    return this.points.balance(ctxOf(ctx).userId);
  }

  @Mutation('calculateStackableDiscount')
  async calculateStackableDiscount(
    @Args('input') input: {
      cartId?: string; shopCouponCode?: string; freeShippingCouponCode?: string;
      redeemPoints?: number; orderItems?: Array<{ productId: string; price: number; quantity: number }>;
      shippingFee?: number;
    },
    @Context() ctx: LooseCtx,
  ) {
    const c = ctxOf(ctx);
    if (!input?.cartId) throw new BadRequestException('Missing cartId');
    const r = await this.calc.calculateStackableDiscount({
      tenantId: c.tenantId,
      userId: c.userId,
      cartId: input.cartId,
      body: {
        ...(input.shopCouponCode ? { shopCouponCode: input.shopCouponCode } : {}),
        ...(input.freeShippingCouponCode ? { freeShippingCouponCode: input.freeShippingCouponCode } : {}),
        redeemPoints: input.redeemPoints ?? 0,
      },
      items: input.orderItems ?? [],
      shippingFee: (input as { shippingFee?: number }).shippingFee ?? 0,
    });
    const withAmounts = (d: { code: string; title: string } | null, amount: number) =>
      d ? { ...d, discountAmount: amount } : null;
    return {
      ...r,
      appliedShopCoupon: withAmounts(r.appliedShopCoupon, r.shopCouponDiscount),
      appliedFreeShippingCoupon: withAmounts(r.appliedFreeShippingCoupon, r.shippingDiscount),
    };
  }
}
