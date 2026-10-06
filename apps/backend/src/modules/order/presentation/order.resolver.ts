// SSOT Phase 012 §3.2 — Order GraphQL presentation (smart checkout + slip verify)
// Canonical: apps/backend/src/modules/order/presentation/order.resolver.ts
// NOTE: `createOrder(productIds)` is owned by the Phase-004 OrderPaymentResolver
// (wired in Apollo gateway) — this module exposes `createSmartOrder(input)` to avoid
// a duplicate-mutation schema collision. ADR-012 documents the split.
import { Resolver, Query, Mutation, Args, Context, ObjectType, Field, ID, Int, Float, InputType } from '@nestjs/graphql';
import { BadRequestException, UnauthorizedException, UseGuards } from '@nestjs/common';
import { CreateOrderInputSchema, VerifySlipInputSchema } from '@repo/shared';
import { CheckoutService } from '../services/checkout.service';
import { SlipVerifyService } from '../services/slip-verify.service';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import type { GraphQLContext } from '../../../api/graphql/context/graphql-context.factory';

@InputType('OrderItemInput')
class OrderItemInputGql {
  @Field(() => ID) productId!: string;
  @Field(() => Int, { nullable: true }) quantity?: number;
}

@InputType('CreateSmartOrderInput')
class CreateSmartOrderInputGql {
  @Field(() => ID) tenantId!: string;
  @Field(() => ID, { nullable: true }) shippingAddressId?: string;
  @Field({ nullable: true }) couponCode?: string;
  @Field(() => [OrderItemInputGql]) items!: OrderItemInputGql[];
}

@ObjectType('CreateSmartOrderPayload')
class CreateSmartOrderPayloadGql {
  @Field(() => ID) orderId!: string;
  @Field() orderNumber!: string;
  @Field(() => Float) netAmount!: number;
  @Field() promptPayQrPayload!: string;
  @Field() expiresAt!: string;
}

@ObjectType('SlipVerificationResult')
class SlipVerificationResultGql {
  @Field() success!: boolean;
  @Field() message!: string;
  @Field(() => ID) orderId!: string;
  @Field() orderStatus!: string;
  @Field() paymentStatus!: string;
  @Field({ nullable: true }) transRef!: string | null;
  @Field(() => [ID]) entitlementsGranted!: string[];
}

function actor(ctx: GraphQLContext): { userId: string } {
  const userId = ctx.req.user?.id;
  if (!userId) throw new UnauthorizedException('Unauthorized');
  return { userId };
}

@Resolver('SmartOrder')
export class OrderResolver {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly slipVerify: SlipVerifyService,
  ) {}

  @Mutation('createSmartOrder')
  @UseGuards(JwtAuthGuard)
  createSmartOrder(@Args('input') input: CreateSmartOrderInputGql, @Context() ctx: GraphQLContext) {
    const parsed = CreateOrderInputSchema.safeParse({
      tenantId: input.tenantId,
      shippingAddressId: input.shippingAddressId,
      couponCode: input.couponCode,
      items: input.items.map((i) => ({ productId: i.productId, quantity: i.quantity ?? 1 })),
    });
    if (!parsed.success) throw new BadRequestException('Invalid checkout payload');
    return this.checkout.createOrder(actor(ctx).userId, parsed.data);
  }

  @Query('smartOrder')
  @UseGuards(JwtAuthGuard)
  smartOrder(@Args('orderId') orderId: string, @Context() ctx: GraphQLContext) {
    return this.checkout.getOrder(actor(ctx).userId, orderId);
  }

  @Mutation('verifyPaymentSlip')
  @UseGuards(JwtAuthGuard)
  verifyPaymentSlip(
    @Args('orderId') orderId: string,
    @Args('slipImageUrl') slipImageUrl: string,
    @Context() ctx: GraphQLContext,
  ) {
    const parsed = VerifySlipInputSchema.safeParse({ orderId, slipImageUrl });
    if (!parsed.success) throw new BadRequestException('Invalid slip verification payload');
    return this.slipVerify.verify(parsed.data.orderId, parsed.data.slipImageUrl, actor(ctx).userId);
  }
}
