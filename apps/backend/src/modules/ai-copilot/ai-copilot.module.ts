// SSOT Phase 094 §5.1 — AiCopilot module wiring
// Canonical: apps/backend/src/modules/ai-copilot/ai-copilot.module.ts
// - Adapters (STT/outline) + in-memory queue + processor + outline/STT/
//   formatter/quiz services -> REST + GQL. Prisma rows ride $transaction
//   (Gate 7); R2 vault via R2StorageService (Gate 6). Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { R2StorageService } from '../../infra/cloudflare/r2-storage.service';
import { EntitlementGrantService } from '../entitlement/services/entitlement-grant.service';
import { DeterministicSttAdapter } from './adapters/openai-whisper.adapter';
import { DeterministicOutlineAdapter } from './adapters/llm-orchestrator.adapter';
import { InMemoryTranscribeQueue } from './queues/transcribe.queue';
import { TranscribeProcessor } from './queues/transcribe.processor';
import { OutlineGeneratorService } from './services/outline-generator.service';
import { WhisperTranscriberService } from './services/whisper-transcriber.service';
import { SubtitleFormatterService } from './services/subtitle-formatter.service';
import { AutoQuizBuilderService } from './services/auto-quiz-builder.service';
import { AiCopilotController } from './controllers/ai-copilot.controller';
import { SubtitleDownloadController } from './controllers/subtitle-download.controller';
import { AiCopilotResolver } from './resolvers/ai-copilot.resolver';

type Db = Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>>;

function jobStoreOf(db: Db) {
  const jobs = db['aiCoPilotJob'];
  return {
    createJob: async (args: { userId: string; jobType: string; inputPayload: unknown }) =>
      (await jobs.create({ data: { ...args, status: 'QUEUED', progressPercent: 0 } })) as unknown as { id: string },
    completeJob: async (jobId: string, resultData: unknown) => {
      await jobs.update({ where: { id: jobId }, data: { status: 'COMPLETED', progressPercent: 100, resultData } });
    },
    failJob: async (jobId: string, errorMessage: string) => {
      await jobs.update({ where: { id: jobId }, data: { status: 'FAILED', errorMessage } });
    },
    markProcessing: async (jobId: string) => {
      await jobs.update({ where: { id: jobId }, data: { status: 'PROCESSING', progressPercent: 5 } });
    },
    markProgress: async (jobId: string, progressPercent: number) => {
      await jobs.update({ where: { id: jobId }, data: { progressPercent } });
    },
    markCompleted: async (jobId: string) => {
      await jobs.update({ where: { id: jobId }, data: { status: 'COMPLETED', progressPercent: 100 } });
    },
    markFailed: async (jobId: string, errorMessage: string) => {
      await jobs.update({ where: { id: jobId }, data: { status: 'FAILED', errorMessage } });
    },
    findJob: async (jobId: string, userId: string) =>
      (await jobs
        .findFirst({ where: { id: jobId, userId } })
        .catch(() => null)) as unknown as { id: string; status: string; progressPercent: number; errorMessage: string | null } | null,
  };
}

