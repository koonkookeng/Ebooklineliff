// SSOT Phase 067 Task 4/5 — HLS quality selector lib (manifest + hysteresis)
// Canonical: apps/frontend/lib/hls-quality-selector.ts
// (legacy src/frontend/lib/hls-quality-selector.ts)
// - Manifest/telemetry ride Next proxies (/api/v1/stream/...).
// - Hysteresis tracker: downscale immediate (<1.5Mbps, BDD-1); upscale only
//   after >8Mbps sustained 8s (BDD-2 anti-flapping); manual locks rung.
// - estimateRamMb: performance.memory (Chrome) or buffer-based fallback.
// - Zero new deps.
import {
  ABR_UPSCALE_HOLD_SEC,
  ABR_UPSCALE_MBPS,
  ladderIndexOf,
  selectQualityFor,
  type VideoQualityLevel,
  type VideoStreamManifest,
} from '@repo/shared';

export type ActiveQuality = Exclude<VideoQualityLevel, 'AUTO'>;

async function asJson(res: Response, what: string): Promise<unknown> {
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (data as { message?: string } | null)?.message ?? `${what} failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}

export function fetchQualityManifest(lessonId: string): Promise<VideoStreamManifest> {
  return fetch(`/api/v1/stream/quality-manifest?lessonId=${encodeURIComponent(lessonId)}`).then(
    (res) => asJson(res, 'Load quality manifest') as Promise<VideoStreamManifest>,
  );
}

export function reportStreamTelemetry(input: {
  lessonId: string;
  selectedQuality: VideoQualityLevel;
  activeQuality: VideoQualityLevel;
  measuredMbps: number;
  bufferStallCount: number;
  ramUsageMb: number;
}): Promise<void> {
  return fetch('/api/v1/stream/telemetry', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...input, timestamp: new Date().toISOString() }),
  })
    .then(() => undefined)
    .catch(() => undefined);
}

/** RAM estimate: Chrome heap when available, else buffer-seconds heuristic. */
export function estimateRamMb(bufferedSec: number): number {
  try {
    const perf = performance as Performance & { memory?: { usedJSHeapSize?: number } };
    if (perf.memory?.usedJSHeapSize) return Math.round((perf.memory.usedJSHeapSize / 1048576) * 100) / 100;
  } catch {
    // heap API unavailable (Safari/LIFF) — fall through
  }
  return Math.round(Math.min(29, 4 + bufferedSec * 1.2) * 100) / 100;
}

/** Anti-flapping hysteresis: immediate down, held-up upscaling. */
export class AbrHysteresis {
  private upSince: number | null = null;
  private current: ActiveQuality = 'QUALITY_720P';

  constructor(initial: ActiveQuality = 'QUALITY_720P') {
    this.current = initial;
  }

  decide(measuredMbps: number, manual: VideoQualityLevel, saveDataMode: boolean, nowMs = Date.now()): ActiveQuality {
    if (manual !== 'AUTO') {
      this.upSince = null;
      this.current = manual;
      return manual;
    }
    const target = selectQualityFor(measuredMbps, 'AUTO', saveDataMode);
    if (ladderIndexOf(target) > ladderIndexOf(this.current)) {
      // Downscale: immediate (BDD-1, ≤2 chunk cycles).
      this.upSince = null;
      this.current = target;
      return target;
    }
    if (ladderIndexOf(target) < ladderIndexOf(this.current)) {
      // Upscale candidate: needs >8Mbps sustained 8s (BDD-2).
      if (measuredMbps < ABR_UPSCALE_MBPS) {
        this.upSince = null;
        return this.current;
      }
      if (this.upSince === null) {
        this.upSince = nowMs;
        return this.current;
      }
      if (nowMs - this.upSince >= ABR_UPSCALE_HOLD_SEC * 1000) {
        this.upSince = null;
        this.current = target;
        return target;
      }
      return this.current;
    }
    this.upSince = null;
    return this.current;
  }
}
