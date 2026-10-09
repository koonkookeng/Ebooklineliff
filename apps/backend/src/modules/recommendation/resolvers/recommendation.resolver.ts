// SSOT Phase 104 Task 6 — Recommendation GraphQL resolver (code-first)
// Canonical: apps/backend/src/modules/recommendation/resolvers/recommendation.resolver.ts
// - Query recommendationSlate / trendingSlate; Mutation trackInteraction /
//   markSlateFeedback. JWT-guarded, tenant from header. Zero new deps.
import { Args, Context, Field, Float, ID, InputType, Int, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { BadRequestException, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { TrackInteractionEventSchema } from '@repo/shared';
import { HybridRerankerService } from '../services/hybrid-reranker.service';
import { ColdStartService } from '../services/cold-start.service';
import { PrismaRecommendationRepository } from '../repositories/recommendation.repository';
import { parseSlateLimit } from '../dto/recommendation-request.dto';

@ObjectType('RecommendationItemPayload')
class RecommendationItemGql {
  @Field(() => ID)
  productId!: string;

  @Field()
  title!: string;

  @Field()
  coverImageUrl!: string;

  @Field()
  productType!: string;

  @Field(() => Float)
  price!: number;

  @Field(() => Float, { nullable: true })
  discountPrice?: number | null;

  @Field(() => Float)
  matchScore!: number;

  @Field()
  reasonType!: string;

  @Field()
  reasonText!: string;

  @Field()
  algorithmUsed!: string;
}

@InputType('TrackInteractionInput')
class TrackInteractionInputGql {
  @Field(() => ID)
  productId!: string;

  @Field()
  eventType!: string;

  @Field(() => Int, { nullable: true })
  dwellTimeSec?: number;

  @Field(() => Float, { nullable: true })
  progressPercentage?: number;
}

type GqlCtx = { req?: { user?: { id?: string }; headers?: Record<string, string> } };

function actorOf(ctx: GqlCtx): { userId: string; tenantId: string } {
  const userId = ctx.req?.user?.id;
  if (!userId) throw new BadRequestException('Missing authentication');
  const tenantId = ctx.req?.headers?.['x-tenant-id'] ?? 'default';
  return { userId, tenantId };
}

@Resolver()
export class RecommendationResolver {
  constructor(
    private readonly reranker: HybridRerankerService,
    private readonly coldStart: ColdStartService,
    private readonly repo: PrismaRecommendationRepository,
  ) {}

  @Query(() => [RecommendationItemGql])
  @UseGuards(JwtAuthGuard)
  async recommendationSlate(
    @Context() ctx: GqlCtx,
    @Args('limit', { nullable: true }) limit?: number,
  ): Promise<RecommendationItemGql[]> {
    const { userId, tenantId } = actorOf(ctx);
    return this.reranker.generatePersonalizedSlate(userId, tenantId, parseSlateLimit(limit));
  }

  @Query(() => [RecommendationItemGql])
  @UseGuards(JwtAuthGuard)
  async trendingSlate(
    @Context() ctx: GqlCtx,
    @Args('limit', { nullable: true }) limit?: number,
  ): Promise<RecommendationItemGql[]> {
    const { tenantId } = actorOf(ctx);
    const n = parseSlateLimit(limit);
    const cards = await this.coldStart.getCuratedBestsellers(tenantId, n);
    return cards.map((c, i) => ({
      productId: c.productId,
      title: c.title,
      coverImageUrl: c.coverImageUrl,
      productType: c.productType,
      price: c.price,
      discountPrice: c.discountPrice,
      matchScore: Math.min(99.8, Math.round((0.9 - i * 0.02) * 1000) / 10),
      reasonType: 'COLD_START_ONBOARDING',
      reasonText: 'ยอดนิยมในหมวดที่คุณสนใจ',
      algorithmUsed: 'BEHAVIORAL_HEURISTIC',
    }));
  }

  @Mutation(() => Boolean)
  @UseGuards(JwtAuthGuard)
  async trackInteraction(@Context() ctx: GqlCtx, @Args('input') input: TrackInteractionInputGql): Promise<boolean> {
    const { userId } = actorOf(ctx);
    const parsed = TrackInteractionEventSchema.safeParse({ ...input, userId, timestamp: new Date().toISOString() });
    if (!parsed.success) throw new BadRequestException('Invalid interaction event');
    await this.repo.logInteraction({
      userId,
      productId: parsed.data.productId,
      eventType: parsed.data.eventType,
      dwellTimeSec: parsed.data.dwellTimeSec,
      progressPercentage: parsed.data.progressPercentage,
    });
    return true;
  }

  @Mutation(() => Boolean)
  @UseGuards(JwtAuthGuard)
  async markSlateFeedback(
    @Context() ctx: GqlCtx,
    @Args('productId') productId: string,
    @Args('action') action: string,
  ): Promise<boolean> {
    const { userId } = actorOf(ctx);
    if (action !== 'click' && action !== 'purchase') throw new BadRequestException('Invalid feedback');
    await this.repo
      .markSlateFeedback(userId, productId, action === 'click' ? 'isClicked' : 'isPurchased')
      .catch(() => undefined);
    return true;
  }
}
