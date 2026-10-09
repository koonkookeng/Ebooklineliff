// SSOT Phase 088 §5.1 — Promotion module wiring
// Canonical: apps/backend/src/modules/promotion/promotion.module.ts
// (legacy class name PromotionModuleModule renamed — no importers.)
// - Pure engine + coupon/points/redlock + quote calculator + REST + GQL.
// - Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { CalculationEngine } from './domain/calculation-engine';
import { CouponService } from './services/coupon.service';
import { PointsService } from './services/points.service';
import { RedlockService } from './services/redlock.service';
import { DiscountCalculatorService } from './services/discount-calculator.service';
import { PromotionController } from './controllers/promotion.controller';
import { PromotionResolver } from './resolvers/promotion.resolver';

@Module({
  controllers: [PromotionController],
  providers: [
    CalculationEngine,
    RedlockService,
    CouponService,
    PointsService,
    {
      provide: DiscountCalculatorService,
      useFactory: (
        coupons: CouponService,
        points: PointsService,
        locks: RedlockService,
        engine: CalculationEngine,
        redis: RedisClusterService,
      ) =>
        new DiscountCalculatorService(coupons, points, locks, engine, {
          xadd: (stream: string, fields: Record<string, string | number>) =>
            redis.xaddPipeline(stream, [fields]),
        }),
      inject: [CouponService, PointsService, RedlockService, CalculationEngine, RedisClusterService],
    },
    {
      provide: PromotionResolver,
      useFactory: (
        calc: DiscountCalculatorService,
        coupons: CouponService,
        points: PointsService,
      ) => new PromotionResolver(calc, coupons, points),
      inject: [DiscountCalculatorService, CouponService, PointsService],
    },
  ],
  exports: [CalculationEngine, CouponService, PointsService, RedlockService, DiscountCalculatorService],
})
export class PromotionModule {}
