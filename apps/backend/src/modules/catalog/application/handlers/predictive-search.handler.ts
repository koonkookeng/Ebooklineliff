// SSOT Phase 009 §5.2/§8.1 — PredictiveSearch handler (rate-limit → Redis → Prisma, 30s TTL)
// Canonical: apps/backend/src/modules/catalog/application/handlers/predictive-search.handler.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import {
  PredictiveSearchQuerySchema,
  sanitizeSearchQuery,
  type PredictiveSuggestion,
} from '@repo/shared';
import { PredictiveSearchQuery } from '../queries/predictive-search.query';
import { PrismaProductSearchRepository } from '../../infrastructure/persistence/prisma-product-search.repository';
import { RedisSearchCacheAdapter } from '../../infrastructure/persistence/redis-search-cache.adapter';

@Injectable()
export class PredictiveSearchHandler {
  constructor(
    private readonly repo: PrismaProductSearchRepository,
    private readonly cache: RedisSearchCacheAdapter,
  ) {}

  async execute(query: PredictiveSearchQuery): Promise<PredictiveSuggestion[]> {
    const clean = sanitizeSearchQuery(query.query);
    const parsed = PredictiveSearchQuerySchema.safeParse({ query: clean, limit: query.limit });
    if (!parsed.success) throw new BadRequestException('Invalid predictive query');

    if (query.lineUserId) {
      const gate = await this.cache.checkPredictiveRateLimit(query.lineUserId);
      if (!gate.allowed) throw new BadRequestException('Too many search requests (30/min)');
    }

    const cached = await this.cache.getPredictive(parsed.data.query, parsed.data.limit);
    if (cached) return (JSON.parse(cached) as PredictiveSuggestion[]).slice(0, 5);

    const items = await this.repo.predictive(parsed.data.query, parsed.data.limit);
    if (items.length === 0) {
      await this.cache.trackZeroResult(parsed.data.query, query.tenantId);
    }
    await this.cache.setPredictive(parsed.data.query, parsed.data.limit, JSON.stringify(items));
    return items.slice(0, 5);
  }
}
