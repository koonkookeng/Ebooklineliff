// SSOT Phase 078 §5.1 — Course studio module wiring
// Canonical: apps/backend/src/modules/course-studio/course-studio.module.ts
// - Curriculum reorder (atomic + cache invalidate), HLS presign + webhook,
//   quiz builder CRUD, REST + GQL presentation.
// - R2 presign + Redis del/xadd from @Global infra. Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { R2StorageService } from '../../infra/cloudflare/r2-storage.service';
import { PrismaCourseStudioRepository } from './infrastructure/repositories/prisma-course-studio.repository';
import { CurriculumBuilderService } from './application/services/curriculum-builder.service';
import { HlsTranscoderService } from './application/services/hls-transcoder.service';
import { QuizEngineService } from './application/services/quiz-engine.service';
import { ReorderCurriculumUseCase } from './application/use-cases/reorder-curriculum.use-case';
import { ProcessHlsWebhookUseCase } from './application/use-cases/process-hls-webhook.use-case';
import { HlsWebhookController } from './infrastructure/controllers/hls-webhook.controller';
import { StudioController } from './presentation/studio.controller';
import { CourseStudioResolver } from './presentation/course-studio.resolver';

function busOf(redis: RedisClusterService) {
  return {
    xadd: (stream: string, fields: Record<string, string | number>) =>
      redis.xaddPipeline(stream, [fields]).catch(() => undefined),
  };
}

@Module({
  controllers: [HlsWebhookController, StudioController],
  providers: [
    PrismaCourseStudioRepository,
    {
      provide: CurriculumBuilderService,
      useFactory: (repo: PrismaCourseStudioRepository, prisma: PrismaService, redis: RedisClusterService) =>
        new CurriculumBuilderService(
          repo,
          { run: <T>(fn: (tx: unknown) => Promise<T>) => prisma.$transaction((tx) => fn(tx)) },
          { del: (key: string) => redis.del(key).catch(() => undefined) },
          busOf(redis),
        ),
      inject: [PrismaCourseStudioRepository, PrismaService, RedisClusterService],
    },
    {
      provide: HlsTranscoderService,
      useFactory: (repo: PrismaCourseStudioRepository, prisma: PrismaService, r2: R2StorageService, redis: RedisClusterService) =>
        new HlsTranscoderService(
          repo,
          { run: <T>(fn: (tx: unknown) => Promise<T>) => prisma.$transaction((tx) => fn(tx)) },
          r2,
          busOf(redis),
          process.env['HLS_WEBHOOK_SECRET'] ?? 'dev-hls-secret',
        ),
      inject: [PrismaCourseStudioRepository, PrismaService, R2StorageService, RedisClusterService],
    },
    {
      provide: QuizEngineService,
      useFactory: (repo: PrismaCourseStudioRepository) => new QuizEngineService(repo),
      inject: [PrismaCourseStudioRepository],
    },
    {
      provide: ReorderCurriculumUseCase,
      useFactory: (curriculum: CurriculumBuilderService) => new ReorderCurriculumUseCase(curriculum),
      inject: [CurriculumBuilderService],
    },
    {
      provide: ProcessHlsWebhookUseCase,
      useFactory: (transcoder: HlsTranscoderService) => new ProcessHlsWebhookUseCase(transcoder),
      inject: [HlsTranscoderService],
    },
    {
      provide: CourseStudioResolver,
      useFactory: (
        reorder: ReorderCurriculumUseCase,
        transcoder: HlsTranscoderService,
        quizzes: QuizEngineService,
        repo: PrismaCourseStudioRepository,
      ) => new CourseStudioResolver(reorder, transcoder, quizzes, repo),
      inject: [ReorderCurriculumUseCase, HlsTranscoderService, QuizEngineService, PrismaCourseStudioRepository],
    },
  ],
  exports: [CurriculumBuilderService, HlsTranscoderService, QuizEngineService, PrismaCourseStudioRepository],
})
export class CourseStudioModule {}
