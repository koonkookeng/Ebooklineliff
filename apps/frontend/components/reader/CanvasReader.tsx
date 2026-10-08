'use client';
/**
 * Phase 000 — Memory-safe Canvas reader (<30MB): window [N-1,N,N+1], GC N-2, forensic watermark.
 * States: LIFF_INIT -> IDLE -> LOADING -> SUCCESS / ERROR (retry).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useReaderStore } from '../../stores/useReaderStore';
import { useViewportKeepAlive } from '../keep-alive/useKeepAlive';
import { releaseBlobUrls } from '../../lib/keep-alive/keep-alive-client';
import { ForensicWatermark } from './watermark/ForensicWatermark';

type UiState = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

interface ChunkWire {
  vectorSvgContent: string;
  forensicWatermark?: { watermarkText: string; userIdHash: string };
}

export default function CanvasReader({ productId, userIdHash }: { productId: string; userIdHash: string }) {
  const [page, setPage] = useState(1);
  // Atomic Phase 059: adopt store-driven navigation (gesture mapper /
  // slider / keyboard) as the single paging bus; local buttons write back.
  const storePage = useReaderStore((s) => s.currentPage);
  useEffect(() => {
    if (storePage !== pageRef.current) setPage(storePage);
  }, [storePage]);
  const turnTo = useCallback((next: number) => {
    setPage(next);
    try {
      useReaderStore.setCurrentPageExact(next);
    } catch {
      // store sync is best-effort; canvas already turned
    }
  }, []);
  const [ui, setUi] = useState<UiState>('IDLE');
  const [error, setError] = useState<string | null>(null);
  const [watermark, setWatermark] = useState<{ watermarkText: string; userIdHash: string } | null>(null);
  const cache = useRef(new Map<number, string>());
  const blobUrls = useRef(new Map<number, string>());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pageRef = useRef(page);
  pageRef.current = page;

  // Phase 031 Task 5: viewport keep-alive (page + scroll survive LINE chat
  // switches; blob/canvas RAM released on hidden, reloaded by sliding window).
  const keepAlive = useViewportKeepAlive({
    viewportType: 'EBOOK_READER',
    resourceId: productId,
    snapshot: () => ({
      productId,
      currentPage: pageRef.current,
      scrollOffsetTop: typeof window !== 'undefined' ? window.scrollY : 0,
      zoomScale: 1,
    }),
    rehydrate: (s) => {
      if (s.currentPage !== pageRef.current) {
        setPage(s.currentPage);
        try {
          useReaderStore.setCurrentPageExact(s.currentPage);
        } catch {
          // store sync best-effort
        }
      }
      if (s.scrollOffsetTop > 0 && typeof window !== 'undefined') window.scrollTo(0, s.scrollOffsetTop);
    },
    release: () => {
      releaseBlobUrls(blobUrls.current);
      const canvas = canvasRef.current;
      canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    },
  });

  const loadSlidingWindow = useCallback(
    async (currentPage: number) => {
      setUi('LOADING');
      setError(null);
      setWatermark(null);
      try {
        const targets = [currentPage - 1, currentPage, currentPage + 1].filter((p) => p > 0);
        const next = new Map<number, string>();
        for (const p of targets) {
          if (cache.current.has(p)) {
            next.set(p, cache.current.get(p)!);
            continue;
          }
          const res = await fetch(`/api/reader/chunk?productId=${productId}&page=${p}`);
          if (!res.ok) throw new Error(`chunk ${p}: ${res.status}`);
          const data = (await res.json()) as ChunkWire;
          next.set(p, data.vectorSvgContent as string);
          // Phase 040: entitled payloads carry the dynamic forensic watermark
          // (v1 route); legacy edge payloads omit it and keep the data-attr div.
          if (p === currentPage && data.forensicWatermark?.watermarkText && data.forensicWatermark?.userIdHash) {
            setWatermark({
              watermarkText: data.forensicWatermark.watermarkText,
              userIdHash: data.forensicWatermark.userIdHash,
            });
          }
        }
        // GC N-2: revoke blob URL + clear canvas (RAM < 30MB)
        for (const [p, url] of blobUrls.current) {
          if (!next.has(p)) {
            URL.revokeObjectURL(url);
            blobUrls.current.delete(p);
          }
        }
        const ctx = canvasRef.current?.getContext('2d');
        ctx?.clearRect(0, 0, canvasRef.current!.width, canvasRef.current!.height);
        cache.current = next;
        setUi('SUCCESS');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'load failed');
        setUi('ERROR');
      }
    },
    [productId],
  );

  useEffect(() => {
    void loadSlidingWindow(page);
  }, [page, loadSlidingWindow]);

  return (
    <div>
      {keepAlive.status === 'HYDRATING' && <div aria-busy>Skeleton restoring page…</div>}
      {keepAlive.status === 'ERROR_FALLBACK' && <div role="status">กู้คืนหน้าจอล่าสุดสำเร็จ</div>}
      {ui === 'LOADING' && <div aria-busy>Skeleton loading page {page}…</div>}
      {ui === 'ERROR' && (
        <div role="alert">
          {error} <button onClick={() => void loadSlidingWindow(page)}>Retry</button>
        </div>
      )}
      <div className="relative">
        <canvas ref={canvasRef} width={390} height={844} aria-label={`ebook page ${page}`} />
        {watermark && (
          <ForensicWatermark watermarkText={watermark.watermarkText} userIdHash={watermark.userIdHash} />
        )}
      </div>
      <div
        aria-hidden
        style={{ pointerEvents: 'none' }}
        data-watermark={`${userIdHash}-${Date.now()}`}
      />
      <nav>
        <button disabled={page <= 1} onClick={() => turnTo(Math.max(1, page - 1))}>Prev</button>
        <span>{page}</span>
        <button onClick={() => turnTo(page + 1)}>Next</button>
      </nav>
    </div>
  );
}
