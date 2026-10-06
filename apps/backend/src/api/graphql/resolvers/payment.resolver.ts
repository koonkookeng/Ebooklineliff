// SSOT Phase 015 §3.2 — Payment verification status query (poll-friendly read)
// Canonical: apps/backend/src/api/graphql/resolvers/payment.resolver.ts
// (legacy src/backend/api/graphql/resolvers/payment.resolver.ts)
// The verifyPaymentSlip MUTATION stays owned by OrderResolver (Phase 012, no
// duplicate field); this resolver owns the status QUERY + enriched grant rows
// (spec §3.2 EntitlementGrantResult) for receipt rendering.
import { Resolver, Query, Args, Context, ObjectType, Field, ID } from '@nestjs/graphql';
import { BadRequestException, UnauthorizedException, UseGuards } from '@nestjs/common';
import { CheckoutService } from '../../../modules/order/services/checkout.service';
import { EntitlementService } from '../../../modules/entitlement/services/entitlement.service';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import type { GraphQLContext } from '../context/graphql-context.factory';

@ObjectType('EntitlementGrantResult')
class EntitlementGrantResultGql {
  @Field(() => ID) entitlementId!: string;
  @Field(() => ID) productId!: string;
  @Field() productTitle!: string;
  @Field() productType!: string;
  @Field() grantedAt!: string;
}

@ObjectType('PaymentVerificationStatus')
class PaymentVerificationStatusGql {
  @Field(() => ID) orderId!: string;
  @Field() orderNumber!: string;
  @Field() orderStatus!: string;
  @Field() paymentStatus!: string;
  @Field({ nullable: true }) transRef!: string | null;
  @Field(() => [EntitlementGrantResultGql]) grantedEntitlements!: EntitlementGrantResultGql[];
}

function actor(ctx: GraphQLContext): { userId: string } {
  const userId = ctx.req.user?.id;
  if (!userId) throw new UnauthorizedException('Unauthorized');
  return { userId };
}

@Resolver('PaymentVerification')
export class PaymentResolver {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly entitlements: EntitlementService,
  ) {}

  @Query('paymentVerificationStatus')
  @UseGuards(JwtAuthGuard)
  async paymentVerificationStatus(@Args('orderId') orderId: string, @Context() ctx: GraphQLContext) {
    const { userId } = actor(ctx);
    if (!orderId) throw new BadRequestException('Missing order id');
    const order = await this.checkout.getOrder(userId, orderId) as unknown as {
      id: string; orderNumber: string; orderStatus: string; paymentStatus: string;
      paymentSlip?: { transRef?: string | null } | null;
      orderItems: Array<{ productId: string }>;
    };
    const granted = order.paymentStatus === 'VERIFIED'
      ? await this.entitlements.listGrantResults(userId, order.orderItems.map((i) => i.productId))
      : [];
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      orderStatus: order.orderStatus,
      paymentStatus: order.paymentStatus,
      transRef: order.paymentSlip?.transRef ?? null,
      grantedEntitlements: granted,
    };
  }
}
