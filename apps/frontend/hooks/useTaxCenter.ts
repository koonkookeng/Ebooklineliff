// SSOT Phase 082 §2.2 — Tax center hook (5-state machine)
// Canonical: apps/frontend/hooks/useTaxCenter.ts
// - LIFF_INIT splash -> IDLE summary+certs -> LOADING pdf -> SUCCESS card /
//   ERROR profile-incomplete fallback. Annual summary falls back to the
//   IndexedDB snapshot offline (§2.1 OFFLINE_FIRST).
// - Zero-dep beyond the tax client.
'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  cacheTaxSummary,
  cachedTaxSummary,
  taxApi,
  type TaxCertificateRow,
  type TaxStatus,
  type TaxSummary,
} from '../lib/tax/tax-client';

export function useTaxCenter(slug: string, year: number) {
  const [status, setStatus] = useState<TaxStatus>('LIFF_INIT');
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<TaxSummary | null>(null);
  const [certificates, setCertificates] = useState<TaxCertificateRow[]>([]);
  const [nonce, setNonce] = useState(0);

  const load = useCallback(async () => {
    setStatus((s) => (s === 'LIFF_INIT' ? s : 'LOADING'));
    setError(null);
    try {
      const [s, c] = await Promise.all([
        taxApi(slug).summary(year).catch(async () => (await cachedTaxSummary(year)) as TaxSummary),
        taxApi(slug).certificates(20).catch(() => [] as TaxCertificateRow[]),
      ]);
      if (s) {
        setSummary(s);
        void cacheTaxSummary(year, s);
      }
      setCertificates(c);
      setStatus('SUCCESS');
    } catch (e) {
      const cached = await cachedTaxSummary(year);
      if (cached) {
        setSummary(cached);
        setStatus('SUCCESS');
      } else {
        setError((e as Error).message);
        setStatus('ERROR');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, year, nonce]);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    status,
    error,
    summary,
    certificates,
    retry: () => {
      setError(null);
      setNonce((n) => n + 1);
    },
  };
}
