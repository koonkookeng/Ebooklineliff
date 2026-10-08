// SSOT Phase 050 §5.1 — VideoSecurityModule (HLS rate-limit + DRM wiring)
// Canonical: apps/backend/src/modules/stream/video-security.module.ts
// (legacy src/backend/modules/stream/video-security.module.ts)
// - useFactory wiring keeps guard/services tsx-importable (Phase 047 precedent).
// - PrismaService + RedisClusterService arrive via global InfraModule;
//   R2StorageService exposes getObjectText/getObjectBuffer (Phase 036 surface).
import { Module } from '@nestjs/common';
import { R2StorageService } from '../../infra/cloudflare/r2-storage.service';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { HlsStreamController } from './controllers/hls-stream.controller';
import { VideoRateLimitGuard } from './guards/video-rate-limit.guard';
import { HlsSecurityService, HlsR2Port } from './services/hls-security.service';
import { VideoSessionService, VideoSessionDbPort, VideoSessionRedisPort } from './services/video-session.service';

@Module({
  controllers: [HlsStreamController],
  providers: [
    {
      provide: HlsSecurityService,
      useFactory: (vault: R2StorageService): HlsSecurityService =>
        new HlsSecurityService(vault as unknown as HlsR2Port),
      inject: [R2StorageService],
    },
    {
      provide: VideoSessionService,
      useFactory: (prisma: PrismaService, edge: RedisClusterService): VideoSessionService =>
        new VideoSessionService(
          prisma as unknown as VideoSessionDbPort,
          edge as unknown as VideoSessionRedisPort,
        ),
      inject: [PrismaService, RedisClusterService],
    },
    {
      provide: VideoRateLimitGuard,
      useFactory: (edge: RedisClusterService): VideoRateLimitGuard =>
        new VideoRateLimitGuard(edge as never),
      inject: [RedisClusterService],
    },
  ],
  exports: [HlsSecurityService, VideoSessionService, VideoRateLimitGuard],
})
export class VideoSecurityModule {}
