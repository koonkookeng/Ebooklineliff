// SSOT Phase 005 §6.2 — LINE LIFF seamless auth hook (5-state machine, <5MB auth state, 1-hop only)
// Canonical: apps/frontend/hooks/useLineAuth.ts (legacy src/frontend/hooks/useLineAuth.ts)
//
// State matrix: LIFF_INIT -> AUTH_PENDING -> [ACCOUNT_LINKING] -> AUTH_SUCCESS | AUTH_ERROR
// - LIFF_INIT: liff.init() / handshake starting -> caller shows tenant skeleton overlay.
// - AUTH_PENDING: ID token sent to backend -> caller locks submit buttons.
// - ACCOUNT_LINKING: backend flags email conflict -> caller shows OTP bottom-sheet, then calls confirmLink().
// - AUTH_SUCCESS: 200 OK -> auth state held in memory (no token in localStorage; cookie is HTTP-Only).
// - AUTH_ERROR: expired/invalid/blocked -> caller shows Error Callout with LINE Login retry.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type LineAuthStatus =
  | 'LIFF_INIT'
  | 'AUTH_PENDING'
  | 'ACCOUNT_LINKING'
  | 'AUTH_SUCCESS'
  | 'AUTH_ERROR';

export interface LineAuthUser {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  role: string;
}

export interface LineAuthState {
  status: LineAuthStatus;
  isAuthenticated: boolean;
  isLoading: boolean;
  user: LineAuthUser | null;
  error: string | null;
  needsLinking: boolean;
}

const INITIAL: LineAuthState = {
  status: 'LIFF_INIT',
  isAuthenticated: false,
  isLoading: true,
  user: null,
  error: null,
  needsLinking: false,
};

async function loadLiff(): Promise<{
  init: (opts: { liffId: string }) => Promise<void>;
  isLoggedIn: () => boolean;
  login: () => void;
  getIDToken: () => string | null;
}> {
  // Dynamic import: keeps LIFF SDK out of the initial bundle (RAM/bundle budget, no hard dep).
  const mod = (await import('@line/liff').catch(() => null)) as unknown as {
    default?: unknown;
  } | null;
  const liff = (mod?.default ?? mod) as unknown as {
    init: (opts: { liffId: string }) => Promise<void>;
    isLoggedIn: () => boolean;
    login: () => void;
    getIDToken: () => string | null;
  };
  if (!liff || typeof liff.init !== 'function') throw new Error('LINE LIFF SDK unavailable');
  return liff;
}

export function useLineAuth(tenantId: string) {
  const [authState, setAuthState] = useState<LineAuthState>(INITIAL);
  const mounted = useRef(true);

  const authenticate = useCallback(
    async (idToken: string) => {
      setAuthState((s) => ({ ...s, status: 'AUTH_PENDING', isLoading: true, error: null }));
      const response = await fetch('/api/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `
            mutation AuthLiff($idToken: String!, $tenantId: ID!) {
              authenticateLineLiff(idToken: $idToken, tenantId: $tenantId) {
                accessToken
                expiresIn
                user { id displayName avatarUrl role }
              }
            }
          `,
          variables: { idToken, tenantId },
        }),
      });
      const result = (await response.json()) as {
        errors?: Array<{ message: string; extensions?: { code?: string } }>;
        data?: { authenticateLineLiff: { user: LineAuthUser } };
      };
      if (result.errors?.length) {
        const code = result.errors[0].extensions?.code;
        if (code === 'ACCOUNT_LINK_REQUIRED') {
          if (mounted.current) {
            setAuthState((s) => ({
              ...s,
              status: 'ACCOUNT_LINKING',
              isLoading: false,
              needsLinking: true,
              error: null,
            }));
          }
          return;
        }
        throw new Error(result.errors[0].message);
      }
      const user = result.data?.authenticateLineLiff.user;
      if (!user) throw new Error('Authentication failed');
      if (mounted.current) {
        setAuthState({ status: 'AUTH_SUCCESS', isAuthenticated: true, isLoading: false, user, error: null, needsLinking: false });
      }
    },
    [tenantId],
  );

  useEffect(() => {
    mounted.current = true;
    const initLiffAndAuth = async () => {
      try {
        const liffId = process.env.NEXT_PUBLIC_LINE_LIFF_ID;
        if (!liffId) throw new Error('Missing NEXT_PUBLIC_LINE_LIFF_ID');
        const liff = await loadLiff();
        await liff.init({ liffId });
        if (!liff.isLoggedIn()) {
          liff.login(); // single-hop redirect (LIFF constraint)
          return;
        }
        const idToken = liff.getIDToken();
        if (!idToken) throw new Error('Failed to retrieve LINE ID Token');
        await authenticate(idToken);
      } catch (err) {
        if (mounted.current) {
          setAuthState({
            status: 'AUTH_ERROR',
            isAuthenticated: false,
            isLoading: false,
            user: null,
            error: err instanceof Error ? err.message : 'Authentication failed',
            needsLinking: false,
          });
        }
      }
    };
    void initLiffAndAuth();
    return () => {
      mounted.current = false;
    };
  }, [tenantId, authenticate]);

  const confirmLink = useCallback((_otp: string) => {
    // OTP verification round-trip lands with the Phase 006 account-linking endpoint;
    // state transition is exposed now so UI can drive the bottom-sheet flow.
    setAuthState((s) => ({ ...s, status: 'AUTH_PENDING', isLoading: true, error: null }));
  }, []);

  const retry = useCallback(() => {
    setAuthState(INITIAL);
  }, []);

  return { ...authState, confirmLink, retry };
}

export default useLineAuth;
