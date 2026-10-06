// SSOT Phase 008 §6.1 — Type-safe catalog fetcher for LINE LIFF (stripped payloads, <30MB RAM)
// Server strips list payloads to render-critical fields; ISR revalidates every 60s.
export interface ProductCatalogItem {
  id: string;
  tenantId: string | null;
  sellerId: string;
  title: string;
  slug: string;
  productType: 'PHYSICAL_BOOK' | 'EBOOK' | 'ELEARNING_COURSE' | 'LIVE_CLASS' | 'HYBRID_BUNDLE';
  status: string;
  priceSatang: number;
  discountSatang: number | null;
  isPublished: boolean;
  stock: { stockQty: number; reservedQty: number; available: number; sku: string } | null;
  ebook: { totalPages: number; previewPages: number } | null;
  course: { totalHours: number } | null;
  bundleChildIds: string[];
}

export interface CatalogListResult {
  items: ProductCatalogItem[];
  page: number;
  pageSize: number;
}

export async function fetchCatalogByTenant(
  tenantId: string,
  init?: { productType?: ProductCatalogItem['productType']; search?: string; page?: number },
): Promise<CatalogListResult> {
  const params = new URLSearchParams({ tenantId, page: String(init?.page ?? 1), pageSize: '20' });
  if (init?.productType) params.set('productType', init.productType);
  if (init?.search) params.set('search', init.search);
  const res = await fetch(`/admin/catalog?${params.toString()}`, {
    headers: { 'Content-Type': 'application/json' },
    next: { revalidate: 60 },
  });
  if (!res.ok) throw new Error('Failed to fetch catalog');
  return (await res.json()) as CatalogListResult;
}
