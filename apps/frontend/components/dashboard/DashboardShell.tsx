'use client';

// SSOT Phase 073 §6.1 — Merchant dashboard shell (5-state workspace)
// Canonical: apps/frontend/components/dashboard/DashboardShell.tsx
// - DASHBOARD_INIT: tenant skeleton; IDLE: workspace; LOADING: progress lock;
//   SUCCESS: toast; ERROR: banner + diagnostic + retry (spec §2.2).
// - Zero-dep (React only).
import React, { useState } from 'react';
import { MerchantSidebar } from './MerchantSidebar';
import type { DashboardStatus } from '../../lib/dashboard/dashboard-client';

export function DashboardShell({
  status,
  error,
  onRetry,
  storeName,
  logoUrl,
  children,
}: {
  status: DashboardStatus;
  error: string | null;
  onRetry: () => void;
  storeName: string;
  logoUrl?: string;
  children: React.ReactNode;
}) {
  const [toast, setToast] = useState<string | null>(null);

  if (status === 'DASHBOARD_INIT') {
    return <div className="theme-skeleton" aria-busy="true" aria-label="Loading Tenant Studio" />;
  }

  return (
    <div className="merchant-shell">
      <MerchantSidebar storeName={storeName} logoUrl={logoUrl} />
      <div className="merchant-main">
        {status === 'LOADING' && <div className="merchant-progress" aria-busy="true" />}
        {status === 'ERROR' && error && (
          <div role="alert" className="merchant-error">
            <span>{error}</span>
            <button type="button" onClick={onRetry}>
              Retry
            </button>
          </div>
        )}
        {toast && <div className="merchant-toast">{toast}</div>}
        <main>{children}</main>
      </div>
    </div>
  );
}

/** SUCCESS toast helper for workspace pages (no toast lib — zero-dep). */
export function useDashboardToast(): [(msg: string) => void, React.ReactNode] {
  const [msg, setMsg] = useState<string | null>(null);
  const show = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg((cur) => (cur === m ? null : cur)), 4000);
  };
  return [show, msg ? <div className="merchant-toast">{msg}</div> : null];
}
