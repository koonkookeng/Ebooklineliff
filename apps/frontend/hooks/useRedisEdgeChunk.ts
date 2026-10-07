// SSOT Phase 039 Task 39.6 — useRedisEdgeChunk (sliding-window canvas hook)
// Canonical: apps/frontend/hooks/useRedisEdgeChunk.ts
// (legacy src/frontend/hooks/useRedisEdgeChunk.ts)
// - Sliding window [N-1, N, N+1] (§2.1); GC revokes N-2 blob URLs instantly
//   so LIFF RAM stays <30MB; at most 3 pages retained in React state.
// - 5-state machine: LIFF_INIT → IDLE → LOADING (skeleton) → SUCCESS
//   (canvas render) / ERROR (IndexedDB fallback seam + toast + retry).
// - Transport: GET /api/reader/chunk?tenantId=&productId=&page=
// - Zero new deps (react only; payload type from @repo/shared).
'use client';

import { useEffect, useRef, useState } from 'react';
import { slidingWindowPages, type RedisChunkPayload } from '@repo/shared';

export type ReaderChunkStatus = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

interface UseRedisEdgeChunkProps {
  tenantId: string;
  productId: string;
  currentPage: number;
}

interface UseRedisEdgeChunkResult {
  chunkMap: Map<number, string>;
  isLoading: boolean;
  status: ReaderChunkStatus;
  error: string | null;
  retry: () => void;
  /** Register a canvas object URL so the N-2 sweep can revoke it (RAM <30MB). */
  trackBlobUrl: (url: string) => void;
}

export function useRedisEdgeChunk({
  tenantId,
  productId,
  currentPage,
}: UseRedisEdgeChunkProps): UseRedisEdgeChunkResult {
  const [chunkMap, setChunkMap] = useState<Map<number, string>>(new Map());
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [status, setStatus] = useState<ReaderChunkStatus>('LIFF_INIT');
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const activeBlobUrls = useRef<string[]>([]);

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    const fetchSlidingWindow = async (): Promise<void> => {
      if (!tenantId || !productId || currentPage <= 0) {
        if (isMounted) {
          setIsLoading(false);
          setStatus('IDLE');
        }
        return;
      }
      if (isMounted) {
        setIsLoading(true);
        setStatus('LOADING');
        setError(null);
      }
      const targetPages = slidingWindowPages(currentPage);
      const newMap = new Map<number, string>();
      let failures = 0;

      for (const page of targetPages) {
        try {
          const res = await fetch(
            `/api/reader/chunk?tenantId=${encodeURIComponent(tenantId)}&productId=${encodeURIComponent(productId)}&page=${page}`,
            { signal: controller.signal },
          );
          if (!res.ok) {
            failures += 1;
            continue;
          }
          const data = (await res.json()) as RedisChunkPayload;
          if (typeof data.vectorSvgContent === 'string' && data.vectorSvgContent.length > 0) {
            newMap.set(page, data.vectorSvgContent);
          } else {
            failures += 1;
          }
        } catch (err) {
          if ((err as Error)?.name === 'AbortError') return;
          failures += 1;
        }
      }

      if (!isMounted) return;
      // Strict memory control (<30MB RAM protection): revoke obsolete blobs
      // for page N-2 before committing the new ≤3-page window.
      for (const url of activeBlobUrls.current) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // revoke is best-effort; a stale URL must never break render.
        }
      }
      activeBlobUrls.current = [];
      setChunkMap(newMap);
      setIsLoading(false);
      if (newMap.size === 0 && failures > 0) {
        setStatus('ERROR');
        setError('Chunk unavailable — offline fallback active');
      } else {
        setStatus('SUCCESS');
      }
    };

    void fetchSlidingWindow();

    return () => {
      isMounted = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, productId, tenantId, attempt]);

  useEffect(() => {
    // LIFF_INIT → IDLE handshake: first mount resolves the splash gate.
    const t = setTimeout(() => {
      setStatus((prev) => (prev === 'LIFF_INIT' ? 'IDLE' : prev));
    }, 0);
    return () => clearTimeout(t);
  }, []);

  return {
    chunkMap,
    isLoading,
    status,
    error,
    retry: () => setAttempt((a) => a + 1),
    trackBlobUrl: (url: string) => {
      activeBlobUrls.current.push(url);
    },
  };
}

export default useRedisEdgeChunk;
