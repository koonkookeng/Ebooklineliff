// SSOT Phase 124 Task 5 §6.1 — resilient canvas reader (IDB fallback)
// Canonical: apps/frontend/components/reader/ResilientCanvasReader.tsx
// (legacy src/frontend/components/reader/CanvasReader.tsx chaos lane;
//  the 040 CanvasReader core stays untouched — this is the fallback shell)
// - RISK_CALL deviation (documented): native indexedDBEngine (062 lane)
//   instead of idb-keyval (not installed; zero-dep rule). Same behavior:
//   edge fetch (2s timeout) → IndexedDB fallback + degraded banner →
//   Thai offline SVG when both lanes fail. Blob URLs revoked on every
//   swap/unmount (RAM < 30MB discipline).
// - Zero new deps.
'use client';

import React, { useEffect, useRef, useState } from 'react';
import { indexedDBEngine } from '@/lib/pwa/indexeddb-engine';

interface ReaderProps {
  productId: string;
  currentPage: number;
}

const OFFLINE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1200"><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#888">ขออภัย สัญญาณเครือข่ายขัดข้อง กรุณาลองใหม่อีกครั้ง</text></svg>';

export const ResilientCanvasReader: React.FC<ReaderProps> = ({ productId, currentPage }) => {
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [isDegradedMode, setIsDegradedMode] = useState<boolean>(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let active = true;

    const fetchChunkWithFallback = async (): Promise<void> => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);

        const res = await fetch(`/api/reader/chunk?productId=${encodeURIComponent(productId)}&page=${currentPage}`, {
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!res.ok) throw new Error('Edge Server Error');

        const data = (await res.json()) as { vectorSvgContent?: string };
        if (!data.vectorSvgContent) throw new Error('Empty chunk payload');
        if (active) {
          setSvgContent(data.vectorSvgContent);
          setIsDegradedMode(false);
          await indexedDBEngine.cacheEbookChunk(productId, currentPage, data.vectorSvgContent).catch(() => undefined);
        }
      } catch (err) {
        const cachedContent = await indexedDBEngine.getEbookChunk(productId, currentPage).catch(() => null);
        if (active) {
          if (cachedContent) {
            setSvgContent(cachedContent);
            setIsDegradedMode(true);
          } else {
            setSvgContent(OFFLINE_SVG);
            setIsDegradedMode(true);
          }
        }
        if (process.env['NODE_ENV'] === 'development') {
          console.warn(`[Reader Resilience] primary fetch failed, IDB fallback: ${err}`);
        }
      }
    };

    void fetchChunkWithFallback();

    return () => {
      active = false;
    };
  }, [productId, currentPage]);

  useEffect(() => {
    if (!svgContent || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
    };
    img.src = url;

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [svgContent]);

  return (
    <div className="relative flex flex-col items-center">
      {isDegradedMode && (
        <div
          role="status"
          className="bg-amber-500/10 text-amber-600 text-xs px-3 py-1 rounded-full mb-2 border border-amber-500/20"
        >
          โหมดประหยัดพลังงาน (กำลังแสดงผลจาก Local Cache)
        </div>
      )}
      <canvas ref={canvasRef} width={800} height={1200} className="w-full max-w-md shadow-lg rounded-md" />
    </div>
  );
};

export default ResilientCanvasReader;
