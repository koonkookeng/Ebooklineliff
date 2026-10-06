// SSOT barrel — Phase 001 core + Phase 002 infra + Phase 003 identity + Phase 005 auth
export * from './schemas/phase001-init';
export * from './schemas/infra-env.schema';
export * from './schemas/identity.zod';
export * from './schemas/zod-graphql-contracts';
export * from './schemas/auth-contract';
export * from './schemas/catalog.zod';
export {
  ProductSortByEnum,
  ProductFilterInputSchema,
  PredictiveSearchQuerySchema,
  FacetCountSchema,
  ProductSearchItemSchema,
  ProductSearchResponseSchema,
  PredictiveSuggestionSchema,
  sanitizeSearchQuery,
  searchCacheKey,
  predictiveCacheKey,
} from './schemas/product-search.schema';
export type {
  ProductSortBy,
  ProductFilterInput,
  PredictiveSearchQuery,
  FacetCount,
  ProductSearchItem,
  ProductSearchResponse,
  PredictiveSuggestion,
} from './schemas/product-search.schema';
export {
  StorefrontBannerSchema,
  CategoryQuickLinkSchema,
  ProductCardSchema,
  ProductDetailSchema,
  StorefrontFeedSchema,
  effectivePrice,
  discountPercent,
} from './schemas/storefront.schema';
export type {
  StorefrontBanner,
  CategoryQuickLink,
  ProductCard,
  ProductDetail,
  StorefrontFeed,
} from './schemas/storefront.schema';
