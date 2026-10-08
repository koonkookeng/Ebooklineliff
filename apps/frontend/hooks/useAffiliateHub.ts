// SSOT Phase 079 §2.2 — Affiliate hub hook (5-state machine)
// Canonical: apps/frontend/hooks/useAffiliateHub.ts
// - LIFF_INIT splash -> IDLE/LOADING -> SUCCESS / ERROR + retry.
// - Zero-dep beyond the affiliate client.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { affiliateApi, cacheAffiliateCode, type AffiliateDashboard, type AffiliateStatus } from '../lib/affiliate/affiliate-client';

export function useAffiliateHub(slug: string) {
  const [status, setStatus] = useState<AffiliateStatus>('LIFF_INIT');
  const [error, setError] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<AffiliateDashboard | null>(null);
  const [nonce, setNonce] = useState(0);

  const load = useCallback(async () => {
    setStatus((s) => (s === 'LIFF_INIT' ? s : 'LOADING'));
    setError(null);
    try {
      const data = await affiliateApi(slug).dashboard();
      if (data.affiliateCode) cacheAffiliateCode(data.affiliateCode);
      setDashboard(data);
      setStatus('SUCCESS');
    } catch (e) {
      setError((e as Error).message);
      setStatus('ERROR');
    }
  }, [slug, nonce]);

  useEffect(() => {
    void load();
  }, [load]);

  return { status, error, dashboard, retry: () => setNonce((n) => n + 1) };
}
