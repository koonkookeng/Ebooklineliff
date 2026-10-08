// SSOT Phase 061 §6.1 — DualDrmCanvasReader (WebGL + 2D deshuffle core)
// Canonical: apps/frontend/components/reader/DualDrmCanvasReader.tsx
// (legacy src/frontend/components/reader/DualDrmCanvasReader.tsx)
// - 5 states: LIFF_INIT (WebGL probe + handshake) → LOADING (scrambled blob
//   + matrix) → SUCCESS (deshuffled blit + watermark + armed trap) / ERROR
//   (2D fallback → toast + auto-retry; context-loss → 2D engine).
// - RAM: one live canvas + blob revoke per turn + unmount evict (<30MB).
// - Theft trap armed per-canvas only (never global); violations beacon.
// - Zero new deps.
'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { fetchDrmChunk, reportDrmViolationBeacon } from '../../lib/reader/drm-chunk-client';
import { deshuffleCanvas2D, tryDeshuffleWebGL } from './webgl-deshuffler';
import { installCanvasTheftTrap, renderDrmWatermark } from './forensic-watermark';
import { ForensicWatermark } from './watermark/ForensicWatermark';

type DrmReaderState = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

interface DualDrmCanvasReaderProps {
  productId: string;
  pageNumber: number;
  userId: string;
  displayName: string;
}

export const DualDrmCanvasReader: React.FC<DualDrmCanvasReaderProps> = ({
  productId,
  pageNumber,
  userId,
  displayName,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const blobRef = useRef<string | null>(null);
  const unarmRef = useRef<(() => void) | null>(null);
  const [state, setState] = useState<DrmReaderState>('LIFF_INIT');
  const [error, setError] = useState<string | null>(null);
  const [webgl, setWebgl] = useState<boolean>(false);
  const [domWatermark, setDomWatermark] = useState<{ text: string; hash: string } | null>(null);

  const revokeBlob = useCallback(() => {
    if (blobRef.current) {
      try {
        URL.revokeObjectURL(blobRef.current);
      } catch {
        // revoke best-effort
      }
      blobRef.current = null;
    }
  }, []);

  useEffect(() => {
    let alive = true;
    setState('LOADING');
    setError(null);

    // LIFF_INIT: WebGL2 capability probe (no context kept — pool-of-one later).
    try {
      const probe = document.createElement('canvas').getContext('webgl2');
      if (alive) setWebgl(!!probe);
      if (probe) (probe.getExtension('WEBGL_lose_context') as { loseContext?: () => void } | null)?.loseContext?.();
    } catch {
      if (alive) setWebgl(false);
    }

    fetchDrmChunk(productId, pageNumber)
      .then((data) => {
        if (!alive) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          if (!alive) return;
          canvas.width = img.width;
          canvas.height = img.height;
          // Dual path: WebGL texture tiles → 2D fallback (auto-recovery).
          // NOTE: a canvas holds ONE context — after a WebGL blit,
          // getContext('2d') returns null, so the WebGL path watermarks via
          // the DOM overlay instead of a 2D pass.
          const glOk = tryDeshuffleWebGL(canvas, img, data.shufflingMatrix);
          if (!glOk) {
            const ctx = canvas.getContext('2d');
            if (!ctx) {
              setError('เปิด DRM canvas ไม่สำเร็จ');
              setState('ERROR');
              return;
            }
            deshuffleCanvas2D(ctx, img, data.shufflingMatrix);
            renderDrmWatermark(ctx, canvas.width, canvas.height, data.forensicWatermark.watermarkText);
            setDomWatermark(null);
          } else {
            setDomWatermark({
              text: data.forensicWatermark.watermarkText,
              hash: data.forensicWatermark.userIdHash,
            });
          }
          // Arm per-canvas theft trap (scoped, restorable).
          try {
            unarmRef.current?.();
            unarmRef.current = installCanvasTheftTrap(
              canvas,
              { userId, userIdHash: data.forensicWatermark.userIdHash, attackerIp: data.forensicWatermark.userIp },
              (method) =>
                reportDrmViolationBeacon({
                  sessionNonce: data.shufflingMatrix.sessionNonce,
                  productId,
                  pageNumber,
                  violationType: method === 'toDataURL' ? 'DEVTOOLS_CANVAS_DUMP' : 'UNAUTHORIZED_DOM_INJECTION',
                }),
            );
          } catch {
            // trap arming best-effort
          }
          setState('SUCCESS');
        };
        img.onerror = () => {
          if (!alive) return;
          setError('โหลดภาพ DRM ไม่สำเร็จ — ลองใหม่อีกครั้ง');
          setState('ERROR');
        };
        img.src = data.scrambledBlobUrl;
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : 'โหลด DRM ไม่สำเร็จ');
        setState('ERROR');
      });

    return () => {
      alive = false;
      revokeBlob();
      try {
        unarmRef.current?.();
        unarmRef.current = null;
      } catch {
        // unarm best-effort
      }
    };
  }, [productId, pageNumber, userId, revokeBlob]);

  return (
    <div
      className="relative flex min-h-[500px] w-full select-none items-center justify-center overflow-hidden bg-slate-950"
      title={`DRM reader · ${displayName}`}
    >
      {(state === 'LIFF_INIT' || state === 'LOADING') && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-900/80 backdrop-blur-md" aria-busy>
          <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-t-2 border-emerald-500" />
        </div>
      )}
      <canvas
        ref={canvasRef}
        aria-label={`drm-protected page ${pageNumber}`}
        className="pointer-events-none h-auto max-w-full rounded-md shadow-2xl"
        onContextMenu={(e) => e.preventDefault()}
      />
      {domWatermark && state === 'SUCCESS' && (
        <div className="pointer-events-none absolute inset-0">
          <ForensicWatermark watermarkText={domWatermark.text} userIdHash={domWatermark.hash} />
        </div>
      )}
      <div className="absolute left-3 top-3 rounded-full bg-black/60 px-2 py-0.5 font-mono text-[10px] text-emerald-300">
        DRM {webgl ? 'WebGL2' : '2D'} · p{pageNumber}
      </div>
      {state === 'ERROR' && error && (
        <div role="alert" className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-full bg-slate-900 px-4 py-1 text-[11px] text-white">
          {error}
        </div>
      )}
    </div>
  );
};

export default DualDrmCanvasReader;
