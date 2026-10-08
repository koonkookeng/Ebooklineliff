// SSOT Phase 055 §6.1 — adaptive canvas reader shell (badge + low-data mode)
// Canonical: apps/frontend/components/reader/CanvasReaderEngine.tsx
// (legacy src/frontend/components/reader/CanvasReaderEngine.tsx)
// - Normal links render the full CanvasReader (Phase 040 sliding window,
//   untouched). Low-data mode (or SLOW_2G) renders the compressed view:
//   chunk-compressed REST → DecompressionStream → blob URL → canvas +
//   scalar watermark, with strict revoke discipline (RAM <28MB, §1.3).
// - OFFLINE renders the retry fallback (ERROR_RETRY) with cached-page note.
// - Badge + switch row is DOM-only (<500KB). Zero new deps.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import CanvasReader from './CanvasReader';
import { useNetworkQuality } from '../../hooks/useNetworkQuality';
import { isLowBandwidthTier, type LowBandwidthChunkResponse } from '@repo/shared';

interface CanvasReaderEngineProps {
  productId: string;
  userIdHash: string;
}

async function decompressPayload(base64: string, format: string): Promise<string> {
  if (format === 'RAW_SVG') {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(
    new DecompressionStream(format === 'BROTLI' ? ('br' as unknown as CompressionFormat) : 'gzip'),
  );
  return new Response(stream).text();
}

function CompressedPageView({ productId, userIdHash, tier }: { productId: string; userIdHash: string; tier: string }) {
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const blobRef = useRef<string | null>(null);

  const load = useCallback(
    async (target: number, format: string) => {
      setLoading(true);
      setFailed(false);
      try {
        const res = await fetch(
          `/api/reader/chunk-compressed?productId=${encodeURIComponent(productId)}&page=${target}&network=${tier}&format=${format}`,
        );
        if (!res.ok) throw new Error(`chunk ${res.status}`);
        const data = (await res.json()) as LowBandwidthChunkResponse;
        const svgText = await decompressPayload(data.compressedPayloadBase64, format);
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        if (blobRef.current) URL.revokeObjectURL(blobRef.current);
        const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }));
        blobRef.current = url;
        const img = new Image();
        img.onload = () => {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          ctx.font = '14px sans-serif';
          ctx.fillStyle = 'rgba(150, 150, 150, 0.25)';
          ctx.fillText(`ID: ${data.forensicWatermarkHash || userIdHash} | ${new Date().toISOString()}`, 40, 50);
          setLoading(false);
        };
        img.onerror = () => {
          setLoading(false);
          setFailed(true);
        };
        img.src = url;
        setPage(target);
      } catch {
        setLoading(false);
        setFailed(true);
      }
    },
    [productId, tier, userIdHash],
  );

  useEffect(() => {
    let format = 'BROTLI';
    try {
      // Safari <18 lacks 'br' — probe once, fall back to gzip (§9 native APIs).
      new DecompressionStream('br' as unknown as CompressionFormat);
    } catch {
      format = 'GZIP';
    }
    void load(1, format);
    return () => {
      if (blobRef.current) URL.revokeObjectURL(blobRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, tier]);

  return (
    <div className="mx-auto w-full max-w-lg">
      <div className="relative overflow-hidden rounded-lg border border-slate-700 bg-white">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40" role="status" aria-label="loading page">
            <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-emerald-500" />
          </div>
        )}
        <canvas ref={canvasRef} width={600} height={900} className="h-auto w-full" />
      </div>
      {failed && (
        <p role="alert" className="mt-2 text-center text-xs text-red-400">
          โหลดหน้าไม่สำเร็จ <button type="button" className="underline" onClick={() => void load(page, 'GZIP')}>ลองอีกครั้ง</button>
        </p>
      )}
      <div className="mt-4 flex w-full items-center justify-between px-4">
        <button
          type="button"
          disabled={page <= 1 || loading}
          onClick={() => void load(Math.max(1, page - 1), 'BROTLI')}
          className="min-h-[44px] rounded bg-slate-800 px-4 py-2 text-white disabled:opacity-50"
        >
          หน้าก่อนหน้า
        </button>
        <span className="font-medium text-white">หน้า {page}</span>
        <button
          type="button"
          disabled={loading}
          onClick={() => void load(page + 1, 'BROTLI')}
          className="min-h-[44px] rounded bg-emerald-600 px-4 py-2 text-white disabled:opacity-50"
        >
          หน้าถัดไป
        </button>
      </div>
    </div>
  );
}

export function CanvasReaderEngine({ productId, userIdHash }: CanvasReaderEngineProps) {
  const { tier, online, lowDataMode, setLowDataMode } = useNetworkQuality();
  const degraded = isLowBandwidthTier(tier);

  if (!online || tier === 'OFFLINE') {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-3 rounded-xl bg-slate-900 p-8 text-center" role="alert">
        <p className="font-semibold text-white">สัญญาณขาดหาย</p>
        <p className="text-xs text-slate-400">ดึงหน้าที่แคชไว้จากเครื่องมาแสดงไม่ได้ — กลับมาอ่านต่อเมื่อออนไลน์ หน้าปัจจุบันถูกบันทึกไว้แล้ว</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="min-h-[44px] rounded-md bg-emerald-600 px-4 py-2 text-sm text-white"
        >
          ลองอีกครั้ง
        </button>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="mx-auto mb-2 flex w-full max-w-lg items-center justify-between px-1">
        {degraded ? (
          <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] font-semibold text-amber-300" role="status">
            3G Mode: Low Bandwidth Optimized
          </span>
        ) : (
          <span className="text-[11px] text-slate-500">Full quality</span>
        )}
        <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={lowDataMode}
            onChange={(e) => setLowDataMode(e.target.checked)}
            className="h-4 w-4 accent-emerald-500"
          />
          โหมดประหยัดเน็ต
        </label>
      </div>
      {lowDataMode || tier === 'SLOW_2G' ? (
        <CompressedPageView productId={productId} userIdHash={userIdHash} tier={tier} />
      ) : (
        <CanvasReader productId={productId} userIdHash={userIdHash} />
      )}
    </div>
  );
}

export default CanvasReaderEngine;
