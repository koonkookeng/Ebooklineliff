// SSOT Phase 126 Task 6 §6.1 — client memory guard (LIFF <30MB)
// Canonical: apps/frontend/lib/perf/memory-guard.ts
// - verifyMemoryUsage() mirrors the spec snippet (warn past 30MB so the
//   shell can GC-sweep canvas layers). SSR-safe (0 without window).
//   shouldEnterWaitingRoom() maps queue latency to the §2.1 2s trip.
// - Zero new deps.
import { LOAD_RAM_BUDGET_MB, WAITING_ROOM_TRIP_MS } from '@repo/shared';

/** Current JS heap in MB (0 when unmeasurable/SSR). */
export function verifyMemoryUsage(): number {
  if (typeof window !== 'undefined') {
    const meter = (performance as unknown as { memory?: { usedJSHeapSize?: unknown } }).memory;
    if (meter && typeof meter.usedJSHeapSize === 'number') {
      const usedHeapMb = meter.usedJSHeapSize / (1024 * 1024);
      if (usedHeapMb > LOAD_RAM_BUDGET_MB) {
        console.warn(`[MEMORY WARNING] Heap usage elevated: ${usedHeapMb.toFixed(2)} MB. Triggering GC sweep.`);
      }
      return usedHeapMb;
    }
  }
  return 0;
}

/** True when queue latency trips the waiting-room fallback (2s). */
export function shouldEnterWaitingRoom(queueLatencyMs: number): boolean {
  return queueLatencyMs > WAITING_ROOM_TRIP_MS;
}

/** Exponential backoff label for the retry button (1s,2s,4s cap 8s). */
export function waitingRetryLabel(attempt: number): string {
  const waitSec = Math.min(8, 2 ** Math.max(0, attempt));
  return `ลองใหม่ใน ${waitSec} วินาที`;
}
