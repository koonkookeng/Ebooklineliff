// SSOT Phase 010 §6.1 — Web storefront home (mirrors LIFF, wider grid via shared component)
'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { StorefrontHome, type StorefrontUiState } from '../../components/storefront/StorefrontHome';
import { fetchStorefrontFeed, type StorefrontFeed } from '../../lib/storefront';

const EMPTY_FEED: StorefrontFeed = {
  banners: [],
  categories: [],
  featuredProducts: [],
  bestsellerProducts: [],
  newReleases: [],
};

function WebHomeInner() {
  const params = useSearchParams();
  const tenantId = params.get('tenant') ?? 'default';
  const [feed, setFeed] = useState<StorefrontFeed>(EMPTY_FEED);
  const [uiState, setUiState] = useState<StorefrontUiState>('LIFF_INIT');

  const load = useCallback(async () => {
    setUiState('LOADING');
    try {
      const data = await fetchStorefrontFeed(tenantId);
      setFeed(data);
      setUiState('SUCCESS');
    } catch {
      setUiState('ERROR');
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="mx-auto max-w-6xl">
      <StorefrontHome
        banners={feed.banners}
        products={feed.newReleases.length > 0 ? feed.newReleases : feed.featuredProducts}
        uiState={uiState}
        onRetry={load}
      />
    </main>
  );
}

export default function WebStorefrontPage() {
  return (
    <Suspense fallback={<StorefrontHome banners={[]} products={[]} uiState="LIFF_INIT" />}>
      <WebHomeInner />
    </Suspense>
  );
}
