// SSOT Phase 079 §3.2/Gate 1 — Affiliate GraphQL intents (code-first)
// Canonical: apps/backend/src/modules/affiliate/resolvers/affiliate.resolver.ts
// - getAffiliateDashboard / generateProductFlexShare / createReferralLink /
//   requestAffiliatePayout behind the authenticated gateway.
// - Zero new deps.
import { Args, Field, Float, ID, InputType, Int, ObjectType, Query, Mutation, Resolver, Context } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { referralUrl } from '@repo/shared';
import { shortAffiliateCode } from '../domain/affiliate.entity';
import type { AffiliateRepository } from '../domain/affiliate.repository';
import { PrismaAffiliateRepository } from '../infrastructure/prisma-affiliate.repository';
import { FlexMessageBuilderService } from '../services/flex-message-builder.service';
import { PayoutService } from '../services/payout.service';

@ObjectType('AffiliateDashboardPayload')
class AffiliateDashboardPayloadGql {
  @Field(() => Float) totalEarnings!: number;
  @Field(() => Float) pendingEarnings!: number;
  @Field(() => Int) tier1ReferralsCount!: number;
  @Field(() => Int) tier2ReferralsCount!: number;
  @Field() affiliateCode!: string;
  @Field() referralLink!: string;
}

@ObjectType('FlexSharePayload')
class FlexSharePayloadGql {
  @Field() flexMessageJson!: string;
  @Field() shareUrl!: string;
}

@ObjectType('ReferralLinkPayload')
class ReferralLinkPayloadGql {
  @Field() signedUrl!: string;
  @Field() qrCodeUrl!: string;
  @Field() affiliateCode!: string;
}

@ObjectType('PayoutResponsePayload')
class PayoutResponsePayloadGql {
  @Field(() => ID) payoutId!: string;
  @Field(() => Float) requestedAmount!: number;
  @Field(() => Float) taxWithheld3Percent!: number;
  @Field(() => Float) netPayoutAmount!: number;
  @Field() status!: string;
}

@InputType('PayoutRequestInput')
class PayoutRequestInputGql {
  @Field(() => Float) amount!: number;
  @Field() bankName!: string;
  @Field() bankAccountNumber!: string;
  @Field() bankAccountName!: string;
}

function gqlCtx(ctx: Record<string, unknown>): { userId: string; tenantId: string } {
  const req = (ctx['req'] as Record<string, unknown> | undefined) ?? {};
  const user = (req['user'] as { id?: string } | undefined) ?? {};
  const headers = (req['headers'] as Record<string, string> | undefined) ?? {};
  const tenantId = (((req['tenantId'] as string | undefined) ?? headers['x-tenant-id'] ?? '') as string).trim();
  if (!user.id || !tenantId) throw new BadRequestException('Missing affiliate context');
  return { userId: user.id, tenantId };
}

@Resolver('Affiliate')
export class AffiliateResolver {
  constructor(
    private readonly payouts: PayoutService,
    private readonly flex: FlexMessageBuilderService,
    private readonly repo: PrismaAffiliateRepository,
  ) {}

  @Query('getAffiliateDashboard')
  getAffiliateDashboard(@Context() ctx: Record<string, unknown>) {
    const { userId } = gqlCtx(ctx);
    return this.payouts.dashboard(userId);
  }

  @Query('generateProductFlexShare')
  async generateProductFlexShare(
    @Args('productId') productId: string,
    @Context() ctx: Record<string, unknown>,
  ) {
    const { userId } = gqlCtx(ctx);
    if (!productId) throw new BadRequestException('Missing productId');
    const repo: AffiliateRepository = this.repo;
    const me = await repo.findUser(userId);
    if (!me) throw new BadRequestException('Affiliate account not found');
    const code = me.affiliateCode || shortAffiliateCode(userId);
    const shareUrl = referralUrl('https://liff.line.me', productId, code);
    return this.flex.build({
      productId,
      productTitle: 'แนะนำสิ่งนี้ให้คุณ',
      coverImageUrl: '',
      price: 0,
      affiliateCode: code,
      shareUrl,
      trackingCode: `${code.slice(0, 4)}-${productId.slice(0, 4)}`,
    });
  }

  @Mutation('createReferralLink')
  async createReferralLink(
    @Args('productId') productId: string,
    @Args('campaignTag', { nullable: true }) campaignTag: string | undefined,
    @Context() ctx: Record<string, unknown>,
  ) {
    const { userId } = gqlCtx(ctx);
    if (!productId) throw new BadRequestException('Missing productId');
    const repo: AffiliateRepository = this.repo;
    const me = await repo.findUser(userId);
    if (!me) throw new BadRequestException('Affiliate account not found');
    const code = me.affiliateCode || shortAffiliateCode(userId);
    const shareUrl = referralUrl('https://liff.line.me', productId, code, campaignTag ?? undefined);
    await repo.createShareEvent({ userId, productId, refToken: `${code}:${productId.slice(0, 8)}:${Date.now().toString(36)}` }).catch(() => undefined);
    return { signedUrl: shareUrl, qrCodeUrl: shareUrl, affiliateCode: code };
  }

  @Mutation('requestAffiliatePayout')
  requestAffiliatePayout(@Args('input') input: PayoutRequestInputGql, @Context() ctx: Record<string, unknown>) {
    const { userId, tenantId } = gqlCtx(ctx);
    return this.payouts.requestPayout(tenantId, userId, { tenantId, ...input });
  }
}
