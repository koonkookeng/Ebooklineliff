// SSOT Phase 083 §2.2 — Gamification hub hook (5-state machine)
// Canonical: apps/frontend/hooks/useGamificationHub.ts
// - LIFF_INIT splash -> IDLE hub -> LOADING checkin/redeem -> SUCCESS
//   (confetti-free toast + badge modal content) / ERROR toast + retry.
// - Catalog/badges fall back to IndexedDB snapshots offline (§2.1).
// - Zero-dep beyond the game client.
'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  cacheBadges,
  cacheCatalog,
  cachedBadges,
  cachedCatalog,
  gameApi,
  type GameBadge,
  type GameStatus,
  type GamificationProfile,
  type RewardCatalogItem,
} from '../lib/gamification/gamification-client';

export function useGamificationHub(slug: string) {
  const [status, setStatus] = useState<GameStatus>('LIFF_INIT');
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<GamificationProfile | null>(null);
  const [badges, setBadges] = useState<GameBadge[]>([]);
  const [catalog, setCatalog] = useState<RewardCatalogItem[]>([]);
  const [nonce, setNonce] = useState(0);

  const load = useCallback(async () => {
    setStatus((s) => (s === 'LIFF_INIT' ? s : 'LOADING'));
    setError(null);
    try {
      const [p, b, c] = await Promise.all([
        gameApi(slug).profile(),
        gameApi(slug).badges().catch(async () => (await cachedBadges(slug)) ?? []),
        gameApi(slug).catalog().catch(async () => (await cachedCatalog(slug)) ?? []),
      ]);
      setProfile(p);
      setBadges(b);
      setCatalog(c);
      void cacheBadges(slug, b);
      void cacheCatalog(slug, c);
      setStatus('SUCCESS');
    } catch (e) {
      const [b, c] = await Promise.all([cachedBadges(slug), cachedCatalog(slug)]);
      if (b || c) {
        setBadges(b ?? []);
        setCatalog(c ?? []);
        setStatus('SUCCESS');
      } else {
        setError((e as Error).message);
        setStatus('ERROR');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, nonce]);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    status,
    error,
    profile,
    badges,
    catalog,
    setProfile,
    retry: () => {
      setError(null);
      setNonce((n) => n + 1);
    },
  };
}
