// SSOT Phase 060 §5.1 — RetinaScalerService (pure viewport matrix engine)
// Canonical: apps/backend/src/modules/reader/services/retina-scaler.service.ts
// (legacy src/backend/modules/reader/services/retina-scaler.service.ts)
// - matrixFor: CSS box + device DPR (+tenant cap) → ViewportMatrix.
// - windowRamFor: active full-DPR + 2 adjacent @1.5x (BDD 17.25MB ref).
// - shouldDownscale: AI policy (<45fps ×3 pages or spike >25MB).
// - Pure + tsx-safe (shared helpers, no I/O). Zero new deps.
import { Injectable } from '@nestjs/common';
import {
  SCALER_ADJACENT_DPR,
  adaptiveDownscale,
  slidingWindowRamMb,
  viewportMatrixFor,
  type ViewportMatrix,
} from '@repo/shared';

@Injectable()
export class RetinaScalerService {
  matrixFor(cssWidth: number, cssHeight: number, deviceDpr: number, dprCap?: number): ViewportMatrix {
    return viewportMatrixFor(cssWidth, cssHeight, deviceDpr, dprCap);
  }

  windowRamFor(cssWidth: number, cssHeight: number, activeDpr: number): number {
    return slidingWindowRamMb(cssWidth, cssHeight, activeDpr);
  }

  adjacentDpr(activeDpr: number): number {
    return Math.min(activeDpr, SCALER_ADJACENT_DPR);
  }

  shouldDownscale(currentDpr: number, slowPageStreak: number, peakRamMb: number): number {
    return adaptiveDownscale(currentDpr, slowPageStreak, peakRamMb);
  }
}
