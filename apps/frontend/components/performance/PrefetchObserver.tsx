// SSOT Phase 029 Task 6/§2.2 — PrefetchObserver (segment-level dwell arming)
// Canonical: apps/frontend/components/performance/PrefetchObserver.tsx
// (legacy src/frontend/components/performance/PrefetchObserver.tsx)
// - Null-render host: arms usePredictivePrefetch from URL context
//   (?productId=&page=) without touching reader/player engines (zero-touch).
// - Ebook pages read numeric ?page=; other routes resolve to PRODUCT_PDP with
//   the pathname as resource id (prediction degrades to self-warm, harmless).
// - Dep-free (no new UI lib in the LIFF bundle, Gate 5).
'use client';

import { useSearchParams, usePathname } from 'next/navigation';
import { usePredictivePrefetch } from '../../hooks/use-predictive-prefetch';

export function PrefetchObserver() {
  const params = useSearchParams();
  const pathname = usePathname();
  const productId = params.get('productId');
  const pageParam = params.get('page');
  const page = pageParam !== null && /^\d+$/.test(pageParam) ? pageParam : null;

  usePredictivePrefetch({
    productId,
    resourceType: page !== null ? 'EBOOK_PAGE' : 'PRODUCT_PDP',
    currentResourceId: page ?? pathname,
    enabled: productId !== null,
  });

  return null;
}

export default PrefetchObserver;
