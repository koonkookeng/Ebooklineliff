// SSOT Phase 115 Task 1 §5.1 — reconciliation module wiring
// Canonical: apps/backend/src/modules/reconciliation/reconciliation.module.ts
// (legacy scaffold class renamed — no importers.)
// - Strategies (pure) + hash chain + notify port + structural repo ->
//   auto engine + maker-checker override -> webhook + admin REST + GQL.
//   Prisma/Redis ride @Global InfraModule (never re-provided). Order/payment
//   lanes are read for matching and written only inside 115's own
//   transactions (module files untouched). Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { MatchingStrategyService } from './services/matching-strategy.service';
import { AuditChainService } from './services/audit-chain.service';
import { LogOnlyReconciliationNotify, ReconciliationNotificationService } from './reconciliation-notify.service';
import { ReconciliationRepository } from './repositories/reconciliation.repository';
import { AutoReconciliationEngineService } from './services/auto-reconciliation-engine.service';
import { ManualOverrideService } from './services/manual-override.service';
import { BankWebhookController } from './controllers/bank-webhook.controller';
import { ManualOverrideController } from './controllers/manual-override.controller';
import { ReconciliationResolver } from './resolvers/reconciliation.resolver';

@Module({
  controllers: [BankWebhookController, ManualOverrideController],
  providers: [
    MatchingStrategyService,
    LogOnlyReconciliationNotify,
    ReconciliationNotificationService,
    ReconciliationRepository,
    {
      provide: AuditChainService,
      useFactory: (redis: RedisClusterService) => new AuditChainService(redis),
      inject: [RedisClusterService],
    },
    {
      provide: AutoReconciliationEngineService,
      useFactory: (
        prisma: PrismaService,
        redis: RedisClusterService,
        repo: ReconciliationRepository,
        strategies: MatchingStrategyService,
        notify: ReconciliationNotificationService,
      ) => new AutoReconciliationEngineService(prisma, redis, repo, strategies, notify),
      inject: [PrismaService, RedisClusterService, ReconciliationRepository, MatchingStrategyService, ReconciliationNotificationService],
    },
    {
      provide: ManualOverrideService,
      useFactory: (
        prisma: PrismaService,
        redis: RedisClusterService,
        chain: AuditChainService,
        notify: ReconciliationNotificationService,
      ) => new ManualOverrideService(prisma, redis, chain, notify),
      inject: [PrismaService, RedisClusterService, AuditChainService, ReconciliationNotificationService],
    },
    {
      provide: ReconciliationResolver,
      useFactory: (engine: AutoReconciliationEngineService, overrides: ManualOverrideService, repo: ReconciliationRepository) =>
        new ReconciliationResolver(engine, overrides, repo),
      inject: [AutoReconciliationEngineService, ManualOverrideService, ReconciliationRepository],
    },
  ],
  exports: [AutoReconciliationEngineService, ManualOverrideService, AuditChainService, ReconciliationRepository],
})
export class ReconciliationModule {}
