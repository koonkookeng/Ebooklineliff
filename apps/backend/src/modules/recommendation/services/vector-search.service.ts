// SSOT Phase 104 Task 3 — Vector search service (pgvector cosine, tenant-isolated)
// Canonical: apps/backend/src/modules/recommendation/services/vector-search.service.ts
// - Builds a 768-dim user-intent vector (recent interactions → profile →
//   category fallback) and queries ProductEmbedding via pgvector (<80ms BDD).
// - Port-based for DB-free tests. Zero new deps.
import { Injectable } from '@nestjs/common';
import { REC_EMBEDDING_DIMS } from '@repo/shared';
import { deterministicEmbedding } from '../../vector-search/services/embedding-generator.service';
import type {
  RecommendationRepository,
  VectorCandidate,
} from '../repositories/recommendation.repository';

function average(vectors: number[][], dims: number): number[] {
  const out = new Array<number>(dims).fill(0);
  if (vectors.length === 0) return out;
  for (const v of vectors) {
    for (let i = 0; i < dims && i < v.length; i++) out[i] += v[i];
  }
  const norm = Math.sqrt(out.reduce((n, x) => n + x * x, 0)) || 1;
  return out.map((x) => x / norm / vectors.length);
}

@Injectable()
export class VectorSearchService {
  constructor(private readonly repo: RecommendationRepository) {}

  /** Builds the user-intent vector; never throws (fallback → zero vector). */
  async buildUserIntentVector(userId: string): Promise<number[]> {
    const recent = await this.repo.findRecentProductIds(userId, 10).catch(() => []);
    if (recent.length > 0) {
      const rows = await this.repo.findProductEmbeddings(recent).catch(() => []);
      const vecs = rows.map((r) => r.embedding).filter((v) => v.length === REC_EMBEDDING_DIMS);
      if (vecs.length > 0) return average(vecs, REC_EMBEDDING_DIMS);
    }
    const profile = await this.repo.getProfile(userId).catch(() => null);
    if (profile) {
      const keys = Object.keys(profile.preferredCategories).sort().join(' ');
      if (keys) return deterministicEmbedding(keys, REC_EMBEDDING_DIMS);
    }
    return new Array<number>(REC_EMBEDDING_DIMS).fill(0);
  }

  async findSimilarProductsByUserEmbedding(userId: string, limit: number): Promise<VectorCandidate[]> {
    const intent = await this.buildUserIntentVector(userId);
    const vectorString = `[${intent.join(',')}]`;
    return this.repo.vectorCandidates(vectorString, 'default', limit).catch(() => []);
  }

  async findSimilarProducts(userId: string, tenantId: string, limit: number): Promise<VectorCandidate[]> {
    const intent = await this.buildUserIntentVector(userId);
    const vectorString = `[${intent.join(',')}]`;
    return this.repo.vectorCandidates(vectorString, tenantId, limit).catch(() => []);
  }
}
