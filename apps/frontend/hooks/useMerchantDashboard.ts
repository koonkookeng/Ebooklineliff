// SSOT Phase 073 §2.2 — Dashboard data hook (5-state machine)
// Canonical: apps/frontend/hooks/useMerchantDashboard.ts
// - DASHBOARD_INIT on mount -> IDLE/SUCCESS on 200 -> ERROR with retry.
// - Zero-dep beyond the dashboard client (no zustand — single hook state).
'use client';

import { useCallback, useEffect, useState } from 'react';
import { merchantApi, type AnalyticsRow, type DashboardStatus } from '../lib/dashboard/dashboard-client';

export function useMerchantDashboard(slug: string) {
  const [status, setStatus] = useState<DashboardStatus>('DASHBOARD_INIT');
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<AnalyticsRow[]>([]);
  const [nonce, setNonce] = useState(0);

  const load = useCallback(async () => {
    setStatus((s) => (s === 'DASHBOARD_INIT' ? s : 'LOADING'));
    setError(null);
    try {
      const to = new Date();
      const from = new Date(Date.now() - 30 * 86400000);
      const data = await merchantApi(slug).analytics(from.toISOString(), to.toISOString());
      setRows(data.rows);
      setStatus('SUCCESS');
    } catch (e) {
      setError((e as Error).message);
      setStatus('ERROR');
    }
  }, [slug, nonce]);

  useEffect(() => {
    void load();
  }, [load]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);
  const totals = rows.reduce(
    (acc, r) => ({
      gmv: acc.gmv + Number(r.totalGmv || 0),
      orders: acc.orders + r.totalOrders,
      students: acc.students + r.newStudentsCount,
    }),
    { gmv: 0, orders: 0, students: 0 },
  );

  return { status, error, rows, totals, retry, reload: load, setStatus, setError };
}
