// SSOT Phase 076 §5.1 — Fulfillment module wiring
// Canonical: apps/backend/src/modules/fulfillment/fulfillment.module.ts
// - Queue service (batch enqueue -> FIFO drain -> atomic BOOKED), thermal
//   print (R2 vault), FIFO processor (BullMQ-shape, port-based), REST + GQL.
// - Queue bus: Redis xadd (FULFILLMENT_QUEUE_STREAM); LINE tracking event is
//   an async seam consumed by the LINE pipeline (Task 5).
// - Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { R2StorageService } from '../../infra/cloudflare/r2-storage.service';
import { PrismaFulfillmentRepository } from './infrastructure/prisma-fulfillment.repository';
import { FulfillmentQueueService } from './services/fulfillment-queue.service';
import { BatchThermalPrintService } from './services/batch-thermal-print.service';
import { FulfillmentQueueProcessor } from './processors/fulfillment-queue.processor';
import { inMemoryBreakerStore } from './application/circuit-breaker';
import { FulfillmentQueueController } from './controllers/fulfillment-queue.controller';
import { ThermalPrintController } from './controllers/thermal-print.controller';
import { FulfillmentResolver } from './resolvers/fulfillment.resolver';

const breakerStore = inMemoryBreakerStore();

@Module({
  controllers: [FulfillmentQueueController, ThermalPrintController],
  providers: [
    PrismaFulfillmentRepository,
    {
      provide: FulfillmentQueueService,
      useFactory: (repo: PrismaFulfillmentRepository, prisma: PrismaService, redis: RedisClusterService) =>
        new FulfillmentQueueService(
          repo,
          { run: <T>(fn: (tx: unknown) => Promise<T>) => prisma.$transaction((tx) => fn(tx)) },
          {
            xadd: (stream: string, fields: Record<string, string | number>) =>
              redis.xaddPipeline(stream, [fields]).catch(() => undefined),
          },
          {
            trackingBooked: async (args: { tenantId: string; orderId: string; trackingNumber: string; courierProvider: string }) =>
              redis
                .xaddPipeline('line.tracking.updated', [
                  {
                    event: 'fulfillment.tracking.booked',
                    tenantId: args.tenantId,
                    orderId: args.orderId,
                    trackingNumber: args.trackingNumber,
                    courierProvider: args.courierProvider,
                    at: Date.now(),
                  },
                ])
                .catch(() => undefined),
          },
          breakerStore,
        ),
      inject: [PrismaFulfillmentRepository, PrismaService, RedisClusterService],
    },
    {
      provide: BatchThermalPrintService,
      useFactory: (repo: PrismaFulfillmentRepository, r2: R2StorageService) =>
        new BatchThermalPrintService(repo, r2, process.env['LABEL_HMAC_SECRET'] ?? 'dev-label-secret'),
      inject: [PrismaFulfillmentRepository, R2StorageService],
    },
    {
      provide: FulfillmentQueueProcessor,
      useFactory: (queue: FulfillmentQueueService) => new FulfillmentQueueProcessor(queue),
      inject: [FulfillmentQueueService],
    },
    {
      provide: FulfillmentResolver,
      useFactory: (
        queue: FulfillmentQueueService,
        processor: FulfillmentQueueProcessor,
        print: BatchThermalPrintService,
        repo: PrismaFulfillmentRepository,
      ) => new FulfillmentResolver(queue, processor, print, repo),
      inject: [FulfillmentQueueService, FulfillmentQueueProcessor, BatchThermalPrintService, PrismaFulfillmentRepository],
    },
  ],
  exports: [FulfillmentQueueService, BatchThermalPrintService, PrismaFulfillmentRepository],
})
export class FulfillmentModule {}
