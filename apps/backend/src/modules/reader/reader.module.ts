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
import { R2StorageModule } from '../../infra/cloudflare/r2-storage.module';
import { R2StorageService } from '../../infra/cloudflare/r2-storage.service';
import { ChunkCacheModule } from './cache/chunk-cache.module';
import { ChunkWarmerService } from './cache/services/chunk-warmer.service';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { ReaderControlController } from './reader-control.controller';
import { ReaderControlResolver } from '../../api/graphql/reader-control.resolver';
import { ReaderPreferenceService } from './application/reader-preference.service';
import { ReaderPreferenceResolver } from './infrastructure/api/reader-preference.resolver';
import { ReaderNavigationController } from './reader-navigation.controller';
import { DrmReaderResolver } from '../../api/graphql/resolvers/drm-reader.resolver';
import { DrmChunkController } from './drm/drm-chunk.controller';
import { CanvasShufflingService } from './drm/canvas-shuffling.service';
import { PixelMatrixGeneratorService } from './drm/pixel-matrix.generator';
import { RetinaReaderController } from './controllers/retina-reader.controller';
import { VectorChunkService } from './services/vector-chunk.service';
import { RetinaScalerService } from './services/retina-scaler.service';
import { ReaderControlService, type ReaderControlCache, type ReaderControlPrisma } from './reader-control.service';
import { ReaderController } from './reader.controller';
import { ReaderResolver } from './reader.resolver';
import { ReaderService, type ReaderPrisma } from './reader.service';
import { SlidingWindowCacheService } from './services/sliding-window-cache.service';
import {
  LowBandwidthReaderService,
  type LowBandwidthChunkCache,
  type LowBandwidthChunkSource,
} from './services/low-bandwidth-reader.service';
import { WatermarkGeneratorService } from './services/watermark-generator.service';

@Module({
  imports: [ChunkCacheModule, R2StorageModule],
  controllers: [ReaderController, ReaderControlController, ReaderNavigationController, RetinaReaderController, DrmChunkController],
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
      // Phase 055: Brotli chunk gateway (entitled SVG via ReaderService +
      // Redis 24h brotli cells; zero new infra).
      provide: LowBandwidthReaderService,
      useFactory: (reader: ReaderService, edge: RedisClusterService): LowBandwidthReaderService => {
        const source: LowBandwidthChunkSource = {
          fetchSvg: (productId, pageNumber, userId, tenantId) =>
            reader.getEbookPageChunk(userId, tenantId, productId, pageNumber).then((p) => p.vectorSvgContent),
        };
        const cache: LowBandwidthChunkCache = {
          getBuffer: (key) => edge.getBuffer(key),
          setBuffer: (key, value, ttl) => edge.set(key, value, 'EX', ttl).then(() => undefined),
        };
        return new LowBandwidthReaderService(source, cache);
      },
      inject: [ReaderService, RedisClusterService],
    },
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
    DrmReaderResolver,
    PixelMatrixGeneratorService,
    {
      provide: CanvasShufflingService,
      useFactory: (
        prisma: PrismaService,
        edge: RedisClusterService,
        vault: R2StorageService,
        matrices: PixelMatrixGeneratorService,
      ): CanvasShufflingService =>
        new CanvasShufflingService(
          matrices,
          prisma as never,
          {
            get: (key: string) => edge.get(key),
            set: (key: string, value: string, ...args: Array<string | number>) => edge.set(key, value, ...args),
          },
          { presignedGetUrl: (objectKey: string, ttl: number) => vault.presignedGetUrl(objectKey, ttl) },
        ),
      inject: [PrismaService, RedisClusterService, R2StorageService, PixelMatrixGeneratorService],
    },
    RetinaScalerService,
    {
      provide: VectorChunkService,
      useFactory: (prisma: PrismaService, edge: RedisClusterService, vault: R2StorageService): VectorChunkService =>
        new VectorChunkService(
          prisma as never,
          {
            get: (key: string) => edge.get(key),
            set: (key: string, value: string, ...args: Array<string | number>) => edge.set(key, value, ...args),
          },
          {
            getFileAsString: async (objectKey: string) => vault.getObjectText(objectKey).catch(() => null),
          },
        ),
      inject: [PrismaService, RedisClusterService, R2StorageService],
    },
    ReaderPreferenceResolver,
    {
      provide: ReaderPreferenceService,
      useFactory: (prisma: PrismaService): ReaderPreferenceService =>
        new ReaderPreferenceService(prisma as never),
      inject: [PrismaService],
    },
  ],
  exports: [ReaderService, SlidingWindowCacheService, ReaderControlService, LowBandwidthReaderService, ReaderPreferenceService, VectorChunkService, RetinaScalerService, CanvasShufflingService, PixelMatrixGeneratorService],
})
export class ReaderModule {}
