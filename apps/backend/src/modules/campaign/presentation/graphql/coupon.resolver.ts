// SSOT Phase 117 Task 5 §5.1 — campaign GraphQL intents (code-first)
// Canonical: apps/backend/src/modules/campaign/presentation/graphql/coupon.resolver.ts
// (legacy src/backend/modules/campaign/presentation/graphql/coupon.resolver.ts)
// - Mutation.validateCoupon / Mutation.claimCoupon / Mutation.applyCouponStack
//   (BDD-2 multi-coupon with matrix check) / Query.myCoupons /
//   Query.campaignCoupons. Zero new deps.
import { Args, Context, Field, Float, ObjectType, Query, Mutation, Resolver } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { ValidateCouponUseCase } from '../../application/use-cases/validate-coupon.use-case';
import { ClaimCouponUseCase } from '../../application/use-cases/claim-coupon.use-case';
import { CouponStackService } from '../../application/services/coupon-stack.service';
import { PrismaCouponRepository } from '../../infrastructure/persistence/prisma-coupon.repository';

@ObjectType('CampaignDiscountLine')
class CampaignDiscountLineGql {
  @Field() couponCode!: string;
  @Field() couponType!: string;
  @Field(() => Float) platformDiscount!: number;
  @Field(() => Float) sellerDiscount!: number;
  @Field(() => Float) shippingDiscount!: number;
  @Field(() => [String]) appliedItemIds!: string[];
}

@ObjectType('CouponValidationResult')
class CouponValidationResultGql {
  @Field() isValid!: boolean;
  @Field() message!: string;
  @Field(() => Float) totalDiscountAmount!: number;
  @Field(() => Float) netAmount!: number;
  @Field(() => [CampaignDiscountLineGql]) breakdown!: CampaignDiscountLineGql[];
}

type LooseCtx = Record<string, unknown>;

function actorOf(ctx: LooseCtx): string {
  const req = (ctx['req'] as Record<string, unknown> | undefined) ?? {};
  const user = (req['user'] as { id?: string } | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  return user.id;
}

@Resolver('CampaignCoupon')
export class CouponResolver {
  constructor(
    private readonly validate: ValidateCouponUseCase,
    private readonly claim: ClaimCouponUseCase,
    private readonly store: PrismaCouponRepository,
    private readonly stack: CouponStackService,
  ) {}

  @Mutation('validateCoupon')
  validateCoupon(@Args('input') input: Record<string, unknown>, @Context() ctx: LooseCtx) {
    return this.validate.execute(input, actorOf(ctx));
  }

  @Mutation('claimCoupon')
  claimCoupon(@Args('couponCode') couponCode: string, @Context() ctx: LooseCtx) {
    return this.claim.execute({ couponCode }, actorOf(ctx));
  }

  /** BDD-2: stack N codes with the compatibility matrix (fail-fast). */
  @Mutation('applyCouponStack')
  applyCouponStack(
    @Args('codes') codes: string[],
    @Args('cartItems') cartItems: Array<Record<string, unknown>>,
    @Args('shippingFee', { nullable: true }) shippingFee: number | undefined,
    @Context() ctx: LooseCtx,
  ) {
    return this.stack.applyStack(actorOf(ctx), {
      codes,
      cartItems: cartItems as Parameters<CouponStackService['applyStack']>[1]['cartItems'],
      ...(typeof shippingFee === 'number' ? { shippingFee } : {}),
    });
  }

  @Query('myCoupons')
  myCoupons(@Context() ctx: LooseCtx) {
    return this.store.listClaims(actorOf(ctx));
  }
}
