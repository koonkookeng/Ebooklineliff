// SSOT Phase 010 §6.1 — LIFF storefront home page (tenant feed, 5 states, <30MB RAM)
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

function LiffHomeInner() {
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

  const products =
    feed.featuredProducts.length > 0
      ? feed.featuredProducts
      : feed.bestsellerProducts.length > 0
        ? feed.bestsellerProducts
        : feed.newReleases;

  return <StorefrontHome banners={feed.banners} products={products} uiState={uiState} onRetry={load} />;
}

export default function LiffStorefrontPage() {
  return (
    <Suspense fallback={<StorefrontHome banners={[]} products={[]} uiState="LIFF_INIT" />}>
      <LiffHomeInner />
    </Suspense>
  );
}
