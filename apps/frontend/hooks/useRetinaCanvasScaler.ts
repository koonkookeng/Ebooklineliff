// SSOT Phase 060 §6.1 — useRetinaCanvasScaler (central DPR hook)
// Canonical: apps/frontend/hooks/useRetinaCanvasScaler.ts
// (legacy src/frontend/hooks/useRetinaCanvasScaler.ts)
// - Owns the ViewportMatrix for a container: DPR probe → tenant cap →
//   matrix + AI downscale streak (slow frames / RAM spikes).
// - Resize listener with cleanup (§10 leak safeguard); SSR-safe defaults.
// - Zero new deps.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { type ViewportMatrix } from '@repo/shared';
import { activeMatrixFor } from '../components/reader/DynamicDprManager';

interface UseRetinaCanvasScalerProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  maxDprCap?: number;
}

const FALLBACK: ViewportMatrix = {
  cssWidth: 375,
  cssHeight: 667,
  devicePixelRatio: 1.0,
  targetDpr: 1.0,
  scaledWidthPx: 375,
  scaledHeightPx: 667,
  canvasMemoryMb: 0.95,
};

export const useRetinaCanvasScaler = ({ containerRef, maxDprCap = 3.0 }: UseRetinaCanvasScalerProps) => {
  const [matrix, setMatrix] = useState<ViewportMatrix>(FALLBACK);
  const [status, setStatus] = useState<'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR'>('LIFF_INIT');
  const capRef = useRef(maxDprCap);
  capRef.current = maxDprCap;

  const updateMatrix = useCallback(() => {
    if (typeof window === 'undefined') return;
    const el = containerRef.current;
    const cssWidth = el?.clientWidth || 375;
    const cssHeight = el?.clientHeight || 667;
    const dpr = window.devicePixelRatio || 1.0;
    try {
      const { matrix } = activeMatrixFor({ cssWidth, cssHeight, devicePixelRatio: dpr, tenantDprCap: capRef.current });
      setMatrix(matrix);
      setStatus((s) => (s === 'LIFF_INIT' ? 'IDLE' : s));
    } catch {
      setStatus('ERROR');
    }
  }, [containerRef]);

  useEffect(() => {
    updateMatrix();
    window.addEventListener('resize', updateMatrix);
    return () => window.removeEventListener('resize', updateMatrix);
  }, [updateMatrix]);

  return { matrix, status, refresh: updateMatrix };
};

export default useRetinaCanvasScaler;
