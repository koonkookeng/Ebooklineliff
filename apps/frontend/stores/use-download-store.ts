// SSOT Phase 068 Task 4/6 — useDownloadStore (zero-dep external store)
// Canonical: apps/frontend/stores/use-download-store.ts
// (IN_SCOPE src/frontend/modules/download-manager/** maps here + components;
//  stores/ is the established canonical host — Phase 011/065 precedent.)
// - 5-state machine (§2.2): DOWNLOAD_IDLE → DOWNLOAD_QUEUED_PROGRESS →
//   OFFLINE_READY / STORAGE_WARNING / LICENSE_EXPIRED_ERROR.
// - Scalar-only tasks (<1KB); chunk bytes never touch the store (worker →
//   OPFS direct, RAM <30MB).
'use client';

import { useSyncExternalStore } from 'react';
import type { DownloadStatus, StorageCategory } from '@repo/shared';

export type DownloadUiState =
  | 'DOWNLOAD_IDLE'
  | 'DOWNLOAD_QUEUED_PROGRESS'
  | 'STORAGE_WARNING'
  | 'OFFLINE_READY'
  | 'LICENSE_EXPIRED_ERROR';

export interface DownloadTaskView {
  productId: string;
  title: string;
  category: StorageCategory;
  totalBytes: number;
  downloadedBytes: number;
  progress: number;
  speedBps: number;
  etaSec: number | null;
  status: DownloadStatus;
  licenseState: 'VALID' | 'EXPIRED' | 'MISSING';
}

interface DownloadState {
  tasks: Record<string, DownloadTaskView>;
  quotaBytes: number;
  usedBytes: number;
  uiState: DownloadUiState;
  error: string | null;
}

const INITIAL: DownloadState = { tasks: {}, quotaBytes: 0, usedBytes: 0, uiState: 'DOWNLOAD_IDLE', error: null };

let snapshot: DownloadState = INITIAL;
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // listener best-effort
    }
  }
}

function set(partial: Partial<DownloadState>): void {
  snapshot = { ...snapshot, ...partial };
  emit();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function useDownloadStore<T>(selector: (s: DownloadState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(snapshot));
}

function emptyTask(productId: string, title: string): DownloadTaskView {
  return {
    productId, title, category: 'OFFLINE_ASSET', totalBytes: 0, downloadedBytes: 0,
    progress: 0, speedBps: 0, etaSec: null, status: 'IDLE', licenseState: 'MISSING',
  };
}

export const downloadStore = {
  getState: (): DownloadState => snapshot,
  upsertTask: (productId: string, patch: Partial<DownloadTaskView>): void => {
    const prev = snapshot.tasks[productId] ?? emptyTask(productId, patch.title ?? productId);
    set({ tasks: { ...snapshot.tasks, [productId]: { ...prev, ...patch, productId } } });
  },
  removeTask: (productId: string): void => {
    const tasks = { ...snapshot.tasks };
    delete tasks[productId];
    set({ tasks, uiState: Object.keys(tasks).length === 0 ? 'DOWNLOAD_IDLE' : snapshot.uiState });
  },
  setQuota: (quotaBytes: number, usedBytes: number): void => set({ quotaBytes, usedBytes }),
  setUiState: (uiState: DownloadUiState, error: string | null = null): void => set({ uiState, error }),
  reset: (): void => {
    snapshot = INITIAL;
    emit();
  },
};

export { useDownloadStore };
export default useDownloadStore;
