// SSOT Phase 009 §6.1 — Type-safe product-search fetcher (stripped cards, URL-synced, ISR 60s)
// Canonical: apps/frontend/lib/product-search.ts
export interface SearchCard {
  id: string;
  title: string;
  slug: string;
  coverImageUrl: string;
  productType: string;
  price: number;
  discountPrice: number | null;
  ratingAverage: number;
  reviewCount: number;
  isAvailable: boolean;
}

export interface FacetCount {
  facetName: string;
  value: string;
  count: number;
}

export interface SearchResponse {
  items: SearchCard[];
  facets: FacetCount[];
  totalCount: number;
  hasNextPage: boolean;
  nextCursor: string | null;
}

export interface CatalogSearchParams {
  query?: string;
  productTypes?: string[];
  minPrice?: number;
  maxPrice?: number;
  ratingMin?: number;
  sortBy?: string;
  page?: number;
  limit?: number;
  inStockOnly?: boolean;
}

export function toSearchParams(p: CatalogSearchParams): string {
  const qs = new URLSearchParams();
  if (p.query) qs.set('query', p.query);
  if (p.productTypes?.length) qs.set('productTypes', p.productTypes.join(','));
  if (p.minPrice !== undefined) qs.set('minPrice', String(p.minPrice));
  if (p.maxPrice !== undefined) qs.set('maxPrice', String(p.maxPrice));
  if (p.ratingMin !== undefined) qs.set('ratingMin', String(p.ratingMin));
  if (p.sortBy) qs.set('sortBy', p.sortBy);
  if (p.inStockOnly) qs.set('inStockOnly', 'true');
  qs.set('page', String(p.page ?? 1));
  qs.set('limit', String(Math.min(100, Math.max(1, p.limit ?? 20))));
  return qs.toString();
}

export async function fetchCatalogSearch(params: CatalogSearchParams): Promise<SearchResponse> {
  const res = await fetch(`/api/search/catalog?${toSearchParams(params)}`, {
    headers: { 'Content-Type': 'application/json' },
    next: { revalidate: 60 },
  });
  if (!res.ok) throw new Error('Failed to search catalog');
  return (await res.json()) as SearchResponse;
}

export async function fetchPredictive(query: string, limit = 5): Promise<SearchCard[]> {
  const res = await fetch(`/api/search/predictive?q=${encodeURIComponent(query)}&limit=${limit}`);
  if (!res.ok) throw new Error('Failed to fetch suggestions');
  return ((await res.json()) as SearchCard[]).slice(0, 5);
}
