// SSOT Phase 009 §5.1 — Product search result entity (pure; Prisma row in, decisions out)
// Canonical: apps/backend/src/modules/catalog/domain/entities/product-search-result.entity.ts
import { BadRequestException } from '@nestjs/common';

export interface SearchItemRow {
  id: string;
  title: string;
  slug: string;
  coverImageUrl: string;
  productType: string;
  price: unknown;
  discountPrice: unknown | null;
  ratingAverage: unknown;
  reviewCount: number;
  stockQty?: number | null;
  reservedQty?: number | null;
}

export interface SearchResultItem {
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

const toNum = (v: unknown, fallback = 0): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  if (v !== null && typeof v === 'object' && 'toNumber' in (v as Record<string, unknown>)) {
    try {
      return ((v as { toNumber(): number }).toNumber() as number) ?? fallback;
    } catch {
      return fallback;
    }
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** Map a Prisma row to a stripped search card (<30MB LIFF RAM: no description/body). */
export function toSearchItem(row: SearchItemRow): SearchResultItem {
  if (!row?.id || !row?.title || !row?.slug) {
    throw new BadRequestException('Invalid product row');
  }
  const stock = row.stockQty ?? null;
  const reserved = row.reservedQty ?? 0;
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    coverImageUrl: row.coverImageUrl,
    productType: row.productType,
    price: toNum(row.price),
    discountPrice: row.discountPrice === null || row.discountPrice === undefined ? null : toNum(row.discountPrice),
    ratingAverage: toNum(row.ratingAverage),
    reviewCount: row.reviewCount ?? 0,
    isAvailable: stock === null ? true : stock - (reserved ?? 0) > 0,
  };
}

/** Build <mark>-highlighted snippet (max 120 chars, HTML-escaped outside marks). */
export function buildHighlightSnippet(title: string, query: string): string | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const idx = title.toLowerCase().indexOf(q);
  if (idx < 0) return title.slice(0, 120);
  const start = Math.max(0, idx - 30);
  const end = Math.min(title.length, idx + q.length + 30);
  const esc = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `${start > 0 ? '…' : ''}${esc(title.slice(start, idx))}<mark>${esc(
    title.slice(idx, idx + q.length),
  )}</mark>${esc(title.slice(idx + q.length, end))}${end < title.length ? '…' : ''}`;
}

/** Aggregate raw groupBy rows into facet list (productType facet first, then price buckets). */
export function buildFacets(
  typeGroups: Array<{ productType: string; _count: { _all: number } }>,
  priceBuckets?: Array<{ bucket: string; count: number }>,
): FacetCount[] {
  const facets: FacetCount[] = typeGroups.map((g) => ({
    facetName: 'productType',
    value: g.productType,
    count: g._count._all,
  }));
  for (const b of priceBuckets ?? []) {
    facets.push({ facetName: 'priceBucket', value: b.bucket, count: b.count });
  }
  return facets;
}

/** Cursor pagination decision (offset-based page + opaque next cursor). */
export function paginate(page: number, limit: number, totalCount: number): {
  hasNextPage: boolean;
  nextCursor: string | null;
} {
  const hasNextPage = page * limit < totalCount;
  return {
    hasNextPage,
    nextCursor: hasNextPage ? Buffer.from(`p:${page + 1}:l:${limit}`).toString('base64url') : null,
  };
}
