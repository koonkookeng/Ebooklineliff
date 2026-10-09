// SSOT Phase 104 Task 4 — Cold-start service (rule-based curated bestsellers)
// Canonical: apps/backend/src/modules/recommendation/services/cold-start.service.ts
// - New users (< 3 interactions): trending bestsellers <50ms + onboarding
//   category-interest boost. Zero new deps.
import { Injectable } from '@nestjs/common';
import type {
  ProductCard,
  RecommendationRepository,
} from '../repositories/recommendation.repository';

/** Boosts cards matching onboarding interests (pure, testable). */
export function boostByInterests(cards: ProductCard[], interests: string[]): ProductCard[] {
  if (interests.length === 0) return cards;
  const wants = new Set(interests.map((s) => s.toLowerCase()));
  return [...cards].sort((a, b) => {
    const ah = wants.has(a.productType.toLowerCase()) ? 0 : 1;
    const bh = wants.has(b.productType.toLowerCase()) ? 0 : 1;
    if (ah !== bh) return ah - bh;
    return b.soldCount - a.soldCount;
  });
}

@Injectable()
export class ColdStartService {
  constructor(private readonly repo: RecommendationRepository) {}

  async getCuratedBestsellers(tenantId: string, limit: number, interests: string[] = []): Promise<ProductCard[]> {
    const cards = await this.repo.findBestsellers(tenantId, Math.max(limit, 10)).catch(() => []);
    return boostByInterests(cards, interests).slice(0, limit);
  }
}
