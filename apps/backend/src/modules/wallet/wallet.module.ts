// SSOT Phase 017 §5.1 — wallet bounded-context module (DDD wiring)
// Canonical: apps/backend/src/modules/wallet/wallet.module.ts
import { Module } from '@nestjs/common';
import { WalletService } from './application/wallet.service';
import { WalletResolver } from './application/wallet.resolver';
import { WalletTopupController } from './application/wallet-topup.controller';
import { WalletPrismaRepo } from './infrastructure/wallet-prisma.repo';
import { RedisLockAdapter } from './infrastructure/redis-lock.adapter';
import { EntitlementGrantService } from '../entitlement/services/entitlement-grant.service';
import { EasySlipProvider } from '../payment/providers/easyslip.provider';
import { EasySlipVerifyAdapter } from '../payment/services/easyslip-verify.adapter';

// NOTE: PrismaService + RedisClusterService come from global InfraModule.
@Module({
  controllers: [WalletTopupController],
  providers: [
    WalletService,
    WalletResolver,
    WalletPrismaRepo,
    RedisLockAdapter,
    EntitlementGrantService,
    EasySlipProvider,
    EasySlipVerifyAdapter,
  ],
  exports: [WalletService, WalletPrismaRepo, RedisLockAdapter],
})
export class WalletModule {}
