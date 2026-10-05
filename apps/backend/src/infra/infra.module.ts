// SSOT Phase 002/004 — global infra providers (Prisma + Redis Cluster singletons)
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './database/prisma.service';
import { RedisClusterService } from './redis/redis-cluster.service';

@Global()
@Module({
  providers: [PrismaService, RedisClusterService],
  exports: [PrismaService, RedisClusterService],
})
export class InfraModule {}
