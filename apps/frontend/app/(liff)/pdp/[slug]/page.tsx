// SSOT Phase 010 §6.2 — LIFF PDP route (slug detail, 5 states, sticky CTA)
'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { ProductDetailPage, type PdpUiState } from '../../../../components/pdp/ProductDetailPage';
import { NativeActionButton } from '../../../../components/share/NativeActionButton';
import { fetchProductDetail, type ProductDetail } from '../../../../lib/storefront';

function LiffPdpInner() {
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

  // Atomic Phase 026: share slot (EBOOK→page, COURSE→lesson, else bundle).
  const shareType = product?.productType === 'EBOOK'
    ? 'EBOOK_SUMMARY'
    : product?.productType === 'ELEARNING_COURSE'
      ? 'COURSE_LESSON'
      : 'PRODUCT_BUNDLE';
  return (
    <ProductDetailPage
      product={product}
      uiState={uiState}
      onRetry={load}
      shareSlot={product ? (
        <div className="flex-1">
          <NativeActionButton productId={product.id} contentType={shareType} variant="inline" />
        </div>
      ) : undefined}
    />
  );
}

export default function LiffPdpPage() {
  return (
    <Suspense fallback={<ProductDetailPage product={null} uiState="LIFF_INIT" />}>
      <LiffPdpInner />
    </Suspense>
  );
}
