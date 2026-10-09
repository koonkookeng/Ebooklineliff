// SSOT Phase 107 §2.2 — usePiiUnmask (5-state hook for LIFF masked PII views)
// Canonical: apps/frontend/hooks/use-pii-unmask.ts
// - LIFF_INIT -> IDLE on mount; LOADING during OTP/verify POST; SUCCESS with
//   30s auto re-mask countdown; ERROR toast state (audit is server-side).
// - Plaintext is memory-only (no persistence), timer-cleared on unmount (Gate 5).
// - Zero new deps.
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { requestUnmask } from '../lib/security/pii-client';

export type PiiUnmaskState = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

export function usePiiUnmask(targetUserId: string, fieldType: string): {
  uiState: PiiUnmaskState;
  plainText: string | null;
  timeLeft: number;
  notice: string | null;
  unmask: (reason: string) => Promise<boolean>;
  relock: () => void;
} {
  const [uiState, setUiState] = useState<PiiUnmaskState>('LIFF_INIT');
  const [plainText, setPlainText] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setUiState('IDLE');
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const relock = useCallback((): void => {
    if (timerRef.current) clearInterval(timerRef.current);
    setPlainText(null);
    setTimeLeft(0);
    setUiState('IDLE');
  }, []);

  const unmask = useCallback(
    async (reason: string): Promise<boolean> => {
      setUiState('LOADING');
      setNotice(null);
      try {
        const result = await requestUnmask({ targetUserId, fieldType, reason });
        if (!result) throw new Error('unmask denied');
        setPlainText(result.plainText);
        setTimeLeft(result.expiresInSec || 30);
        setUiState('SUCCESS');
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = setInterval(() => {
          setTimeLeft((prev) => {
            if (prev <= 1) {
              if (timerRef.current) clearInterval(timerRef.current);
              setPlainText(null);
              setUiState('IDLE');
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
        return true;
      } catch {
        setNotice('ไม่มีสิทธิ์เข้าถึงข้อมูลส่วนบุคคลนี้');
        setUiState('ERROR');
        return false;
      }
    },
    [targetUserId, fieldType],
  );

  return useMemo(
    () => ({ uiState, plainText, timeLeft, notice, unmask, relock }),
    [uiState, plainText, timeLeft, notice, unmask, relock],
  );
}

export default usePiiUnmask;
