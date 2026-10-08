// SSOT Phase 077 §5.1 — Logistics module wiring
// Canonical: apps/backend/src/modules/logistics/logistics.module.ts
// - Booking (carrier factory + atomic Shipment), HMAC webhook intake with
//   replay guard, LINE Flex tracking push with retry stream, REST + GQL.
// - Carrier HTTP + LINE push ride global fetch (zero new deps); secrets stay
//   in CarrierApiConfig / env (never logged).
// - Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { WEBHOOK_REPLAY_TTL_SEC } from '@repo/shared';
import { PrismaLogisticsRepository } from './infrastructure/prisma-logistics.repository';
import { CarrierFactoryService } from './services/carrier-factory.service';
import { LogisticsService } from './services/logistics.service';
import { LineNotificationService } from './services/line-notification.service';
import { CarrierWebhookService } from './services/carrier-webhook.service';
import { LogisticsController } from './controllers/logistics.controller';
import { LogisticsResolver } from './resolvers/logistics.resolver';
import type { FetchPort } from './adapters/carrier.interface';

const globalFetch: FetchPort = (url, init) =>
  fetch(url, init).then((res) => ({
    ok: res.ok,
    status: res.status,
    json: () => res.json() as Promise<unknown>,
  }));

@Module({
  controllers: [LogisticsController],
  providers: [
    PrismaLogisticsRepository,
    {
      provide: CarrierFactoryService,
      useFactory: () => new CarrierFactoryService(globalFetch),
    },
    {
      provide: LogisticsService,
      useFactory: (repo: PrismaLogisticsRepository, prisma: PrismaService, carriers: CarrierFactoryService, redis: RedisClusterService) =>
        new LogisticsService(
          repo,
          { run: <T>(fn: (tx: unknown) => Promise<T>) => prisma.$transaction((tx) => fn(tx)) },
          carriers,
          {
            xadd: (stream: string, fields: Record<string, string | number>) =>
              redis.xaddPipeline(stream, [fields]).catch(() => undefined),
          },
        ),
      inject: [PrismaLogisticsRepository, PrismaService, CarrierFactoryService, RedisClusterService],
    },
    {
      provide: LineNotificationService,
      useFactory: (redis: RedisClusterService) =>
        new LineNotificationService(globalFetch, process.env['LINE_CHANNEL_ACCESS_TOKEN'] ?? '', {
          xadd: (stream: string, fields: Record<string, string | number>) =>
            redis.xaddPipeline(stream, [fields]).catch(() => undefined),
        }),
      inject: [RedisClusterService],
    },
    {
      provide: CarrierWebhookService,
      useFactory: (repo: PrismaLogisticsRepository, prisma: PrismaService, redis: RedisClusterService, line: LineNotificationService) =>
        new CarrierWebhookService(
          repo,
          { run: <T>(fn: (tx: unknown) => Promise<T>) => prisma.$transaction((tx) => fn(tx)) },
          {
            setnx: (key: string, ttl: number) => redis.setnx(key, '1', ttl || WEBHOOK_REPLAY_TTL_SEC),
          },
          line,
          process.env['LINE_LIFF_ID'] ?? 'default',
        ),
      inject: [PrismaLogisticsRepository, PrismaService, RedisClusterService, LineNotificationService],
    },
    {
      provide: LogisticsResolver,
      useFactory: (logistics: LogisticsService, repo: PrismaLogisticsRepository) =>
        new LogisticsResolver(logistics, repo),
      inject: [LogisticsService, PrismaLogisticsRepository],
    },
  ],
  exports: [LogisticsService, LineNotificationService, CarrierWebhookService, PrismaLogisticsRepository],
})
export class LogisticsModule {}
