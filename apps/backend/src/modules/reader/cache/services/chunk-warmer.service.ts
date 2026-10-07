// SSOT Phase 039 Task 39.4 — ChunkWarmerService (R2 miss fallback + pre-warm)
// Canonical: apps/backend/src/modules/reader/cache/services/chunk-warmer.service.ts
// - BDD-2: edge MISS → zero-egress R2 vault read → gzip-warm edge (<50ms
//   best-effort, never blocks the reader response).
// - §7.1 AI predictive seam: warmReadAhead() pre-warms the next N pages.
// - R2 read arrives via injected R2ChunkReader (production: R2StorageService
//   getObjectText bound in ChunkCacheModule; tests: in-memory fake).
import { Injectable, Logger } from '@nestjs/common';
import {
  chunkR2ObjectKey,
  CHUNK_CACHE_TTL_SEC,
  slidingWindowPages,
  type ChunkCacheKeyParams,
  type RedisChunkPayload,
} from '@repo/shared';
import type { R2ChunkReader } from '../interfaces/chunk-cache.interface';
import { RedisEdgeService } from './redis-edge.service';

@Injectable()
export class ChunkWarmerService {
  private readonly logger = new Logger(ChunkWarmerService.name);

  // NOTE: Module wires via useFactory (no param decorators — tsx-safe, see above).
  constructor(
    private readonly edge: RedisEdgeService,
    private readonly r2Reader?: R2ChunkReader,
  ) {}

  /** Reader-facing path: HIT returns instantly; MISS warms from R2 vault. */
  async getOrWarm(params: ChunkCacheKeyParams): Promise<RedisChunkPayload | null> {
    const hit = await this.edge.getPageChunk(params);
    if (hit) return hit;
    if (!this.r2Reader) return null;
    try {
      const vectorSvgContent = await this.r2Reader(chunkR2ObjectKey(params.productId, params.pageNumber));
      if (!vectorSvgContent) return null;
      const payload: RedisChunkPayload = {
        pageNumber: params.pageNumber,
        vectorSvgContent,
        compressedSizeByte: Buffer.byteLength(vectorSvgContent, 'utf-8'),
        isEncrypted: true,
        cachedAt: new Date().toISOString(),
        ttlSeconds: CHUNK_CACHE_TTL_SEC,
      };
      // Async warm — the caller already holds the payload; edge SET must not
      // gate the canvas render path.
      void this.edge.setPageChunk(params, payload).catch(() => undefined);
      return payload;
    } catch (error) {
      this.logger.error(`[Chunk Warmer MISS-FALLBACK ERROR] ${params.productId}#${params.pageNumber}`, error as Error);
      return null;
    }
  }

  /** Sliding-window + predictive read-ahead warm (N-1,N,N+1 plus next N). */
  async warmReadAhead(base: ChunkCacheKeyParams, readAhead = 2): Promise<number> {
    if (!this.r2Reader) return 0;
    const targets = new Set<number>(slidingWindowPages(base.pageNumber));
    for (let i = 1; i <= Math.max(0, readAhead); i += 1) targets.add(base.pageNumber + i);
    let warmed = 0;
    for (const page of [...targets].sort((a, b) => a - b)) {
      const params: ChunkCacheKeyParams = { ...base, pageNumber: page };
      const existing = await this.edge.getPageChunk(params);
      if (existing) continue;
      const warmedPayload = await this.getOrWarm(params);
      if (warmedPayload) warmed += 1;
    }
    this.logger.debug(`[Chunk Warmer READ-AHEAD] ${base.productId} +${warmed} pages`);
    return warmed;
  }
}
