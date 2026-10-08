// SSOT Phase 056 §6.3 — Adaptive canvas reader (LIFF <30MB ↔ Web high-perf)
// Canonical: apps/frontend/components/reader/AdaptiveCanvasReader.tsx
// (legacy src/frontend/components/reader/AdaptiveCanvasReader.tsx)
// - Sliding window: LIFF N-1..N+1 (strict 30MB, blob revoked immediately),
//   Web N-2..N+2 (spread workspace). GC N-2: evicted pages drop out of the
//   Map and canvas.width resets force-clear the buffer on unmount.
// - Forensic watermark overlay (user-verified line + LIFF flag) per §8.1.
// - Keyboard via useReaderNavigation central engine (store bus); swipe bar on LIFF.
// - Zero new deps.
'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { isLiffEnvironment, viewportSlidingWindowPages, type ViewportCapabilities } from '@repo/shared';
import { useReaderStore } from '../../stores/useReaderStore';

interface AdaptiveCanvasReaderProps {
  productId: string;
  initialPage: number;
  capabilities: ViewportCapabilities;
}

export const AdaptiveCanvasReader: React.FC<AdaptiveCanvasReaderProps> = ({
  productId,
  initialPage,
  capabilities,
}) => {
  const [currentPage, setCurrentPage] = useState<number>(initialPage);
  const [chunksMap, setChunksMap] = useState<Map<number, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeBlobUrlRef = useRef<string | null>(null);
  const chunksRef = useRef(chunksMap);
  chunksRef.current = chunksMap;

  const isLiffMode = capabilities.isLiff || isLiffEnvironment(capabilities.environment);

  const renderCanvasPage = useCallback(
    (svgContent?: string) => {
      if (!svgContent || !canvasRef.current) return;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      if (activeBlobUrlRef.current) {
        URL.revokeObjectURL(activeBlobUrlRef.current);
        activeBlobUrlRef.current = null;
      }
      const img = new Image();
      const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      activeBlobUrlRef.current = url;
      img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        ctx.font = '14px sans-serif';
        ctx.fillStyle = 'rgba(150, 150, 150, 0.25)';
        ctx.fillText(`USER-VERIFIED | LIFF: ${capabilities.isLiff}`, 40, canvas.height - 40);
        if (isLiffMode) {
          URL.revokeObjectURL(url);
          activeBlobUrlRef.current = null;
        }
      };
      img.src = url;
    },
    [capabilities.isLiff, isLiffMode],
  );

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      setFailed(false);
      try {
        const windowRange = viewportSlidingWindowPages(currentPage, isLiffMode);
        const next = new Map<number, string>();
        for (const page of windowRange) {
          const cached = chunksRef.current.get(page);
          if (cached) {
            next.set(page, cached);
          } else {
            const res = await fetch(
              `/api/reader/chunk?productId=${encodeURIComponent(productId)}&page=${page}`,
            );
            if (!res.ok) throw new Error(`chunk ${res.status}`);
            const data = (await res.json()) as { vectorSvgContent?: string; svg?: string };
            next.set(page, data.vectorSvgContent ?? data.svg ?? '');
          }
        }
        if (!mounted) return;
        setChunksMap(next);
        renderCanvasPage(next.get(currentPage));
      } catch {
        if (mounted) setFailed(true);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void load();
    return () => {
      mounted = false;
    };
  }, [currentPage, productId, isLiffMode, renderCanvasPage, retryNonce]);

  // Strict GC: force-clear the canvas buffer on unmount (LINE Webview guard).
  useEffect(
    () => () => {
      if (activeBlobUrlRef.current) {
        URL.revokeObjectURL(activeBlobUrlRef.current);
        activeBlobUrlRef.current = null;
      }
      const canvas = canvasRef.current;
      if (canvas) canvas.width = canvas.width;
    },
    [],
  );

  // Atomic Phase 059: store is the single paging bus (gesture mapper /
  // ReaderKeyboardHandler). Adopt external turns; the legacy inline keydown
  // moved to useReaderNavigation (focus-guard + throttle + full keymap) so
  // Web never double-fires a page turn.
  const storePage = useReaderStore((s) => s.currentPage);
  const seededRef = useRef(false);
  useEffect(() => {
    // First run: seed the bus from the route (?page=); later runs adopt
    // external turns (ReaderKeyboardHandler) into local state.
    if (!seededRef.current) {
      seededRef.current = true;
      if (storePage !== initialPage) {
        try {
          useReaderStore.setCurrentPageExact(initialPage);
        } catch {
          // store sync best-effort
        }
      }
      return;
    }
    setCurrentPage((p) => (p === storePage ? p : storePage));
  }, [storePage, initialPage]);

  return (
    <div className={`relative flex h-full w-full flex-col ${isLiffMode ? 'bg-black text-white' : 'bg-gray-100 text-gray-900'}`}>
      <div className="flex h-14 items-center justify-between border-b px-4">
        <span className="text-sm font-semibold">Mode: {capabilities.environment}</span>
        <span className="text-xs text-muted-foreground">RAM Budget: {capabilities.maxRamBudgetMB}MB</span>
      </div>
      <div className="flex flex-1 items-center justify-center overflow-hidden p-2">
        {loading && !chunksMap.get(currentPage) ? (
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" aria-busy />
        ) : (
          <canvas
            ref={canvasRef}
            width={800}
            height={1200}
            className={`max-h-full max-w-full rounded shadow-lg transition-transform ${isLiffMode ? 'touch-pan-y' : ''}`}
          />
        )}
      </div>
      {failed && (
        <div role="alert" className="mx-4 mb-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs">
          โหลดหน้านี้ไม่สำเร็จ
          <button onClick={() => setRetryNonce((n) => n + 1)} className="ml-2 font-bold">
            ลองใหม่
          </button>
        </div>
      )}
      <div className={`flex items-center justify-between px-6 py-4 ${isLiffMode ? 'bg-zinc-900' : 'bg-white border-t'}`}>
        <button
          onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
          className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90"
        >
          ก่อนหน้า
        </button>
        <span className="text-sm font-medium">หน้า {currentPage}</span>
        <button
          onClick={() => setCurrentPage((p) => p + 1)}
          className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90"
        >
          ถัดไป
        </button>
      </div>
    </div>
  );
};

export default AdaptiveCanvasReader;
