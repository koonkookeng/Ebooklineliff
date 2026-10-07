// SSOT Phase 034 Task 4/§6.1 — useLineAuthAndFriendship (login + OA verify)
// Canonical: apps/frontend/hooks/useLineAuthAndFriendship.ts
// (legacy src/frontend/hooks/useLineAuthAndFriendship.ts)
// - BDD Scenario 1: liff.init() → logged in? getFriendship() : login with
//   botPrompt aggressive (cast — older SDK types omit the option; the channel
//   Bot-prompt setting remains the authoritative switch, documented).
// - 5 states: LIFF_INIT (sdk handshake) → IDLE (ready, friend known) →
//   LOADING (friendship/auth round-trip) → SUCCESS (friend) / ERROR (non-
//   friend → modal fallback, or SDK/network failure → retryable).
// - Server sync is best-effort (local flag drives the UI instantly, §2.1);
//   the flag mirrors to localStorage for offline opens.
// - RAM guard: SDK via lib singleton (no static import in hotspot); no
//   listeners, single init guard against StrictMode double-mount.
// - Zero new deps.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { OA_BOT_PROMPT_DEFAULT, type BotPromptMode } from '@repo/shared';
import { getLiff } from '../lib/liff/liff-sdk';
import { fetchFriendship, readFriendCache, syncFriendship, writeFriendCache } from '../lib/line-oa/oa-client';

export type LineAuthStatus = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

export interface LineAuthFriendship {
  status: LineAuthStatus;
  isFriend: boolean | null;
  botPrompt: BotPromptMode;
  error: string | null;
  recheck: () => Promise<boolean | null>;
}

async function readFriendFlag(): Promise<boolean | null> {
  try {
    const liff = await getLiff();
    if (typeof (liff as unknown as { getFriendship?: () => Promise<{ friendFlag?: unknown }> }).getFriendship !== 'function') {
      return null;
    }
    const res = await (liff as unknown as { getFriendship: () => Promise<{ friendFlag?: unknown }> }).getFriendship();
    return typeof res.friendFlag === 'boolean' ? res.friendFlag : null;
  } catch {
    return null;
  }
}

export function useLineAuthAndFriendship(liffId: string, tenant = 'default'): LineAuthFriendship {
  const [status, setStatus] = useState<LineAuthStatus>('LIFF_INIT');
  const [isFriend, setIsFriend] = useState<boolean | null>(() => readFriendCache(tenant));
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const startedRef = useRef(false);

  const applyFlag = useCallback(
    async (flag: boolean | null, lineUserId?: string) => {
      if (!mountedRef.current) return flag;
      if (flag !== null) {
        setIsFriend(flag);
        writeFriendCache(tenant, flag);
        setStatus(flag ? 'SUCCESS' : 'ERROR');
        if (lineUserId) void syncFriendship(lineUserId, flag);
      } else {
        // Unverifiable (outside LINE / API gap): consult the server truth.
        const server = lineUserId ? await fetchFriendship(lineUserId) : null;
        if (!mountedRef.current) return flag;
        if (server !== null) {
          setIsFriend(server);
          writeFriendCache(tenant, server);
          setStatus(server ? 'SUCCESS' : 'ERROR');
          return server;
        }
        setStatus('IDLE');
      }
      return flag;
    },
    [tenant],
  );

  const recheck = useCallback(async (): Promise<boolean | null> => {
    setStatus('LOADING');
    setError(null);
    try {
      const liff = await getLiff();
      const profile = (await (liff as unknown as { getProfile?: () => Promise<{ userId?: string }> }).getProfile?.()) ?? {};
      return await applyFlag(await readFriendFlag(), profile.userId);
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'ตรวจสอบสถานะเพื่อนไม่สำเร็จ');
        setStatus('ERROR');
      }
      return null;
    }
  }, [applyFlag]);

  useEffect(() => {
    mountedRef.current = true;
    if (startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      try {
        const liff = await getLiff();
        await liff.init({ liffId });
        if (!mountedRef.current) return;
        const loggedIn = typeof liff.isLoggedIn === 'function' ? liff.isLoggedIn() : false;
        if (!loggedIn) {
          setStatus('LOADING');
          await liff.login({
            redirectUri: typeof window !== 'undefined' ? window.location.href : undefined,
            ...( { botPrompt: OA_BOT_PROMPT_DEFAULT } as object),
          });
          return;
        }
        setStatus('LOADING');
        const profile = (await (liff as unknown as { getProfile?: () => Promise<{ userId?: string }> }).getProfile?.()) ?? {};
        await applyFlag(await readFriendFlag(), profile.userId);
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof Error ? err.message : 'เริ่มต้น LINE ไม่สำเร็จ');
          setStatus('ERROR');
        }
      }
    })();
    return () => {
      mountedRef.current = false;
    };
  }, [liffId, applyFlag]);

  return { status, isFriend, botPrompt: OA_BOT_PROMPT_DEFAULT, error, recheck };
}
