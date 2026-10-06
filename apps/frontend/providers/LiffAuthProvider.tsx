// SSOT Phase 006 §6.1 — LINE LIFF Auth Provider (Mini App seamless auth, 5-state machine)
// Canonical: apps/frontend/providers/LiffAuthProvider.tsx
// (legacy src/frontend/providers/LiffAuthProvider.tsx)
//
// State matrix: LIFF_INIT -> IDLE -> LOADING -> SUCCESS | ERROR (no White Screen: splash persists).
// - Token lives ONLY in HTTP-Only cookies + React memory (never localStorage — XSS §8.1).
// - Auth state <15MB: single user object, no media, dynamic LIFF SDK import.
// - Referral auto-read from `?ref=` (deep-link attribution); tenant via prop.
'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { UserProfileAuth } from '@repo/shared';

export type LiffAuthStatus = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

interface LiffAuthContextType {
  status: LiffAuthStatus;
  isInitialized: boolean;
  isLoading: boolean;
  isAuthenticated: boolean;
  user: UserProfileAuth | null;
  error: string | null;
  login: () => void;
  logout: () => void;
  retry: () => void;
}

const LiffAuthContext = createContext<LiffAuthContextType>({
  status: 'LIFF_INIT',
  isInitialized: false,
  isLoading: true,
  isAuthenticated: false,
  user: null,
  error: null,
  login: () => {},
  logout: () => {},
  retry: () => {},
});

interface LiffSdk {
  init: (opts: { liffId: string }) => Promise<void>;
  isLoggedIn: () => boolean;
  isInClient: () => boolean;
  login: () => void;
  logout: () => void;
  getIDToken: () => string | null;
}

async function loadLiffSdk(): Promise<LiffSdk> {
  // Dynamic import keeps the SDK out of the initial bundle (RAM/bundle budget, no hard dep).
  const mod = (await import('@line/liff').catch(() => null)) as unknown as {
    default?: LiffSdk;
  } | null;
  const liff = (mod?.default ?? mod) as unknown as LiffSdk;
  if (!liff || typeof liff.init !== 'function') throw new Error('LINE LIFF SDK unavailable');
  return liff;
}

interface GraphQLAuthData {
  accessToken: string;
  expiresIn: number;
  user: UserProfileAuth;
}

async function handshakeWithBackend(
  idToken: string,
  tenantId: string,
  referralCode: string | undefined,
): Promise<GraphQLAuthData> {
  const response = await fetch('/api/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `
        mutation AuthenticateLiff($input: LiffAuthInput!) {
          authenticateLineLiff(input: $input) {
            accessToken
            expiresIn
            user {
              id lineUserId displayName avatarUrl email role tenantId
              walletBalance rewardPoints affiliateCode
            }
          }
        }
      `,
      variables: { input: { idToken, tenantId, referralCode } },
    }),
  });
  const result = (await response.json()) as {
    errors?: Array<{ message: string }>;
    data?: { authenticateLineLiff: GraphQLAuthData };
  };
  if (result.errors?.length) throw new Error(result.errors[0].message);
  const authData = result.data?.authenticateLineLiff;
  if (!authData) throw new Error('Authentication failed');
  return authData;
}

export function LiffAuthProvider({
  children,
  liffId,
  tenantId,
}: {
  children: React.ReactNode;
  liffId: string;
  tenantId: string;
}) {
  const [status, setStatus] = useState<LiffAuthStatus>('LIFF_INIT');
  const [user, setUser] = useState<UserProfileAuth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const sdkRef = useRef<LiffSdk | null>(null);
  const mounted = useRef(true);

  const authenticate = useCallback(
    async (idToken: string) => {
      setStatus('LOADING');
      try {
        const ref =
          typeof window !== 'undefined'
            ? new URLSearchParams(window.location.search).get('ref') ?? undefined
            : undefined;
        const authData = await handshakeWithBackend(idToken, tenantId, ref ?? undefined);
        if (!mounted.current) return;
        // Memory-only session (HTTP-Only cookie set by backend; nothing in localStorage)
        setUser(authData.user);
        setError(null);
        setStatus('SUCCESS');
      } catch (err) {
        if (!mounted.current) return;
        setError(err instanceof Error ? err.message : 'Authentication failed');
        setStatus('ERROR');
      }
    },
    [tenantId],
  );

  useEffect(() => {
    mounted.current = true;
    const boot = async () => {
      try {
        const liff = await loadLiffSdk();
        sdkRef.current = liff;
        await liff.init({ liffId });
        if (!mounted.current) return;
        setStatus('IDLE');
        if (liff.isLoggedIn()) {
          const idToken = liff.getIDToken();
          if (idToken) {
            await authenticate(idToken);
          }
        } else if (liff.isInClient()) {
          liff.login(); // single-hop auto-login inside LINE client
        }
      } catch (err) {
        if (!mounted.current) return;
        setError(err instanceof Error ? err.message : 'Failed to initialize LINE LIFF SDK');
        setStatus('ERROR');
      }
    };
    void boot();
    return () => {
      mounted.current = false;
    };
  }, [liffId, authenticate, attempt]);

  const login = useCallback(() => {
    try {
      if (sdkRef.current && !sdkRef.current.isLoggedIn()) sdkRef.current.login();
    } catch {
      setError('LINE login unavailable');
      setStatus('ERROR');
    }
  }, []);

  const logout = useCallback(() => {
    try {
      sdkRef.current?.logout();
    } catch {
      // storage already memory-only; nothing to clear
    }
    setUser(null);
    setStatus('IDLE');
  }, []);

  const retry = useCallback(() => {
    setError(null);
    setStatus('LIFF_INIT');
    setAttempt((n) => n + 1);
  }, []);

  const value = useMemo<LiffAuthContextType>(
    () => ({
      status,
      isInitialized: status !== 'LIFF_INIT',
      isLoading: status === 'LIFF_INIT' || status === 'LOADING',
      isAuthenticated: status === 'SUCCESS' && user !== null,
      user,
      error,
      login,
      logout,
      retry,
    }),
    [status, user, error, login, logout, retry],
  );

  return <LiffAuthContext.Provider value={value}>{children}</LiffAuthContext.Provider>;
}

export function useLiffAuth(): LiffAuthContextType {
  return useContext(LiffAuthContext);
}

export default LiffAuthProvider;
