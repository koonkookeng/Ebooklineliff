// SSOT Phase 087 §5.1 — Flash sale module wiring
// Canonical: apps/backend/src/modules/flash-sale/flash-sale.module.ts
// (legacy class name FlashSaleModuleModule renamed — no importers.)
// - Campaign UTC machine + Lua stock locks + expiry sweeper + admin REST +
//   GQL. The checkout hook lives in the order module (owns order builds).
// - Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { FlashSaleCampaignService } from './services/flash-sale-campaign.service';
import { RedisStockLockService } from './services/redis-stock-lock.service';
import { ReservationCleanupService } from './services/reservation-cleanup.cron';
import { FlashSaleAdminController } from './controllers/flash-sale-admin.controller';
import { FlashSaleController } from './controllers/flash-sale.controller';
import { FlashSaleResolver } from './resolvers/flash-sale.resolver';
import { FlashSaleCheckoutService } from '../order/flash-sale-checkout.service';

@Module({
  controllers: [FlashSaleAdminController, FlashSaleController],
  providers: [
    FlashSaleCampaignService,
    RedisStockLockService,
    ReservationCleanupService,
    FlashSaleCheckoutService,
    {
      provide: FlashSaleResolver,
      useFactory: (
        campaigns: FlashSaleCampaignService,
        locks: RedisStockLockService,
        prisma: PrismaService,
      ) => new FlashSaleResolver(campaigns, locks, prisma),
      inject: [FlashSaleCampaignService, RedisStockLockService, PrismaService],
    },
  ],
  exports: [FlashSaleCampaignService, RedisStockLockService, ReservationCleanupService, FlashSaleCheckoutService],
})
export class FlashSaleModule {}
