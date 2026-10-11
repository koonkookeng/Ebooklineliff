// SSOT Phase 124 Task 2 §5.1 — chaos composition module
// Canonical: apps/backend/src/modules/chaos/chaos.module.ts
// - Provides the injector (registry + ledger) over global InfraModule
//   Redis/Prisma, the admin control plane, and the 122 breaker status
//   lane (imported, not duplicated). Interceptors/proxies are request-
//   scoped by callers (no provider entry — payment/reader cores untouched).
// - Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { ResilienceModule } from '../resilience/resilience.module';
import { ChaosInjectorService } from './chaos-injector.service';
import { ChaosController } from './chaos.controller';

@Module({
  imports: [ResilienceModule],
  controllers: [ChaosController],
  providers: [
    {
      provide: ChaosInjectorService,
      useFactory: (redis: RedisClusterService, prisma: PrismaService) =>
        new ChaosInjectorService(redis, prisma),
      inject: [RedisClusterService, PrismaService],
    },
  ],
  exports: [ChaosInjectorService],
})
export class ChaosModule {}
