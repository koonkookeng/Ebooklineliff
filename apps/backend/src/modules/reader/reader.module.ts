// SSOT Phase 040 Task 40.2 — ReaderModule (entitled reader wiring)
// Canonical: apps/backend/src/modules/reader/reader.module.ts
// (legacy src/backend/modules/reader/reader.module.ts)
// - Chunk transport reuses ChunkCacheModule (Phase 039 edge HIT + R2 warm);
//   PrismaService arrives via global InfraModule (single pool).
// - Services stay tsx-importable (no Nest parameter decorators) — this module
//   is the only place that knows the concrete wiring (useFactory).
import { Module } from '@nestjs/common';
import { ChunkCacheModule } from './cache/chunk-cache.module';
import { ChunkWarmerService } from './cache/services/chunk-warmer.service';
import { PrismaService } from '../../infra/database/prisma.service';
import { ReaderController } from './reader.controller';
import { ReaderResolver } from './reader.resolver';
import { ReaderService, type ReaderPrisma } from './reader.service';
import { SlidingWindowCacheService } from './services/sliding-window-cache.service';
import { WatermarkGeneratorService } from './services/watermark-generator.service';

@Module({
  imports: [ChunkCacheModule],
  controllers: [ReaderController],
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
  ],
  exports: [ReaderService, SlidingWindowCacheService],
})
export class ReaderModule {}
