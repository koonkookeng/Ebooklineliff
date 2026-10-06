// SSOT Phase 010 §6.2 — Web PDP route (mirrors LIFF, centered column)
'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { ProductDetailPage, type PdpUiState } from '../../../../components/pdp/ProductDetailPage';
import { fetchProductDetail, type ProductDetail } from '../../../../lib/storefront';

function WebPdpInner() {
  const params = useParams<{ slug: string }>();
  const search = useSearchParams();
  const slug = Array.isArray(params.slug) ? params.slug[0] : params.slug;
  const tenantId = search.get('tenant') ?? undefined;
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [uiState, setUiState] = useState<PdpUiState>('LIFF_INIT');

  const load = useCallback(async () => {
    if (!slug) {
      setUiState('ERROR');
      return;
    }
    setUiState('LOADING');
    try {
      const data = await fetchProductDetail(slug, tenantId);
      setProduct(data);
      setUiState('SUCCESS');
    } catch {
      setUiState('ERROR');
    }
  }, [slug, tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="mx-auto max-w-3xl">
      <ProductDetailPage product={product} uiState={uiState} onRetry={load} />
    </main>
  );
}

export default function WebPdpPage() {
  return (
    <Suspense fallback={<ProductDetailPage product={null} uiState="LIFF_INIT" />}>
      <WebPdpInner />
    </Suspense>
  );
}
