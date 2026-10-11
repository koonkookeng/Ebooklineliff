// SSOT Phase 128 §2.2/§6.1 — Redis edge cached-query lane (IDLE < 2ms)
// Canonical: apps/backend/src/infra/redis/cache-query.service.ts
// (legacy src/infra/redis/cache-query.service.ts)
// - query(): cache-aside get-or-compute with TTL; single-flight per key
//   (concurrent misses share one compute); optional serve-stale fallback
//   when both cache and compute fail (ERROR state reads backup cache).
// -DHIT/MISS counters are in-memory (cheap); Redis stays the truth.
// - Ports-based (tsx-importable); wired via useFactory. Zero new deps.
import { Injectable } from '@nestjs/common';

export interface CachedQueryEdgePort {
  get(key: string): Promise<string | null>;
  setex(key: string, ttlSeconds: number, value: string): Promise<void>;
  del(...keys: string[]): Promise<void>;
  scanKeys?(pattern: string, pageSize?: number): Promise<string[]>;
}

export interface CacheQueryStats {
  hits: number;
  misses: number;
  staleServed: number;
}

@Injectable()
export class CacheQueryService {
  private readonly stats: CacheQueryStats = { hits: 0, misses: 0, staleServed: 0 };
  private readonly inflight = new Map<string, Promise<string>>();

  constructor(private readonly edge: CachedQueryEdgePort) {}

  snapshot(): CacheQueryStats {
    return { ...this.stats };
  }

  /** Cache-aside read. compute() runs at most once per key per tick. */
  async query(key: string, ttlSeconds: number, compute: () => Promise<string>): Promise<string> {
    try {
      const hit = await this.edge.get(key);
      if (hit !== null) {
        this.stats.hits += 1;
        return hit;
      }
    } catch {
      /* cache outage => compute through (fail-open) */
    }
    this.stats.misses += 1;
    const running = this.inflight.get(key);
    if (running) return running;
    const task = (async (): Promise<string> => {
      try {
        const fresh = await compute();
        try {
          await this.edge.setex(key, ttlSeconds, fresh);
        } catch {
          /* cache write loss is non-fatal */
        }
        return fresh;
      } catch (err) {
        // Last resort: serve whatever the edge still holds (ERROR-state backup).
        try {
          const stale = await this.edge.get(key);
          if (stale !== null) {
            this.stats.staleServed += 1;
            return stale;
          }
        } catch {
          /* fall through to the original error */
        }
        throw err;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, task);
    return task;
  }

  async invalidate(key: string): Promise<void> {
    try {
      await this.edge.del(key);
    } catch {
      /* best-effort */
    }
  }

  /** Pattern invalidate (e.g. product catalog sweep); no-op without scan. */
  async invalidatePattern(pattern: string): Promise<number> {
    try {
      const keys = (await this.edge.scanKeys?.(pattern, 100)) ?? [];
      if (keys.length > 0) await this.edge.del(...keys);
      return keys.length;
    } catch {
      return 0;
    }
  }
}

/** Compat alias for the scaffold stub name (no behavior change). */
export const CacheQueryServiceService = CacheQueryService;
