// SSOT Phase 124 Task 5 §5.1 — reader paging service (chaos fallback lane)
// Canonical: apps/backend/src/modules/reader/reader-paging.service.ts
// (legacy src/backend/modules/reader/reader-paging.service.ts)
// - Page fetch with graceful degradation: edge cache first (50ms fault
//   detect), R2 direct on cache fault (BDD-1). Returns the degraded flag
//   so the LIFF shell can show the offline-cache banner. The 040 reader
//   core stays untouched — this lane only reorders existing transports.
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { CHAOS_READER_FALLBACK_MS } from '@repo/shared';

export interface PagingCachePort {
  get(key: string): Promise<string | null>;
}

export interface PagingR2Port {
  getObjectText(objectKey: string): Promise<string>;
}

export interface ReaderPageResult {
  productId: string;
  page: number;
  svg: string;
  degraded: boolean;
  source: 'edge-cache' | 'r2-direct';
}

export function readerChunkKey(productId: string, page: number): string {
  return `ebook:chunk:{${productId}}:${page}`;
}

export function readerChunkObject(productId: string, page: number): string {
  return `ebooks/${productId}/page-${page}.svg`;
}

@Injectable()
export class ReaderPagingService {
  constructor(
    private readonly cache: PagingCachePort,
    private readonly r2: PagingR2Port,
  ) {}

  /** Fetch a page (edge → R2 fallback; throws only when both lanes fail). */
  async getPage(productId: string, page: number): Promise<ReaderPageResult> {
    const key = readerChunkKey(productId, page);
    try {
      const hit = await Promise.race([
        this.cache.get(key),
        new Promise<null>((resolve) => {
          setTimeout(() => resolve(null), CHAOS_READER_FALLBACK_MS);
        }),
      ]);
      if (hit) return { productId, page, svg: hit, degraded: false, source: 'edge-cache' };
    } catch {
      // Cache faults fall through to R2 (BDD-1 memory fallback mode).
    }
    const svg = await this.r2.getObjectText(readerChunkObject(productId, page));
    return { productId, page, svg, degraded: true, source: 'r2-direct' };
  }
}

/** Backward-compat alias for the Phase-000 auto-scaffold name. */
export { ReaderPagingService as ReaderPagingServiceService };
