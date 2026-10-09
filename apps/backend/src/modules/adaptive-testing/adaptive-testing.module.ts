// SSOT Phase 093 Task 2 — Adaptive testing module wiring
// Canonical: apps/backend/src/modules/adaptive-testing/adaptive-testing.module.ts
// - Repository + IRT engine + attempt service -> GQL + REST. Response +
//   profile persist under Prisma $transaction (Gate 7). Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { PrismaAdaptiveRepository } from './infrastructure/persistence/prisma-adaptive.repository';
import { IrtEngineService } from './application/services/irt-engine.service';
import { AdaptiveAttemptService } from './application/services/adaptive-attempt.service';
import { AdaptiveTestingResolver } from './api/graphql/adaptive-testing.resolver';
import { AdaptiveTestingController } from './api/rest/adaptive-testing.controller';

@Module({
  controllers: [AdaptiveTestingController],
  providers: [
    PrismaAdaptiveRepository,
    IrtEngineService,
    {
      provide: AdaptiveAttemptService,
      useFactory: (repo: PrismaAdaptiveRepository, prisma: PrismaService, redis: RedisClusterService) =>
        new AdaptiveAttemptService(repo, {
          run: <T>(fn: (tx: unknown) => Promise<T>) => prisma.$transaction((tx) => fn(tx)),
        }, {
          xadd: (stream: string, fields: Record<string, string | number>) =>
            redis.xaddPipeline(stream, [fields]),
        }),
      inject: [PrismaAdaptiveRepository, PrismaService, RedisClusterService],
    },
    {
      provide: AdaptiveTestingResolver,
      useFactory: (attempts: AdaptiveAttemptService) => new AdaptiveTestingResolver(attempts),
      inject: [AdaptiveAttemptService],
    },
  ],
  exports: [AdaptiveAttemptService, PrismaAdaptiveRepository, IrtEngineService],
})
export class AdaptiveTestingModule {}
