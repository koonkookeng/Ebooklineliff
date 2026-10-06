// SSOT Phase 025 §3.2/Task 3 — Resolver GraphQL presentation (code-first, Zod-gated)
// Canonical: apps/backend/src/modules/resolver/resolver.resolver.ts
// - Query.resolveShortCode(shortCode, env) → DynamicRouteResolved (BDD §1.3).
// - Mutation.generatePermanentDeepLink(input) → short code string (HMAC-signed).
// - Explicit @InputType (code-first schema generation cannot infer `unknown`).
import { Args, Field, InputType, Int, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { ResolveDeepLinkUseCase } from './application/use-cases/resolve-deep-link.usecase';
import { CreateShortLinkUseCase } from './application/use-cases/create-short-link.usecase';
import { CreateShortLinkInputSchema } from '@repo/shared';

@ObjectType('DynamicRouteResolved')
class DynamicRouteResolvedGql {
  @Field() success!: boolean;
  @Field() targetUrl!: string;
  @Field() tenantId!: string;
  @Field() targetType!: string;
  @Field() targetId!: string;
  @Field({ nullable: true }) affiliateCode?: string | null;
  @Field({ nullable: true }) couponCode?: string | null;
  @Field() requiresAuth!: boolean;
}

@InputType('GenerateDeepLinkInput')
class GenerateDeepLinkInputGql {
  @Field() tenantId!: string;
  @Field() targetType!: string;
  @Field() targetId!: string;
  @Field({ nullable: true }) customSlug?: string;
  @Field({ nullable: true }) affiliateCode?: string;
  @Field({ nullable: true }) campaignId?: string;
  @Field({ nullable: true }) couponCode?: string;
  @Field({ nullable: true }) expiresAt?: string;
  @Field(() => Int, { nullable: true }) maxRedemptions?: number;
}

@Resolver('Resolver')
export class ResolverResolver {
  constructor(
    private readonly resolve: ResolveDeepLinkUseCase,
    private readonly create: CreateShortLinkUseCase,
  ) {}

  @Query('resolveShortCode')
  async resolveShortCode(
    @Args('shortCode') shortCode: string,
    @Args('env', { nullable: true }) env?: string | null,
  ): Promise<DynamicRouteResolvedGql> {
    if (!shortCode) throw new BadRequestException('Missing short code');
    const ua = typeof env === 'string' && env ? env : 'DESKTOP_WEB';
    const out = await this.resolve.execute(shortCode, ua, 'graphql', undefined);
    return {
      success: out.success,
      targetUrl: out.targetUrl,
      tenantId: out.tenantId,
      targetType: out.targetType,
      targetId: out.targetId,
      affiliateCode: out.affiliateCode ?? null,
      couponCode: out.couponCode ?? null,
      requiresAuth: out.requiresAuth,
    };
  }

  @Mutation('generatePermanentDeepLink')
  async generatePermanentDeepLink(
    @Args('input') input: GenerateDeepLinkInputGql,
  ): Promise<string> {
    const parsed = CreateShortLinkInputSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException('Invalid short-link input');
    const row = await this.create.execute(parsed.data);
    return row.shortCode;
  }
}
