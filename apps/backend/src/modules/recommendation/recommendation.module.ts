// SSOT Phase 104 — Recommendation module wiring
// Canonical: apps/backend/src/modules/recommendation/recommendation.module.ts
// - Repository + vector/CF/cold-start/reranker + REST + GQL.
// - RISK_CALL: no new ML deps — deterministic 768-dim embeddings (091 lane).
// - Services take the repository port (interface): wired here via explicit
//   factories on the concrete Prisma adapter (Nest cannot infer interfaces).
import { Module } from '@nestjs/common';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { PrismaRecommendationRepository } from './repositories/recommendation.repository';
import { VectorSearchService } from './services/vector-search.service';
import { CollaborativeFilteringService } from './services/collaborative-filtering.service';
import { ColdStartService } from './services/cold-start.service';
import { HybridRerankerService } from './services/hybrid-reranker.service';
import { RecommendationEventController } from './controllers/recommendation-event.controller';
import { RecommendationResolver } from './resolvers/recommendation.resolver';

@Module({
  controllers: [RecommendationEventController],
  providers: [
    PrismaRecommendationRepository,
    {
      provide: VectorSearchService,
      useFactory: (repo: PrismaRecommendationRepository) => new VectorSearchService(repo),
      inject: [PrismaRecommendationRepository],
    },
    {
      provide: CollaborativeFilteringService,
      useFactory: (repo: PrismaRecommendationRepository) => new CollaborativeFilteringService(repo),
      inject: [PrismaRecommendationRepository],
    },
    {
      provide: ColdStartService,
      useFactory: (repo: PrismaRecommendationRepository) => new ColdStartService(repo),
      inject: [PrismaRecommendationRepository],
    },
    {
      provide: HybridRerankerService,
      useFactory: (
        repo: PrismaRecommendationRepository,
        redis: RedisClusterService,
        vectors: VectorSearchService,
        cf: CollaborativeFilteringService,
        cold: ColdStartService,
      ) =>
        new HybridRerankerService(
          repo,
          {
            get: (k: string) => redis.get(k),
            set: (k: string, v: string, ...a: Array<string | number>) => redis.set(k, v, ...a),
          },
          { xaddPipeline: (s: string, b: Array<Record<string, string | number>>) => redis.xaddPipeline(s, b) },
          vectors,
          cf,
          cold,
        ),
      inject: [PrismaRecommendationRepository, RedisClusterService, VectorSearchService, CollaborativeFilteringService, ColdStartService],
    },
    RecommendationResolver,
  ],
  exports: [HybridRerankerService, PrismaRecommendationRepository],
})
export class RecommendationModule {}