@Module({
  controllers: [AiCopilotController, SubtitleDownloadController],
  providers: [
    PrismaService,
    EntitlementGrantService,
    DeterministicSttAdapter,
    DeterministicOutlineAdapter,
    InMemoryTranscribeQueue,
    {
      provide: OutlineGeneratorService,
      useFactory: (llm: DeterministicOutlineAdapter, prisma: PrismaService, redis: RedisClusterService) =>
        new OutlineGeneratorService(llm, jobStoreOf(prisma as unknown as Db), {
          xadd: (stream: string, fields: Record<string, string | number>) =>
            redis.xaddPipeline(stream, [fields]),
        }),
      inject: [DeterministicOutlineAdapter, PrismaService, RedisClusterService],
    },
    {
      provide: WhisperTranscriberService,
      useFactory: (queue: InMemoryTranscribeQueue, prisma: PrismaService, redis: RedisClusterService) =>
        new WhisperTranscriberService(queue, jobStoreOf(prisma as unknown as Db), {
          xadd: (stream: string, fields: Record<string, string | number>) =>
            redis.xaddPipeline(stream, [fields]),
        }),
      inject: [InMemoryTranscribeQueue, PrismaService, RedisClusterService],
    },
    {
      provide: SubtitleFormatterService,
      useFactory: (prisma: PrismaService, r2: R2StorageService) =>
        new SubtitleFormatterService(
          {
            saveSubtitle: async (tx: unknown, args) => {
              const db = (tx as Db)['videoSubtitle'];
              return (await db.upsert({
                where: { lessonId: (args as { lessonId: string }).lessonId },
                update: { ...(args as object) },
                create: { ...(args as object) },
              })) as unknown as { id: string };
            },
            saveSegments: async (tx: unknown, rows) => {
              const db = (tx as Db)['subtitleSegment'];
              const subId = (rows as Array<{ videoSubtitleId: string }>)[0]?.videoSubtitleId;
              if (subId) await db.deleteMany({ where: { videoSubtitleId: subId } }).catch(() => undefined);
              for (const row of rows as Array<Record<string, unknown>>) {
                await db.create({ data: { ...row } });
              }
            },
          },
          { run: <T>(fn: (tx: unknown) => Promise<T>) => prisma.$transaction((tx) => fn(tx)) },
          { putObject: (key: string, body: string | Buffer, type: string) => r2.putObject(key, body, type) },
        ),
      inject: [PrismaService, R2StorageService],
    },
    {
      provide: AutoQuizBuilderService,
      useFactory: (prisma: PrismaService, redis: RedisClusterService) =>
        new AutoQuizBuilderService(
          {
            saveQuizzes: async (tx: unknown, rows) => {
              const db = (tx as Db)['aiGeneratedQuiz'];
              let n = 0;
              for (const row of rows) {
                await db.create({ data: { ...row } });
                n++;
              }
              return n;
            },
          },
          { run: <T>(fn: (tx: unknown) => Promise<T>) => prisma.$transaction((tx) => fn(tx)) },
          {
            xadd: (stream: string, fields: Record<string, string | number>) =>
              redis.xaddPipeline(stream, [fields]),
          },
        ),
      inject: [PrismaService, RedisClusterService],
    },
    {
      provide: TranscribeProcessor,
      useFactory: (
        queue: InMemoryTranscribeQueue,
        stt: DeterministicSttAdapter,
        formatter: SubtitleFormatterService,
        prisma: PrismaService,
        redis: RedisClusterService,
      ) => {
        const store = jobStoreOf(prisma as unknown as Db);
        return new TranscribeProcessor(queue, stt, formatter, store, {
          xadd: (stream: string, fields: Record<string, string | number>) =>
            redis.xaddPipeline(stream, [fields]),
        });
      },
      inject: [InMemoryTranscribeQueue, DeterministicSttAdapter, SubtitleFormatterService, PrismaService, RedisClusterService],
    },
    {
      provide: AiCopilotController,
      useFactory: (
        outline: OutlineGeneratorService,
        transcriber: WhisperTranscriberService,
        quiz: AutoQuizBuilderService,
        prisma: PrismaService,
      ) => new AiCopilotController(outline, transcriber, quiz, jobStoreOf(prisma as unknown as Db)),
      inject: [OutlineGeneratorService, WhisperTranscriberService, AutoQuizBuilderService, PrismaService],
    },
    {
      provide: AiCopilotResolver,
      useFactory: (
        outline: OutlineGeneratorService,
        transcriber: WhisperTranscriberService,
        quiz: AutoQuizBuilderService,
        prisma: PrismaService,
      ) => new AiCopilotResolver(outline, transcriber, quiz, jobStoreOf(prisma as unknown as Db)),
      inject: [OutlineGeneratorService, WhisperTranscriberService, AutoQuizBuilderService, PrismaService],
    },
  ],
  exports: [OutlineGeneratorService, WhisperTranscriberService, SubtitleFormatterService, AutoQuizBuilderService, TranscribeProcessor],
})
export class AiCopilotModule {}
