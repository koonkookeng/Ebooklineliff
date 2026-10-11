// SSOT Phase 125 Task 4 §5.1 — connection-pool composition module
// Canonical: apps/backend/src/modules/infra/connection-pool.module.ts
// (legacy src/backend/modules/infra/connection-pool.module.ts)
// - Provides the replica/edge-cache lanes + health webhook over the
//   global InfraModule singletons (no new pools). The read/write
//   interceptor stays opt-in per-controller (no APP_* side effects).
// - Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { DatabaseReplicaService } from '../../infra/connection-pool/database-replica.service';
import { EdgeRegionCacheService } from '../../infra/connection-pool/edge-redis-cluster.service';
import { InfraHealthService } from '../../infra/connection-pool/infra-health.service';
import { InfraHealthController } from '../../infra/connection-pool/infra-health.controller';
import { ReadWriteInterceptor } from '../../infra/connection-pool/read-write-interceptor';

@Module({
  controllers: [InfraHealthController],
  providers: [
    {
      provide: DatabaseReplicaService,
      useFactory: (prisma: PrismaService) => new DatabaseReplicaService(prisma),
      inject: [PrismaService],
    },
    {
      provide: EdgeRegionCacheService,
      useFactory: (redis: RedisClusterService) => new EdgeRegionCacheService(redis),
      inject: [RedisClusterService],
    },
    {
      provide: InfraHealthService,
      useFactory: (replicas: DatabaseReplicaService) => new InfraHealthService(replicas),
      inject: [DatabaseReplicaService],
    },
    ReadWriteInterceptor,
  ],
  exports: [DatabaseReplicaService, EdgeRegionCacheService, InfraHealthService, ReadWriteInterceptor],
})
export class ConnectionPoolModule {}

/** Backward-compat alias for the Phase-000 auto-scaffold name. */
export { ConnectionPoolModule as ConnectionPoolModuleModule };
