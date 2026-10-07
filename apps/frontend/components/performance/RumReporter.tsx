// SSOT Phase 029 Task 8/§7.1 — RUM reporter (LCP/FID/CLS via PerformanceObserver)
// Canonical: apps/frontend/components/performance/RumReporter.tsx
// (legacy src/frontend/components/performance/RumReporter.tsx)
// - Zero-dep web-vitals equivalent (Gate 5): largest-contentful-paint,
//   first-input + layout-shift observers, beaconed once each per page view.
// - RISK_CALL deviation (documented): no web-vitals library (spec §7.1 names it)
//   — native PerformanceObserver covers the same three signals without adding
//   ~5KB to the initial bundle the guard protects.
// - Null-render; observers disconnected on unmount; sendBeacon on each signal.
'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { beaconRum } from '../../lib/prefetch/prefetch-client';

function supported(entryType: string): boolean {
  try {
    return typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes.includes(entryType);
  } catch {
    return false;
  }
}

export function RumReporter() {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sent = new Set<string>();
    const observers: PerformanceObserver[] = [];
    const send = (metricType: 'LARGEST_CONTENTFUL_PAINT' | 'FIRST_INPUT_DELAY' | 'CUMULATIVE_LAYOUT_SHIFT', value: number) => {
      if (sent.has(metricType)) return;
      sent.add(metricType);
      beaconRum({ metricType, value: Math.round(value * 100) / 100, route: pathname });
    };

    try {
      if (supported('largest-contentful-paint')) {
        const lcp = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          const last = entries[entries.length - 1] as PerformanceEntry & { startTime: number };
          if (last) send('LARGEST_CONTENTFUL_PAINT', last.startTime);
        });
        lcp.observe({ type: 'largest-contentful-paint', buffered: true });
        observers.push(lcp);
      }
      if (supported('first-input')) {
        const fid = new PerformanceObserver((list) => {
          const first = list.getEntries()[0] as PerformanceEntry & { processingStart?: number; startTime: number };
          if (first) send('FIRST_INPUT_DELAY', (first.processingStart ?? first.startTime) - first.startTime);
        });
        fid.observe({ type: 'first-input', buffered: true });
        observers.push(fid);
      }
      if (supported('layout-shift')) {
        let cls = 0;
        const clo = new PerformanceObserver((list) => {
          for (const e of list.getEntries() as Array<PerformanceEntry & { value?: number; hadRecentInput?: boolean }>) {
            if (!e.hadRecentInput) cls += e.value ?? 0;
          }
          send('CUMULATIVE_LAYOUT_SHIFT', cls);
        });
        clo.observe({ type: 'layout-shift', buffered: true });
        observers.push(clo);
      }
    } catch {
      // Observer unsupported (older WebView): RUM silently skipped.
    }
    return () => {
      for (const o of observers) {
        try {
          o.disconnect();
        } catch {
          // ignore
        }
      }
    };
  }, [pathname]);

  return null;
}

export default RumReporter;
