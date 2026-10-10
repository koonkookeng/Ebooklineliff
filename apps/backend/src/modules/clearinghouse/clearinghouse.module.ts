// SSOT Phase 114 Task 2 §5.1 — clearinghouse module wiring
// Canonical: apps/backend/src/modules/clearinghouse/clearinghouse.module.ts
// (legacy scaffold class renamed — no importers.)
// - Settlement engine + 3% facade + payout processor + reconciliation +
//   notify port + REST + GQL. KycModule imported for the bank-decrypt reuse
//   (exported encryptor, read-only). Prisma/Redis ride @Global InfraModule.
// - Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { KycModule } from '../kyc/kyc.module';
import { KycEncryptionService } from '../kyc/services/kyc-encryption.service';
import { ClearinghouseTaxService } from './tax-calculator.service';
import { ClearinghouseService } from './clearinghouse.service';
import { ReconciliationEngineService } from './reconciliation-engine.service';
import { LogOnlyClearinghouseNotify, ClearinghouseNotificationService } from './clearinghouse-notify.service';
import { PayoutProcessorService } from './payout-processor.service';
import { ClearinghouseController } from './clearinghouse.controller';
import { ClearinghouseResolver } from './resolvers/clearinghouse.resolver';

@Module({
  imports: [KycModule],
  controllers: [ClearinghouseController],
  providers: [
    ClearinghouseTaxService,
    LogOnlyClearinghouseNotify,
    ClearinghouseNotificationService,
    {
      provide: ClearinghouseService,
      useFactory: (prisma: PrismaService, redis: RedisClusterService) => new ClearinghouseService(prisma, redis),
      inject: [PrismaService, RedisClusterService],
    },
    {
      provide: ReconciliationEngineService,
      useFactory: (prisma: PrismaService, redis: RedisClusterService) => new ReconciliationEngineService(prisma, redis),
      inject: [PrismaService, RedisClusterService],
    },
    {
      provide: PayoutProcessorService,
      useFactory: (
        prisma: PrismaService,
        redis: RedisClusterService,
        encryption: KycEncryptionService,
        tax: ClearinghouseTaxService,
        recon: ReconciliationEngineService,
        notify: ClearinghouseNotificationService,
      ) => new PayoutProcessorService(prisma, redis, encryption, tax, recon, notify),
      inject: [PrismaService, RedisClusterService, KycEncryptionService, ClearinghouseTaxService, ReconciliationEngineService, ClearinghouseNotificationService],
    },
    {
      provide: ClearinghouseResolver,
      useFactory: (clearing: ClearinghouseService, payout: PayoutProcessorService, recon: ReconciliationEngineService) =>
        new ClearinghouseResolver(clearing, payout, recon),
      inject: [ClearinghouseService, PayoutProcessorService, ReconciliationEngineService],
    },
  ],
  exports: [ClearinghouseService, PayoutProcessorService, ReconciliationEngineService, ClearinghouseTaxService],
})
export class ClearinghouseModule {}
