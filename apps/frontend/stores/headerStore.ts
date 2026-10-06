// SSOT Phase 023 §6.1 — Header external store (zero new deps, memory-only)
// Canonical: apps/frontend/stores/headerStore.ts
// (legacy src/frontend/stores/headerStore.ts)
// RAM budget: single config object (<0.2MB, Gate 5); ephemeral — no persistence.
// NOTE: spec §6.1 shows zustand; this is a dependency-free equivalent (same state shape
// + selector API) to honor the zero-new-deps policy and the LIFF RAM budget.
'use client';

import { useSyncExternalStore } from 'react';
import type { DynamicHeaderPayload } from '@repo/shared';

export type HeaderUiState = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

interface HeaderSnapshot {
  headerConfig: DynamicHeaderPayload | null;
  uiState: HeaderUiState;
  error: string | null;
}

let snapshot: HeaderSnapshot = { headerConfig: null, uiState: 'LIFF_INIT', error: null };
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function getSnapshot(): HeaderSnapshot {
  return snapshot;
}

function getServerSnapshot(): HeaderSnapshot {
  return { headerConfig: null, uiState: 'LIFF_INIT', error: null };
}

export function setHeaderConfig(config: DynamicHeaderPayload): void {
  snapshot = { headerConfig: config, uiState: 'SUCCESS', error: null };
  emit();
}

export function updateHeaderTitle(mainTitle: string, subtitle?: string): void {
  if (!snapshot.headerConfig) return;
  snapshot = {
    ...snapshot,
    headerConfig: { ...snapshot.headerConfig, mainTitle, subtitle },
    uiState: 'SUCCESS',
  };
  emit();
}

export function setHeaderLoading(): void {
  snapshot = { ...snapshot, uiState: 'LOADING' };
  emit();
}

export function setHeaderError(error: string, fallbackTenantTitle?: string): void {
  snapshot = {
    ...snapshot,
    uiState: 'ERROR',
    error,
    headerConfig:
      fallbackTenantTitle && !snapshot.headerConfig
        ? {
            tenantId: 'default',
            displayMode: 'DEFAULT_STORE',
            mainTitle: fallbackTenantTitle,
            brandColor: '#000000',
            showBackButton: true,
            actionIcons: [],
          }
        : snapshot.headerConfig,
  };
  emit();
}

export function resetHeader(): void {
  snapshot = { headerConfig: null, uiState: 'IDLE', error: null };
  emit();
}

/** Selector-based hook (zustand-compatible call shape: useHeaderStore(sel)). */
export function useHeaderStore<T>(selector: (s: HeaderSnapshot) => T): T {
  return useSyncExternalStore(subscribe, () => selector(getSnapshot()), () => selector(getServerSnapshot()));
}

export function getHeaderSnapshot(): HeaderSnapshot {
  return getSnapshot();
}
