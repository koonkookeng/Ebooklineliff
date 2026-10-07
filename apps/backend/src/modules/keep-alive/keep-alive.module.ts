// SSOT Phase 031 §5.1 — Keep-alive module (viewport preservation engine)
// Canonical: apps/backend/src/modules/keep-alive/keep-alive.module.ts
// (legacy src/backend/modules/keep-alive/keep-alive.module.ts)
// NOTE: PrismaService + RedisClusterService come from global InfraModule (single pool).
import { Module } from '@nestjs/common';
import { KeepAliveRedisRepository } from '../../infra/redis/keep-alive-redis.repository';
import { KeepAliveService } from './keep-alive.service';
import { KeepAliveController } from './keep-alive.controller';
import { KeepAliveResolver } from './keep-alive.resolver';

@Module({
  controllers: [KeepAliveController],
  providers: [KeepAliveRedisRepository, KeepAliveService, KeepAliveResolver],
  exports: [KeepAliveService],
})
export class KeepAliveModule {}
