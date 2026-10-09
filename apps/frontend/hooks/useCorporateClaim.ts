// SSOT Phase 097 BDD-2 — Corporate claim hook (5-state, single-tap guard)
// Canonical: apps/frontend/hooks/useCorporateClaim.ts
// - LIFF_INIT warm -> IDLE invite card -> LOADING atomic claim (button
//   blocked against double-tap) -> SUCCESS (library link) / ERROR
//   (exhausted/expired + HR contact).
// - Zero-dep beyond the b2b client.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { b2bApi, type B2bStatus, type ClaimResult, type LicenseInfo } from '../lib/b2b/b2b-client';

export function useCorporateClaim(code: string | null) {
  const [status, setStatus] = useState<B2bStatus>('LIFF_INIT');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<LicenseInfo | null>(null);
  const [result, setResult] = useState<ClaimResult | null>(null);
  const [nonce, setNonce] = useState(0);

  const load = useCallback(async () => {
    if (!code) {
      setStatus('ERROR');
      setError('ลิงก์รับสิทธิ์ไม่ถูกต้อง');
      return;
    }
    setStatus('LOADING');
    setError(null);
    try {
      setInfo(await b2bApi().licenseInfo(code));
      setStatus('IDLE');
    } catch (e) {
      setStatus('ERROR');
      setError((e as Error).message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, nonce]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  async function claim(): Promise<boolean> {
    if (!code) return false;
    setStatus('LOADING');
    try {
      const r = await b2bApi().claim(code);
      if (!r.success) {
        setStatus('ERROR');
        setError(r.message);
        return false;
      }
      setResult(r);
      setStatus('SUCCESS');
      return true;
    } catch (e) {
      setStatus('ERROR');
      setError((e as Error).message);
      return false;
    }
  }

  return { status, error, info, result, claim, retry: () => setNonce((n) => n + 1) };
}
