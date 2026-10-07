// SSOT Phase 040 Task 40.5 — memoryManager (RAM <30MB protocol utils)
// Canonical: apps/frontend/components/reader/utils/memoryManager.ts
// (legacy src/frontend/components/reader/utils/memoryManager.ts)
// - Pure, zero-dep, tsx-testable: window math, GC eviction sets, heap meter.
// - Single budget source: READER_RAM_BUDGET_MB / READER_RAM_WARN_MB (shared).
import {
  READER_RAM_BUDGET_MB,
  READER_RAM_WARN_MB,
  readerEvictedPages,
  readerWindowPages,
} from '@repo/shared';

export { READER_RAM_BUDGET_MB as RAM_BUDGET_MB, READER_RAM_WARN_MB as RAM_WARN_MB };
export { readerWindowPages as windowFor, readerEvictedPages as evictedPages };

interface HeapMeter {
  usedJSHeapSize?: number;
}

/** Heap estimate in MB (Chromium performance.memory; null elsewhere). */
export function estimateHeapMB(): number | null {
  const meter = (globalThis as { performance?: { memory?: HeapMeter } }).performance?.memory;
  if (!meter || typeof meter.usedJSHeapSize !== 'number') return null;
  return meter.usedJSHeapSize / (1024 * 1024);
}

/** True when the reader must stop prefetching and GC immediately. */
export function isOverBudget(heapMB: number | null): boolean {
  return heapMB !== null && heapMB >= READER_RAM_BUDGET_MB;
}

/** True when the RAM badge turns red (§6.1 overlay rule). */
export function isWarning(heapMB: number | null): boolean {
  return heapMB !== null && heapMB >= READER_RAM_WARN_MB;
}

/**
 * Evict every entry outside the new window: revoke its blob URL (GPU/RAM
 * release) and drop it from the map. Returns the evicted page numbers.
 */
export function sweepOutsideWindow<V>(
  cache: Map<number, V>,
  blobUrls: Map<number, string>,
  nextPages: number[],
): number[] {
  const keep = new Set(nextPages);
  const evicted: number[] = [];
  for (const page of [...cache.keys()]) {
    if (keep.has(page)) continue;
    const url = blobUrls.get(page);
    if (url) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // Best-effort: a stale URL must never break the render path.
      }
      blobUrls.delete(page);
    }
    cache.delete(page);
    evicted.push(page);
  }
  return evicted;
}
