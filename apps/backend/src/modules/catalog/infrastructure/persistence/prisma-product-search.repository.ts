// SSOT Phase 009 §5.1 — Prisma product-search repository (parallel data+count+facets, <80ms)
// Canonical: apps/backend/src/modules/catalog/infrastructure/persistence/prisma-product-search.repository.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../../infra/database/prisma.service';
import {
  ProductFilterInputSchema,
  PredictiveSearchQuerySchema,
  sanitizeSearchQuery,
  type ProductFilterInput,
  type ProductSearchResponse,
  type PredictiveSuggestion,
} from '@repo/shared';
import {
  buildFacets,
  buildHighlightSnippet,
  paginate,
  toSearchItem,
} from '../../domain/entities/product-search-result.entity';
import { buildSearchWhere, mapSortOrder } from '../search-engine/postgres-fts.engine';
import type { IProductSearchRepository } from '../../domain/repositories/product-search.repository.interface';

const SEARCH_SELECT = {
  id: true,
  title: true,
  slug: true,
  coverImageUrl: true,
  productType: true,
  price: true,
  discountPrice: true,
  ratingAverage: true,
  reviewCount: true,
  physicalDetail: { select: { stockQty: true, reservedQty: true } },
} as const;

type RawRow = Record<string, unknown>;

function toSuggestion(r: RawRow, query: string): Record<string, unknown> {
  const item = toSearchItem({
    id: r['id'] as string,
    title: r['title'] as string,
    slug: r['slug'] as string,
    coverImageUrl: r['coverImageUrl'] as string,
    productType: r['productType'] as string,
    price: r['price'],
    discountPrice: (r['discountPrice'] as unknown) ?? null,
    ratingAverage: r['ratingAverage'],
    reviewCount: (r['reviewCount'] as number) ?? 0,
    stockQty: ((r['physicalDetail'] as { stockQty?: number } | null)?.stockQty ?? null) as number | null,
    reservedQty: (r['physicalDetail'] as { reservedQty?: number } | null)?.reservedQty ?? 0,
  });
  return { ...(item as unknown as Record<string, unknown>), highlightSnippet: buildHighlightSnippet(r['title'] as string, query) };
}

@Injectable()
export class PrismaProductSearchRepository implements IProductSearchRepository {
  constructor(private readonly prisma: PrismaService) {}

  async search(raw: ProductFilterInput): Promise<ProductSearchResponse> {
    const parsed = ProductFilterInputSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException('Invalid product filter');
    const filter = parsed.data;
    const where = buildSearchWhere(filter);

    const [rows, totalCount, facetRaw] = await Promise.all([
      this.prisma.product.findMany({
        where: where as never,
        select: SEARCH_SELECT,
        orderBy: mapSortOrder(filter.sortBy) as never,
        take: filter.limit,
        skip: (filter.page - 1) * filter.limit,
      }),
      this.prisma.product.count({ where: where as never }),
      this.prisma.product.groupBy({
        by: ['productType'],
        where: where as never,
        _count: { _all: true },
      }),
    ]);

    const items = (rows as unknown as Array<Record<string, unknown>>).map((r) =>
      toSearchItem({
        id: r['id'] as string,
        title: r['title'] as string,
        slug: r['slug'] as string,
        coverImageUrl: r['coverImageUrl'] as string,
        productType: r['productType'] as string,
        price: r['price'],
        discountPrice: (r['discountPrice'] as unknown) ?? null,
        ratingAverage: r['ratingAverage'],
        reviewCount: (r['reviewCount'] as number) ?? 0,
        stockQty: ((r['physicalDetail'] as { stockQty?: number } | null)?.stockQty ?? null) as number | null,
        reservedQty: (r['physicalDetail'] as { reservedQty?: number } | null)?.reservedQty ?? 0,
      }),
    );

    const facets = buildFacets(
      (facetRaw as Array<{ productType: string; _count: { _all: number } }>).map((f) => ({
        productType: f.productType,
        _count: f._count,
      })),
    );

    const { hasNextPage, nextCursor } = paginate(filter.page, filter.limit, totalCount);
    return { items: items as never, facets, totalCount, hasNextPage, nextCursor };
  }

  async predictive(rawQuery: string, rawLimit: number): Promise<PredictiveSuggestion[]> {
    const parsed = PredictiveSearchQuerySchema.safeParse({
      query: sanitizeSearchQuery(rawQuery),
      limit: rawLimit,
    });
    if (!parsed.success) throw new BadRequestException('Invalid predictive query');
    const { query, limit } = parsed.data;
    const rows = await this.prisma.product.findMany({
      where: {
        isPublished: true,
        deletedAt: null,
        OR: [
          { title: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
        ],
      } as never,
      select: SEARCH_SELECT,
      orderBy: [{ reviewCount: 'desc' }, { ratingAverage: 'desc' }] as never,
      take: limit,
    });
    return (rows as unknown as Array<Record<string, unknown>>).map((r) =>
      toSuggestion(r, query),
    ) as never;
  }
}
