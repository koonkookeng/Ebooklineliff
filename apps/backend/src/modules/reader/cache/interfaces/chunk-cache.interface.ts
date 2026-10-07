// SSOT Phase 039 — chunk-cache port interfaces (DDD ports)
// Canonical: apps/backend/src/modules/reader/cache/interfaces/chunk-cache.interface.ts
// - Minimal client surface so RedisEdgeService is unit-testable with a fake
//   and production-wired to ioredis/RedisClusterService without adaptation.
// - R2ChunkReader abstracts the zero-egress vault seam (Phase 036).
import type { CacheMetrics, ChunkCacheKeyParams, RedisChunkPayload } from '@repo/shared';

/** Nest DI token for the binary-safe edge client (production: RedisClusterService). */
export const EDGE_CACHE_CLIENT = 'EDGE_CACHE_CLIENT';
/** Nest DI token for the zero-egress R2 page reader (production: R2StorageService.getObjectText). */
export const R2_CHUNK_READER = 'R2_CHUNK_READER';

/** Smallest Redis surface the edge service needs (binary-safe). */
export interface EdgeCacheClient {
  getBuffer(key: string): Promise<Buffer | null>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string | Buffer, ...args: Array<string | number>): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  scanKeys?(pattern: string, pageSize?: number): Promise<string[]>;
}

/** Zero-egress origin read (R2 vault text of one page chunk). */
export type R2ChunkReader = (objectKey: string) => Promise<string>;

export interface ChunkCacheReader {
  getPageChunk(params: ChunkCacheKeyParams): Promise<RedisChunkPayload | null>;
}

export interface ChunkCacheWriter {
  setPageChunk(params: ChunkCacheKeyParams, payload: RedisChunkPayload): Promise<void>;
  invalidateEbookCache(tenantId: string, productId: string): Promise<number>;
}

export interface ChunkCacheMetrics {
  snapshot(): CacheMetrics;
  recordHit(latencyMs: number): void;
  recordMiss(latencyMs: number): void;
}
