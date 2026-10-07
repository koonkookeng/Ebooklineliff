// SSOT Phase 029 §5.1 — Performance module (guard + prefetch + telemetry)
// Canonical: apps/backend/src/modules/performance/performance.module.ts
// (legacy src/backend/modules/performance/ + src/backend/modules/prefetch/)
// NOTE: PrismaService + RedisClusterService come from global InfraModule (single pool).
import { Module } from '@nestjs/common';
import { GetBundleMetricsQuery } from './application/queries/get-bundle-metrics.query';
import { BundleGuardService } from './application/services/bundle-guard.service';
import { PredictivePrefetchService } from './application/services/predictive-prefetch.service';
import { RedisPrefetchCacheAdapter } from './infrastructure/adapters/redis-prefetch-cache.adapter';
import { PrismaPerformanceRepository } from './infrastructure/persistence/prisma-performance.repository';
import { PrefetchResolver } from './presentation/graphql/prefetch.resolver';
import { PerformanceTelemetryController } from './presentation/webhooks/performance-telemetry.controller';

@Module({
  controllers: [PerformanceTelemetryController],
  providers: [
    BundleGuardService,
    PredictivePrefetchService,
    GetBundleMetricsQuery,
    RedisPrefetchCacheAdapter,
    PrismaPerformanceRepository,
    PrefetchResolver,
  ],
  exports: [BundleGuardService, PredictivePrefetchService, PrismaPerformanceRepository],
})
export class PerformanceModule {}
