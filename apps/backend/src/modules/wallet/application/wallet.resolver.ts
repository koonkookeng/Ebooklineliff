// SSOT Phase 017 §5 — Wallet GraphQL presentation (balance + ledger + one-click)
// Canonical: apps/backend/src/modules/wallet/application/wallet.resolver.ts
// (legacy src/backend/modules/wallet/application/wallet.resolver.ts)
import { Resolver, Query, Mutation, Args, Context, ObjectType, Field, ID, Float, Int } from '@nestjs/graphql';
import { BadRequestException, UnauthorizedException, UseGuards } from '@nestjs/common';
import { OneClickBuyInputSchema, WalletTopupInputSchema } from '@repo/shared';
import { WalletService } from './wallet.service';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import type { GraphQLContext } from '../../../api/graphql/context/graphql-context.factory';

@ObjectType('WalletBalance')
class WalletBalanceGql {
  @Field(() => ID) walletId!: string;
  @Field(() => Float) mainBalance!: number;
  @Field(() => Float) bonusBalance!: number;
  @Field(() => Float) totalBalance!: number;
  @Field() currency!: string;
}

@ObjectType('WalletLedgerItem')
class WalletLedgerItemGql {
  @Field(() => ID) id!: string;
  @Field() type!: string;
  @Field(() => Float) amount!: number;
  @Field(() => Float) balanceAfter!: number;
  @Field() description!: string;
  @Field({ nullable: true }) referenceId!: string | null;
  @Field() createdAt!: string;
}

@ObjectType('OneClickBuyResult')
class OneClickBuyResultGql {
  @Field() success!: boolean;
  @Field(() => ID) orderId!: string;
  @Field(() => Float) remainingBalance!: number;
}

@ObjectType('WalletTopupResult')
class WalletTopupResultGql {
  @Field() success!: boolean;
  @Field(() => ID) walletId!: string;
  @Field(() => Float) creditedAmount!: number;
  @Field(() => Float) bonusAmount!: number;
  @Field(() => Float) totalBalance!: number;
  @Field({ nullable: true }) transRef!: string | null;
}

function actor(ctx: GraphQLContext): { userId: string; tenantId: string } {
  const userId = ctx.req.user?.id;
  if (!userId) throw new UnauthorizedException('Unauthorized');
  return { userId, tenantId: ctx.tenantId ?? 'default' };
}

@Resolver('Wallet')
export class WalletResolver {
  constructor(private readonly wallet: WalletService) {}

  @Query('walletBalance')
  @UseGuards(JwtAuthGuard)
  walletBalance(@Context() ctx: GraphQLContext) {
    return this.wallet.getBalance(actor(ctx).userId);
  }

  @Query('walletLedger')
  @UseGuards(JwtAuthGuard)
  walletLedger(@Args('take', { type: () => Int, nullable: true }) take: number | undefined, @Context() ctx: GraphQLContext) {
    return this.wallet.ledger(actor(ctx).userId, take ?? 20);
  }

  @Mutation('executeOneClickBuy')
  @UseGuards(JwtAuthGuard)
  executeOneClickBuy(
    @Args('productId') productId: string,
    @Args('expectedPrice', { type: () => Float }) expectedPrice: number,
    @Context() ctx: GraphQLContext,
  ) {
    const { userId, tenantId } = actor(ctx);
    const parsed = OneClickBuyInputSchema.safeParse({ productId, tenantId, expectedPrice });
    if (!parsed.success) throw new BadRequestException('Invalid one-click payload');
    return this.wallet.executeOneClickBuy(userId, parsed.data.productId, parsed.data.expectedPrice, parsed.data.tenantId);
  }

  @Mutation('topupWalletPreview')
  @UseGuards(JwtAuthGuard)
  topupWalletPreview(@Args('amount', { type: () => Float }) amount: number) {
    const parsed = WalletTopupInputSchema.safeParse({ amount });
    if (!parsed.success) throw new BadRequestException(parsed.error.errors[0]?.message ?? 'Invalid amount');
    return { amount: parsed.data.amount };
  }
}
