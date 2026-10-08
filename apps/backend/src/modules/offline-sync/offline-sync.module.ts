// SSOT Phase 062 §5.1 — OfflineSyncModule (bulk flush wiring)
// Canonical: apps/backend/src/modules/offline-sync/offline-sync.module.ts
// (legacy src/backend/modules/offline-sync/offline-sync.module.ts)
// - useFactory wiring keeps use-cases tsx-importable (Phase 027–062).
// - PrismaService via global InfraModule; module is self-contained.
// - Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { ProcessBulkSyncUseCase } from './application/use-cases/process-bulk-sync.use-case';
import { OfflineSyncRepository } from './infrastructure/repositories/offline-sync.repository';
import { OfflineSyncController } from './infrastructure/controllers/offline-sync.controller';
import { OfflineSyncResolver } from './infrastructure/offline-sync.resolver';

@Module({
  controllers: [OfflineSyncController],
  providers: [
    {
      provide: OfflineSyncRepository,
      useFactory: (prisma: PrismaService): OfflineSyncRepository =>
        new OfflineSyncRepository(prisma as never),
      inject: [PrismaService],
    },
    {
      provide: ProcessBulkSyncUseCase,
      useFactory: (ledger: OfflineSyncRepository): ProcessBulkSyncUseCase =>
        new ProcessBulkSyncUseCase(ledger),
      inject: [OfflineSyncRepository],
    },
    OfflineSyncResolver,
  ],
  exports: [ProcessBulkSyncUseCase, OfflineSyncRepository],
})
export class OfflineSyncModule {}
