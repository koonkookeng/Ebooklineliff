// SSOT Phase 061 §6.1/§1.3 — Forensic watermark renderer + theft-trap kit
// Canonical: apps/frontend/components/reader/forensic-watermark.ts
// (legacy src/frontend/components/reader/forensic-watermark.ts)
// - renderDrmWatermark: diagonal tiled identity text on a 2D ctx (CSS space).
// - installCanvasTheftTrap: arms toDataURL/getImageData Proxy traps on ONE
//   DRM canvas; extraction attempts get a blacked-out frame stamped with the
//   attacker IP + user hash, and fire onViolation (≤500ms server insert).
//   Returns an unarm() restorer. Never armed globally — caller-scoped only.
// - reportDrmViolationBeacon: sendBeacon-first violation pulse.
// - Zero new deps.
import { SCALER_WATERMARK_OPACITY } from '@repo/shared';

export interface DrmTheftContext {
  userId: string;
  userIdHash: string;
  attackerIp: string;
}

export function renderDrmWatermark(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  watermarkText: string,
  opacity: number = SCALER_WATERMARK_OPACITY,
): void {
  ctx.save();
  ctx.fillStyle = `rgba(180, 180, 180, ${opacity})`;
  ctx.font = 'bold 16px sans-serif';
  ctx.rotate((-20 * Math.PI) / 180);
  for (let y = -height; y < height * 2; y += 120) {
    for (let x = -width; x < width * 2; x += 240) {
      ctx.fillText(watermarkText, x, y);
    }
  }
  ctx.restore();
}

function blackoutWithForensics(canvas: HTMLCanvasElement, trap: DrmTheftContext): string {
  const w = Math.max(2, canvas.width);
  const h = Math.max(2, canvas.height);
  const off = document.createElement('canvas');
  off.width = w;
  off.height = h;
  const ctx = off.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(`PROTECTED ${trap.userIdHash} ${trap.attackerIp}`, 16, 32);
  }
  return off.toDataURL('image/png');
}

/**
 * Arm extraction traps on a single DRM canvas. Returns unarm().
 * BDD: toDataURL/getImageData return blacked-out forensics + log breach.
 */
export function installCanvasTheftTrap(
  canvas: HTMLCanvasElement,
  trap: DrmTheftContext,
  onViolation: (method: 'toDataURL' | 'getImageData') => void,
): () => void {
  const proto = HTMLCanvasElement.prototype;
  const origToDataURL = proto.toDataURL;
  const ctxProto = CanvasRenderingContext2D.prototype;
  const origGetImageData = ctxProto.getImageData;
  let armed = true;

  proto.toDataURL = function patchedToDataURL(this: HTMLCanvasElement, ...args: unknown[]): string {
    if (armed && this === canvas) {
      try {
        onViolation('toDataURL');
      } catch {
        // audit pulse must never throw the page
      }
      return blackoutWithForensics(canvas, trap);
    }
    return origToDataURL.apply(this, args as []);
  } as typeof proto.toDataURL;

  ctxProto.getImageData = function patchedGetImageData(
    this: CanvasRenderingContext2D,
    ...args: [number, number, number, number, ...unknown[]]
  ): ImageData {
    if (armed && this.canvas === canvas) {
      try {
        onViolation('getImageData');
      } catch {
        // audit pulse must never throw the page
      }
      const [sx, sy, sw, sh] = args;
      const blank = origGetImageData.call(this, sx, sy, sw, sh);
      blank.data.fill(0);
      return blank;
    }
    return origGetImageData.apply(this, args as [number, number, number, number]);
  } as typeof ctxProto.getImageData;

  return () => {
    armed = false;
    proto.toDataURL = origToDataURL;
    ctxProto.getImageData = origGetImageData;
  };
}

export function reportDrmViolationBeacon(input: {
  sessionNonce: string;
  productId: string;
  pageNumber: number;
  violationType: string;
}): void {
  try {
    const body = JSON.stringify({ ...input, userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '' });
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      if (navigator.sendBeacon('/api/v1/reader/drm-violation', new Blob([body], { type: 'application/json' }))) return;
    }
    void fetch('/api/v1/reader/drm-violation', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // audit never breaks reading
  }
}
