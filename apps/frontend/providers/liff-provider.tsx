// SSOT Phase 021 §6.2 — LiffProvider (Next.js 15 App Router, 5-state machine)
// Canonical: apps/frontend/providers/liff-provider.tsx
// Alias: apps/frontend/app/(liff)/providers/liff-provider.tsx (re-export, IN_SCOPE path)
// (legacy src/frontend/app/(liff)/providers/liff-provider.tsx)
// States: LIFF_INIT (splash) → IDLE/LOADING → SUCCESS | ERROR (fallback + retry)
'use client';

import React, { createContext, useContext } from 'react';
import { useLiff } from '../hooks/use-liff';

interface LiffContextType {
  isReady: boolean;
  error: string | null;
  isSubWindow: boolean;
  environment: 'LINE_IN_APP' | 'LINE_MINI_APP_SUBWINDOW' | 'EXTERNAL_BROWSER' | 'DESKTOP_MOCK';
  appLanguage: string | undefined;
  login: () => void;
  logout: () => void;
  retry: () => void;
}

const LiffContext = createContext<LiffContextType>({
  isReady: false,
  error: null,
  isSubWindow: false,
  environment: 'EXTERNAL_BROWSER',
  appLanguage: undefined,
  login: () => {},
  logout: () => {},
  retry: () => {},
});

export const LiffProvider: React.FC<{
  children: React.ReactNode;
  liffId: string;
  tenantId: string;
}> = ({ children, liffId, tenantId }) => {
  const liffState = useLiff({ liffId, tenantId });

  // LIFF_INIT — tenant splash (brand CSS vars injected by middleware)
  if (!liffState.isReady && !liffState.error) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm font-medium text-muted-foreground">กำลังโหลดระบบ LINE Mini App...</p>
        </div>
      </div>
    );
  }

  // ERROR — fallback banner + Web Login option (never white-screen)
  if (liffState.error && !liffState.isReady) {
    return (
      <LiffContext.Provider value={liffState}>
        <div className="flex min-h-screen w-full flex-col items-center justify-center gap-4 bg-background p-6 text-center">
          <p className="text-sm text-muted-foreground">ไม่สามารถเชื่อมต่อ LINE ได้ ({liffState.error})</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={liffState.retry}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              ลองใหม่อีกครั้ง
            </button>
            <button
              type="button"
              onClick={liffState.login}
              className="rounded-md border px-4 py-2 text-sm font-medium"
            >
              เข้าสู่ระบบด้วย LINE
            </button>
          </div>
          {children}
        </div>
      </LiffContext.Provider>
    );
  }

  return <LiffContext.Provider value={liffState}>{children}</LiffContext.Provider>;
};

export const useLiffContext = () => useContext(LiffContext);

export default LiffProvider;
