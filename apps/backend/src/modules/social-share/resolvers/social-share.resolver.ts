// SSOT Phase 026 §3.2/Task 2 — Social share GraphQL presentation (code-first, Zod-gated)
// Canonical: apps/backend/src/modules/social-share/resolvers/social-share.resolver.ts
// (legacy src/backend/modules/social-share/resolvers/social-share.resolver.ts)
// - Query.generateProductFlexShare(input) → FlexSharePayload (§3.2 verbatim intent).
// - Mutation.recordShareLog(productId, targetType, status, shareToken) → result.
// - Identity via GraphQL context (library.resolver precedent), never via input.
import { Args, Context, Field, InputType, Int, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { SocialShareService } from '../services/social-share.service';
import type { GraphQLContext } from '../../../api/graphql/context/graphql-context.factory';
import {
  DynamicFlexShareInputSchema,
  RecordShareLogInputSchema,
} from '@repo/shared';

@ObjectType('FlexSharePayload')
class FlexSharePayloadGql {
  @Field() flexMessageJson!: string;
  @Field() shareToken!: string;
  @Field() affiliateCode!: string;
  @Field() deepLinkUrl!: string;
}

@ObjectType('ShareLogResultPayload')
class ShareLogResultPayloadGql {
  @Field() success!: boolean;
  @Field({ nullable: true }) shareLogId?: string | null;
  @Field(() => Int) rewardPointsEarned!: number;
  @Field() message!: string;
}

@InputType('DynamicFlexShareInput')
class DynamicFlexShareInputGql {
  @Field() productId!: string;
  @Field() contentType!: string;
  @Field(() => Int, { nullable: true }) targetPageNumber?: number;
  @Field({ nullable: true }) targetLessonId?: string;
  @Field({ nullable: true }) customQuote?: string;
}

function actor(ctx: GraphQLContext): string {
  const userId = ctx.req.user?.id;
  if (!userId) throw new UnauthorizedException('Unauthorized');
  return userId;
}

@Resolver('SocialShare')
export class SocialShareResolver {
  constructor(private readonly share: SocialShareService) {}

  @Query('generateProductFlexShare')
  generateProductFlexShare(
    @Args('input') input: DynamicFlexShareInputGql,
    @Context() ctx: GraphQLContext,
  ): Promise<FlexSharePayloadGql> {
    const parsed = DynamicFlexShareInputSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException('Invalid share input');
    return this.share.generateFlexSharePayload(actor(ctx), parsed.data);
  }

  @Mutation('recordShareLog')
  async recordShareLog(
    @Args('productId') productId: string,
    @Args('targetType') targetType: string,
    @Args('status') status: string,
    @Args('shareToken') shareToken: string,
    @Context() ctx: GraphQLContext,
  ): Promise<ShareLogResultPayloadGql> {
    const parsed = RecordShareLogInputSchema.safeParse({ productId, targetType, status, shareToken });
    if (!parsed.success) throw new BadRequestException('Invalid share-log input');
    const out = await this.share.recordShareLog(actor(ctx), parsed.data);
    return { ...out, shareLogId: out.shareLogId ?? null };
  }
}
