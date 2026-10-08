// SSOT Phase 067 Task 3 — useNetworkBandwidth (throughput + RTT estimator)
// Canonical: apps/frontend/hooks/useNetworkBandwidth.ts
// (legacy src/frontend/hooks/useNetworkBandwidth.ts)
// - Primary: NetworkInformation API (downlink/rtt/effectiveType/saveData).
// - RTT probe: timed HEAD to /api/health every 4s (2 chunk-cycle cadence);
//   measured Mbps blends connection.downlink with probe throughput.
// - SSR-safe; listeners cleaned up; scalar-only state (<1KB RAM).
// - Zero new deps.
'use client';

import { useEffect, useRef, useState } from 'react';
import type { NetworkMetrics } from '@repo/shared';

interface NetworkConnection {
  downlink?: number;
  rtt?: number;
  effectiveType?: NetworkMetrics['effectiveType'];
  saveData?: boolean;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
}

function readConnection(): NetworkConnection | null {
  try {
    const nav = navigator as Navigator & { connection?: NetworkConnection; mozConnection?: NetworkConnection; webkitConnection?: NetworkConnection };
    return nav.connection ?? nav.mozConnection ?? nav.webkitConnection ?? null;
  } catch {
    return null;
  }
}

const INITIAL: NetworkMetrics = { downlinkMbps: 10, rttMs: 50, effectiveType: '4g', saveDataMode: false };

export function useNetworkBandwidth(probeIntervalMs = 4000) {
  const [metrics, setMetrics] = useState<NetworkMetrics>(INITIAL);
  const metricsRef = useRef(INITIAL);

  useEffect(() => {
    let cancelled = false;

    const snapshot = (): NetworkMetrics => {
      const conn = readConnection();
      return {
        downlinkMbps: Math.max(0, Number(conn?.downlink ?? 10)),
        rttMs: Math.max(0, Number(conn?.rtt ?? 50)),
        effectiveType: conn?.effectiveType ?? '4g',
        saveDataMode: conn?.saveData === true,
      };
    };

    const probeRtt = async (): Promise<void> => {
      const started = performance.now();
      try {
        await fetch('/api/health', { method: 'HEAD', cache: 'no-store' });
        if (cancelled) return;
        const rtt = Math.max(0, performance.now() - started);
        const base = snapshot();
        // Blend: probe RTT corrects the OS-reported figure (EWMA).
        const next: NetworkMetrics = { ...base, rttMs: Math.round(base.rttMs * 0.6 + rtt * 0.4) };
        metricsRef.current = next;
        setMetrics(next);
      } catch {
        if (cancelled) return;
        const next: NetworkMetrics = { ...snapshot(), downlinkMbps: 0 };
        metricsRef.current = next;
        setMetrics(next);
      }
    };

    const onChange = () => {
      const next = snapshot();
      metricsRef.current = next;
      setMetrics(next);
    };

    const conn = readConnection();
    try {
      conn?.addEventListener?.('change', onChange);
    } catch {
      // connection events best-effort
    }
    void probeRtt();
    const timer = setInterval(() => void probeRtt(), probeIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
      try {
        conn?.removeEventListener?.('change', onChange);
      } catch {
        // detach best-effort
      }
    };
  }, [probeIntervalMs]);

  return { metrics, metricsRef };
}

export default useNetworkBandwidth;
