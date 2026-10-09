// SSOT Phase 104 Task 4 — Hybrid reranker (cache → cold-start/hybrid → slate)
// Canonical: apps/backend/src/modules/recommendation/services/hybrid-reranker.service.ts
// - Redis-first slate (<30ms edge), purchased-exclusion, matchScore 0..100,
//   slate impression ledger (best-effort), 15-min cache. Zero new deps.
import { Injectable, Logger } from '@nestjs/common';
import {
  COLD_START_INTERACTION_THRESHOLD,
  SLATE_TTL_SEC,
  recSlateCacheKey,
  recEventStreamKey,
  type RecommendationItem,
} from '@repo/shared';
import type {
  ProductCard,
  RecommendationRepository,
} from '../repositories/recommendation.repository';
import { VectorSearchService } from './vector-search.service';
import { CollaborativeFilteringService } from './collaborative-filtering.service';
import { ColdStartService } from './cold-start.service';

export interface RecCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: Array<string | number>): Promise<unknown>;
}

export interface RecStream {
  xaddPipeline(stream: string, batch: Array<Record<string, string | number>>): Promise<void>;
}

function toItem(
  card: ProductCard,
  score01: number,
  reasonType: RecommendationItem['reasonType'],
  reasonText: string,
  algorithmUsed: RecommendationItem['algorithmUsed'],
): RecommendationItem {
  return {
    productId: card.productId,
    title: card.title,
    coverImageUrl: card.coverImageUrl,
    productType: card.productType as RecommendationItem['productType'],
    price: card.price,
    discountPrice: card.discountPrice,
    matchScore: Math.min(99.8, Math.round(Math.max(0, Math.min(1, score01)) * 1000) / 10),
    reasonType,
    reasonText,
    algorithmUsed,
  };
}

@Injectable()
export class HybridRerankerService {
  private readonly logger = new Logger(HybridRerankerService.name);

  constructor(
    private readonly repo: RecommendationRepository,
    private readonly cache: RecCache,
    private readonly stream: RecStream,
    private readonly vectorSearch: VectorSearchService,
    private readonly collaborative: CollaborativeFilteringService,
    private readonly coldStart: ColdStartService,
  ) {}

  async generatePersonalizedSlate(userId: string, tenantId: string, limit = 6): Promise<RecommendationItem[]> {
    const cacheKey = recSlateCacheKey(tenantId, userId);
    const cached = await this.cache.get(cacheKey).catch(() => null);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as RecommendationItem[];
        if (Array.isArray(parsed) && parsed.length > 0) return parsed.slice(0, limit);
      } catch { /* corrupt cache → regenerate */ }
    }

    const interactionCount = await this.repo.countInteractions(userId).catch(() => 0);
    let items: RecommendationItem[];
    if (interactionCount < COLD_START_INTERACTION_THRESHOLD) {
      this.logger.log(`Cold-start slate for user ${userId}`);
      const cards = await this.coldStart.getCuratedBestsellers(tenantId, limit);
      items = cards.map((c, i) =>
        toItem(c, 0.9 - i * 0.02, 'COLD_START_ONBOARDING', 'ยอดนิยมในหมวดที่คุณสนใจ', 'BEHAVIORAL_HEURISTIC'),
      );
    } else {
      this.logger.log(`Hybrid vector+CF slate for user ${userId}`);
      items = await this.buildHybridSlate(userId, tenantId, limit);
    }

    await this.cache.set(cacheKey, JSON.stringify(items), 'EX', SLATE_TTL_SEC).catch(() => undefined);
    await this.repo
      .logSlate(items.map((it, i) => ({ userId, productId: it.productId, positionIndex: i, reasonType: it.reasonType })))
      .catch(() => undefined);
    await this.stream
      .xaddPipeline(recEventStreamKey(), [{ event: 'slate_generated', userId, tenantId, count: items.length, at: Date.now() }])
      .catch(() => undefined);
    return items;
  }

  private async buildHybridSlate(userId: string, tenantId: string, limit: number): Promise<RecommendationItem[]> {
    const [vectors, cf] = await Promise.all([
      this.vectorSearch.findSimilarProducts(userId, tenantId, limit * 2),
      this.collaborative.findAlsoBought(userId, limit),
    ]);
    const purchased = new Set(await this.repo.findPurchasedProductIds(userId).catch(() => []));
    const cfScore = new Map(cf.map((c) => [c.productId, c.confidence]));
    const ordered = vectors.filter((v) => !purchased.has(v.productId)).slice(0, limit * 2);
    const cfOnly = cf.filter((c) => !purchased.has(c.productId) && !ordered.some((o) => o.productId === c.productId));
    const mergedIds = [...ordered.map((o) => o.productId), ...cfOnly.slice(0, limit).map((c) => c.productId)].slice(0, limit);
    if (mergedIds.length === 0) {
      const fallback = await this.coldStart.getCuratedBestsellers(tenantId, limit);
      return fallback.map((c, i) =>
        toItem(c, 0.85 - i * 0.02, 'TRENDING_IN_CATEGORY', 'กำลังเป็นที่นิยมตอนนี้', 'BEHAVIORAL_HEURISTIC'),
      );
    }
    const cards = await this.repo.findProductCards(mergedIds, tenantId).catch(() => []);
    const byId = new Map(cards.map((c) => [c.productId, c]));
    return mergedIds
      .map((id) => byId.get(id))
      .filter((c): c is ProductCard => !!c)
      .map((card) => {
        const v = ordered.find((o) => o.productId === card.productId);
        const cfC = cfScore.get(card.productId);
        if (cfC != null && (v == null || cfC > v.similarity)) {
          return toItem(card, 0.7 + cfC * 0.25, 'COLLABORATIVE_USER_ALSO_BOUGHT', 'ลูกค้าที่ซื้อคล้ายกันก็ซื้อสิ่งนี้', 'COLLABORATIVE_FILTERING_CF');
        }
        const sim = v?.similarity ?? 0.8;
        return toItem(
          card,
          sim,
          'VECTOR_SIMILARITY_MATCH',
          `แนะนำสำหรับคุณจากความสนใจใกล้เคียง ${Math.round(sim * 100)}%`,
          'HYBRID_RERANKED',
        );
      });
  }
}
