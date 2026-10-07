// SSOT Phase 027 §6.2 — Navigation external store (zero new deps, memory-only)
// Canonical: apps/frontend/stores/use-navigation-store.ts
// (legacy src/frontend/stores/use-navigation-store.ts)
// RAM budget: string-only stack ≤50 entries (~10KB « 1.5MB Gate 5); ephemeral —
// no persistence (server snapshot is the source of truth via /api/v1/navigation).
// NOTE: spec §6.2 shows zustand; this is a dependency-free equivalent (same state
// shape + selector API) to honor the zero-new-deps policy and the LIFF RAM budget
// (Phase 023 headerStore precedent).
'use client';

import { useSyncExternalStore } from 'react';
import { NAV_STACK_MAX_DEPTH, deriveNavUiState, type NavUiState } from '@repo/shared';

export type { NavUiState };

export interface PendingExit {
  kind: 'BACK' | 'CLOSE';
  at: number;
}

interface NavigationSnapshot {
  historyStack: string[];
  currentRoute: string;
  tenantId: string;
  isDirtyState: boolean;
  isModalOpen: boolean;
  activeModalId: string | null;
  canGoBack: boolean;
  shellReady: boolean;
  pendingExit: PendingExit | null;
}

const initial: NavigationSnapshot = {
  historyStack: [],
  currentRoute: '/',
  tenantId: 'default',
  isDirtyState: false,
  isModalOpen: false,
  activeModalId: null,
  canGoBack: false,
  shellReady: false,
  pendingExit: null,
};

let snapshot: NavigationSnapshot = { ...initial };
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

function getSnapshot(): NavigationSnapshot {
  return snapshot;
}

function getServerSnapshot(): NavigationSnapshot {
  return initial;
}

function set(patch: Partial<NavigationSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  emit();
}

export function setShellReady(ready: boolean): void {
  set({ shellReady: ready });
}

export function setTenantContext(tenantId: string, currentRoute: string): void {
  set({ tenantId, currentRoute });
}

export function setDirtyState(isDirty: boolean): void {
  set({ isDirtyState: isDirty });
}

export function setModalOpen(isOpen: boolean, modalId?: string): void {
  set({
    isModalOpen: isOpen,
    activeModalId: isOpen ? (modalId ?? 'modal') : null,
  });
}

export function closeModal(): void {
  set({ isModalOpen: false, activeModalId: null });
}

export function setCanGoBack(canGoBack: boolean): void {
  set({ canGoBack });
}

export function requestExit(kind: PendingExit['kind']): void {
  set({ pendingExit: { kind, at: Date.now() } });
}

export function cancelExit(): void {
  set({ pendingExit: null });
}

/** Push with GC: oldest entry evicted past NAV_STACK_MAX_DEPTH (N-2 GC, §2.1). */
export function pushRoute(pathname: string): void {
  const next = [...snapshot.historyStack, pathname];
  const trimmed = next.length > NAV_STACK_MAX_DEPTH ? next.slice(next.length - NAV_STACK_MAX_DEPTH) : next;
  set({ historyStack: trimmed, currentRoute: pathname, canGoBack: trimmed.length > 1 });
}

/** Pop one level; false when at root (caller triggers close-confirm path). */
export function popRoute(): boolean {
  const stack = snapshot.historyStack;
  if (stack.length <= 1) {
    set({ canGoBack: false, historyStack: [] });
    return false;
  }
  const next = stack.slice(0, -1);
  set({ historyStack: next, currentRoute: next[next.length - 1], canGoBack: next.length > 1 });
  return true;
}

export function resetNavigation(): void {
  snapshot = { ...initial };
  emit();
}

/** Selector-based hook (zustand-compatible call shape: useNavigationStore(sel)). */
export function useNavigationStore<T>(selector: (s: NavigationSnapshot) => T): T {
  return useSyncExternalStore(subscribe, () => selector(getSnapshot()), () => selector(getServerSnapshot()));
}

export function getNavigationSnapshot(): NavigationSnapshot {
  return getSnapshot();
}

/** Derive the 5-state machine for the current snapshot (§2.2). */
export function getNavUiState(): NavUiState {
  const s = getSnapshot();
  return deriveNavUiState({
    shellReady: s.shellReady,
    isModalOpen: s.isModalOpen,
    isDirtyState: s.isDirtyState,
    stackDepth: Math.max(s.historyStack.length, 1),
  });
}
