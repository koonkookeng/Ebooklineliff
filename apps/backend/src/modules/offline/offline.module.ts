// SSOT Phase 063 §5.1 — OfflineModule (DRM lease + progress sync wiring)
// Canonical: apps/backend/src/modules/offline/offline.module.ts
// (legacy src/backend/modules/offline/offline.module.ts)
// - useFactory wiring keeps services tsx-importable (Phase 027–063).
// - PrismaService via global InfraModule. Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { DrmLeaseService } from './services/drm-lease.service';
import { OfflineSyncService } from './services/offline-sync.service';
import { DrmLeaseController } from './controllers/drm-lease.controller';

@Module({
  controllers: [DrmLeaseController],
  providers: [
    {
      provide: DrmLeaseService,
      useFactory: (prisma: PrismaService): DrmLeaseService =>
        new DrmLeaseService(prisma as never),
      inject: [PrismaService],
    },
    {
      provide: OfflineSyncService,
      useFactory: (prisma: PrismaService): OfflineSyncService =>
        new OfflineSyncService(prisma as never),
      inject: [PrismaService],
    },
  ],
  exports: [DrmLeaseService, OfflineSyncService],
})
export class OfflineModule {}
