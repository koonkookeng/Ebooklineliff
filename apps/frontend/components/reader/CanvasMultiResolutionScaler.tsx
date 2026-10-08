// SSOT Phase 060 §6.2 — CanvasMultiResolutionScaler (Retina render core)
// Canonical: apps/frontend/components/reader/CanvasMultiResolutionScaler.tsx
// (legacy src/frontend/components/reader/CanvasMultiResolutionScaler.tsx)
// - 5 states: LIFF_INIT (DPR probe) → LOADING (variant fetch) → SUCCESS
//   (ctx.scale(dpr) vector blit + watermark) / ERROR (crisp-downsample
//   fallback + toast; IDB offline cell first).
// - RAM: single live canvas + revoke-on-turn + unmount evict (<30MB).
// - Telemetry: render latency + footprint beacon (§7.1, best-effort).
// - Zero new deps.
'use client';

import React, { useEffect, useRef, useState } from 'react';
import { SCALER_WATERMARK_OPACITY } from '@repo/shared';
import { useRetinaCanvasScaler } from '../../hooks/useRetinaCanvasScaler';
import { applyMatrixToCanvas, evictCanvas } from './DynamicDprManager';
import { fetchRetinaChunk, reportRenderMetrics } from '../../lib/reader/retina-chunk-client';

type ScalerState = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

interface CanvasMultiResolutionScalerProps {
  productId: string;
  currentPage: number;
  userId?: string;
  maxDprCap?: number;
}

export const CanvasMultiResolutionScaler: React.FC<CanvasMultiResolutionScalerProps> = ({
  productId,
  currentPage,
  maxDprCap = 3.0,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const blobRef = useRef<string | null>(null);
  const { matrix, status: dprStatus } = useRetinaCanvasScaler({ containerRef, maxDprCap });
  const [state, setState] = useState<ScalerState>('LIFF_INIT');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState('LOADING');
    setError(null);
    const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
    fetchRetinaChunk({
      productId,
      page: currentPage,
      deviceDpr: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
      cssWidth: matrix.cssWidth,
      cssHeight: matrix.cssHeight,
    })
      .then((data) => {
        if (cancelled) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) {
          setState('ERROR');
          return;
        }
        // Revoke the previous blob BEFORE resizing (evict-after-resize
        // would wipe the fresh backing store).
        if (blobRef.current) {
          try {
            URL.revokeObjectURL(blobRef.current);
          } catch {
            // revoke best-effort
          }
          blobRef.current = null;
        }
        applyMatrixToCanvas(canvas, ctx, matrix);
        const img = new Image();
        const url = URL.createObjectURL(new Blob([data.vectorSvgContent], { type: 'image/svg+xml;charset=utf-8' }));
        blobRef.current = url;
        img.onload = () => {
          if (cancelled) {
            URL.revokeObjectURL(url);
            return;
          }
          ctx.clearRect(0, 0, matrix.cssWidth, matrix.cssHeight);
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, matrix.cssWidth, matrix.cssHeight);
          ctx.drawImage(img, 0, 0, matrix.cssWidth, matrix.cssHeight);
          ctx.save();
          ctx.font = '12px Inter, sans-serif';
          ctx.fillStyle = `rgba(120, 120, 120, ${SCALER_WATERMARK_OPACITY})`;
          ctx.rotate((-25 * Math.PI) / 180);
          for (let x = -matrix.cssWidth; x < matrix.cssWidth * 2; x += 180) {
            for (let y = -matrix.cssHeight; y < matrix.cssHeight * 2; y += 120) {
              ctx.fillText(data.forensicWatermarkData.watermarkText, x, y);
            }
          }
          ctx.restore();
          setState('SUCCESS');
          const latency = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started;
          reportRenderMetrics({
            productId,
            page: currentPage,
            latencyMs: Math.round(latency),
            ramMb: matrix.canvasMemoryMb,
            dpr: matrix.targetDpr,
          });
        };
        img.onerror = () => {
          if (!cancelled) {
            setError('เรนเดอร์หน้าไม่สำเร็จ — ลองใหม่อีกครั้ง');
            setState('ERROR');
          }
        };
        img.src = url;
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'โหลดหน้าไม่สำเร็จ');
        setState('ERROR');
      });
    return () => {
      cancelled = true;
    };
  }, [productId, currentPage, matrix]);

  useEffect(
    () => () => {
      blobRef.current = evictCanvas(canvasRef.current, blobRef.current);
    },
    [],
  );

  return (
    <div ref={containerRef} className="relative flex h-full w-full items-center justify-center overflow-hidden bg-neutral-100 dark:bg-neutral-900">
      {(state === 'LIFF_INIT' || state === 'LOADING' || dprStatus === 'LIFF_INIT') && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 backdrop-blur-sm dark:bg-black/60" aria-busy>
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
        </div>
      )}
      <canvas ref={canvasRef} aria-label={`ebook page ${currentPage}`} className="shadow-2xl transition-all duration-200 ease-out" />
      {state === 'ERROR' && error && (
        <div role="alert" className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-full bg-slate-900 px-4 py-1 text-[11px] text-white">
          {error}
        </div>
      )}
    </div>
  );
};

export default CanvasMultiResolutionScaler;
