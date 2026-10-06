// SSOT Phase 011 §6.1 — Smart cart external store (zero new deps, localStorage offline sync)
// Canonical: apps/frontend/stores/useCartStore.ts
// (legacy src/frontend/stores/useCartStore.ts)
// RAM budget: cart drawer + list ≤5MB (stripped cards only, no descriptions/bodies).
// NOTE: spec §6.1 shows zustand; this is a dependency-free equivalent (same state shape
// + persist key) to honor the zero-new-deps policy and the LIFF RAM budget.
'use client';

import { useSyncExternalStore } from 'react';
import type { HybridCartSplitSummary, SmartCartItem } from '@repo/shared';

export type CartUiState = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

export interface CartSnapshot extends HybridCartSplitSummary {
  uiState: CartUiState;
  error: string | null;
}

const STORAGE_KEY = 'zene-smart-cart-storage';
const EMPTY: HybridCartSplitSummary = {
  digitalItems: [],
  physicalItems: [],
  digitalSubtotal: 0,
  physicalSubtotal: 0,
  totalPhysicalWeightGrams: 0,
  estimatedShippingFee: 0,
  appliedDiscountAmount: 0,
  grandTotalAmount: 0,
  requiresShippingAddress: false,
};

let snapshot: CartSnapshot = { ...EMPTY, uiState: 'LIFF_INIT', error: null };
const listeners = new Set<() => void>();

function readPersisted(): HybridCartSplitSummary | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as HybridCartSplitSummary;
    if (!Array.isArray(data.digitalItems) || !Array.isArray(data.physicalItems)) return null;
    return data;
  } catch {
    return null;
  }
}

function set(partial: Partial<CartSnapshot>): void {
  snapshot = { ...snapshot, ...partial };
  try {
    const { uiState: _omit, error: _err, ...persistable } = snapshot;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persistable));
  } catch {
    // private-mode storage: stay functional without persistence
  }
  for (const fn of listeners) fn();
}

async function request(path: string, init?: RequestInit): Promise<HybridCartSplitSummary> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `Cart request failed (${res.status})`);
  }
  return (await res.json()) as HybridCartSplitSummary;
}

function applyData(data: HybridCartSplitSummary): void {
  set({ ...data, uiState: 'SUCCESS', error: null });
}

export const cartStore = {
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  getSnapshot(): CartSnapshot {
    return snapshot;
  },
  hydrate(): void {
    const cached = readPersisted();
    set({ ...(cached ?? EMPTY), uiState: 'IDLE', error: null });
  },
  async refresh(shippingAddressId?: string): Promise<void> {
    set({ uiState: 'LOADING', error: null });
    try {
      const qs = shippingAddressId ? `?shippingAddressId=${encodeURIComponent(shippingAddressId)}` : '';
      applyData(await request(`/api/cart${qs}`));
    } catch (e) {
      set({ uiState: 'ERROR', error: (e as Error).message });
    }
  },
  async add(productId: string, quantity = 1): Promise<void> {
    set({ uiState: 'LOADING', error: null });
    try {
      applyData(
        await request('/api/cart/items', {
          method: 'POST',
          body: JSON.stringify({ productId, quantity }),
        }),
      );
    } catch (e) {
      set({ uiState: 'ERROR', error: (e as Error).message });
    }
  },
  async updateQty(cartItemId: string, quantity: number): Promise<void> {
    set({ uiState: 'LOADING', error: null });
    try {
      applyData(
        await request(`/api/cart/items/${encodeURIComponent(cartItemId)}`, {
          method: 'PATCH',
          body: JSON.stringify({ quantity }),
        }),
      );
    } catch (e) {
      set({ uiState: 'ERROR', error: (e as Error).message });
    }
  },
  async remove(cartItemId: string): Promise<void> {
    set({ uiState: 'LOADING', error: null });
    try {
      applyData(
        await request(`/api/cart/items/${encodeURIComponent(cartItemId)}`, { method: 'DELETE' }),
      );
    } catch (e) {
      set({ uiState: 'ERROR', error: (e as Error).message });
    }
  },
  setCartData(data: HybridCartSplitSummary): void {
    applyData(data);
  },
  clearCart(): void {
    set({ ...EMPTY, uiState: 'IDLE', error: null });
  },
};

/** Hook: cart snapshot + actions (selector-friendly; components subscribe once). */
export function useCartStore(): CartSnapshot & typeof cartStore {
  const state = useSyncExternalStore(cartStore.subscribe, cartStore.getSnapshot, cartStore.getSnapshot);
  return { ...state, ...cartStore };
}

export type { HybridCartSplitSummary, SmartCartItem };
