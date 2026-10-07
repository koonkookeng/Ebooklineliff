// SSOT Phase 040 Task 40.2 — ReaderModule (entitled reader wiring)
// Canonical: apps/backend/src/modules/reader/reader.module.ts
// (legacy src/backend/modules/reader/reader.module.ts)
// - Chunk transport reuses ChunkCacheModule (Phase 039 edge HIT + R2 warm);
//   PrismaService arrives via global InfraModule (single pool).
// - Services stay tsx-importable (no Nest parameter decorators) — this module
//   is the only place that knows the concrete wiring (useFactory).
// - Phase 041: reader controls (bookmarks/highlights/preferences) share the
//   global Prisma pool + RedisClusterService edge (1h annotation cache).
import { Module } from '@nestjs/common';
import { ChunkCacheModule } from './cache/chunk-cache.module';
import { ChunkWarmerService } from './cache/services/chunk-warmer.service';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { ReaderControlController } from './reader-control.controller';
import { ReaderControlResolver } from '../../api/graphql/reader-control.resolver';
import { ReaderControlService, type ReaderControlCache, type ReaderControlPrisma } from './reader-control.service';
import { ReaderController } from './reader.controller';
import { ReaderResolver } from './reader.resolver';
import { ReaderService, type ReaderPrisma } from './reader.service';
import { SlidingWindowCacheService } from './services/sliding-window-cache.service';
import { WatermarkGeneratorService } from './services/watermark-generator.service';

@Module({
  imports: [ChunkCacheModule],
  controllers: [ReaderController, ReaderControlController],
  providers: [
    WatermarkGeneratorService,
    {
      provide: SlidingWindowCacheService,
      useFactory: (warmer: ChunkWarmerService): SlidingWindowCacheService =>
        new SlidingWindowCacheService(warmer),
      inject: [ChunkWarmerService],
    },
    {
      provide: ReaderService,
      useFactory: (
        warmer: ChunkWarmerService,
        prisma: PrismaService,
        watermarks: WatermarkGeneratorService,
      ): ReaderService =>
        new ReaderService(
          warmer,
          prisma as unknown as ReaderPrisma,
          watermarks,
          process.env.APP_SECRET ?? '',
        ),
      inject: [ChunkWarmerService, PrismaService, WatermarkGeneratorService],
    },
    ReaderResolver,
    {
      provide: ReaderControlService,
      useFactory: (prisma: PrismaService, edge: RedisClusterService): ReaderControlService =>
        new ReaderControlService(
          prisma as unknown as ReaderControlPrisma,
          edge as unknown as ReaderControlCache,
        ),
      inject: [PrismaService, RedisClusterService],
    },
    ReaderControlResolver,
  ],
  exports: [ReaderService, SlidingWindowCacheService, ReaderControlService],
})
export class ReaderModule {}
