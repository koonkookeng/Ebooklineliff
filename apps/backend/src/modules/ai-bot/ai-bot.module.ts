// SSOT Phase 103 — AI Bot module (RAG + sentiment, zero-dep deterministic)
// Canonical: apps/backend/src/modules/ai-bot/ai-bot.module.ts
import { Module } from '@nestjs/common';
import { RAGSearchService } from './application/rag-search.service';
import { SentimentAnalyzerService } from './application/sentiment-analyzer.service';
import { EmbeddingGeneratorService } from '../vector-search/services/embedding-generator.service';
import { PrismaService } from '../../infra/database/prisma.service';

@Module({
  providers: [
    SentimentAnalyzerService,
    {
      provide: RAGSearchService,
      useFactory: (embeddings: EmbeddingGeneratorService, prisma: PrismaService) =>
        new RAGSearchService(embeddings, {
          queryRawUnsafe: <T>(sql: string, ...args: Array<string | number | null>) =>
            (prisma as unknown as {
              $queryRawUnsafe: (sql: string, ...a: Array<string | number | null>) => Promise<T>;
            }).$queryRawUnsafe(sql, ...args),
        }),
      inject: [EmbeddingGeneratorService, PrismaService],
    },
  ],
  exports: [RAGSearchService, SentimentAnalyzerService],
})
export class AiBotModule {}
