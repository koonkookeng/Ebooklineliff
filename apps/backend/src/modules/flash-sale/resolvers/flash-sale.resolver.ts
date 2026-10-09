// SSOT Phase 087 §3.2/Gate 1 — Flash sale GraphQL intents (code-first)
// Canonical: apps/backend/src/modules/flash-sale/resolvers/flash-sale.resolver.ts
// (legacy class name FlashSaleResolverResolver renamed — no importers.)
// - Query.getActiveFlashSaleCampaign / getFlashSaleItemStatus (public reads).
// - Mutation.reserveFlashSaleStock (JWT) / cancelStockReservation (JWT).
// - Zero new deps.
import { Args, Field, Float, ID, Int, ObjectType, Query, Mutation, Resolver, Context } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { ReserveStockInputSchema } from '@repo/shared';
import { FlashSaleCampaignService } from '../services/flash-sale-campaign.service';
import { RedisStockLockService } from '../services/redis-stock-lock.service';
import { PrismaService } from '../../../infra/database/prisma.service';

@ObjectType('FlashSaleProductItem')
class FlashSaleProductItemGql {
  @Field(() => ID) productId!: string;
  @Field() productTitle!: string;
  @Field() coverImageUrl!: string;
  @Field(() => Float) originalPrice!: number;
  @Field(() => Float) flashSalePrice!: number;
  @Field(() => Int) allocatedStock!: number;
  @Field(() => Int) soldQty!: number;
  @Field(() => Int) remainingStock!: number;
  @Field(() => Int) maxPerUser!: number;
  @Field(() => Int) discountPercentage!: number;
}

@ObjectType('FlashSaleCampaign')
class FlashSaleCampaignGql {
  @Field(() => ID) id!: string;
  @Field() tenantId!: string;
  @Field() title!: string;
  @Field({ nullable: true }) description!: string | null;
  @Field() startTime!: string;
  @Field() endTime!: string;
  @Field() status!: string;
  @Field() serverCurrentTime!: string;
  @Field(() => [FlashSaleProductItemGql]) items!: FlashSaleProductItemGql[];
}

@ObjectType('StockReservationResult')
class StockReservationResultGql {
  @Field() success!: boolean;
  @Field({ nullable: true }) reservationToken!: string | null;
  @Field({ nullable: true }) expiresAt!: string | null;
  @Field() message!: string;
  @Field(() => Int) remainingStock!: number;
}

type LooseCtx = Record<string, unknown>;

function tenantOf(ctx: LooseCtx, fallback?: string): string {
  const req = (ctx['req'] as Record<string, unknown> | undefined) ?? {};
  const headers = (req['headers'] as Record<string, string> | undefined) ?? {};
  return (fallback ?? headers['x-tenant-id'] ?? 'default').trim();
}

function actorOf(ctx: LooseCtx): string {
  const req = (ctx['req'] as Record<string, unknown> | undefined) ?? {};
  const user = (req['user'] as { id?: string } | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  return user.id;
}

@Resolver('FlashSale')
export class FlashSaleResolver {
  constructor(
    private readonly campaigns: FlashSaleCampaignService,
    private readonly locks: RedisStockLockService,
    private readonly prisma: PrismaService,
  ) {}

  @Query('getActiveFlashSaleCampaign')
  getActiveFlashSaleCampaign(@Args('tenantId') tenantId: string, @Context() ctx: LooseCtx) {
    return this.campaigns.activeCampaign(tenantOf(ctx, tenantId));
  }

  @Query('getFlashSaleItemStatus')
  getFlashSaleItemStatus(
    @Args('campaignId') campaignId: string,
    @Args('productId') productId: string,
  ) {
    return this.campaigns.itemStatus(campaignId, productId);
  }

  @Mutation('reserveFlashSaleStock')
  reserveFlashSaleStock(
    @Args('campaignId') campaignId: string,
    @Args('productId') productId: string,
    @Args('quantity', { nullable: true }) quantity: number | undefined,
    @Context() ctx: LooseCtx,
  ) {
    const parsed = ReserveStockInputSchema.safeParse({
      tenantId: tenantOf(ctx),
      campaignId,
      productId,
      quantity: quantity ?? 1,
    });
    if (!parsed.success) throw new BadRequestException('Invalid reserve input');
    return this.locks.reserveStockAtomic({
      campaignId: parsed.data.campaignId,
      productId: parsed.data.productId,
      userId: actorOf(ctx),
      quantity: parsed.data.quantity,
    });
  }

  @Mutation('cancelStockReservation')
  async cancelStockReservation(@Args('reservationToken') reservationToken: string, @Context() ctx: LooseCtx) {
    const userId = actorOf(ctx);
    const db = this.prisma as unknown as {
      stockReservation: {
        findUnique(a: unknown): Promise<{ id: string; userId: string; status: string } | null>;
        update(a: unknown): Promise<unknown>;
      };
    };
    const row = await db.stockReservation.findUnique({ where: { reservationToken } }).catch(() => null);
    if (!row || row.userId !== userId) throw new BadRequestException('Reservation not found');
    if (row.status !== 'HOLD') return false;
    await db.stockReservation.update({ where: { id: row.id }, data: { status: 'CANCELLED' } });
    return true;
  }
}
