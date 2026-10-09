// SSOT Phase 084 §3.2/Gate 1 — Abandoned cart GraphQL intents (code-first)
// Canonical: apps/backend/src/modules/messaging/resolvers/abandoned-cart.resolver.ts
// (ADDITIVE to the §5.1 tree, which lists REST only — GQL carries the §3.2
// intents; 079–083 code-first precedent.)
// - Mutation.markCartAsAbandoned / recoverAbandonedCart (public magic-link).
// - Query.getAbandonedCartAnalytics (authed creator view).
// - Zero new deps.
import { Args, Field, Float, ID, Int, ObjectType, Query, Mutation, Resolver, Context } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { AbandonedCartService } from '../services/abandoned-cart.service';

@ObjectType('AbandonedCartItem')
class AbandonedCartItemGql {
  @Field(() => ID) productId!: string;
  @Field() title!: string;
  @Field() coverImageUrl!: string;
  @Field(() => Float) price!: number;
  @Field(() => Int) quantity!: number;
}

@ObjectType('AbandonedCartSession')
class AbandonedCartSessionGql {
  @Field(() => ID) cartId!: string;
  @Field(() => ID) userId!: string;
  @Field() status!: string;
  @Field(() => [AbandonedCartItemGql]) items!: AbandonedCartItemGql[];
  @Field(() => Float) totalAmount!: number;
  @Field(() => Float, { nullable: true }) discountAmount!: number | null;
  @Field({ nullable: true }) recoveryCouponCode!: string | null;
  @Field({ nullable: true }) expiresAt!: string | null;
}

@ObjectType('RecoveryPayload')
class RecoveryPayloadGql {
  @Field() success!: boolean;
  @Field() message!: string;
  @Field(() => AbandonedCartSessionGql, { nullable: true }) cartSession!: AbandonedCartSessionGql | null;
}

@ObjectType('AbandonedCartAnalyticsPayload')
class AbandonedCartAnalyticsPayloadGql {
  @Field(() => Int) totalAbandonedCount!: number;
  @Field(() => Int) recoveredCount!: number;
  @Field(() => Float) recoveredRevenue!: number;
  @Field(() => Float) recoveryRatePercentage!: number;
}

type LooseCtx = Record<string, unknown>;

function actorOf(ctx: LooseCtx): string {
  const req = (ctx['req'] as Record<string, unknown> | undefined) ?? {};
  const user = (req['user'] as { id?: string } | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  return user.id;
}

function tenantOf(ctx: LooseCtx, fallback?: string): string {
  const req = (ctx['req'] as Record<string, unknown> | undefined) ?? {};
  const headers = (req['headers'] as Record<string, string> | undefined) ?? {};
  return (fallback ?? headers['x-tenant-id'] ?? 'default').trim();
}

@Resolver('AbandonedCart')
export class AbandonedCartResolver {
  constructor(private readonly carts: AbandonedCartService) {}

  @Mutation('markCartAsAbandoned')
  markCartAsAbandoned(@Args('cartId') cartId: string, @Context() ctx: LooseCtx) {
    if (!cartId) throw new BadRequestException('Missing cartId');
    return this.carts.markAbandoned(actorOf(ctx), cartId).then(() => true);
  }

  @Mutation('recoverAbandonedCart')
  recoverAbandonedCart(@Args('recoveryToken') recoveryToken: string) {
    if (!recoveryToken) throw new BadRequestException('Missing recoveryToken');
    const secret = process.env['RECOVERY_TOKEN_SECRET'] || process.env['JWT_SECRET'] || 'secret-key-144-xz';
    return this.carts.recover(recoveryToken, secret);
  }

  @Query('getAbandonedCartAnalytics')
  getAbandonedCartAnalytics(
    @Args('tenantId') tenantId: string,
    @Context() ctx: LooseCtx,
  ) {
    return this.carts.analytics(tenantOf(ctx, tenantId));
  }
}
