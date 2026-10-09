// SSOT Phase 092 §5.1 — AiCompanion module wiring
// Canonical: apps/backend/src/modules/ai-companion/ai-companion.module.ts
// - Retrieval rides Phase 091 vector services (Single Source §9);
//   orchestration rides the 091 summarizer with Redis semantic cache.
//   Chat history + insight persist under Prisma $transaction (Gate 7).
//   Quiz answers park in Redis 1h (server-side grading).
// - Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { EntitlementGrantService } from '../entitlement/services/entitlement-grant.service';
import { EmbeddingGeneratorService } from '../vector-search/services/embedding-generator.service';
import { PgVectorRepositoryService } from '../vector-search/services/pgvector-repository.service';
import { AiSummarizerService } from '../ai-rag/services/ai-summarizer.service';
import { RagRetrievalService } from './services/rag-retrieval.service';
import { LlmOrchestratorService } from './services/llm-orchestrator.service';
import { CompanionSummarizerService } from './services/summarizer.service';
import { AdaptiveQuizService } from './services/adaptive-quiz.service';
import type { QuizLevel } from '@repo/shared';
import { AiChatController } from './controllers/ai-chat.controller';
import { AiQuizController } from './controllers/ai-quiz.controller';
import { AiCompanionResolver } from './resolvers/ai-companion.resolver';

type Db = {
  aiChatSession: {
    findFirst: (args: unknown) => Promise<{ id: string } | null>;
    create: (args: unknown) => Promise<{ id: string }>;
  };
  aiChatMessage: {
    create: (args: unknown) => Promise<{ id: string }>;
  };
  userLearningInsight: {
    findUnique: (args: unknown) => Promise<{ adaptedQuizLevel: string } | null>;
    upsert: (args: unknown) => Promise<unknown>;
  };
};

const asLevel = (v: unknown): QuizLevel =>
  v === 'EASY' || v === 'HARD' ? v : 'MEDIUM';

