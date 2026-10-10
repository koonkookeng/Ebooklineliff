// SSOT Phase 052 §5.1 — AnalyticsModule (ingest + stream + drain + heatmap + GQL)
// Canonical: apps/backend/src/modules/analytics/analytics.module.ts
// (legacy src/backend/modules/analytics/analytics.module.ts)
// - useFactory wiring keeps services tsx-importable (Phase 047 precedent).
// - PrismaService + RedisClusterService arrive via global InfraModule.
import { Module, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { AnalyticsIngestionController } from './controllers/analytics-ingestion.controller';
import { AnalyticsResolver } from './resolvers/analytics.resolver';
import {
  AnalyticsAggregationService,
  type AnalyticsWriterDbPort,
} from './services/analytics-aggregation.service';
import { AnalyticsStreamService, type AnalyticsStreamRedisPort } from './services/analytics-stream.service';
import { HeatmapProcessorService, type HeatmapReaderDbPort } from './services/heatmap-processor.service';
import { AnalyticsQueueProcessor } from './processors/analytics-queue.processor';
import { ExecutiveAnalyticsService } from './services/executive-analytics.service';
import { DailySnapshotWorker } from './workers/daily-snapshot.worker';
import { ExecutiveAnalyticsController } from './controllers/executive-analytics.controller';
import { ExecutiveAnalyticsResolver } from './resolvers/executive-analytics.resolver';

@Module({
  controllers: [AnalyticsIngestionController, ExecutiveAnalyticsController],
  providers: [
    {
      provide: AnalyticsStreamService,
      useFactory: (edge: RedisClusterService): AnalyticsStreamService =>
        new AnalyticsStreamService(edge as unknown as AnalyticsStreamRedisPort),
      inject: [RedisClusterService],
    },
    {
      provide: AnalyticsAggregationService,
      useFactory: (prisma: PrismaService): AnalyticsAggregationService =>
        new AnalyticsAggregationService(prisma as unknown as AnalyticsWriterDbPort),
      inject: [PrismaService],
    },
    {
      provide: HeatmapProcessorService,
      useFactory: (prisma: PrismaService): HeatmapProcessorService =>
        new HeatmapProcessorService(prisma as unknown as HeatmapReaderDbPort),
      inject: [PrismaService],
    },
    {
      provide: AnalyticsQueueProcessor,
      useFactory: (writer: AnalyticsAggregationService): AnalyticsQueueProcessor =>
        new AnalyticsQueueProcessor(writer),
      inject: [AnalyticsAggregationService],
    },
    {
      provide: ExecutiveAnalyticsService,
      useFactory: (prisma: PrismaService, redis: RedisClusterService): ExecutiveAnalyticsService =>
        new ExecutiveAnalyticsService(prisma, redis),
      inject: [PrismaService, RedisClusterService],
    },
    {
      provide: DailySnapshotWorker,
      useFactory: (prisma: PrismaService, redis: RedisClusterService): DailySnapshotWorker =>
        new DailySnapshotWorker(prisma, redis),
      inject: [PrismaService, RedisClusterService],
    },
    {
      provide: ExecutiveAnalyticsResolver,
      useFactory: (bi: ExecutiveAnalyticsService, nightly: DailySnapshotWorker): ExecutiveAnalyticsResolver =>
        new ExecutiveAnalyticsResolver(bi, nightly),
      inject: [ExecutiveAnalyticsService, DailySnapshotWorker],
    },
    AnalyticsResolver,
  ],
  exports: [AnalyticsStreamService, AnalyticsAggregationService, HeatmapProcessorService, AnalyticsQueueProcessor, ExecutiveAnalyticsService, DailySnapshotWorker],
})
export class AnalyticsModule implements OnModuleInit {
  constructor(private readonly queue: AnalyticsQueueProcessor) {}

  onModuleInit(): void {
    this.queue.startDrainLoop();
  }
}
