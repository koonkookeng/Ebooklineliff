// SSOT Phase 042 — useForensicWatermark (seed lifecycle hook, §2.2)
// Canonical: apps/frontend/hooks/useForensicWatermark.ts
// (legacy src/frontend/hooks/useForensicWatermark.ts)
// - 5-state machine: LIFF_INIT (seed fetch) → IDLE → LOADING (background
//   15min refresh, never blocks reading) → SUCCESS (live seed) / ERROR
//   (tamper lock or network; content blanks + alert).
// - Listens for SECURITY_VIOLATION (tamper observer) and maps it to the
//   ERROR lock + violation report fire-and-forget.
// - Zero new deps (react only).
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { WATERMARK_SEED_TTL_SEC, type WatermarkSeedPayload } from '@repo/shared';

export type ForensicWatermarkStatus = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

interface UseForensicWatermarkResult {
  seed: WatermarkSeedPayload | null;
  status: ForensicWatermarkStatus;
  error: string | null;
  locked: boolean;
  refresh: () => void;
  reportViolation: (violationType: string, metadata?: Record<string, unknown>) => void;
}

export function useForensicWatermark(productId: string): UseForensicWatermarkResult {
  const [seed, setSeed] = useState<WatermarkSeedPayload | null>(null);
  const [status, setStatus] = useState<ForensicWatermarkStatus>('LIFF_INIT');
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const mountedRef = useRef(true);

  const reportViolation = useCallback(
    (violationType: string, metadata?: Record<string, unknown>) => {
      void fetch('/api/v1/watermark/violation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ violationType, metadata: metadata ?? {} }),
      }).catch(() => undefined);
    },
    [],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const load = async (background: boolean): Promise<void> => {
      if (!productId || cancelled) return;
      if (mountedRef.current && !background) {
        setStatus((prev) => (prev === 'LIFF_INIT' ? prev : 'LOADING'));
      }
      try {
        const res = await fetch(`/api/v1/watermark/seed?productId=${encodeURIComponent(productId)}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`seed ${res.status}`);
        const data = (await res.json()) as WatermarkSeedPayload;
        if (cancelled || !mountedRef.current) return;
        setSeed(data);
        setError(null);
        setStatus('SUCCESS');
      } catch (err) {
        if ((err as Error)?.name === 'AbortError' || cancelled) return;
        if (mountedRef.current && !background) {
          setError('Security seed unavailable');
          setStatus('ERROR');
        }
      }
    };
    void load(attempt > 0);
    const timer = setInterval(() => void load(true), WATERMARK_SEED_TTL_SEC * 1000);
    const onViolation = (e: Event): void => {
      const detail = (e as CustomEvent<string>).detail ?? 'TAMPER_DOM';
      reportViolation(detail, { productId });
      if (mountedRef.current) {
        setLocked(true);
        setError('Security Policy Triggered');
        setStatus('ERROR');
      }
    };
    window.addEventListener('SECURITY_VIOLATION', onViolation);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
      window.removeEventListener('SECURITY_VIOLATION', onViolation);
    };
  }, [productId, attempt, reportViolation]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (mountedRef.current) setStatus((prev) => (prev === 'LIFF_INIT' ? 'IDLE' : prev));
    }, 0);
    return () => clearTimeout(t);
  }, []);

  return { seed, status, error, locked, refresh: () => setAttempt((a) => a + 1), reportViolation };
}

export default useForensicWatermark;
