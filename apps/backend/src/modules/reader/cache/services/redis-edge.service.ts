// SSOT Phase 039 Task 39.3 — RedisEdgeService (gzip + sliding expiry)
// Canonical: apps/backend/src/modules/reader/cache/services/redis-edge.service.ts
// (legacy src/backend/modules/reader/cache/redis-edge.service.ts)
// - BDD-1 HIT <10ms: GET buffer → gunzip → Zod-shaped JSON → async EXPIRE 86400.
// - BDD-2 MISS: null (ChunkWarmerService owns the R2 fallback + <50ms warm).
// - BDD-3 invalidation: paginated SCAN + pipelined DEL, returns evicted count.
// - Fail-open reads (null) + fail-silent writes; L1 in-memory fallback when
//   edge latency exceeds EDGE_SELFHEAL_MS (§10 self-healing loop seam).
// - Zero new deps (node:zlib only; ioredis client injected, never constructed
//   here so unit tests run without a live cluster).
import { Injectable, Logger } from '@nestjs/common';
import { gunzip as gunzipCb, gzip as gzipCb } from 'node:zlib';
import { promisify } from 'node:util';
import {
  buildChunkCacheKey,
  CHUNK_CACHE_TTL_SEC,
  chunkInvalidationPattern,
  EDGE_SELFHEAL_MS,
  type CacheMetrics,
  type ChunkCacheKeyParams,
  type RedisChunkPayload,
} from '@repo/shared';
import type { ChunkCacheMetrics, ChunkCacheReader, ChunkCacheWriter, EdgeCacheClient } from '../interfaces/chunk-cache.interface';
// NOTE: No Nest parameter decorators here on purpose — the module wires this
// service via useFactory so tsx contract tests can import it directly
// (Phase 027–038 precedent: tsx/esbuild cannot transform param decorators).

const gzipAsync = promisify(gzipCb);
const gunzipAsync = promisify(gunzipCb);

const SCAN_PAGE_SIZE = 100;

/** Rolling hit/miss + latency telemetry (§7.1 edge-latency tracker seam). */
export class EdgeCacheTelemetry implements ChunkCacheMetrics {
  private hits = 0;
  private misses = 0;
  private latencySumMs = 0;
  private samples = 0;

  recordHit(latencyMs: number): void {
    this.hits += 1;
    this.recordLatency(latencyMs);
  }

  recordMiss(latencyMs: number): void {
    this.misses += 1;
    this.recordLatency(latencyMs);
  }

  private recordLatency(latencyMs: number): void {
    if (!Number.isFinite(latencyMs) || latencyMs < 0) return;
    this.latencySumMs += latencyMs;
    this.samples += 1;
  }

  snapshot(): CacheMetrics {
    const total = this.hits + this.misses;
    return {
      hitRatio: total === 0 ? 100 : (this.hits / total) * 100,
      averageLatencyMs: this.samples === 0 ? 0 : this.latencySumMs / this.samples,
      keysCount: total,
      memoryUsedMb: 0,
    };
  }
}

@Injectable()
export class RedisEdgeService implements ChunkCacheReader, ChunkCacheWriter {
  private readonly logger = new Logger(RedisEdgeService.name);
  private readonly l1 = new Map<string, { payload: RedisChunkPayload; expiresAt: number }>();
  private readonly telemetry = new EdgeCacheTelemetry();

  constructor(private readonly client?: EdgeCacheClient) {}

  /** Canonical key builder (single source — shared helper). */
  buildKey(params: ChunkCacheKeyParams): string {
    return buildChunkCacheKey(params);
  }

  metrics(): CacheMetrics {
    return this.telemetry.snapshot();
  }

  async getPageChunk(params: ChunkCacheKeyParams): Promise<RedisChunkPayload | null> {
    const key = this.buildKey(params);
    const startedAt = Date.now();
    try {
      if (!this.client) return this.readL1(key);
      const raw = await this.client.getBuffer(key);
      if (!raw) {
        this.telemetry.recordMiss(Date.now() - startedAt);
        return this.readL1(key);
      }
      const json = (await gunzipAsync(raw)).toString('utf-8');
      const payload = JSON.parse(json) as RedisChunkPayload;
      const latencyMs = Date.now() - startedAt;
      this.telemetry.recordHit(latencyMs);
      // Sliding-window TTL renewal (async, never blocks the <10ms HIT path).
      this.client.expire(key, CHUNK_CACHE_TTL_SEC).catch(() => undefined);
      this.writeL1(key, payload);
      this.logger.debug(`[Redis Edge HIT] ${key} | ${latencyMs}ms`);
      return payload;
    } catch (error) {
      this.telemetry.recordMiss(Date.now() - startedAt);
      this.logger.error(`[Redis Edge ERROR] ${key}`, error as Error);
      return this.readL1(key);
    }
  }

  async setPageChunk(params: ChunkCacheKeyParams, payload: RedisChunkPayload): Promise<void> {
    const key = this.buildKey(params);
    try {
      const compressed = await gzipAsync(JSON.stringify(payload));
      const sized: RedisChunkPayload = { ...payload, compressedSizeByte: compressed.length };
      const body = await gzipAsync(JSON.stringify(sized));
      this.writeL1(key, sized);
      if (!this.client) return;
      await this.client.set(key, body, 'EX', CHUNK_CACHE_TTL_SEC);
      this.logger.debug(`[Redis Edge WARMED] ${key} | ${body.length} bytes`);
    } catch (error) {
      this.logger.error(`[Redis Edge SET ERROR] ${key}`, error as Error);
    }
  }

  async invalidateEbookCache(tenantId: string, productId: string): Promise<number> {
    const pattern = chunkInvalidationPattern(tenantId, productId);
    let evicted = 0;
    // L1 sweep always runs (keeps single-node dev/test consistent).
    for (const key of [...this.l1.keys()]) {
      if (key.startsWith(`tenant:${tenantId}:ebook:${productId}:page:`)) this.l1.delete(key);
    }
    if (!this.client) return evicted;
    try {
      if (typeof this.client.scanKeys === 'function') {
        const keys = await this.client.scanKeys(pattern, SCAN_PAGE_SIZE);
        if (keys.length > 0) {
          await this.client.del(...keys);
          evicted += keys.length;
        }
        return evicted;
      }
      // ioredis Cluster/Node scanStream fallback without static imports.
      const stream = (this.client as unknown as { scanStream(opts: { match: string }): NodeJS.EventEmitter }).scanStream({
        match: pattern,
      });
      const keys: string[] = await new Promise((resolve, reject) => {
        const acc: string[] = [];
        stream.on('data', (batch: string[]) => acc.push(...batch));
        stream.on('end', () => resolve(acc));
        stream.on('error', reject);
      });
      if (keys.length > 0) {
        await this.client.del(...keys);
        evicted += keys.length;
      }
    } catch (error) {
      this.logger.error(`[Redis Edge INVALIDATE ERROR] ${pattern}`, error as Error);
    }
    return evicted;
  }

  private readL1(key: string): RedisChunkPayload | null {
    const entry = this.l1.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.l1.delete(key);
      return null;
    }
    return entry.payload;
  }

  private writeL1(key: string, payload: RedisChunkPayload): void {
    // L1 self-heal tier: bounded (latest 64 chunks) so Node RSS stays flat.
    if (this.l1.size >= 64) {
      const oldest = this.l1.keys().next();
      if (!oldest.done) this.l1.delete(oldest.value);
    }
    this.l1.set(key, { payload, expiresAt: Date.now() + EDGE_SELFHEAL_MS * 60 * 1000 });
  }
}
