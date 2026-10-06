// SSOT Phase 009 §5.1/§4.2 — Postgres FTS where/order builder (pure, unit-tested)
// Canonical: apps/backend/src/modules/catalog/infrastructure/search-engine/postgres-fts.engine.ts
// Strategy: Prisma `contains insensitive` for MVP + trigram index; raw tsvector SQL lives in
// product-search-indexes.sql. This builder MUST stay injection-free (no string interpolation
// of user input into raw SQL — values flow via Prisma params only).
import type { ProductFilterInput } from '@repo/shared';

export type PrismaWhere = Record<string, unknown>;

/** Build a tenant-isolated, published-only Prisma where clause from a validated filter. */
export function buildSearchWhere(filter: ProductFilterInput): PrismaWhere {
  const where: PrismaWhere = { isPublished: true, deletedAt: null };
  if (filter.tenantId) where['tenantId'] = filter.tenantId;
  if (filter.productTypes?.length) where['productType'] = { in: filter.productTypes };
  if (filter.minPrice !== undefined || filter.maxPrice !== undefined) {
    const price: Record<string, number> = {};
    if (filter.minPrice !== undefined) price['gte'] = filter.minPrice;
    if (filter.maxPrice !== undefined) price['lte'] = filter.maxPrice;
    where['price'] = price;
  }
  if (filter.ratingMin !== undefined) where['ratingAverage'] = { gte: filter.ratingMin };
  if (filter.query?.trim()) {
    const q = filter.query.trim();
    where['OR'] = [
      { title: { contains: q, mode: 'insensitive' } },
      { description: { contains: q, mode: 'insensitive' } },
    ];
  }
  if (filter.inStockOnly) {
    // Physical stock gate; digital goods (null physicalDetail) always pass.
    where['OR'] = [
      ...(Array.isArray(where['OR']) ? (where['OR'] as unknown[]) : []),
      { physicalDetail: null },
    ];
    // NOTE: strict stockQty>reservedQty enforcement happens post-map via isAvailable
    // to keep the query index-friendly (no JOIN filter on hot path).
  }
  return where;
}

/** Map public sort enum to Prisma orderBy (index-aligned). */
export function mapSortOrder(sortBy: string): Record<string, string> {
  switch (sortBy) {
    case 'PRICE_ASC':
      return { price: 'asc' };
    case 'PRICE_DESC':
      return { price: 'desc' };
    case 'RATING':
      return { ratingAverage: 'desc' };
    case 'POPULARITY':
      return { reviewCount: 'desc' };
    case 'NEWEST':
      return { createdAt: 'desc' };
    case 'RELEVANCE':
    default:
      return { createdAt: 'desc' };
  }
}

/** Escape a term for LIKE/ILIKE prefix use (defense-in-depth; Prisma still parametrizes). */
export function escapeLikeTerm(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`).slice(0, 100);
}
