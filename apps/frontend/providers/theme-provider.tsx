// SSOT Phase 066 Task 6 — ThemeProvider (tokens + cross-tab/device sync)
// Canonical: apps/frontend/providers/theme-provider.tsx
// (legacy src/frontend/providers/theme-provider.tsx)
// - LIFF_INIT hydrates localStorage instantly (no FOUT), then reconciles
//   with server truth; writes debounce 800ms to PATCH.
// - Applies data-theme + §2.1 tokens + brightness on <html>; SYSTEM tracks
//   prefers-color-scheme live. Cross-tab via BroadcastChannel; cross-device
//   via SSE (userId prop; absent → local-only mode for logged-out readers).
// - Rollback to last-acked snapshot on ERROR (§2.2).
// - Zero new deps.
'use client';

import { useEffect, useRef } from 'react';
import {
  PREF_PERSIST_DEBOUNCE_MS,
  THEME_TOKENS,
  canvasFilterFor,
  resolveThemeMode,
  type UserReadingPreference,
} from '@repo/shared';
import { themeStore } from '../stores/use-theme-store';
import {
  fetchServerPreference,
  loadLocalPreference,
  persistServerPreference,
  saveLocalPreference,
  subscribePreferenceStream,
  syncOfflinePreference,
} from '../lib/theme/theme-client';

const CHANNEL = 'zene-theme-sync';

function applyTokens(mode: string, brightness: number): void {
  try {
    const root = document.documentElement;
    const tokens = (THEME_TOKENS as Record<string, Record<string, string>>)[mode] ?? THEME_TOKENS.LIGHT;
    root.setAttribute('data-theme', mode.toLowerCase());
    for (const [k, v] of Object.entries(tokens)) root.style.setProperty(k, v);
    root.style.setProperty('--brightness-filter', `${brightness}%`);
    root.style.setProperty('--canvas-filter', canvasFilterFor(mode as 'LIGHT' | 'DARK' | 'SEPIA' | 'OLED_BLACK'));
    root.classList.toggle('dark', mode === 'DARK' || mode === 'OLED_BLACK');
  } catch {
    // DOM best-effort (SSR never reaches here — 'use client' + effect)
  }
}

export function ThemeProvider({ children, userId }: { children: React.ReactNode; userId?: string | null }) {
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const local = loadLocalPreference();
    if (local) themeStore.hydrate(local as Parameters<typeof themeStore.hydrate>[0]);
    else themeStore.hydrate({});
    const s = themeStore.getState();
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTokens(resolveThemeMode(s.themeMode, prefersDark), s.brightnessLevel);

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onSystem = () => {
      const cur = themeStore.getState();
      if (cur.themeMode === 'SYSTEM') applyTokens(resolveThemeMode('SYSTEM', mq.matches), cur.brightnessLevel);
    };
    mq.addEventListener('change', onSystem);

    // Server reconciliation (fail-open offline).
    fetchServerPreference()
      .then((server) => {
        const merged = { ...loadLocalPreference(), ...server };
        themeStore.hydrate(merged);
        saveLocalPreference(merged);
        lastAckedRef.current = JSON.stringify(merged);
        const cur = themeStore.getState();
        applyTokens(resolveThemeMode(cur.themeMode, mq.matches), cur.brightnessLevel);
      })
      .catch(() => {
        themeStore.setIdle();
      });

    // Cross-tab sync.
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel(CHANNEL);
      bc.onmessage = (e: MessageEvent) => {
        const prefs = (e.data as { prefs?: UserReadingPreference } | null)?.prefs;
        if (prefs) {
          themeStore.hydrate(prefs);
          saveLocalPreference(prefs);
          const cur = themeStore.getState();
          applyTokens(resolveThemeMode(cur.themeMode, mq.matches), cur.brightnessLevel);
        }
      };
    } catch {
      bc = null;
    }

    // Offline drain + cross-device SSE.
    const onOnline = () => {
      const snap = themeStore.getState();
      void syncOfflinePreference(snap)
        .then((server) => {
          themeStore.hydrate(server);
          saveLocalPreference(server);
        })
        .catch(() => undefined);
    };
    window.addEventListener('online', onOnline);
    const unsubStream = userId ? subscribePreferenceStream(userId, (remote) => {
      themeStore.hydrate(remote);
      saveLocalPreference(remote);
      const cur = themeStore.getState();
      applyTokens(resolveThemeMode(cur.themeMode, mq.matches), cur.brightnessLevel);
    }) : () => undefined;

    return () => {
      mq.removeEventListener('change', onSystem);
      window.removeEventListener('online', onOnline);
      unsubStream();
      bc?.close();
      if (persistTimer.current) clearTimeout(persistTimer.current);
    };
  }, [userId]);

  return <>{children}</>;
}

/** Debounced persist entrypoint for toggles (rollback on ERROR, §2.2). */
export function persistThemeChange(fields: Partial<UserReadingPreference>, triggerSource = 'READER_TOOLBAR'): void {
  const merged = { ...themeStore.getState(), ...fields };
  themeStore.patchLocal(fields as Parameters<typeof themeStore.patchLocal>[0]);
  saveLocalPreference(merged);
  try {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTokens(resolveThemeMode(merged.themeMode, prefersDark), merged.brightnessLevel);
    sharedChannel()?.postMessage({ prefs: merged });
  } catch {
    // broadcast best-effort
  }
  themeStore.setSaving();
  if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
  persistTimerRef.current = setTimeout(() => {
    persistServerPreference({ ...fields, triggerSource })
      .then((server) => {
        themeStore.setSaved();
        themeStore.hydrate(server);
        saveLocalPreference(server);
        setTimeout(() => themeStore.setIdle(), 1500);
      })
      .catch(() => {
        // Rollback to last-acked; queue replays on `online` (BDD-2).
        try {
          if (lastAckedRef.current) themeStore.hydrate(JSON.parse(lastAckedRef.current));
        } catch {
          // rollback best-effort
        }
        themeStore.setError('ซิงก์ธีมล้มเหลว — จะลองใหม่เมื่อออนไลน์');
      });
  }, PREF_PERSIST_DEBOUNCE_MS);
}

// Module-scope mirrors (rollback target §2.2 + shared debounce timer/channel).
const lastAckedRef: { current: string | null } = { current: null };
const persistTimerRef: { current: ReturnType<typeof setTimeout> | null } = { current: null };
let sharedBc: BroadcastChannel | null = null;

function sharedChannel(): BroadcastChannel | null {
  try {
    if (!sharedBc && typeof BroadcastChannel !== 'undefined') sharedBc = new BroadcastChannel(CHANNEL);
    return sharedBc;
  } catch {
    return null;
  }
}

export default ThemeProvider;
