// SSOT Phase 060 §6.1 — DynamicDprManager (pure DPR policy engine)
// Canonical: apps/frontend/components/reader/DynamicDprManager.ts
// (legacy src/frontend/components/reader/DynamicDprManager.ts)
// - Single source for DPR decisions (Zero Redundant Code Policy): physical
//   box math, window RAM estimate, AI downscale, tenant-cap resolution.
// - Pure + framework-free so CanvasReader, the scaler hook, and tests share
//   byte-identical math with the Zod SSOT. Zero new deps.
import {
  SCALER_DPR_CAP,
  adaptiveDownscale,
  canvasMemoryMb,
  slidingWindowRamMb,
  targetDprFor,
  viewportMatrixFor,
  type ViewportMatrix,
} from '@repo/shared';

export interface DprReading {
  cssWidth: number;
  cssHeight: number;
  devicePixelRatio: number;
  tenantDprCap?: number;
}

export function resolveTenantDprCap(vars?: { dprCap?: number }): number {
  if (typeof document !== 'undefined') {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--retina-dpr-cap').trim();
    const parsed = Number.parseFloat(raw);
    if (Number.isFinite(parsed) && parsed >= 1) return Math.min(parsed, SCALER_DPR_CAP);
  }
  if (vars?.dprCap && vars.dprCap >= 1) return Math.min(vars.dprCap, SCALER_DPR_CAP);
  return SCALER_DPR_CAP;
}

/** Active-page matrix for a container reading (+ effective cap). */
export function activeMatrixFor(reading: DprReading): { matrix: ViewportMatrix; cap: number } {
  const cap = resolveTenantDprCap({ dprCap: reading.tenantDprCap });
  return { matrix: viewportMatrixFor(reading.cssWidth, reading.cssHeight, reading.devicePixelRatio, cap), cap };
}

/** Physical canvas application: backing store + CSS box + ctx scale. */
export function applyMatrixToCanvas(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  matrix: ViewportMatrix,
): void {
  canvas.width = matrix.scaledWidthPx;
  canvas.height = matrix.scaledHeightPx;
  canvas.style.width = `${matrix.cssWidth}px`;
  canvas.style.height = `${matrix.cssHeight}px`;
  ctx.setTransform(matrix.targetDpr, 0, 0, matrix.targetDpr, 0, 0);
}

/**
 * Backing store for an already-laid-out canvas: CSS box × DPR stepped down
 * until a single canvas fits maxSingleMb (default 12MB — a 3-canvas window
 * then stays well under the 30MB LIFF ceiling).
 */
export function dprBackingFor(
  canvas: HTMLCanvasElement,
  maxSingleMb = 12,
): { cssWidth: number; cssHeight: number; scaledWidthPx: number; scaledHeightPx: number; scale: number } {
  const cssWidth = canvas.clientWidth || canvas.width || 600;
  const cssHeight = canvas.clientHeight || canvas.height || Math.round(cssWidth * 1.5);
  const device = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  let scale = targetDprFor(device);
  while (scale > 1 && canvasMemoryMb(cssWidth, cssHeight, scale) > maxSingleMb) {
    scale = Math.max(1, scale - 0.5);
  }
  return {
    cssWidth,
    cssHeight,
    scaledWidthPx: Math.max(1, Math.round(cssWidth * scale)),
    scaledHeightPx: Math.max(1, Math.round(cssHeight * scale)),
    scale,
  };
}

/** Hard eviction for a canvas (BDD: revoke + clearRect + backing release). */
export function evictCanvas(canvas: HTMLCanvasElement | null, blobUrl: string | null): string | null {
  try {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
  } catch {
    // revoke best-effort
  }
  try {
    if (canvas) {
      canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
      canvas.width = 1;
      canvas.height = 1;
    }
  } catch {
    // GC hints must never throw the render loop
  }
  return null;
}

export { adaptiveDownscale, canvasMemoryMb, slidingWindowRamMb, targetDprFor };
export type { ViewportMatrix };
