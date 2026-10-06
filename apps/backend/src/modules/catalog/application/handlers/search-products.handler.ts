// SSOT Phase 009 §5.2 — SearchProducts handler (Redis <5ms → Prisma parallel facets, 60s TTL)
// Canonical: apps/backend/src/modules/catalog/application/handlers/search-products.handler.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { ProductFilterInputSchema, type ProductSearchResponse } from '@repo/shared';
import { SearchProductsQuery } from '../queries/search-products.query';
import { PrismaProductSearchRepository } from '../../infrastructure/persistence/prisma-product-search.repository';
import { RedisSearchCacheAdapter } from '../../infrastructure/persistence/redis-search-cache.adapter';

@Injectable()
export class SearchProductsHandler {
  constructor(
    private readonly repo: PrismaProductSearchRepository,
    private readonly cache: RedisSearchCacheAdapter,
  ) {}

  async execute(query: SearchProductsQuery): Promise<ProductSearchResponse> {
    const parsed = ProductFilterInputSchema.safeParse(query.filter);
    if (!parsed.success) throw new BadRequestException('Invalid product filter');

    const cached = await this.cache.getCatalog(parsed.data);
    if (cached) return JSON.parse(cached) as ProductSearchResponse;

    const response = await this.repo.search(parsed.data);
    if (response.totalCount === 0 && parsed.data.query) {
      await this.cache.trackZeroResult(parsed.data.query, parsed.data.tenantId);
    }
    await this.cache.setCatalog(parsed.data, JSON.stringify(response));
    return response;
  }

  mapSortOrder(sortBy: string): Record<string, string> {
    switch (sortBy) {
      case 'PRICE_ASC':
        return { price: 'asc' };
      case 'PRICE_DESC':
        return { price: 'desc' };
      case 'RATING':
        return { ratingAverage: 'desc' };
      case 'NEWEST':
        return { createdAt: 'desc' };
      default:
        return { createdAt: 'desc' };
    }
  }
}
