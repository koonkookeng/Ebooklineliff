// SSOT Phase 009 §3.2/§5.1 — Product search GraphQL presentation (facets + predictive)
// Canonical: apps/backend/src/modules/catalog/presentation/resolvers/product-search.resolver.ts
// (legacy src/backend/api/graphql/resolvers/product.resolver.ts)
import { Resolver, Query, Args, Context, ObjectType, Field, ID, Int, Float, InputType, registerEnumType } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { ProductFilterInputSchema } from '@repo/shared';
import { SearchProductsQuery } from '../../application/queries/search-products.query';
import { PredictiveSearchQuery } from '../../application/queries/predictive-search.query';
import { SearchProductsHandler } from '../../application/handlers/search-products.handler';
import { PredictiveSearchHandler } from '../../application/handlers/predictive-search.handler';
import type { GraphQLContext } from '../../../../api/graphql/context/graphql-context.factory';

enum ProductTypeGql {
  PHYSICAL_BOOK = 'PHYSICAL_BOOK',
  EBOOK = 'EBOOK',
  ELEARNING_COURSE = 'ELEARNING_COURSE',
  LIVE_CLASS = 'LIVE_CLASS',
  HYBRID_BUNDLE = 'HYBRID_BUNDLE',
}
registerEnumType(ProductTypeGql, { name: 'ProductType' });

enum ProductSortByGql {
  RELEVANCE = 'RELEVANCE',
  PRICE_ASC = 'PRICE_ASC',
  PRICE_DESC = 'PRICE_DESC',
  NEWEST = 'NEWEST',
  POPULARITY = 'POPULARITY',
  RATING = 'RATING',
}
registerEnumType(ProductSortByGql, { name: 'ProductSortBy' });

@InputType('ProductFilterInput')
class ProductFilterInputGql {
  @Field({ nullable: true }) query?: string;
  @Field(() => [String], { nullable: true }) productTypes?: string[];
  @Field(() => [ID], { nullable: true }) categoryIds?: string[];
  @Field(() => Float, { nullable: true }) minPrice?: number;
  @Field(() => Float, { nullable: true }) maxPrice?: number;
  @Field({ nullable: true }) inStockOnly?: boolean;
  @Field(() => Float, { nullable: true }) ratingMin?: number;
  @Field({ nullable: true }) sortBy?: string;
  @Field(() => Int, { nullable: true }) page?: number;
  @Field(() => Int, { nullable: true }) limit?: number;
  @Field({ nullable: true }) cursor?: string;
}

@ObjectType('ProductSearchItem')
class ProductSearchItemGql {
  @Field(() => ID) id!: string;
  @Field() title!: string;
  @Field() slug!: string;
  @Field() coverImageUrl!: string;
  @Field() productType!: string;
  @Field(() => Float) price!: number;
  @Field(() => Float, { nullable: true }) discountPrice!: number | null;
  @Field(() => Float) ratingAverage!: number;
  @Field(() => Int) reviewCount!: number;
  @Field() isAvailable!: boolean;
}

@ObjectType('FacetCount')
class FacetCountGql {
  @Field() facetName!: string;
  @Field() value!: string;
  @Field(() => Int) count!: number;
}

@ObjectType('ProductSearchResult')
class ProductSearchResultGql {
  @Field(() => [ProductSearchItemGql]) items!: ProductSearchItemGql[];
  @Field(() => [FacetCountGql]) facets!: FacetCountGql[];
  @Field(() => Int) totalCount!: number;
  @Field() hasNextPage!: boolean;
  @Field({ nullable: true }) nextCursor!: string | null;
}

@ObjectType('PredictiveSuggestion')
class PredictiveSuggestionGql extends ProductSearchItemGql {
  @Field({ nullable: true }) highlightSnippet!: string | null;
}

function tenantFrom(ctx: GraphQLContext): string | undefined {
  const t = ctx.tenantId;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t ?? '') ? t : undefined;
}

@Resolver('ProductSearch')
export class ProductSearchResolver {
  constructor(
    private readonly searchHandler: SearchProductsHandler,
    private readonly predictiveHandler: PredictiveSearchHandler,
  ) {}

  @Query('searchProducts')
  async searchProducts(@Args('filter') filter: ProductFilterInputGql, @Context() ctx: GraphQLContext) {
    const parsed = ProductFilterInputSchema.safeParse({
      tenantId: tenantFrom(ctx),
      query: filter.query,
      productTypes: filter.productTypes,
      categoryIds: filter.categoryIds,
      minPrice: filter.minPrice,
      maxPrice: filter.maxPrice,
      inStockOnly: filter.inStockOnly ?? false,
      ratingMin: filter.ratingMin,
      sortBy: (filter.sortBy as never) ?? 'RELEVANCE',
      page: filter.page ?? 1,
      limit: filter.limit ?? 20,
      cursor: filter.cursor,
    });
    if (!parsed.success) throw new BadRequestException('Invalid product filter');
    return this.searchHandler.execute(new SearchProductsQuery(parsed.data));
  }

  @Query('predictiveSearch')
  async predictiveSearch(
    @Args('query') query: string,
    @Args('limit', { type: () => Int, nullable: true }) limit: number | undefined,
    @Context() ctx: GraphQLContext,
  ) {
    if (!query?.trim()) throw new BadRequestException('Missing search query');
    return this.predictiveHandler.execute(
      new PredictiveSearchQuery(query, limit ?? 5, tenantFrom(ctx), ctx.req.user?.id),
    );
  }
}
