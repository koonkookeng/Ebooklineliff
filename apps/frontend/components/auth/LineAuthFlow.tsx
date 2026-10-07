// SSOT Phase 034 Task 6 — LIFF login + OA friendship flow (auth page client)
// Canonical: apps/frontend/components/auth/LineAuthFlow.tsx
// - Drives useLineAuthAndFriendship: SUCCESS (friend) → redirect to the
//   storefront/catalog preserving tenant; non-friend/ERROR → LineOAPromptModal
//   with the tenant OA config; “added” re-checks friendship live.
// - Null-visual until a redirect/modal decision (splash stays underneath).
// - Zero new deps.
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLineAuthAndFriendship } from '../../hooks/useLineAuthAndFriendship';
import { LineOAPromptModal } from './LineOAPromptModal';
import { fetchOaConfig } from '../../lib/line-oa/oa-client';
import type { LineOAPublicConfig } from '@repo/shared';

interface LineAuthFlowProps {
  liffId: string;
  tenant: string;
}

export function LineAuthFlow({ liffId, tenant }: LineAuthFlowProps) {
  const router = useRouter();
  const { status, isFriend, error, recheck } = useLineAuthAndFriendship(liffId, tenant);
  const [config, setConfig] = useState<LineOAPublicConfig | null>(null);
  const [checking, setChecking] = useState(false);
  const showModal = status === 'ERROR' || (status !== 'LIFF_INIT' && status !== 'LOADING' && isFriend === false);

  useEffect(() => {
    let cancelled = false;
    void fetchOaConfig(tenant).then((c) => {
      if (!cancelled) setConfig(c);
    });
    return () => {
      cancelled = true;
    };
  }, [tenant]);

  useEffect(() => {
    if (status === 'SUCCESS' && isFriend) {
      router.replace(`/?tenant=${encodeURIComponent(tenant)}`);
    }
  }, [status, isFriend, router, tenant]);

  const handleAdded = async () => {
    setChecking(true);
    try {
      await recheck();
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      {error && status === 'ERROR' && isFriend !== false ? (
        <p role="alert" className="sr-only">
          {error}
        </p>
      ) : null}
      <LineOAPromptModal
        isOpen={showModal && config !== null}
        lineOaBasicId={config?.lineOaBasicId ?? ''}
        tenantName={tenant}
        busy={checking}
        onAddedFriend={() => void handleAdded()}
      />
    </>
  );
}

export default LineAuthFlow;
