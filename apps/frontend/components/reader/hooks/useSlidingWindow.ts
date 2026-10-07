// SSOT Phase 040 Task 40.3 — useSlidingWindow (memory protocol hook, §6.2)
// Canonical: apps/frontend/components/reader/hooks/useSlidingWindow.ts
// (legacy src/frontend/components/reader/hooks/useSlidingWindow.ts)
// - Spec surface preserved: (productId, currentPage) →
//   { activeChunks, isLoading, memoryUsageMB }; tenantId is an optional third
//   argument (defaults to 'default'; the server prefers the JWT tenant).
// - Cache-first per page (no refetch inside the window), offline IndexedDB
//   fallback (BDD-3), GC outside [N-1,N,N+1] with blob revocation (<30MB).
// - Zero new deps (react only).
'use client';

import { useEffect, useRef, useState } from 'react';
import type { EbookChunkPayload } from '@repo/shared';
import {
  estimateHeapMB,
  evictedPages,
  isOverBudget,
  sweepOutsideWindow,
  windowFor,
} from '../utils/memoryManager';
import { loadChunkOffline, pruneOfflineOutside, saveChunkForOffline } from '../../../lib/reader/offline-chunk-cache';

export function useSlidingWindow(productId: string, currentPage: number, tenantId = 'default') {
  const [activeChunks, setActiveChunks] = useState<Map<number, EbookChunkPayload>>(new Map());
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [memoryUsageMB, setMemoryUsageMB] = useState<number>(0);
  const cacheRef = useRef<Map<number, EbookChunkPayload>>(new Map());
  const blobUrlsRef = useRef<Map<number, string>>(new Map());

  useEffect(() => {
    let isSubscribed = true;

    const executeSlidingWindowProtocol = async (): Promise<void> => {
      if (!productId || currentPage <= 0) return;
      setIsLoading(true);
      // RAM circuit-breaker: skip prefetch when already at the ceiling.
      const heap = estimateHeapMB();
      if (isOverBudget(heap)) {
        sweepOutsideWindow(cacheRef.current, blobUrlsRef.current, [currentPage]);
      }
      const targetPages = windowFor(currentPage);
      const updated = new Map<number, EbookChunkPayload>();

      for (const page of targetPages) {
        const cached = cacheRef.current.get(page);
        if (cached) {
          updated.set(page, cached);
          continue;
        }
        try {
          const response = await fetch(
            `/api/v1/reader/chunk?productId=${encodeURIComponent(productId)}&page=${page}&tenantId=${encodeURIComponent(tenantId)}`,
          );
          if (response.ok) {
            const data = (await response.json()) as EbookChunkPayload;
            updated.set(page, data);
            void saveChunkForOffline(data);
            continue;
          }
        } catch {
          // Network failure → offline fallback below (BDD-3).
        }
        const offline = await loadChunkOffline(productId, page);
        if (offline) updated.set(page, offline);
      }

      if (!isSubscribed) return;
      const evicted = evictedPages([...cacheRef.current.keys()], targetPages);
      for (const page of evicted) {
        const url = blobUrlsRef.current.get(page);
        if (url) {
          try {
            URL.revokeObjectURL(url);
          } catch {
            // Best-effort (memoryManager.sweepOutsideWindow parity).
          }
          blobUrlsRef.current.delete(page);
        }
      }
      cacheRef.current = updated;
      void pruneOfflineOutside(productId, targetPages);
      setActiveChunks(new Map(updated));
      setIsLoading(false);
      const used = estimateHeapMB();
      if (used !== null) setMemoryUsageMB(used);
    };

    void executeSlidingWindowProtocol();

    return () => {
      isSubscribed = false;
    };
  }, [productId, currentPage, tenantId]);

  return { activeChunks, isLoading, memoryUsageMB };
}

export default useSlidingWindow;
