// SSOT Phase 027 Task 5 — LiffRouterProvider (shell guard + tenant theme + dialog)
// Canonical: apps/frontend/components/navigation/liff-router-provider.tsx
// (legacy src/frontend/components/navigation/liff-router-provider.tsx)
// - Mounts useLiffNavigation once per LIFF segment (owns the popstate listener).
// - Injects multi-tenant nav CSS vars (--nav-bg, --nav-text, --brand-primary).
// - LIFF_SHELL_INIT: skeleton bar, native controls untouched; READY: renders the
//   exit-confirmation dialog bound to store.pendingExit (dirty/root guard).
// - Identity for exit persist: ?userId=&lineUserId= hints (JWT path owns prod auth;
//   hints keep the LIFF WebView exit path functional without new deps).
'use client';

import React, { useCallback, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLiffNavigation } from '../../hooks/use-liff-navigation';
import { cancelExit, useNavigationStore } from '../../stores/use-navigation-store';
import { ExitConfirmDialog } from './ExitConfirmDialog';

function tenantTheme(tenantId: string): { navBg: string; navText: string; brand: string } {
  if (tenantId === 'default') return { navBg: '#ffffff', navText: '#111111', brand: '#0284C7' };
  let h = 0;
  for (let i = 0; i < tenantId.length; i++) h = (Math.imul(31, h) + tenantId.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return { navBg: '#ffffff', navText: '#111111', brand: `hsl(${hue} 70% 40%)` };
}

export function LiffRouterProvider({ children }: { children: React.ReactNode }) {
  const { status, confirmExit } = useLiffNavigation();
  const params = useSearchParams();
  const tenantId = params.get('tenant') ?? 'default';
  const pendingExit = useNavigationStore((s) => s.pendingExit);
  const shellReady = useNavigationStore((s) => s.shellReady);
  const [busy, setBusy] = useState(false);
  const theme = tenantTheme(tenantId);

  const handleConfirm = useCallback(async () => {
    setBusy(true);
    try {
      const userId = params.get('userId') ?? 'anonymous';
      const lineUserId = params.get('lineUserId') ?? params.get('line_user_id') ?? 'anonymous';
      await confirmExit({ userId, lineUserId });
    } finally {
      setBusy(false);
      cancelExit();
    }
  }, [confirmExit, params]);

  const handleCancel = useCallback(() => {
    cancelExit();
  }, []);

  return (
    <div
      data-testid="liff-router"
      style={
        {
          '--nav-bg': theme.navBg,
          '--nav-text': theme.navText,
          '--brand-primary': theme.brand,
        } as React.CSSProperties
      }
    >
      {!shellReady && status === 'LIFF_INIT' ? (
        <div aria-hidden="true" className="h-12 w-full animate-pulse" style={{ background: 'var(--nav-bg)' }} />
      ) : null}
      {children}
      <ExitConfirmDialog
        open={pendingExit !== null}
        busy={busy}
        kind={pendingExit?.kind ?? 'CLOSE'}
        onCancel={handleCancel}
        onConfirm={() => void handleConfirm()}
      />
    </div>
  );
}

export default LiffRouterProvider;
