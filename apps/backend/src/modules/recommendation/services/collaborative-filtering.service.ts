// SSOT Phase 104 Task 4 — Collaborative filtering service (user-also-bought)
// Canonical: apps/backend/src/modules/recommendation/services/collaborative-filtering.service.ts
// - Co-purchase counting via Entitlement self-join (delegated to repo raw SQL)
//   + pure score normalizer for tests. Zero new deps.
import { Injectable } from '@nestjs/common';
import type {
  CoPurchaseCandidate,
  RecommendationRepository,
} from '../repositories/recommendation.repository';

/** Normalizes raw co-purchase counts to 0..1 confidence (pure, testable). */
export function normalizeCoPurchaseScores(rows: CoPurchaseCandidate[]): Array<CoPurchaseCandidate & { confidence: number }> {
  const max = rows.reduce((m, r) => Math.max(m, r.score), 0) || 1;
  return rows.map((r) => ({ ...r, confidence: Math.min(1, r.score / max) }));
}

@Injectable()
export class CollaborativeFilteringService {
  constructor(private readonly repo: RecommendationRepository) {}

  async findAlsoBought(userId: string, limit: number): Promise<Array<CoPurchaseCandidate & { confidence: number }>> {
    const purchased = await this.repo.findPurchasedProductIds(userId).catch(() => []);
    if (purchased.length === 0) return [];
    const rows = await this.repo.coPurchaseCandidates(purchased, userId, limit).catch(() => []);
    return normalizeCoPurchaseScores(rows);
  }
}
