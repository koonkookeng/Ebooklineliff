// SSOT Phase 060 §3.1 — Canvas Multi-Resolution Scaler contracts
// Canonical: packages/shared/src/schemas/canvas-scaler.schema.ts
// (legacy src/shared/schemas/canvas-scaler.schema.ts)
// - Verbatim shapes from §3.1: DprLevelEnum, ViewportMatrix,
//   CanvasResolutionConfig, EbookMultiResChunkPayload.
// - Budgets: DPR cap 3.0 (device ≤4.0); active page full DPR, adjacent
//   1.5x; sliding window [N-1,N,N+1] ≤3 live canvases; total <30MB
//   (BDD reference: 17.25MB on 393×852@3x); edge TTL 3600s; 60fps ⇒ 16ms;
//   AI downscale below 45fps ×3 pages or spikes >25MB.
// - Browser-safe: pure Zod + math (no node:crypto). Zero new deps.
import { z } from 'zod';

export const DprLevelEnum = z.enum(['DPR_1X', 'DPR_2X', 'DPR_3X', 'DPR_ADAPTIVE']);
export type DprLevel = z.infer<typeof DprLevelEnum>;

export const ViewportMatrixSchema = z.object({
  cssWidth: z.number().positive(),
  cssHeight: z.number().positive(),
  devicePixelRatio: z.number().min(1.0).max(4.0),
  targetDpr: z.number().min(1.0).max(3.0),
  scaledWidthPx: z.number().int().positive(),
  scaledHeightPx: z.number().int().positive(),
  canvasMemoryMb: z.number().nonnegative(),
});
export type ViewportMatrix = z.infer<typeof ViewportMatrixSchema>;

export const CanvasResolutionConfigSchema = z.object({
  productId: z.string().uuid(),
  pageNumber: z.number().int().positive(),
  dprLevel: DprLevelEnum,
  viewport: ViewportMatrixSchema,
  enableForensicWatermark: z.boolean().default(true),
});
export type CanvasResolutionConfig = z.infer<typeof CanvasResolutionConfigSchema>;

export const EbookMultiResChunkPayloadSchema = z.object({
  pageNumber: z.number().int().positive(),
  vectorSvgContent: z.string(),
  dprVariant: z.string(),
  forensicWatermarkData: z.object({
    watermarkText: z.string(),
    userIdHash: z.string(),
    timestamp: z.string(),
  }),
  memoryFootprintMb: z.number(),
  hasPrevious: z.boolean(),
  hasNext: z.boolean(),
});
export type EbookMultiResChunkPayload = z.infer<typeof EbookMultiResChunkPayloadSchema>;

// ---------- §1.3/§2.1/§7.1 budgets + scaler policy (single source) ----------
export const SCALER_DPR_CAP = 3.0;
export const SCALER_DPR_DEVICE_MAX = 4.0;
export const SCALER_ADJACENT_DPR = 1.5;
export const SCALER_EDGE_TTL_SEC = 3600;
export const SCALER_MAX_LIVE_CANVASES = 3;
export const SCALER_LIFF_RAM_MB = 30;
export const SCALER_WINDOW_RAM_REF_MB = 17.25;
export const SCALER_FRAME_BUDGET_MS = 16;
export const SCALER_AI_FPS_FLOOR = 45;
export const SCALER_AI_SLOW_PAGES = 3;
export const SCALER_AI_SPIKE_MB = 25;
export const SCALER_WATERMARK_OPACITY = 0.18;
export const SCALER_BASE_WIDTH_PX = 393;
export const SCALER_BASE_HEIGHT_PX = 852;
export const SCALER_BYTES_PER_PX = 4;
export const SCALER_RENDER_EVENT_STREAM_KEY = 'stream:reader:render-metrics';

export function retinaCacheKey(productId: string, pageNumber: number, targetDpr: number): string {
  return `ebook:${productId}:page:${pageNumber}:dpr:${targetDpr}`;
}

/** Dynamic DPR cap (§5.2: >2.0→3.0, ≥1.5→2.0, else 1.0). */
export function targetDprFor(deviceDpr: number, cap: number = SCALER_DPR_CAP): number {
  const dpr = Number.isFinite(deviceDpr) && deviceDpr > 0 ? deviceDpr : 1;
  const stepped = dpr > 2.0 ? 3.0 : dpr >= 1.5 ? 2.0 : 1.0;
  return Math.min(stepped, cap);
}

export function dprVariantFor(targetDpr: number): string {
  return `DPR_${targetDpr}X`;
}

/** RGBA backing-store footprint for a CSS box at a DPR. */
export function canvasMemoryMb(cssWidth: number, cssHeight: number, targetDpr: number): number {
  if (cssWidth <= 0 || cssHeight <= 0 || targetDpr <= 0) return 0;
  return (cssWidth * targetDpr * (cssHeight * targetDpr) * SCALER_BYTES_PER_PX) / (1024 * 1024);
}

/** Full viewport matrix for a container (CSS → physical px + footprint). */
export function viewportMatrixFor(
  cssWidth: number,
  cssHeight: number,
  deviceDpr: number,
  cap: number = SCALER_DPR_CAP,
): ViewportMatrix {
  const w = cssWidth > 0 ? cssWidth : 375;
  const h = cssHeight > 0 ? cssHeight : 667;
  const dpr = Number.isFinite(deviceDpr) && deviceDpr >= 1 && deviceDpr <= SCALER_DPR_DEVICE_MAX ? deviceDpr : 1;
  const targetDpr = targetDprFor(dpr, cap);
  const scaledWidthPx = Math.max(1, Math.round(w * targetDpr));
  const scaledHeightPx = Math.max(1, Math.round(h * targetDpr));
  return {
    cssWidth: w,
    cssHeight: h,
    devicePixelRatio: dpr,
    targetDpr,
    scaledWidthPx,
    scaledHeightPx,
    canvasMemoryMb: canvasMemoryMb(w, h, targetDpr),
  };
}

/** Sliding-window RAM: active full DPR + 2 adjacent @1.5x (§1.3 BDD). */
export function slidingWindowRamMb(cssWidth: number, cssHeight: number, activeDpr: number): number {
  return (
    canvasMemoryMb(cssWidth, cssHeight, activeDpr) +
    2 * canvasMemoryMb(cssWidth, cssHeight, Math.min(activeDpr, SCALER_ADJACENT_DPR))
  );
}

/** AI adaptive downscale (§7.1: <45fps ×3 pages or spike >25MB ⇒ step down). */
export function adaptiveDownscale(
  currentDpr: number,
  slowPageStreak: number,
  peakRamMb: number,
): number {
  if (slowPageStreak >= SCALER_AI_SLOW_PAGES || peakRamMb > SCALER_AI_SPIKE_MB) {
    if (currentDpr >= 3.0) return 2.0;
    if (currentDpr >= 2.0) return SCALER_ADJACENT_DPR;
    return 1.0;
  }
  return currentDpr;
}

/** Multi-tenant CSS vars (§2.1): --retina-dpr-cap / --canvas-bg-color / --watermark-opacity. */
export function scalerTenantVars(input: { dprCap?: number; canvasBg?: string; watermarkOpacity?: number }): Record<string, string> {
  return {
    '--retina-dpr-cap': String(input.dprCap ?? SCALER_DPR_CAP),
    '--canvas-bg-color': input.canvasBg ?? '#FFFFFF',
    '--watermark-opacity': String(input.watermarkOpacity ?? SCALER_WATERMARK_OPACITY),
  };
}
