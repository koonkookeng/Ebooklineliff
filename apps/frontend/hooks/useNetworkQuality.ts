// SSOT Phase 055 §2.1 — network-aware adaptation hook (tier + low-data mode)
// Canonical: apps/frontend/hooks/useNetworkQuality.ts
// (legacy src/frontend/hooks/useNetworkQuality.ts)
// - Reads navigator.connection (effectiveType/downlink/rtt) once + on change,
//   maps to the shared NetworkQualityTier, and owns the persisted
//   "โหมดประหยัดเน็ต" switch (localStorage). Effective tier = SLOW override
//   when the user forces low-data mode.
// - Zero new deps.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { tierFromEffectiveType, type NetworkQualityTier } from '@repo/shared';

const LOW_DATA_KEY = 'low-data-mode-v1';

interface NavigatorConnection {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  addEventListener?: (type: string, fn: () => void) => void;
  removeEventListener?: (type: string, fn: () => void) => void;
}

function readConnection(): { effectiveType?: string; downlink: number } {
  try {
    const conn = (navigator as unknown as { connection?: NavigatorConnection }).connection;
    return { effectiveType: conn?.effectiveType, downlink: conn?.downlink ?? 10 };
  } catch {
    return { effectiveType: undefined, downlink: 10 };
  }
}

export function useNetworkQuality() {
  const [tier, setTier] = useState<NetworkQualityTier>('FAST_4G_5G');
  const [online, setOnline] = useState(true);
  const [lowDataMode, setLowDataModeState] = useState(false);

  useEffect(() => {
    try {
      setLowDataModeState(window.localStorage.getItem(LOW_DATA_KEY) === '1');
    } catch {
      // storage unavailable — default off
    }
    const update = (): void => {
      const { effectiveType, downlink } = readConnection();
      setTier(tierFromEffectiveType(effectiveType, downlink));
      setOnline(navigator.onLine);
    };
    update();
    const conn = (navigator as unknown as { connection?: NavigatorConnection }).connection;
    conn?.addEventListener?.('change', update);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      conn?.removeEventListener?.('change', update);
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const setLowDataMode = useCallback((on: boolean) => {
    setLowDataModeState(on);
    try {
      window.localStorage.setItem(LOW_DATA_KEY, on ? '1' : '0');
    } catch {
      // persist best-effort only
    }
  }, []);

  const effectiveTier: NetworkQualityTier = !online
    ? 'OFFLINE'
    : lowDataMode && tier === 'FAST_4G_5G'
      ? 'GOOD_3G'
      : tier;

  return { tier: effectiveTier, rawTier: tier, online, lowDataMode, setLowDataMode };
}

export default useNetworkQuality;
