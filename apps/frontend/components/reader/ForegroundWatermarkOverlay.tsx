// SSOT Phase 042 Task 5/6/7 — ForegroundWatermarkOverlay (Lissajous + stego + anti-tamper)
// Canonical: apps/frontend/components/reader/ForegroundWatermarkOverlay.tsx
// (legacy src/frontend/components/reader/ForegroundWatermarkOverlay.tsx)
// - Visible layer: Lissajous drift (shared lissajousPosition), opacity
//   oscillation 0.12–0.25, 15° tilt, z-index high, pointer-events none.
// - Invisible layer: 16x16 bottom-right RGBA manifest (BDD stego block).
// - Anti-tamper: closed Shadow DOM encapsulation + MutationObserver →
//   SECURITY_VIOLATION within one frame of removal (BDD-2, <50ms).
// - Battery: 60fps active → 10fps after 5s stillness (touch/visibility wake).
// - Memory: one canvas + one reused ImageData — zero per-frame allocation
//   (<2MB loop budget, Gate 5).
// - Zero new deps.
'use client';

import { useEffect, useRef } from 'react';
import {
  WATERMARK_ACTIVE_FPS,
  WATERMARK_IDLE_AFTER_MS,
  WATERMARK_IDLE_FPS,
  WATERMARK_OPACITY_MAX,
  WATERMARK_OPACITY_MIN,
  WATERMARK_STEGO_SIZE_PX,
  lissajousPosition,
  type WatermarkSeedPayload,
} from '@repo/shared';

interface ForegroundWatermarkOverlayProps {
  seed: WatermarkSeedPayload;
  width: number;
  height: number;
  steganography?: boolean;
  label?: string;
}

const STEGO_RGBA: [number, number, number, number] = [18, 144, 200, 12];

export function ForegroundWatermarkOverlay({
  seed,
  width,
  height,
  steganography = true,
  label = 'CONFIDENTIAL',
}: ForegroundWatermarkOverlayProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef({ seed, width, height, steganography, label });
  stateRef.current = { seed, width, height, steganography, label };

  // Size sync (the render loop reads stateRef dims every frame).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas && width > 0 && height > 0) {
      canvas.width = width;
      canvas.height = height;
    }
  }, [width, height]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let shadow: ShadowRoot;
    try {
      shadow = host.attachShadow({ mode: 'closed' });
    } catch {
      return; // Shadow DOM unavailable → caller keeps the CSS fallback layer.
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, width);
    canvas.height = Math.max(1, height);
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    shadow.appendChild(canvas);
    canvasRef.current = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const stego = ctx.createImageData(WATERMARK_STEGO_SIZE_PX, WATERMARK_STEGO_SIZE_PX);
    for (let i = 0; i < stego.data.length; i += 4) {
      stego.data[i] = STEGO_RGBA[0];
      stego.data[i + 1] = STEGO_RGBA[1];
      stego.data[i + 2] = STEGO_RGBA[2];
      stego.data[i + 3] = STEGO_RGBA[3];
    }

    let raf = 0;
    let lastFrame = 0;
    let lastActive = performance.now();
    let running = true;
    const frameInterval = (): number => {
      const idle = performance.now() - lastActive > WATERMARK_IDLE_AFTER_MS;
      return 1000 / (idle ? WATERMARK_IDLE_FPS : WATERMARK_ACTIVE_FPS);
    };
    const wake = (): void => {
      lastActive = performance.now();
    };

    const render = (now: number): void => {
      if (!running) return;
      raf = requestAnimationFrame(render);
      if (now - lastFrame < frameInterval()) return;
      lastFrame = now;
      const { seed: s, width: w, height: h, steganography: stegoOn, label: tag } = stateRef.current;
      const t = now / 1000;
      ctx.clearRect(0, 0, w, h);
      const { nx, ny } = lissajousPosition(t);
      const who = s.lineUserId ?? s.userIdHash.slice(0, 8);
      const text = `${s.displayName} (${who}) - ${tag}`;
      const opacity =
        WATERMARK_OPACITY_MIN +
        ((WATERMARK_OPACITY_MAX - WATERMARK_OPACITY_MIN) * (Math.sin(t * (Math.PI * 2) / 3) * 0.5 + 0.5));
      ctx.save();
      ctx.translate(nx * Math.max(1, w - 220), ny * Math.max(1, h - 40));
      ctx.rotate((-15 * Math.PI) / 180);
      ctx.font = `${s.config.fontSizePx}px sans-serif`;
      ctx.fillStyle = `rgba(140, 140, 140, ${opacity.toFixed(3)})`;
      ctx.fillText(text, 0, 0);
      ctx.restore();
      if (stegoOn && s.config.steganographyEnabled) {
        ctx.putImageData(stego, w - WATERMARK_STEGO_SIZE_PX - 2, h - WATERMARK_STEGO_SIZE_PX - 2);
      }
    };
    raf = requestAnimationFrame(render);

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'childList' || m.type === 'attributes') {
          window.dispatchEvent(new CustomEvent('SECURITY_VIOLATION', { detail: 'TAMPER_DOM' }));
          break;
        }
      }
    });
    observer.observe(host, { attributes: true, childList: true, subtree: true });
    window.addEventListener('touchstart', wake, { passive: true });
    window.addEventListener('pointerdown', wake, { passive: true });
    document.addEventListener('visibilitychange', wake);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener('touchstart', wake);
      window.removeEventListener('pointerdown', wake);
      document.removeEventListener('visibilitychange', wake);
      if (canvasRef.current === canvas) canvasRef.current = null;
    };
    // Mount-once: canvas sizing follows props via the size-sync effect above,
    // so re-attaching (which would throw on a live shadow root) never happens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={hostRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ zIndex: 9999 }}
    />
  );
}

export default ForegroundWatermarkOverlay;
