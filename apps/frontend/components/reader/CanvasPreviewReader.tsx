'use client';
// SSOT Phase 051 §6.1 — memory-safe canvas preview reader (pages 1–10, paywall at 11)
// Canonical: apps/frontend/components/reader/CanvasPreviewReader.tsx
// (legacy src/frontend/components/reader/CanvasPreviewReader.tsx)
// - Single-page discipline: exactly ONE blob URL alive at a time, revoked on
//   load AND on unmount/page-change (LIFF RAM < 30MB, Gate 5).
// - HTTP 403 PREVIEW_LIMIT_EXCEEDED ⇒ lock viewport + PaywallModal (§2.2).
// - 6 states: LIFF_INIT → IDLE → PREVIEW_ACTIVE → PREVIEW_LIMIT_REACHED /
//   CHECKOUT_PAYWALL / ERROR. Zero new deps.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PREVIEW_EBOOK_DEFAULT_PAGES, remainingQuotaLabel } from '@repo/shared';
import { PaywallModal } from '../checkout/PaywallModal';

export type PreviewReaderUiState =
  | 'LIFF_INIT'
  | 'IDLE'
  | 'PREVIEW_ACTIVE'
  | 'PREVIEW_LIMIT_REACHED'
  | 'CHECKOUT_PAYWALL'
  | 'ERROR';

interface CanvasPreviewReaderProps {
  productId: string;
  productTitle: string;
  price: number;
  discountPrice?: number;
  coverImageUrl: string;
  maxPreviewPages?: number;
}

export function CanvasPreviewReader({
  productId,
  productTitle,
  price,
  discountPrice,
  coverImageUrl,
  maxPreviewPages = PREVIEW_EBOOK_DEFAULT_PAGES,
}: CanvasPreviewReaderProps) {
  const [ui, setUi] = useState<PreviewReaderUiState>('LIFF_INIT');
  const [currentPage, setCurrentPage] = useState(1);
  const [retryNonce, setRetryNonce] = useState(0);
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [watermark, setWatermark] = useState('');
  const [isPaywallOpen, setIsPaywallOpen] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const blobUrlRef = useRef<string | null>(null);

  const revokeBlob = useCallback(() => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  }, []);

  const openPaywall = useCallback(() => {
    setUi('PREVIEW_LIMIT_REACHED');
    setIsPaywallOpen(true);
  }, []);

  useEffect(() => {
    let mounted = true;
    setUi('IDLE');
    const load = async () => {
      try {
        const res = await fetch(
          `/api/v1/preview/ebook/chunk?productId=${encodeURIComponent(productId)}&page=${currentPage}`,
        );
        if (!mounted) return;
        if (res.status === 403) {
          openPaywall();
          return;
        }
        if (!res.ok) {
          setUi('ERROR');
          return;
        }
        const data = (await res.json()) as {
          vectorSvgContent: string;
          forensicWatermarkData: { watermarkText: string };
        };
        revokeBlob();
        setSvgContent(data.vectorSvgContent);
        setWatermark(data.forensicWatermarkData.watermarkText);
        setUi('PREVIEW_ACTIVE');
        // Engagement tick (fail-open; 5s cadence owned by the beat below for video —
        // ebook logs per page view to keep the funnel exact).
        fetch('/api/v1/preview/ebook/events', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ productId, contentType: 'EBOOK', reachedValue: currentPage, action: 'PAGE_VIEW' }),
        }).catch(() => undefined);
      } catch {
        if (mounted) setUi('ERROR');
      }
    };
    void load();
    return () => {
      mounted = false;
    };
  }, [currentPage, retryNonce, productId, openPaywall, revokeBlob]);

  // Render page to canvas + forensic watermark layer; revoke blob instantly.
  useEffect(() => {
    if (!svgContent || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    blobUrlRef.current = url;
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      ctx.font = '16px sans-serif';
      ctx.fillStyle = 'rgba(150, 150, 150, 0.25)';
      ctx.rotate((-20 * Math.PI) / 180);
      ctx.fillText(`PREVIEW MODE - ${watermark}`, 50, 300);
      ctx.rotate((20 * Math.PI) / 180);
      URL.revokeObjectURL(url); // instant GC for < 30MB RAM
      if (blobUrlRef.current === url) blobUrlRef.current = null;
    };
    img.src = url;
    return () => {
      URL.revokeObjectURL(url);
      if (blobUrlRef.current === url) blobUrlRef.current = null;
    };
  }, [svgContent, watermark]);

  // Full sweep on unmount: canvas pixels + blob + state.
  useEffect(() => {
    return () => {
      revokeBlob();
      const canvas = canvasRef.current;
      canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [revokeBlob]);

  if (ui === 'LIFF_INIT' || ui === 'IDLE') {
    return <div role="status" aria-label="loading preview" className="min-h-screen w-full animate-pulse bg-slate-900" />;
  }

  return (
    <div className="relative flex min-h-screen w-full flex-col items-center justify-center bg-slate-900 text-white">
      <div className="absolute left-4 right-4 top-4 z-10 flex items-center justify-between rounded-xl bg-slate-800/80 p-3 backdrop-blur-md">
        <span className="text-xs font-semibold text-amber-400">โหมดทดลองอ่าน (ฟรี {maxPreviewPages} หน้าแรก)</span>
        <span className="font-mono text-xs">{remainingQuotaLabel('EBOOK', currentPage, maxPreviewPages)}</span>
      </div>

      <div className="flex w-full max-w-md items-center justify-center p-2">
        <canvas ref={canvasRef} width={800} height={1200} className="h-auto w-full rounded-lg bg-white shadow-2xl" />
      </div>
      {ui === 'ERROR' && (
        <div role="alert" className="mt-2 text-sm text-red-300">
          ไม่สามารถโหลดเนื้อหาได้{' '}
          <button type="button" className="underline" onClick={() => setRetryNonce((n) => n + 1)}>
            ลองใหม่
          </button>
        </div>
      )}

      <div className="fixed bottom-6 z-10 flex gap-4 rounded-full bg-slate-800/90 px-6 py-3 shadow-lg backdrop-blur-md">
        <button
          type="button"
          onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
          disabled={currentPage === 1}
          className="rounded-lg bg-slate-700 px-4 py-2 text-sm disabled:opacity-40"
        >
          ย้อนกลับ
        </button>
        <button
          type="button"
          onClick={() => {
            if (currentPage >= maxPreviewPages) openPaywall();
            else setCurrentPage((p) => p + 1);
          }}
          className="rounded-lg bg-emerald-500 px-5 py-2 text-sm font-bold text-slate-950 hover:bg-emerald-600"
        >
          {currentPage === maxPreviewPages ? 'สั่งซื้อเพื่ออ่านต่อ' : 'หน้าถัดไป'}
        </button>
      </div>

      <PaywallModal
        isOpen={isPaywallOpen}
        onClose={() => {
          setIsPaywallOpen(false);
          setUi('CHECKOUT_PAYWALL');
        }}
        productTitle={productTitle}
        price={price}
        discountPrice={discountPrice}
        coverImageUrl={coverImageUrl}
        productId={productId}
        reachedMessage={`คุณอ่านตัวอย่างฟรีครบ ${maxPreviewPages} หน้าแล้ว`}
        shareContentType="EBOOK_SUMMARY"
      />
    </div>
  );
}

export default CanvasPreviewReader;
