// SSOT Phase 117 Task 4 §5.1 — campaign module wiring
// Canonical: apps/backend/src/modules/campaign/campaign.module.ts
// (no legacy class — this module is new in 117; promotion.module owns 088.)
// - Entity gates + calculator + validate/claim/flash-lock use-cases +
//   coupon Redis seam + prisma repo + GQL + event bridge. Prisma/Redis ride
//   @Global InfraModule (never re-provided). Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { DiscountCalculatorService } from './application/services/discount-calculator.service';
import { CouponStackService } from './application/services/coupon-stack.service';
import { ValidateCouponUseCase } from './application/use-cases/validate-coupon.use-case';
import { ClaimCouponUseCase } from './application/use-cases/claim-coupon.use-case';
import { ExecuteFlashSaleLockUseCase } from './application/use-cases/execute-flash-sale-lock.use-case';
import { CouponCacheRepository } from '../coupon/infra/redis/coupon-cache.repository';
import { PrismaCouponRepository } from './infrastructure/persistence/prisma-coupon.repository';
import { CouponResolver } from './presentation/graphql/coupon.resolver';
import { CampaignEventController } from './presentation/webhooks/campaign-event.controller';

@Module({
  controllers: [CampaignEventController],
  providers: [
    DiscountCalculatorService,
    {
      provide: CouponStackService,
      useFactory: (validate: ValidateCouponUseCase, store: PrismaCouponRepository) =>
        new CouponStackService(validate, store),
      inject: [ValidateCouponUseCase, PrismaCouponRepository],
    },
    {
      provide: CouponCacheRepository,
      useFactory: (redis: RedisClusterService) => new CouponCacheRepository(redis),
      inject: [RedisClusterService],
    },
    {
      provide: PrismaCouponRepository,
      useFactory: (prisma: PrismaService) => new PrismaCouponRepository(prisma),
      inject: [PrismaService],
    },
    {
      provide: ValidateCouponUseCase,
      useFactory: (calculator: DiscountCalculatorService, store: PrismaCouponRepository, cache: CouponCacheRepository) =>
        new ValidateCouponUseCase(calculator, store, cache),
      inject: [DiscountCalculatorService, PrismaCouponRepository, CouponCacheRepository],
    },
    {
      provide: ClaimCouponUseCase,
      useFactory: (store: PrismaCouponRepository, cache: CouponCacheRepository) =>
        new ClaimCouponUseCase(store, cache),
      inject: [PrismaCouponRepository, CouponCacheRepository],
    },
    {
      provide: ExecuteFlashSaleLockUseCase,
      useFactory: (cache: CouponCacheRepository) => new ExecuteFlashSaleLockUseCase(cache),
      inject: [CouponCacheRepository],
    },
    {
      provide: CouponResolver,
      useFactory: (validate: ValidateCouponUseCase, claim: ClaimCouponUseCase, store: PrismaCouponRepository, stack: CouponStackService) =>
        new CouponResolver(validate, claim, store, stack),
      inject: [ValidateCouponUseCase, ClaimCouponUseCase, PrismaCouponRepository, CouponStackService],
    },
  ],
  exports: [ValidateCouponUseCase, ClaimCouponUseCase, ExecuteFlashSaleLockUseCase, DiscountCalculatorService, CouponStackService, CouponCacheRepository, PrismaCouponRepository],
})
export class CampaignModule {}
