// SSOT Phase 049 — DrmModule (canvas-shuffle DRM wiring)
// Canonical: apps/backend/src/modules/drm/drm.module.ts
// (legacy src/backend/modules/drm/*)
// - useFactory wiring keeps services tsx-importable (Phase 027–049 precedent).
// - PrismaService arrives via global InfraModule; Redis via RedisClusterService.
// - Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { DrmShufflingService } from './services/drm-shuffling.service';
import { DrmSessionService } from './services/drm-session.service';
import { DrmController } from './presentation/drm.controller';
import { DrmResolver } from './presentation/drm.resolver';

@Module({
  controllers: [DrmController],
  providers: [
    DrmShufflingService,
    {
      provide: DrmSessionService,
      useFactory: (
        prisma: PrismaService,
        redis: RedisClusterService,
        shuffling: DrmShufflingService,
      ): DrmSessionService => new DrmSessionService(prisma, redis, shuffling),
      inject: [PrismaService, RedisClusterService, DrmShufflingService],
    },
    DrmResolver,
  ],
  exports: [DrmShufflingService, DrmSessionService],
})
export class DrmModule {}
