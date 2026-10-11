// SSOT Phase 129 §2.2/§6.1 — LINE LIFF auth + PDPA consent gate hook
// Canonical: apps/frontend/hooks/useLineLiffAuth.ts
// (legacy src/frontend/hooks/useLineLiffAuth.ts)
// - LIFF_INIT (handshake) -> CONSENT_REQUIRED (strict gate) /
//   IDLE_COMPLIANT (token + mandatory consent ok) -> PROCESSING_RIGHTS
//   (DSR in flight) / ERROR_NON_COMPLIANT (401/mandatory refused + retry).
//   Memory-only token (no localStorage secret, 005 precedent). Zero new deps.
'use client';

import { useCallback, useEffect, useState } from 'react';

export type LineLiffAuthState =
  | 'LIFF_INIT'
  | 'CONSENT_REQUIRED'
  | 'IDLE_COMPLIANT'
  | 'PROCESSING_RIGHTS'
  | 'ERROR_NON_COMPLIANT';

export interface ConsentStatusView {
  isNecessaryAccepted: boolean;
  isMarketingAccepted: boolean;
  isAnalyticsAccepted: boolean;
  consentVersion: string;
  updatedAt: string;
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { Accept: 'application/json', ...(init?.headers ?? {}) } });
  if (res.status === 401) throw new Error('REAUTH_REQUIRED');
  if (!res.ok) throw new Error(`consent ${res.status}`);
  return (await res.json().catch(() => null)) as T;
}

export function useLineLiffAuth(tenant: string) {
  const [state, setState] = useState<LineLiffAuthState>('LIFF_INIT');
  const [status, setStatus] = useState<ConsentStatusView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const view = await getJson<ConsentStatusView>(
        `/api/v1/pdpa/consent/status?tenant=${encodeURIComponent(tenant)}`,
      );
      setStatus(view);
      setState(view.isNecessaryAccepted ? 'IDLE_COMPLIANT' : 'CONSENT_REQUIRED');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ตรวจสอบสิทธิ์ไม่สำเร็จ');
      setState('ERROR_NON_COMPLIANT');
    }
  }, [tenant]);

  useEffect(() => {
    const t = setTimeout(refresh, 300);
    return () => clearTimeout(t);
  }, [refresh]);

  const submitConsent = useCallback(
    async (purposes: string[]) => {
      setState('PROCESSING_RIGHTS');
      try {
        await getJson(`/api/v1/pdpa/consent?tenant=${encodeURIComponent(tenant)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            consentVersion: '2026-10-01',
            acceptedPurposes: purposes,
          }),
        });
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'บันทึกความยินยอมไม่สำเร็จ');
        setState('ERROR_NON_COMPLIANT');
      }
    },
    [refresh, tenant],
  );

  const retry = useCallback(() => {
    setError(null);
    setState('LIFF_INIT');
    void refresh();
  }, [refresh]);

  return { state, status, error, refresh, submitConsent, retry };
}

export default useLineLiffAuth;