@Module({
  controllers: [AiChatController, AiQuizController],
  providers: [
    PrismaService,
    EmbeddingGeneratorService,
    PgVectorRepositoryService,
    AiSummarizerService,
    EntitlementGrantService,
    RagRetrievalService,
    {
      provide: LlmOrchestratorService,
      useFactory: (
        embeddings: EmbeddingGeneratorService,
        summarizer: AiSummarizerService,
        redis: RedisClusterService,
      ) =>
        new LlmOrchestratorService(embeddings, summarizer, {
          get: (key: string) => redis.get(key),
          set: (key: string, value: string | Buffer, ...args: Array<string | number>) =>
            redis.set(key, value, ...args),
        }),
      inject: [EmbeddingGeneratorService, AiSummarizerService, RedisClusterService],
    },
    {
      provide: CompanionSummarizerService,
      useFactory: (
        retrieval: RagRetrievalService,
        orchestrator: LlmOrchestratorService,
        prisma: PrismaService,
        redis: RedisClusterService,
      ) =>
        new CompanionSummarizerService(
          retrieval,
          orchestrator,
          {
            ensureSession: async (tx: unknown, userId: string, productId: string) => {
              const db = (tx as Db).aiChatSession;
              const existing = await db.findFirst({
                where: { userId, productId },
                orderBy: { updatedAt: 'desc' },
              });
              if (existing) return existing;
              return db.create({ data: { userId, productId } });
            },
            createMessage: async (tx: unknown, args) => {
              const db = (tx as Db).aiChatMessage;
              return db.create({ data: { ...args } });
            },
          },
          { run: <T>(fn: (tx: unknown) => Promise<T>) => prisma.$transaction((tx) => fn(tx)) },
          {
            xadd: (stream: string, fields: Record<string, string | number>) =>
              redis.xaddPipeline(stream, [fields]),
          },
        ),
      inject: [RagRetrievalService, LlmOrchestratorService, PrismaService, RedisClusterService],
    },
    {
      provide: 'QuizAnswerStore',
      useFactory: (redis: RedisClusterService) => ({
        saveAnswers: async (quizId: string, correctIndexes: number[], ttlSec: number) => {
          await redis.set(`quiz:${quizId}`, JSON.stringify(correctIndexes), 'EX', ttlSec);
        },
        takeAnswers: async (quizId: string) => {
          const raw = await redis.getdel(`quiz:${quizId}`);
          if (!raw) return null;
          try {
            const parsed: unknown = JSON.parse(raw);
            return Array.isArray(parsed) ? (parsed as number[]) : null;
          } catch {
            return null;
          }
        },
      }),
      inject: [RedisClusterService],
    },
    {
      provide: AdaptiveQuizService,
      useFactory: (prisma: PrismaService, redis: RedisClusterService) =>
        new AdaptiveQuizService(
          {
            getLevel: async (userId: string) => {
              const row = await (prisma as unknown as Db).userLearningInsight
                .findUnique({ where: { userId } })
                .catch(() => null);
              return asLevel(row?.adaptedQuizLevel);
            },
            saveResult: async (userId: string, args) => {
              await (prisma as unknown as Db).userLearningInsight.upsert({
                where: { userId },
                update: {
                  comprehensionRate: args.comprehensionRate,
                  adaptedQuizLevel: args.adaptedQuizLevel,
                  weakTopicsJson: args.weakTopic ? [args.weakTopic] : [],
                },
                create: {
                  userId,
                  comprehensionRate: args.comprehensionRate,
                  weakTopicsJson: args.weakTopic ? [args.weakTopic] : [],
                  strengthTopicsJson: [],
                  adaptedQuizLevel: args.adaptedQuizLevel,
                },
              });
            },
          },
          {
            xadd: (stream: string, fields: Record<string, string | number>) =>
              redis.xaddPipeline(stream, [fields]),
          },
        ),
      inject: [PrismaService, RedisClusterService],
    },
    {
      provide: AiQuizController,
      useFactory: (quiz: AdaptiveQuizService, redis: RedisClusterService) =>
        new AiQuizController(quiz, {
          saveAnswers: async (quizId: string, correctIndexes: number[], ttlSec: number) => {
            await redis.set(`quiz:${quizId}`, JSON.stringify(correctIndexes), 'EX', ttlSec);
          },
          takeAnswers: async (quizId: string) => {
            const raw = await redis.getdel(`quiz:${quizId}`);
            if (!raw) return null;
            try {
              const parsed: unknown = JSON.parse(raw);
              return Array.isArray(parsed) ? (parsed as number[]) : null;
            } catch {
              return null;
            }
          },
        }),
      inject: [AdaptiveQuizService, RedisClusterService],
    },
    {
      provide: AiCompanionResolver,
      useFactory: (
        companion: CompanionSummarizerService,
        quiz: AdaptiveQuizService,
        redis: RedisClusterService,
        grants: EntitlementGrantService,
        prisma: PrismaService,
      ) =>
        new AiCompanionResolver(
          companion,
          quiz,
          {
            saveAnswers: async (quizId: string, correctIndexes: number[], ttlSec: number) => {
              await redis.set(`quiz:${quizId}`, JSON.stringify(correctIndexes), 'EX', ttlSec);
            },
            takeAnswers: async (quizId: string) => {
              const raw = await redis.getdel(`quiz:${quizId}`);
              if (!raw) return null;
              try {
                const parsed: unknown = JSON.parse(raw);
                return Array.isArray(parsed) ? (parsed as number[]) : null;
              } catch {
                return null;
              }
            },
          },
          grants,
          prisma,
        ),
      inject: [CompanionSummarizerService, AdaptiveQuizService, RedisClusterService, EntitlementGrantService, PrismaService],
    },
  ],
  exports: [RagRetrievalService, LlmOrchestratorService, CompanionSummarizerService, AdaptiveQuizService],
})
export class AiCompanionModule {}
