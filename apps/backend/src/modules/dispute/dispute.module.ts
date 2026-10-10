// SSOT Phase 113 Tasks 2/4 §5.1 — dispute module wiring
// Canonical: apps/backend/src/modules/dispute/dispute.module.ts
// (legacy scaffold class renamed — no importers.)
// - Atomic arbitration service + notify port + buyer/admin REST + GQL.
//   EscrowService rides EscrowModule (single writer). Prisma/Redis ride the
//   @Global InfraModule (never re-provided). Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { EscrowModule } from '../escrow/escrow.module';
import { EscrowService } from '../escrow/escrow.service';
import { DisputeService } from './dispute.service';
import { LogOnlyDisputeNotify, DisputeNotificationService } from './dispute-notify.service';
import { DisputeController } from './dispute.controller';
import { DisputeAdminController } from './dispute-admin.controller';
import { DisputeResolver } from './dispute.resolver';

@Module({
  imports: [EscrowModule],
  controllers: [DisputeController, DisputeAdminController],
  providers: [
    LogOnlyDisputeNotify,
    DisputeNotificationService,
    {
      provide: DisputeService,
      useFactory: (prisma: PrismaService, redis: RedisClusterService, notify: DisputeNotificationService) =>
        new DisputeService(prisma, redis, notify),
      inject: [PrismaService, RedisClusterService, DisputeNotificationService],
    },
    {
      provide: DisputeResolver,
      useFactory: (disputes: DisputeService, escrow: EscrowService) => new DisputeResolver(disputes, escrow),
      inject: [DisputeService, EscrowService],
    },
  ],
  exports: [DisputeService, DisputeResolver],
})
export class DisputeModule {}
