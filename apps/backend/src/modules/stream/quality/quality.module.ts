// SSOT Phase 067 Task 2 — QualityModule (ABR manifest + telemetry wiring)
// Canonical: apps/backend/src/modules/stream/quality/quality.module.ts
// (legacy src/backend/modules/stream/quality.module.ts)
// - Self-contained (avoids the heavy StreamModule FFmpeg chain); Prisma via
//   global InfraModule; edge cache + telemetry stream via RedisClusterService.
// - useFactory keeps the service tsx-importable. Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import { QualitySelectorService } from './quality-selector.service';
import { QualityManifestController } from './quality-manifest.controller';
import { QualityResolver } from './quality.resolver';

@Module({
  controllers: [QualityManifestController],
  providers: [
    {
      provide: QualitySelectorService,
      useFactory: (prisma: PrismaService, edge: RedisClusterService): QualitySelectorService =>
        new QualitySelectorService(prisma as never, edge as never, edge as never),
      inject: [PrismaService, RedisClusterService],
    },
    QualityResolver,
  ],
  exports: [QualitySelectorService],
})
export class QualityModule {}
