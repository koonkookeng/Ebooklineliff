/**
 * Phase 000 — Redis Edge sliding-window cache [N-1, N, N+1]
 * BDD: deliver encrypted vector SVG chunks, GC N-2 via TTL + explicit del.
 */
import { Injectable } from '@nestjs/common';

const WINDOW_TTL_SEC = 300;

export function slidingWindow(currentPage: number): number[] {
  return [currentPage - 1, currentPage, currentPage + 1].filter((p) => p > 0);
}

@Injectable()
export class EdgeCacheService {
  // Thin wrapper: real Redis client injected in Phase 002 (ioredis). Map fallback for tests.
  private mem = new Map<string, string>();
  constructor(private readonly redis?: { get(k: string): Promise<string | null>; setex(k: string, ttl: number, v: string): Promise<unknown>; del(...k: string[]): Promise<unknown> }) {}

  key(productId: string, page: number): string {
    return `ebook:chunk:${productId}:${page}`;
  }

  async getChunk(productId: string, page: number): Promise<string | null> {
    const k = this.key(productId, page);
    if (this.redis) return this.redis.get(k);
    return this.mem.get(k) ?? null;
  }

  async setChunk(productId: string, page: number, vectorSvg: string): Promise<void> {
    const k = this.key(productId, page);
    if (this.redis) {
      await this.redis.setex(k, WINDOW_TTL_SEC, vectorSvg);
      return;
    }
    this.mem.set(k, vectorSvg);
  }

  /** GC page N-2 after sliding forward — keeps LIFF RAM < 30MB. */
  async gcBehind(productId: string, currentPage: number): Promise<void> {
    const evict = currentPage - 2;
    if (evict <= 0) return;
    const k = this.key(productId, evict);
    if (this.redis) {
      await this.redis.del(k);
      return;
    }
    this.mem.delete(k);
  }
}
