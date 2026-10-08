// SSOT Phase 068 Task 2 — OfflineLicenseModule (license + quota wiring)
// Canonical: apps/backend/src/modules/offline-license/offline-license.module.ts
// (legacy src/backend/modules/offline-license/offline-license.module.ts)
// - useFactory wiring keeps the service tsx-importable (Phase 027–068).
// - PrismaService via global InfraModule; analytics via RedisClusterService.
// - Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { OfflineLicenseService } from './offline-license.service';
import { OfflineLicenseController } from './offline-license.controller';
import { OfflineLicenseResolver } from './offline-license.resolver';

@Module({
  controllers: [OfflineLicenseController],
  providers: [
    {
      provide: OfflineLicenseService,
      useFactory: (prisma: PrismaService, edge: RedisClusterService): OfflineLicenseService =>
        new OfflineLicenseService(prisma as never, edge as never),
      inject: [PrismaService, RedisClusterService],
    },
    OfflineLicenseResolver,
  ],
  exports: [OfflineLicenseService],
})
export class OfflineLicenseModule {}
