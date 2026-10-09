// SSOT Phase 091 §5.1 — VectorSearch module wiring
// Canonical: apps/backend/src/modules/vector-search/vector-search.module.ts
// - Embedding + pgvector repo + semantic search + RAG builder + summarizer
//   -> GQL + REST. Entitlement reads reuse 012 grant service. Titles ride
//   Prisma (no catalog dep). Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { EntitlementGrantService } from '../entitlement/services/entitlement-grant.service';
import { EmbeddingGeneratorService } from './services/embedding-generator.service';
import { PgVectorRepositoryService } from './services/pgvector-repository.service';
import { SemanticSearchService } from './services/semantic-search.service';
import { RagContextBuilderService } from '../ai-rag/services/rag-context-builder.service';
import { AiSummarizerService } from '../ai-rag/services/ai-summarizer.service';
import { VectorSearchResolver } from './api/graphql/vector-search.resolver';
import { VectorSearchController } from './api/rest/vector-search.controller';

@Module({
  controllers: [VectorSearchController],
  providers: [
    PrismaService,
    EmbeddingGeneratorService,
    PgVectorRepositoryService,
    RagContextBuilderService,
    AiSummarizerService,
    EntitlementGrantService,
    {
      provide: SemanticSearchService,
      useFactory: (
        embeddings: EmbeddingGeneratorService,
        vectors: PgVectorRepositoryService,
        prisma: PrismaService,
        redis: RedisClusterService,
      ) =>
        new SemanticSearchService(
          embeddings,
          vectors,
          {
            findTitles: async (ids: string[]) => {
              const out: Record<string, string> = {};
              for (const id of ids) {
                const p = (await (prisma.product as unknown as {
                  findUnique: (args: unknown) => Promise<{ title: string } | null>;
                })
                  .findUnique({ where: { id } })
                  .catch(() => null)) as { title: string } | null;
                if (p) out[id] = p.title;
              }
              return out;
            },
          },
          {
            xadd: (stream: string, fields: Record<string, string | number>) =>
              redis.xaddPipeline(stream, [fields]),
          },
        ),
      inject: [EmbeddingGeneratorService, PgVectorRepositoryService, PrismaService, RedisClusterService],
    },
    {
      provide: VectorSearchResolver,
      useFactory: (
        search: SemanticSearchService,
        embeddings: EmbeddingGeneratorService,
        vectors: PgVectorRepositoryService,
        rag: RagContextBuilderService,
        summarizer: AiSummarizerService,
        grants: EntitlementGrantService,
        prisma: PrismaService,
      ) => new VectorSearchResolver(search, embeddings, vectors, rag, summarizer, grants, prisma),
      inject: [
        SemanticSearchService,
        EmbeddingGeneratorService,
        PgVectorRepositoryService,
        RagContextBuilderService,
        AiSummarizerService,
        EntitlementGrantService,
        PrismaService,
      ],
    },
  ],
  exports: [EmbeddingGeneratorService, PgVectorRepositoryService, SemanticSearchService, RagContextBuilderService, AiSummarizerService],
})
export class VectorSearchModule {}
