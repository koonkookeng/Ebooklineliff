// SSOT Phase 063 §6.2 — OfflineCanvasReader (IDB chunk render, <30MB RAM)
// Canonical: apps/frontend/components/reader/OfflineCanvasReader.tsx
// (legacy src/frontend/components/reader/OfflineCanvasReader.tsx)
// - 5 states: LIFF_INIT (online probe) → LOADING (IDB cell) → SUCCESS
//   (canvas blit + forensic watermark) / ERROR (not-downloaded hint).
// - Offline cells read from AhongOfflineOmniCacheDB; online falls back to
//   the chunk REST path. Single live canvas + revoke-per-turn (RAM <30MB).
// - Progress auto-queued to pendingSyncRecords for the bg-sync flush.
// - Zero new deps.
'use client';

import React, { useEffect, useRef, useState } from 'react';
import { openOfflineDb, OFFLINE_STORES } from '../../lib/offline/indexeddb-schema';
import { recordOfflineProgress } from '../../lib/offline/offline-manager';

type OfflineReaderState = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

interface OfflineCanvasReaderProps {
  productId: string;
  initialPage: number;
  watermarkText: string;
}

async function readChunkCell(productId: string, page: number): Promise<string | null> {
  try {
    const db = await openOfflineDb();
    const cell = await new Promise<{ encryptedSvgData?: string } | undefined>((resolve) => {
      try {
        const t = db.transaction(OFFLINE_STORES.ebookChunks, 'readonly');
        const req = t.objectStore(OFFLINE_STORES.ebookChunks).get(`${productId}_p${page}`);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    });
    return cell?.encryptedSvgData ?? null;
  } catch {
    return null;
  }
}

export const OfflineCanvasReader: React.FC<OfflineCanvasReaderProps> = ({
  productId,
  initialPage,
  watermarkText,
}) => {
  const [currentPage, setCurrentPage] = useState<number>(initialPage);
  const [isOfflineMode, setIsOfflineMode] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? !navigator.onLine : false,
  );
  const [state, setState] = useState<OfflineReaderState>('LIFF_INIT');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const blobRef = useRef<string | null>(null);

  useEffect(() => {
    const handleOnlineStatus = () => setIsOfflineMode(!navigator.onLine);
    window.addEventListener('online', handleOnlineStatus);
    window.addEventListener('offline', handleOnlineStatus);
    return () => {
      window.removeEventListener('online', handleOnlineStatus);
      window.removeEventListener('offline', handleOnlineStatus);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setState('LOADING');

    const renderPageChunk = async () => {
      let svgContent: string | null = null;
      if (!navigator.onLine || isOfflineMode) {
        svgContent = await readChunkCell(productId, currentPage);
        if (!svgContent && !cancelled) {
          setState('ERROR');
          return;
        }
      } else {
        try {
          const res = await fetch(`/api/reader/chunk?productId=${encodeURIComponent(productId)}&page=${currentPage}`);
          const data = (await res.json()) as { vectorSvgContent?: string };
          svgContent = data.vectorSvgContent ?? null;
        } catch {
          svgContent = await readChunkCell(productId, currentPage);
        }
      }
      if (cancelled || !svgContent || !canvasRef.current) {
        if (!cancelled && !svgContent) setState('ERROR');
        return;
      }
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setState('ERROR');
        return;
      }
      if (blobRef.current) {
        try {
          URL.revokeObjectURL(blobRef.current);
        } catch {
          // revoke best-effort
        }
        blobRef.current = null;
      }
      const img = new Image();
      const url = URL.createObjectURL(new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' }));
      blobRef.current = url;
      img.onload = () => {
        if (cancelled) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        ctx.font = '16px Prompt, sans-serif';
        ctx.fillStyle = 'rgba(180, 180, 180, 0.25)';
        ctx.save();
        ctx.translate(canvas.width / 4, canvas.height / 2);
        ctx.rotate(-Math.PI / 6);
        ctx.fillText(`OFFLINE LICENSED TO: ${watermarkText} (${new Date().toLocaleDateString()})`, 0, 0);
        ctx.restore();
        try {
          URL.revokeObjectURL(url);
        } catch {
          // revoke best-effort
        }
        blobRef.current = null;
        setState('SUCCESS');
        void recordOfflineProgress({
          type: 'EBOOK_PROGRESS',
          targetId: productId,
          payload: { productId, lastPage: currentPage, timestamp: Date.now() },
        });
      };
      img.onerror = () => {
        if (!cancelled) setState('ERROR');
      };
      img.src = url;
    };

    void renderPageChunk();
    return () => {
      cancelled = true;
      if (blobRef.current) {
        try {
          URL.revokeObjectURL(blobRef.current);
        } catch {
          // revoke best-effort
        }
        blobRef.current = null;
      }
    };
  }, [currentPage, productId, isOfflineMode, watermarkText]);

  return (
    <div className="flex flex-col items-center justify-center p-4">
      {state === 'LIFF_INIT' && (
        <div className="mb-3 rounded-full bg-slate-500/10 px-3 py-1 text-xs" aria-busy>
          กำลังตรวจสอบโหมดออฟไลน์…
        </div>
      )}
      {isOfflineMode && state !== 'LIFF_INIT' && (
        <div className="mb-3 rounded-full border border-amber-500 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-500">
          ⚡ โหมดออฟไลน์: กำลังอ่านจาก IndexedDB Cache
        </div>
      )}
      <canvas ref={canvasRef} width={800} height={1130} className="h-auto max-w-full rounded-lg border bg-white shadow-2xl" />
      {state === 'ERROR' && (
        <p role="alert" className="mt-2 text-sm text-red-500">
          หน้า {currentPage} ไม่ได้ถูกดาวน์โหลดไว้สำหรับอ่านออฟไลน์
        </p>
      )}
      <div className="mt-4 flex items-center gap-4">
        <button
          onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
          className="rounded-lg bg-slate-800 px-4 py-2 text-white disabled:opacity-50"
          disabled={currentPage <= 1}
        >
          หน้าก่อนหน้า
        </button>
        <span className="font-semibold text-slate-700">หน้า {currentPage}</span>
        <button onClick={() => setCurrentPage((p) => p + 1)} className="rounded-lg bg-slate-800 px-4 py-2 text-white">
          หน้าถัดไป
        </button>
      </div>
    </div>
  );
};

export default OfflineCanvasReader;
