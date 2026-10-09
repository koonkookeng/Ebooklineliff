// SSOT Phase 084 §5.1 — Behavioral messaging module wiring
// Canonical: apps/backend/src/modules/messaging/messaging.module.ts
// (legacy class name MessagingModuleModule renamed — no importers).
// - Abandoned-cart service (detect/recover/analytics) + Flex builder +
//   coupon issuer + Redis delayed queue + 3-attempt processor + REST + GQL.
//   Coupon/promotion modules stay 088/117-owned (asserted in 084 tests).
// - Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { AbandonedCartService } from './services/abandoned-cart.service';
import { LineFlexBuilderService } from './services/line-flex-builder.service';
import { CouponIssuerService } from './services/coupon-issuer.service';
import { AbandonedCartQueue } from './queues/abandoned-cart.queue';
import { AbandonedCartProcessor, LogOnlyLinePush } from './queues/abandoned-cart.processor';
import { AbandonedCartController } from './controllers/abandoned-cart.controller';
import { AbandonedCartResolver } from './resolvers/abandoned-cart.resolver';

@Module({
  controllers: [AbandonedCartController],
  providers: [
    AbandonedCartService,
    LineFlexBuilderService,
    CouponIssuerService,
    AbandonedCartQueue,
    LogOnlyLinePush,
    {
      provide: AbandonedCartProcessor,
      useFactory: (
        carts: AbandonedCartService,
        coupons: CouponIssuerService,
        flex: LineFlexBuilderService,
        push: LogOnlyLinePush,
        prisma: PrismaService,
        redis: RedisClusterService,
      ) => new AbandonedCartProcessor(carts, coupons, flex, push, prisma, redis),
      inject: [AbandonedCartService, CouponIssuerService, LineFlexBuilderService, LogOnlyLinePush, PrismaService, RedisClusterService],
    },
    {
      provide: AbandonedCartResolver,
      useFactory: (carts: AbandonedCartService) => new AbandonedCartResolver(carts),
      inject: [AbandonedCartService],
    },
  ],
  exports: [AbandonedCartService, AbandonedCartProcessor, AbandonedCartQueue],
})
export class MessagingModule {}
