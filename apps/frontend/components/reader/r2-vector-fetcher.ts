// SSOT Phase 036 Task 7/§6.1 — R2 sliding-window chunk fetcher (<30MB RAM)
// Canonical: apps/frontend/components/reader/r2-vector-fetcher.ts
// (legacy src/frontend/components/reader/r2-vector-fetcher.ts)
// - 3-page window [N-1, N, N+1]: out-of-window entries evicted on every fetch
//   (GC discipline mirrors CanvasReader; RAM stays < 30MB, Gate 5).
// - Transport is the vault proxy (/api/v1/media-vault/chunk — JWT cookie binds
//   identity; preview pages stay server-gated, Gate 4).
// - Zero new deps (fetch only). Framework-free: unit-tested without React.
export interface R2VectorChunkResponse {
  pageNumber: number;
  vectorSvgContent: string;
  watermarkData: {
    watermarkText: string;
    timestamp: string;
  };
  preview?: boolean;
}

export class R2CanvasChunkFetcher {
  private readonly memoryCache = new Map<number, R2VectorChunkResponse>();
  private readonly maxMemoryPages = 3;

  constructor(
    private readonly productId: string,
    private readonly proxyBase = '/api/v1/media-vault',
  ) {
    if (!productId) throw new Error('Missing product id');
  }

  get cachedPages(): number[] {
    return [...this.memoryCache.keys()].sort((a, b) => a - b);
  }

  async fetchPageChunk(pageNumber: number): Promise<R2VectorChunkResponse> {
    if (!Number.isInteger(pageNumber) || pageNumber <= 0) throw new Error(`Invalid page ${pageNumber}`);
    const hit = this.memoryCache.get(pageNumber);
    if (hit) return hit;
    const res = await fetch(
      `${this.proxyBase}/chunk?productId=${encodeURIComponent(this.productId)}&page=${pageNumber}`,
      { headers: { Accept: 'application/json', 'X-LIFF-Client': 'true' } },
    );
    if (!res.ok) throw new Error(`Failed to load page ${pageNumber} from R2 Vault (${res.status})`);
    const data = (await res.json()) as R2VectorChunkResponse;
    if (typeof data.vectorSvgContent !== 'string' || !data.vectorSvgContent) {
      throw new Error(`Empty vector payload for page ${pageNumber}`);
    }
    this.memoryCache.set(pageNumber, data);
    this.evictOutOfBoundsPages(pageNumber);
    return data;
  }

  /** Prefetch the window around N (fire-and-forget warm, never throws). */
  async prefetchWindow(pageNumber: number): Promise<void> {
    const targets = [pageNumber - 1, pageNumber, pageNumber + 1].filter((p) => p > 0);
    await Promise.allSettled(targets.map((p) => this.fetchPageChunk(p).catch(() => undefined)));
  }

  private evictOutOfBoundsPages(currentPage: number): void {
    if (this.memoryCache.size <= this.maxMemoryPages) return;
    const valid = new Set([currentPage - 1, currentPage, currentPage + 1]);
    for (const key of this.memoryCache.keys()) {
      if (!valid.has(key)) this.memoryCache.delete(key);
    }
  }
}
