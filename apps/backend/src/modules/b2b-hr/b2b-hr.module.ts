// SSOT Phase 098 §5.1 — B2B HR module wiring
// Canonical: apps/backend/src/modules/b2b-hr/b2b-hr.module.ts
// - Repository + seat/quiz/analytics services -> REST + code-first GQL.
//   Streams ride Redis (Gate 8); dashboard reads ride the edge cache.
//   Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { B2bAnalyticsCacheService } from '../../infra/redis/b2b-analytics-cache.service';
import { HrReportGeneratorService } from '../../infra/pdf/hr-report-generator.service';
import { B2bHrResolver } from '../../api/graphql/b2b-hr.resolver';
import { PrismaB2bHrRepository } from './repositories/b2b-hr.repository';
import { B2bHrSeatService } from './services/b2b-seat.service';
import { B2bHrQuizTrackerService } from './services/b2b-quiz-tracker.service';
import { B2bHrAnalyticsService } from './services/b2b-analytics.service';
import { B2bExportController } from './controllers/b2b-export.controller';

function busOf(redis: RedisClusterService) {
  return {
    xadd: (stream: string, fields: Record<string, string | number>) =>
      redis.xaddPipeline(stream, [fields]),
  };
}

@Module({
  controllers: [B2bExportController],
  providers: [
    PrismaB2bHrRepository,
    B2bAnalyticsCacheService,
    HrReportGeneratorService,
    {
      provide: B2bHrSeatService,
      useFactory: (repo: PrismaB2bHrRepository, redis: RedisClusterService) =>
        new B2bHrSeatService(repo, busOf(redis)),
      inject: [PrismaB2bHrRepository, RedisClusterService],
    },
    {
      provide: B2bHrQuizTrackerService,
      useFactory: (repo: PrismaB2bHrRepository, redis: RedisClusterService) =>
        new B2bHrQuizTrackerService(repo, busOf(redis)),
      inject: [PrismaB2bHrRepository, RedisClusterService],
    },
    {
      provide: B2bHrAnalyticsService,
      useFactory: (repo: PrismaB2bHrRepository, cache: B2bAnalyticsCacheService) =>
        new B2bHrAnalyticsService(repo, cache),
      inject: [PrismaB2bHrRepository, B2bAnalyticsCacheService],
    },
    {
      provide: B2bHrResolver,
      useFactory: (
        seats: B2bHrSeatService,
        quizzes: B2bHrQuizTrackerService,
        analytics: B2bHrAnalyticsService,
      ) => new B2bHrResolver(seats, quizzes, analytics),
      inject: [B2bHrSeatService, B2bHrQuizTrackerService, B2bHrAnalyticsService],
    },
  ],
  exports: [B2bHrSeatService, B2bHrQuizTrackerService, B2bHrAnalyticsService, PrismaB2bHrRepository],
})
export class B2bHrModule {}
