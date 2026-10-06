// SSOT Phase 011 §3.2/§5.1 — Cart GraphQL presentation (queries + mutations)
// Canonical: apps/backend/src/modules/cart/presentation/cart.resolver.ts
// (legacy src/backend/api/graphql/resolvers/cart.resolver.ts)
import { Resolver, Query, Mutation, Args, Context, ObjectType, Field, ID, Int, Float, InputType } from '@nestjs/graphql';
import { BadRequestException, UnauthorizedException, UseGuards } from '@nestjs/common';
import { CalculateShippingInputSchema, type Carrier } from '@repo/shared';
import { CartService } from '../application/cart.service';
import { AddToCartUseCase } from '../application/use-cases/add-to-cart.usecase';
import { SplitCartCalculatorUseCase } from '../application/use-cases/split-cart-calculator.usecase';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import type { GraphQLContext } from '../../../api/graphql/context/graphql-context.factory';

@ObjectType('SmartCartItem')
class SmartCartItemGql {
  @Field(() => ID) cartItemId!: string;
  @Field(() => ID) productId!: string;
  @Field() title!: string;
  @Field() coverImageUrl!: string;
  @Field() productType!: string;
  @Field() itemCategory!: string;
  @Field(() => Float) unitPrice!: number;
  @Field(() => Int) quantity!: number;
  @Field(() => Int) weightGrams!: number;
  @Field({ nullable: true }) sku?: string;
}

@ObjectType('HybridCartSplitSummary')
class HybridCartSplitSummaryGql {
  @Field(() => [SmartCartItemGql]) digitalItems!: SmartCartItemGql[];
  @Field(() => [SmartCartItemGql]) physicalItems!: SmartCartItemGql[];
  @Field(() => Float) digitalSubtotal!: number;
  @Field(() => Float) physicalSubtotal!: number;
  @Field(() => Int) totalPhysicalWeightGrams!: number;
  @Field(() => Float) estimatedShippingFee!: number;
  @Field(() => Float) appliedDiscountAmount!: number;
  @Field(() => Float) grandTotalAmount!: number;
  @Field() requiresShippingAddress!: boolean;
}

@InputType('CalculateShippingInput')
class CalculateShippingInputGql {
  @Field(() => ID) cartId!: string;
  @Field(() => ID) shippingAddressId!: string;
  @Field({ nullable: true }) preferredCarrier?: string;
}

function actor(ctx: GraphQLContext): { userId: string; tenantId: string } {
  const userId = ctx.req.user?.id;
  if (!userId) throw new UnauthorizedException('Unauthorized');
  return { userId, tenantId: ctx.tenantId ?? 'default' };
}

@Resolver('SmartCart')
export class CartResolver {
  constructor(
    private readonly cart: CartService,
    private readonly addToCart: AddToCartUseCase,
    private readonly splitCalc: SplitCartCalculatorUseCase,
  ) {}

  @Query('getSmartCart')
  @UseGuards(JwtAuthGuard)
  getSmartCart(@Context() ctx: GraphQLContext) {
    const { userId, tenantId } = actor(ctx);
    return this.splitCalc.execute(userId, undefined, tenantId);
  }

  @Mutation('addToSmartCart')
  @UseGuards(JwtAuthGuard)
  addToSmartCart(
    @Args('productId') productId: string,
    @Args('quantity', { type: () => Int, nullable: true }) quantity: number | undefined,
    @Context() ctx: GraphQLContext,
  ) {
    const { userId, tenantId } = actor(ctx);
    return this.addToCart.execute(userId, { productId, quantity: quantity ?? 1 }, tenantId);
  }

  @Mutation('updateSmartCartItemQuantity')
  @UseGuards(JwtAuthGuard)
  updateSmartCartItemQuantity(
    @Args('cartItemId') cartItemId: string,
    @Args('quantity', { type: () => Int }) quantity: number,
    @Context() ctx: GraphQLContext,
  ) {
    const { userId, tenantId } = actor(ctx);
    return this.cart.updateQuantity(userId, cartItemId, quantity, tenantId);
  }

  @Mutation('removeFromSmartCart')
  @UseGuards(JwtAuthGuard)
  removeFromSmartCart(@Args('cartItemId') cartItemId: string, @Context() ctx: GraphQLContext) {
    const { userId, tenantId } = actor(ctx);
    return this.cart.removeItem(userId, cartItemId, tenantId);
  }

  @Mutation('calculateHybridShippingFee')
  @UseGuards(JwtAuthGuard)
  async calculateHybridShippingFee(
    @Args('input') input: CalculateShippingInputGql,
    @Context() ctx: GraphQLContext,
  ) {
    const { userId, tenantId } = actor(ctx);
    const parsed = CalculateShippingInputSchema.safeParse({
      cartId: input.cartId,
      shippingAddressId: input.shippingAddressId,
      preferredCarrier: input.preferredCarrier as Carrier | undefined,
    });
    if (!parsed.success) throw new BadRequestException('Invalid shipping input');
    const { summary } = await this.cart.calculateShipping(
      userId,
      parsed.data.shippingAddressId,
      parsed.data.preferredCarrier,
      tenantId,
    );
    return summary;
  }
}
