// SSOT Phase 069 Task 3 — NetworkHealthModule (ping + offline sync wiring)
// Canonical: apps/backend/src/modules/network/network-health.module.ts
// (legacy src/backend/modules/network/network-health.module.ts)
// - useFactory wiring keeps services tsx-importable (Phase 027–069).
// - PrismaService via global InfraModule. Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { NetworkHealthService } from './network-health.service';
import { OfflineSyncService } from './services/offline-sync.service';
import { NetworkHealthController } from './network-health.controller';
import { NetworkHealthResolver } from './network-health.resolver';

@Module({
  controllers: [NetworkHealthController],
  providers: [
    {
      provide: NetworkHealthService,
      useFactory: (prisma: PrismaService): NetworkHealthService => new NetworkHealthService(prisma as never),
      inject: [PrismaService],
    },
    {
      provide: OfflineSyncService,
      useFactory: (prisma: PrismaService): OfflineSyncService => new OfflineSyncService(prisma as never),
      inject: [PrismaService],
    },
    NetworkHealthResolver,
  ],
  exports: [NetworkHealthService, OfflineSyncService],
})
export class NetworkHealthModule {}
