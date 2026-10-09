// SSOT Phase 106 §2.2/§6 — usePermission (LIFF zero-flicker client guard)
// Canonical: apps/frontend/hooks/use-permission.ts
// (legacy src/frontend/hooks/use-permission.ts)
// - LIFF_INIT hydrates scoped context (splash); IDLE gates UI from in-memory
//   bitmask (no flicker); LOADING during matrix persist; SUCCESS toast;
//   ERROR alert + hidden privileged buttons.
// - In-memory only (no localStorage token persistence); <0.5MB footprint (Gate 5).
// - Zero new deps.
'use client';

import { useCallback, useMemo, useState } from 'react';
import { hasBit, matchScopePattern } from '@repo/shared';

export type PermissionUiState = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

interface HydrateInput {
  bitmask?: string;
  scopes?: string[];
}

export function usePermission(initial?: HydrateInput): {
  uiState: PermissionUiState;
  bitmask: string;
  scopes: string[];
  notice: string | null;
  hydrate: (input: HydrateInput) => void;
  can: (requiredBitmask: string, requiredScope?: string) => boolean;
  persist: (nextBitmask: string, nextScopes: string[]) => Promise<boolean>;
} {
  const [uiState, setUiState] = useState<PermissionUiState>('LIFF_INIT');
  const [bitmask, setBitmask] = useState<string>(initial?.bitmask ?? '0');
  const [scopes, setScopes] = useState<string[]>(initial?.scopes ?? []);
  const [notice, setNotice] = useState<string | null>(null);

  const hydrate = useCallback((input: HydrateInput): void => {
    setBitmask(input.bitmask ?? '0');
    setScopes(input.scopes ?? []);
    setUiState('IDLE');
  }, []);

  const can = useCallback(
    (requiredBitmask: string, requiredScope?: string): boolean => {
      try {
        if (!hasBit(bitmask, requiredBitmask)) return false;
      } catch {
        return false;
      }
      if (requiredScope) return matchScopePattern(requiredScope, scopes);
      return true;
    },
    [bitmask, scopes],
  );

  const persist = useCallback(
    async (nextBitmask: string, nextScopes: string[]): Promise<boolean> => {
      setUiState('LOADING');
      setNotice(null);
      try {
        const res = await fetch('/api/v1/security/matrix', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bitmask: nextBitmask, scopes: nextScopes }),
        });
        const payload = (await res.json().catch(() => null)) as { success?: boolean } | null;
        if (!res.ok || payload?.success === false) throw new Error(`persist failed: ${res.status}`);
        setBitmask(nextBitmask);
        setScopes(nextScopes);
        setNotice('Permissions Updated');
        setUiState('SUCCESS');
        return true;
      } catch {
        setNotice('Insufficient Scopes');
        setUiState('ERROR');
        return false;
      }
    },
    [],
  );

  const value = useMemo(
    () => ({ uiState, bitmask, scopes, notice, hydrate, can, persist }),
    [uiState, bitmask, scopes, notice, hydrate, can, persist],
  );
  return value;
}

export default usePermission;
