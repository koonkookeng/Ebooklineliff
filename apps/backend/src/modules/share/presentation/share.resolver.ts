// SSOT Phase 080 §3.2/Gate 1 — Share GraphQL intents (code-first)
// Canonical: apps/backend/src/modules/share/presentation/share.resolver.ts
// - Mutation.trackAffiliateClick(refToken): public recipient intake (BDD-2);
//   identity optional — IP/UA stamped from the request headers.
// - Query.getAffiliateShareMetrics(productId): authed sharer-self metrics.
// - RISK_CALL (documented): generateProductFlexShare is NOT redeclared here —
//   the SocialShare (026) and Affiliate (079) resolvers already own that field
//   name; a third declaration would collide the schema. Generation rides the
//   GenerateFlexShareUseCase via REST (share.controller.ts).
// - Zero new deps.
import { Args, Field, Float, Int, ObjectType, Query, Mutation, Resolver, Context } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { ctrOf } from '@repo/shared';
import { PrismaShareRepository } from '../infrastructure/share.repository';
import { TrackClickUseCase } from '../application/track-click.usecase';

@ObjectType('TrackClickPayload')
class TrackClickPayloadGql {
  @Field() success!: boolean;
  @Field() affiliateCode!: string;
  @Field() isNewSession!: boolean;
}

@ObjectType('AffiliateMetricsPayload')
class AffiliateMetricsPayloadGql {
  @Field(() => Int) totalShares!: number;
  @Field(() => Int) totalClicks!: number;
  @Field(() => Int) conversions!: number;
  @Field(() => Float) estimatedEarnings!: number;
  @Field(() => Float) ctrPercentage!: number;
}

type LooseCtx = Record<string, unknown>;

function authed(ctx: LooseCtx): string {
  const req = (ctx['req'] as Record<string, unknown> | undefined) ?? {};
  const user = (req['user'] as { id?: string } | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  return user.id;
}

function netOf(ctx: LooseCtx): { ip: string; ua: string; lineId: string | null } {
  const req = (ctx['req'] as Record<string, unknown> | undefined) ?? {};
  const headers = (req['headers'] as Record<string, string> | undefined) ?? {};
  const fwd = headers['x-forwarded-for'] ?? '';
  const user = (req['user'] as { id?: string; lineUserId?: string } | undefined) ?? {};
  return {
    ip: ((req['ip'] as string | undefined) ?? fwd.split(',')[0]?.trim() ?? '0.0.0.0'),
    ua: headers['user-agent'] ?? 'unknown',
    lineId: user.lineUserId ?? null,
  };
}

@Resolver('Share')
export class ShareResolver {
  constructor(
    private readonly track: TrackClickUseCase,
    private readonly repo: PrismaShareRepository,
  ) {}

  @Mutation('trackAffiliateClick')
  trackAffiliateClick(
    @Args('refToken') refToken: string,
    @Context() ctx: LooseCtx,
  ) {
    // NOTE: the use-case also returns productId for the REST envelope;
    // GraphQL exposes only the verbatim §3.1 TrackClickPayload fields.
    if (!refToken) throw new BadRequestException('Missing refToken');
    const net = netOf(ctx);
    return this.track.execute({
      refToken,
      visitorLineId: net.lineId,
      ipAddress: net.ip,
      userAgent: net.ua,
    });
  }

  @Query('getAffiliateShareMetrics')
  async getAffiliateShareMetrics(
    @Args('productId', { nullable: true }) productId: string | undefined,
    @Context() ctx: LooseCtx,
  ) {
    const userId = authed(ctx);
    const m = await this.repo.shareMetrics({ userId, productId: productId || null });
    return { ...m, ctrPercentage: ctrOf(m.totalClicks, m.totalShares) };
  }
}
