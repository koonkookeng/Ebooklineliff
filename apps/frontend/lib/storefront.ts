// SSOT Phase 010 §5-§6 — Type-safe storefront fetcher (ISR 60s, tenant header, R2 images)
// Canonical: apps/frontend/lib/storefront.ts
import type { ProductDetail, StorefrontFeed } from '@repo/shared';

export type { ProductDetail, StorefrontFeed };

export async function fetchStorefrontFeed(tenantId: string): Promise<StorefrontFeed> {
  const res = await fetch(`/api/storefront/feed?tenantId=${encodeURIComponent(tenantId)}`, {
    headers: { 'x-tenant-id': tenantId, 'Content-Type': 'application/json' },
    next: { revalidate: 60 },
  });
  if (!res.ok) throw new Error('Failed to fetch storefront feed');
  return (await res.json()) as StorefrontFeed;
}

export async function fetchProductDetail(slug: string, tenantId?: string): Promise<ProductDetail> {
  const qs = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : '';
  const res = await fetch(`/api/storefront/pdp/${encodeURIComponent(slug)}${qs}`, {
    headers: { 'Content-Type': 'application/json' },
    next: { revalidate: 60 },
  });
  if (!res.ok) throw new Error('Product not found or unavailable');
  return (await res.json()) as ProductDetail;
}
