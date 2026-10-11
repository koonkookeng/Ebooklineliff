// SSOT Phase 124 Task 2 §5.1 — auto-fallback Redis wrapper (BDD-1 detect)
// Canonical: apps/backend/src/infra/redis/resilient-redis.client.ts
// (legacy src/backend/infra/resilience/resilient-redis.client.ts)
// - Fail-open reads (fault → null) with a 50ms detection race (BDD-1:
//   reader failover engages within 50ms), best-effort writes, degraded
//   flag for telemetry. Wraps the cluster service structurally (no
//   subclassing — the client stays replaceable in tests).
// - Zero new deps.
import { Injectable, Logger } from '@nestjs/common';
import { CHAOS_READER_FALLBACK_MS } from '@repo/shared';

/** Minimal read/write surface (structural; cluster service satisfies it). */
export interface ResilientRedisPort {
  get(key: string): Promise<string | null>;
  set(key: string, value: string | Buffer, ...args: Array<string | number>): Promise<unknown>;
  del(...keys: string[]): Promise<void>;
}

@Injectable()
export class ResilientRedisClient {
  private readonly logger = new Logger(ResilientRedisClient.name);
  private degraded = false;

  constructor(private readonly redis: ResilientRedisPort) {}

  /** True after a fault was observed (clears on the next success). */
  isDegraded(): boolean {
    return this.degraded;
  }

  /** Fail-open read (null on fault/timeout past the detect budget). */
  async get(key: string, budgetMs = CHAOS_READER_FALLBACK_MS): Promise<string | null> {
    // Ref'd timer + clear (122 lesson: unref'd sole handles exit early).
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const value = await Promise.race([
        this.redis.get(key),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), budgetMs);
        }),
      ]);
      if (value !== null) this.degraded = false;
      return value;
    } catch (err) {
      if (!this.degraded) {
        this.degraded = true;
        this.logger.warn(`Redis fallback engaged: ${(err as Error).message}`);
      }
      return null;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /** Best-effort write (never throws). */
  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(key, value, 'EX', ttlSeconds);
    } catch (err) {
      if (!this.degraded) {
        this.degraded = true;
        this.logger.warn(`Redis write fail-open: ${(err as Error).message}`);
      }
    }
  }
}
