// SSOT Phase 113 Task 3 §5.1 — escrow module wiring
// Canonical: apps/backend/src/modules/escrow/escrow.module.ts
// (legacy scaffold class renamed — no importers.)
// - Hold/release/status + hourly cron (bootstrap-owned start). Prisma/Redis
//   ride the @Global InfraModule (never re-provided). Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { EscrowService } from './escrow.service';
import { EscrowReleaseCron } from './escrow.cron';
import { EscrowController } from './escrow.controller';

@Module({
  controllers: [EscrowController],
  providers: [
    {
      provide: EscrowService,
      useFactory: (prisma: PrismaService, redis: RedisClusterService) => new EscrowService(prisma, redis),
      inject: [PrismaService, RedisClusterService],
    },
    {
      provide: EscrowReleaseCron,
      useFactory: (escrow: EscrowService) => new EscrowReleaseCron(escrow),
      inject: [EscrowService],
    },
  ],
  exports: [EscrowService, EscrowReleaseCron],
})
export class EscrowModule {}
