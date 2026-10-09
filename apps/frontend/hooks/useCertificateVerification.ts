// SSOT Phase 105 §2.2 — Public verification hook (canonical 5-state)
// Canonical: apps/frontend/hooks/useCertificateVerification.ts
// - LIFF_INIT (fetching skeleton) → SUCCESS (verified card) / ERROR
//   (invalid / revoked / expired / server — distinguished by payload).
// - LOADING covers PDF/share actions; IDLE is the settled-verified rest.
// - Zero-dep (React only).
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchPublicVerification, type VerifyStatus } from '../lib/certificate/certificate-verify-client';
import type { CertificateVerificationPayload } from '@repo/shared';

export function useCertificateVerification(certificateNo: string, hash?: string, initial?: CertificateVerificationPayload | null) {
  const [status, setStatus] = useState<VerifyStatus>(initial ? 'SUCCESS' : 'LIFF_INIT');
  const [payload, setPayload] = useState<CertificateVerificationPayload | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  const load = useCallback(async () => {
    setStatus('LIFF_INIT');
    setError(null);
    try {
      const p = await fetchPublicVerification(certificateNo, hash);
      if (!alive.current) return;
      setPayload(p);
      setStatus(p.success ? 'SUCCESS' : 'ERROR');
      if (!p.success) setError(p.message);
    } catch (e) {
      if (!alive.current) return;
      setError((e as Error).message);
      setStatus('ERROR');
    }
  }, [certificateNo, hash]);

  useEffect(() => {
    alive.current = true;
    if (!initial) void load();
    else setStatus(initial.success ? 'SUCCESS' : 'ERROR');
    return () => { alive.current = false; };
  }, [initial, load]);

  function retry() {
    setError(null);
    void load();
  }

  return { status, payload, error, busy, setBusy, retry };
}
