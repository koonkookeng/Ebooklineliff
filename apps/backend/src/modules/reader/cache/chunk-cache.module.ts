// SSOT Phase 039 Task 39.3/39.4 — ChunkCacheModule (edge cache wiring)
// Canonical: apps/backend/src/modules/reader/cache/chunk-cache.module.ts
// (legacy src/backend/modules/reader/cache/chunk-cache.module.ts)
// - RedisEdgeService → global RedisClusterService singleton (no new pool).
// - ChunkWarmerService → R2StorageService.getObjectText (zero-egress vault).
// - Services are wired via useFactory (no Nest parameter decorators inside
//   the service classes, keeping them tsx-importable for contract tests).
// - Hosts the public LIFF chunk controller + guarded invalidate route.
import { Module } from '@nestjs/common';
import { R2StorageModule } from '../../../infra/cloudflare/r2-storage.module';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import { R2StorageService } from '../../../infra/cloudflare/r2-storage.service';
import { ReaderChunkController } from '../controllers/reader-chunk.controller';
import type { EdgeCacheClient } from './interfaces/chunk-cache.interface';
import { RedisEdgeService } from './services/redis-edge.service';
import { ChunkWarmerService } from './services/chunk-warmer.service';

@Module({
  imports: [R2StorageModule],
  controllers: [ReaderChunkController],
  providers: [
    {
      provide: RedisEdgeService,
      useFactory: (cluster: RedisClusterService): RedisEdgeService =>
        new RedisEdgeService(cluster as unknown as EdgeCacheClient),
      inject: [RedisClusterService],
    },
    {
      provide: ChunkWarmerService,
      useFactory: (edge: RedisEdgeService, vault: R2StorageService): ChunkWarmerService =>
        new ChunkWarmerService(edge, vault.getObjectText.bind(vault)),
      inject: [RedisEdgeService, R2StorageService],
    },
  ],
  exports: [RedisEdgeService, ChunkWarmerService],
})
export class ChunkCacheModule {}
