// SSOT Phase 096 — Squad module wiring
// Canonical: apps/backend/src/modules/squad/squad.module.ts
// - Repository + create/join/leave -> REST + GQL. Zero new deps.
import { Module } from '@nestjs/common';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { PrismaSquadRepository } from './infrastructure/persistence/prisma-squad.repository';
import { CreateSquadUsecase } from './application/create-squad.usecase';
import { JoinSquadUsecase, LeaveSquadUsecase } from './application/join-squad.usecase';
import { SquadController } from './squad.controller';
import { SquadResolver } from './squad.resolver';

@Module({
  controllers: [SquadController],
  providers: [
    PrismaSquadRepository,
    JoinSquadUsecase,
    LeaveSquadUsecase,
    {
      provide: CreateSquadUsecase,
      useFactory: (repo: PrismaSquadRepository, redis: RedisClusterService) =>
        new CreateSquadUsecase(repo, {
          xadd: (stream: string, fields: Record<string, string | number>) =>
            redis.xaddPipeline(stream, [fields]),
        }),
      inject: [PrismaSquadRepository, RedisClusterService],
    },
    {
      provide: SquadResolver,
      useFactory: (
        create: CreateSquadUsecase,
        join: JoinSquadUsecase,
        leave: LeaveSquadUsecase,
        repo: PrismaSquadRepository,
      ) => new SquadResolver(create, join, leave, repo),
      inject: [CreateSquadUsecase, JoinSquadUsecase, LeaveSquadUsecase, PrismaSquadRepository],
    },
  ],
  exports: [CreateSquadUsecase, JoinSquadUsecase, LeaveSquadUsecase, PrismaSquadRepository],
})
export class SquadModule {}
