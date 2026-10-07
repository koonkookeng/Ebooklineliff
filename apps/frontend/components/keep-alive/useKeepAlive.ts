// SSOT Phase 031 Task 3 — useKeepAlive + useViewportKeepAlive (single hook point)
// Canonical: apps/frontend/components/keep-alive/useKeepAlive.ts
// (legacy src/frontend/components/keep-alive/useKeepAlive.ts)
// - §9: all viewport components persist through THIS hook only (no ad-hoc
//   visibility logic in readers/players/checkout forms).
// - Lifecycle per viewport: mount → HYDRATING (local IDB → rehydrate; miss +
//   serverSync → server → ERROR_FALLBACK toast flag when server saves the day)
//   → ACTIVE (2s snapshot cadence) → hidden: snapshot + release() + server
//   flush → visible: reload + rehydrate (budget < 150ms, measured).
// - Snapshots are Zod-validated per viewport (invalid drafts never persist);
//   oversized payloads (>32KB) are skipped, never truncated.
// - Zero new deps.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  CheckoutKeepAliveStateSchema,
  EbookKeepAliveStateSchema,
  KEEPALIVE_SAVE_INTERVAL_MS,
  VideoKeepAliveStateSchema,
  type KeepAliveStatus,
  type ViewportType,
} from '@repo/shared';
import { useKeepAliveContext } from './KeepAliveProvider';
import { KEEPALIVE_STATE_MAX_BYTES, measureRehydrate, snapshotSizeBytes } from '../../lib/keep-alive/keep-alive-client';

export function useKeepAlive() {
  return useKeepAliveContext();
}

export interface ViewportKeepAliveOptions<T> {
  viewportType: ViewportType;
  /** Stable resource id (productId / lessonId / orderId). */
  resourceId: string;
  /** Build the current snapshot (called while visible + on hidden). */
  snapshot: () => T;
  /** Apply a restored snapshot (page/time/form refill). */
  rehydrate: (snapshot: T) => void;
  /** Release GPU/blob/canvas memory on hidden (RAM < 30MB, Gate 5). */
  release?: () => void;
  /** Consult the server when local vault is empty (ERROR_FALLBACK path). */
  serverSync?: boolean;
}

function validateSnapshot(viewportType: ViewportType, data: unknown): boolean {
  switch (viewportType) {
    case 'EBOOK_READER':
      return EbookKeepAliveStateSchema.safeParse(data).success;
    case 'VIDEO_PLAYER':
      return VideoKeepAliveStateSchema.safeParse(data).success;
    case 'CHECKOUT_FORM':
      return CheckoutKeepAliveStateSchema.safeParse(data).success;
    default:
      return typeof data === 'object' && data !== null;
  }
}

/** Suspense-safe tenant hint (defaults outside a Suspense boundary). */
function useTenantSlug(): string {
  try {
    return useSearchParams().get('tenant') ?? 'default';
  } catch {
    return 'default';
  }
}

export function useViewportKeepAlive<T>(options: ViewportKeepAliveOptions<T>) {
  const { viewportType, resourceId, serverSync = true } = options;
  const { saveViewState, loadViewState, syncServer, restoreServer, status: providerStatus } = useKeepAliveContext();
  const tenantId = useTenantSlug();
  const [status, setStatus] = useState<KeepAliveStatus>('LIFF_INIT');
  const [lastMs, setLastMs] = useState<number | null>(null);
  const optsRef = useRef(options);
  optsRef.current = options;

  const persist = useCallback(
    async (withServer: boolean) => {
      const opts = optsRef.current;
      let data: T;
      try {
        data = opts.snapshot();
      } catch {
        return;
      }
      if (!validateSnapshot(viewportType, data)) return;
      if (snapshotSizeBytes(data) > KEEPALIVE_STATE_MAX_BYTES) return;
      await saveViewState(viewportType, resourceId, data);
      if (withServer) {
        const branch =
          viewportType === 'EBOOK_READER'
            ? { ebookState: data }
            : viewportType === 'VIDEO_PLAYER'
              ? { videoState: data }
              : viewportType === 'CHECKOUT_FORM'
                ? { checkoutState: data }
                : {};
        await syncServer({ tenantId, viewportType, timestamp: Date.now(), ...(branch as object) });
      }
    },
    [saveViewState, syncServer, viewportType, resourceId, tenantId],
  );

  const rehydrate = useCallback(async () => {
    const opts = optsRef.current;
    setStatus('HYDRATING');
    const local = await loadViewState<T>(viewportType, resourceId);
    if (local && validateSnapshot(viewportType, local)) {
      const { ms } = await measureRehydrate(() => opts.rehydrate(local));
      setLastMs(ms);
      setStatus('ACTIVE');
      return;
    }
    if (serverSync) {
      const remote = await restoreServer(tenantId, viewportType);
      if (remote && validateSnapshot(viewportType, remote)) {
        const { ms } = await measureRehydrate(() => opts.rehydrate(remote as T));
        setLastMs(ms);
        setStatus('ERROR_FALLBACK');
        return;
      }
    }
    setStatus('ACTIVE');
  }, [loadViewState, restoreServer, viewportType, resourceId, serverSync, tenantId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await rehydrate();
    })();

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        void (async () => {
          await persist(true);
          try {
            optsRef.current.release?.();
          } catch {
            // Release is best-effort (canvas may already be gone).
          }
        })();
        return;
      }
      void rehydrate();
    };
    document.addEventListener('visibilitychange', onVisibility);
    const cadence = setInterval(() => {
      if (document.visibilityState === 'visible') void persist(false);
    }, KEEPALIVE_SAVE_INTERVAL_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      clearInterval(cadence);
    };
  }, [persist, rehydrate]);

  return { status: providerStatus === 'BACKGROUND_PRESERVED' ? providerStatus : status, lastMs, persist, rehydrate };
}
