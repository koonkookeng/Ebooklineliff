// SSOT Phase 125 Task 6 §6.1 — edge-aware canvas chunk fetcher
// Canonical: apps/frontend/components/reader/EdgeAwareCanvasReader.tsx
// (legacy src/frontend/components/reader/EdgeAwareCanvasReader.tsx)
// - Fetches page SVG through the edge proxy (/api/edge/reader/chunk),
//   shows the serving-region badge, renders to canvas with strict blob
//   revocation (<30MB RAM discipline, 040 precedent). The 040 CanvasReader
//   core stays untouched — this is the edge-routing shell.
// - Zero new deps.
'use client';

import React, { useEffect, useRef, useState } from 'react';

interface EdgeChunkResponse {
  pageNumber: number;
  vectorSvgContent: string;
  servedFromRegion: string;
}

export const EdgeAwareCanvasReader: React.FC<{ productId: string; page: number }> = ({ productId, page }) => {
  const [svgData, setSvgData] = useState<string | null>(null);
  const [region, setRegion] = useState<string>('EDGE_DETECTING');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let isCancelled = false;

    const fetchChunkFromEdge = async (): Promise<void> => {
      try {
        const response = await fetch(
          `/api/edge/reader/chunk?productId=${encodeURIComponent(productId)}&page=${page}`,
          { headers: { 'x-client-intent': 'EBOOK_READ' } },
        );
        if (!response.ok) throw new Error(`Edge chunk ${response.status}`);
        const data = (await response.json()) as EdgeChunkResponse;
        if (!isCancelled && data.vectorSvgContent) {
          setSvgData(data.vectorSvgContent);
          setRegion(data.servedFromRegion ?? 'EDGE_UNKNOWN');
        }
      } catch {
        if (!isCancelled) setRegion('EDGE_FALLBACK');
      }
    };

    void fetchChunkFromEdge();
    return () => {
      isCancelled = true;
    };
  }, [productId, page]);

  useEffect(() => {
    if (!svgData || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
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
  }, [svgData]);

  return (
    <div className="flex flex-col items-center">
      <div className="text-xs text-muted-foreground mb-1" role="status">Node: {region}</div>
      <canvas ref={canvasRef} width={800} height={1200} className="border shadow-md max-w-full" />
    </div>
  );
};

export default EdgeAwareCanvasReader;
