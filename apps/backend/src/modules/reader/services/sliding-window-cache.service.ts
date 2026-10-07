// SSOT Phase 040 BDD-1/BDD-2 — SlidingWindowCacheService (window orchestration)
// Canonical: apps/backend/src/modules/reader/services/sliding-window-cache.service.ts
// - Server-side mirror of the canvas window: fetchWindow() resolves [N-1,N,N+1]
//   through the Phase 039 edge (HIT) → R2 warm (MISS) path and reports which
//   pages the client must evict (GC N-2 rule).
// - Pure orchestration over injected ports; tsx-safe (no param decorators).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import {
  readerEvictedPages,
  readerWindowPages,
  type ChunkCacheKeyParams,
  type RedisChunkPayload,
} from '@repo/shared';
import { ChunkWarmerService } from '../cache/services/chunk-warmer.service';

export interface ReaderWindow {
  pages: number[];
  chunks: Map<number, RedisChunkPayload>;
  evicted: number[];
}

@Injectable()
export class SlidingWindowCacheService {
  // NOTE: Module wires via useFactory (no param decorators — tsx-safe).
  constructor(private readonly warmer?: ChunkWarmerService) {}

  windowFor(currentPage: number): number[] {
    return readerWindowPages(currentPage);
  }

  async fetchWindow(
    tenantId: string,
    productId: string,
    currentPage: number,
    previousPages: number[] = [],
  ): Promise<ReaderWindow> {
    const pages = readerWindowPages(currentPage);
    const chunks = new Map<number, RedisChunkPayload>();
    if (!this.warmer) return { pages, chunks, evicted: readerEvictedPages(previousPages, pages) };
    for (const page of pages) {
      const params: ChunkCacheKeyParams = { tenantId, productId, pageNumber: page };
      const payload = await this.warmer.getOrWarm(params).catch(() => null);
      if (payload) chunks.set(page, payload);
    }
    return { pages, chunks, evicted: readerEvictedPages(previousPages, pages) };
  }
}
