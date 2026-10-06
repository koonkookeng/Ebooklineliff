// SSOT Phase 010 §5.1 — Storefront GraphQL resolver (feed + PDP + predictive)
// Canonical: apps/backend/src/modules/catalog/resolvers/storefront.resolver.ts
// (legacy src/backend/modules/catalog/resolvers/storefront.resolver.ts)
import { Resolver, Query, Args, Context, ObjectType, Field, ID, Int, Float } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { StorefrontService } from '../services/storefront.service';
import type { GraphQLContext } from '../../../api/graphql/context/graphql-context.factory';

@ObjectType('StorefrontBanner')
class StorefrontBannerGql {
  @Field(() => ID) id!: string;
  @Field() title!: string;
  @Field() imageUrl!: string;
  @Field() targetUrl!: string;
  @Field(() => Int) displayOrder!: number;
}

@ObjectType('CategoryQuickLink')
class CategoryQuickLinkGql {
  @Field(() => ID) id!: string;
  @Field() name!: string;
  @Field() slug!: string;
  @Field(() => Int) productCount!: number;
}

@ObjectType('ProductCard')
class ProductCardGql {
  @Field(() => ID) id!: string;
  @Field() title!: string;
  @Field() slug!: string;
  @Field() coverImageUrl!: string;
  @Field() productType!: string;
  @Field(() => Float) price!: number;
  @Field(() => Float, { nullable: true }) discountPrice!: number | null;
  @Field(() => Float) rating!: number;
  @Field(() => Int) soldCount!: number;
  @Field() isBestseller!: boolean;
}

@ObjectType('StorefrontFeedPayload')
class StorefrontFeedGql {
  @Field(() => [StorefrontBannerGql]) banners!: StorefrontBannerGql[];
  @Field(() => [CategoryQuickLinkGql]) categories!: CategoryQuickLinkGql[];
  @Field(() => [ProductCardGql]) featuredProducts!: ProductCardGql[];
  @Field(() => [ProductCardGql]) bestsellerProducts!: ProductCardGql[];
  @Field(() => [ProductCardGql]) newReleases!: ProductCardGql[];
}

function tenantFrom(ctx: GraphQLContext, explicit?: string): string {
  const t = explicit ?? ctx.tenantId;
  if (!t) throw new BadRequestException('Missing tenant id');
  return t;
}

@Resolver('Storefront')
export class StorefrontResolver {
  constructor(private readonly storefront: StorefrontService) {}

  @Query('getStorefrontFeed')
  getStorefrontFeed(@Args('tenantId') tenantId: string, @Context() ctx: GraphQLContext) {
    return this.storefront.getFeedByTenant(tenantFrom(ctx, tenantId));
  }

  @Query('getProductDetailBySlug')
  getProductDetailBySlug(
    @Args('slug') slug: string,
    @Args('tenantId') tenantId: string,
    @Context() ctx: GraphQLContext,
  ) {
    if (!slug?.trim()) throw new BadRequestException('Missing product slug');
    return this.storefront.getProductBySlug(slug, tenantFrom(ctx, tenantId));
  }

  @Query('getPredictiveSearch')
  getPredictiveSearch(
    @Args('query') query: string,
    @Args('tenantId') tenantId: string,
    @Context() ctx: GraphQLContext,
  ) {
    if (!query?.trim()) throw new BadRequestException('Missing search query');
    return this.storefront.getPredictiveSearch(query, tenantFrom(ctx, tenantId));
  }
}
