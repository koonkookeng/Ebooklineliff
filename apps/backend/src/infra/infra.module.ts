// SSOT Phase 002/004 — global infra providers (Prisma + Redis Cluster singletons)
import { Global, Module, OnModuleInit } from '@nestjs/common';
import { PrismaService } from './database/prisma.service';
import { RedisClusterService } from './redis/redis-cluster.service';
// Phase 128 §5.2: install the slow-query guard once at bootstrap
// (PrismaService itself stays untouched — installer is idempotent).
import { installQueryPerformanceGuard } from './prisma/prisma-query-logger.middleware';

@Global()
@Module({
  providers: [PrismaService, RedisClusterService],
  exports: [PrismaService, RedisClusterService],
})
export class InfraModule implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    installQueryPerformanceGuard(this.prisma as never);
  }
}
