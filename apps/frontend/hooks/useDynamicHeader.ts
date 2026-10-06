// SSOT Phase 023 §6.1 — useDynamicHeader hook (title sync: document + LINE native)
// Canonical: apps/frontend/hooks/useDynamicHeader.ts
// (legacy src/frontend/hooks/useDynamicHeader.ts)
// - document.title always synced (text assignment = XSS-safe, no HTML parsing).
// - liff.setTitle invoked ONLY via guarded dynamic import: the installed
//   @line/liff v2.22 typings expose no setTitle, so the call is optional-chained
//   and failure falls back to document.title silently (ERROR → tenant fallback).
// - No static `import liff` (RAM guard: keeps SDK out of the header chunk).
'use client';

import { useEffect } from 'react';
import {
  useHeaderStore,
  setHeaderConfig,
  updateHeaderTitle,
  setHeaderLoading,
  setHeaderError,
  type HeaderUiState,
} from '../stores/headerStore';
import type { DynamicHeaderPayload } from '@repo/shared';

function fullTitle(config: DynamicHeaderPayload): string {
  return config.subtitle ? `${config.mainTitle} - ${config.subtitle}` : config.mainTitle;
}

interface LiffTitleSdk {
  isLoggedIn?: () => boolean;
  setTitle?: (args: { title: string }) => void;
}

async function syncLiffNativeTitle(title: string): Promise<void> {
  try {
    const mod = (await import('@line/liff').catch(() => null)) as unknown as
      | { default?: LiffTitleSdk }
      | LiffTitleSdk
      | null;
    const liff: LiffTitleSdk | undefined =
      mod && 'default' in mod ? (mod.default ?? undefined) : ((mod as LiffTitleSdk | null) ?? undefined);
    if (liff && typeof liff.isLoggedIn === 'function' && liff.isLoggedIn()) {
      liff.setTitle?.({ title });
    }
  } catch {
    // Native sync is best-effort; document.title remains authoritative.
  }
}

export const useDynamicHeader = (initialConfig?: DynamicHeaderPayload) => {
  const headerConfig = useHeaderStore((s) => s.headerConfig);
  const uiState: HeaderUiState = useHeaderStore((s) => s.uiState);
  const error = useHeaderStore((s) => s.error);

  useEffect(() => {
    if (initialConfig) setHeaderConfig(initialConfig);
  }, [initialConfig]);

  useEffect(() => {
    if (!headerConfig) return;
    const title = fullTitle(headerConfig);
    document.title = title;
    void syncLiffNativeTitle(title);
  }, [headerConfig]);

  return {
    headerConfig,
    uiState,
    error,
    setHeaderConfig,
    updateTitle: updateHeaderTitle,
    setLoading: setHeaderLoading,
    setError: setHeaderError,
  };
};

export default useDynamicHeader;
