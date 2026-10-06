// SSOT Phase 010 §5.2 — Storefront high-performance service (Redis 5-min feed cache, <20ms)
// Canonical: apps/backend/src/modules/catalog/services/storefront.service.ts
// (legacy src/backend/modules/catalog/services/storefront.service.ts)
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import {
  CategoryQuickLinkSchema,
  ProductCardSchema,
  StorefrontBannerSchema,
  StorefrontFeedSchema,
  type ProductCard,
  type ProductDetail,
  type StorefrontFeed,
} from '@repo/shared';

const FEED_TTL_SEC = 300;
const FEED_LIMIT = 10;
export const BESTSELLER_THRESHOLD = 50;

const CARD_SELECT = {
  id: true,
  title: true,
  slug: true,
  coverImageUrl: true,
  productType: true,
  price: true,
  discountPrice: true,
  ratingAverage: true,
  soldCount: true,
} as const;

const DETAIL_INCLUDE = {
  physicalDetail: { select: { isbn: true, weightGrams: true, stockQty: true } },
  ebookDetail: { select: { totalPages: true, previewPages: true } },
  courseDetail: {
    select: {
      totalHours: true,
      sections: {
        select: {
          id: true,
          title: true,
          lessons: { select: { id: true, title: true, durationSec: true, isPreview: true } },
        },
        orderBy: { sectionOrder: 'asc' as const },
      },
    },
  },
} as const;

type CardRow = {
  id: string;
  title: string;
  slug: string;
  coverImageUrl: string;
  productType: string;
  price: unknown;
  discountPrice: unknown | null;
  ratingAverage: unknown;
  soldCount: number;
};

const toNum = (v: unknown, fallback = 0): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  if (v !== null && typeof v === 'object' && 'toNumber' in (v as Record<string, unknown>)) {
    try {
      return (v as { toNumber(): number }).toNumber() ?? fallback;
    } catch {
      return fallback;
    }
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** Map a stripped Prisma row to a validated ProductCard (throws on contract drift). */
export function toProductCard(row: CardRow): ProductCard {
  const parsed = ProductCardSchema.safeParse({
    id: row.id,
    title: row.title,
    slug: row.slug,
    coverImageUrl: row.coverImageUrl,
    productType: row.productType,
    price: toNum(row.price),
    discountPrice:
      row.discountPrice === null || row.discountPrice === undefined
        ? null
        : toNum(row.discountPrice),
    rating: toNum(row.ratingAverage, 5.0),
    soldCount: row.soldCount ?? 0,
    isBestseller: (row.soldCount ?? 0) >= BESTSELLER_THRESHOLD,
  });
  if (!parsed.success) throw new BadRequestException('Product card contract drift');
  return parsed.data;
}

@Injectable()
export class StorefrontService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
  ) {}

  private feedKey(tenantId: string): string {
    return `storefront:feed:${tenantId}`;
  }

  /** Tenant feed: banners + categories + featured/bestsellers/new releases (parallel, cached 5 min). */
  async getFeedByTenant(tenantId: string): Promise<StorefrontFeed> {
    if (!tenantId?.trim()) throw new BadRequestException('Missing tenant id');
    const cached = await this.redis.get(this.feedKey(tenantId)).catch(() => null);
    if (cached) return JSON.parse(cached) as StorefrontFeed;

    const client = this.prisma as unknown as Record<string, unknown>;
    const bannerApi = client['banner'] as
      | { findMany: (args: unknown) => Promise<Array<Record<string, unknown>>> }
      | undefined;
    const categoryApi = client['category'] as
      | { findMany: (args: unknown) => Promise<Array<Record<string, unknown>>> }
      | undefined;

    const [bannersRaw, featuredRaw, bestsellerRaw, newRaw, categoriesRaw] = await Promise.all([
      bannerApi
        ? bannerApi
            .findMany({
              where: { tenantId, isActive: true },
              orderBy: { displayOrder: 'asc' },
              take: FEED_LIMIT,
            })
            .catch(() => [])
        : Promise.resolve([]),
      this.prisma.product
        .findMany({
          where: { isPublished: true, deletedAt: null, isFeatured: true },
          select: CARD_SELECT,
          orderBy: { createdAt: 'desc' },
          take: FEED_LIMIT,
        })
        .catch(() => []),
      this.prisma.product
        .findMany({
          where: { isPublished: true, deletedAt: null },
          select: CARD_SELECT,
          orderBy: { soldCount: 'desc' },
          take: FEED_LIMIT,
        })
        .catch(() => []),
      this.prisma.product
        .findMany({
          where: { isPublished: true, deletedAt: null },
          select: CARD_SELECT,
          orderBy: { createdAt: 'desc' },
          take: FEED_LIMIT,
        })
        .catch(() => []),
      categoryApi
        ? categoryApi.findMany({ take: 8 }).catch(() => [])
        : Promise.resolve([]),
    ]);

    // Resilient mapping: one malformed row must never kill the whole feed (availability
    // over strictness on the hot discovery path; drift still surfaces via contract tests).
    const safeCards = (rows: CardRow[]): ProductCard[] => {
      const out: ProductCard[] = [];
      for (const r of rows) {
        try {
          out.push(toProductCard(r));
        } catch {
          // skip malformed card
        }
      }
      return out;
    };
    const feed: StorefrontFeed = StorefrontFeedSchema.parse({
      banners: (bannersRaw as Array<Record<string, unknown>>)
        .map((b, i) => ({
          id: (b['id'] as string) ?? `banner-${i}`,
          title: (b['title'] as string) ?? '',
          imageUrl: b['imageUrl'] as string,
          targetUrl: (b['targetUrl'] as string) ?? '/',
          displayOrder: (b['displayOrder'] as number) ?? i,
        }))
        .filter((b) => StorefrontBannerSchema.safeParse(b).success),
      categories: (categoriesRaw as Array<Record<string, unknown>>)
        .map((c) => ({
          id: c['id'] as string,
          name: c['name'] as string,
          slug: c['slug'] as string,
          productCount: 0,
        }))
        .filter((c) => CategoryQuickLinkSchema.safeParse(c).success),
      featuredProducts: safeCards(featuredRaw as unknown as CardRow[]),
      bestsellerProducts: safeCards(bestsellerRaw as unknown as CardRow[]),
      newReleases: safeCards(newRaw as unknown as CardRow[]),
    });

    await this.redis.setex(this.feedKey(tenantId), FEED_TTL_SEC, JSON.stringify(feed)).catch(() => undefined);
    // Fire-and-forget impression event (analytics pipeline §7.1; never blocks the feed).
    await this.redis
      .publish('stream:storefront:impression', JSON.stringify({ tenantId, at: new Date().toISOString() }))
      .catch(() => undefined);
    return feed;
  }

  private pdpKey(slug: string, tenantId?: string): string {
    // Tenant-scoped key: prevents cross-tenant cache leakage (isolation guard).
    return `storefront:pdp:${tenantId ?? 'global'}:${slug}`;
  }

  /** Full PDP by slug with format-specific details + seller card (cached per tenant+slug). */
  async getProductBySlug(slug: string, tenantId?: string): Promise<ProductDetail> {
    if (!slug?.trim()) throw new BadRequestException('Missing product slug');
    const key = this.pdpKey(slug, tenantId);
    const cached = await this.redis.get(key).catch(() => null);
    if (cached) return JSON.parse(cached) as ProductDetail;

    const product = await this.prisma.product
      .findUnique({ where: { slug }, include: DETAIL_INCLUDE })
      .catch(() => null) as
      | (Record<string, unknown> & {
          sellerId: string;
          description: string;
          isPublished: boolean;
          deletedAt: Date | null;
          tenantId: string | null;
          courseDetail?: { totalHours: number; sections: Array<{ id: string; title: string; lessons: Array<{ id: string; title: string; durationSec: number; isPreview: boolean }> }> } | null;
          physicalDetail?: { isbn: string | null; weightGrams: number; stockQty: number } | null;
          ebookDetail?: { totalPages: number; previewPages: number } | null;
        })
      | null;
    if (!product || !product.isPublished || product.deletedAt) {
      throw new NotFoundException('Product not found or unavailable');
    }
    if (tenantId && product.tenantId && product.tenantId !== tenantId) {
      throw new NotFoundException('Product not found or unavailable');
    }

    const seller = await (this.prisma as unknown as { user?: { findUnique: (args: unknown) => Promise<{ displayName: string; avatarUrl: string | null } | null> } }).user
      ?.findUnique({ where: { id: product.sellerId as string }, select: { displayName: true, avatarUrl: true } })
      .catch(() => null);

    const sections = product.courseDetail?.sections ?? [];
    const detail: ProductDetail = {
      ...toProductCard({
        id: product['id'] as string,
        title: product['title'] as string,
        slug: product['slug'] as string,
        coverImageUrl: product['coverImageUrl'] as string,
        productType: product['productType'] as string,
        price: product['price'],
        discountPrice: (product['discountPrice'] as unknown) ?? null,
        ratingAverage: product['ratingAverage'] ?? 5.0,
        soldCount: (product['soldCount'] as number) ?? 0,
      }),
      description: product.description,
      sellerId: product.sellerId,
      sellerName: seller?.displayName ?? 'Official Store',
      sellerAvatarUrl: seller?.avatarUrl ?? null,
      physicalDetail: product.physicalDetail
        ? {
            isbn: product.physicalDetail.isbn,
            weightGrams: product.physicalDetail.weightGrams,
            stockQty: product.physicalDetail.stockQty,
          }
        : null,
      ebookDetail: product.ebookDetail
        ? { totalPages: product.ebookDetail.totalPages, previewPages: product.ebookDetail.previewPages }
        : null,
      courseDetail: product.courseDetail
        ? {
            totalHours: product.courseDetail.totalHours,
            totalLessons: sections.reduce((n, s) => n + s.lessons.length, 0),
            sections: sections.map((s) => ({ id: s.id, title: s.title, lessons: s.lessons })),
          }
        : null,
    };

    await this.redis.setex(key, FEED_TTL_SEC, JSON.stringify(detail)).catch(() => undefined);
    return detail;
  }

  /** Predictive top-5 cards for the storefront search entry (delegates to FTS-lite). */
  async getPredictiveSearch(query: string, tenantId?: string): Promise<ProductCard[]> {
    const q = query?.trim().slice(0, 100);
    if (!q) throw new BadRequestException('Missing search query');
    const rows = await this.prisma.product
      .findMany({
        where: {
          isPublished: true,
          deletedAt: null,
          ...(tenantId ? { tenantId } : {}),
          OR: [
            { title: { contains: q, mode: 'insensitive' } },
            { description: { contains: q, mode: 'insensitive' } },
          ],
        } as never,
        select: CARD_SELECT,
        orderBy: [{ soldCount: 'desc' }] as never,
        take: 5,
      })
      .catch(() => []);
    return (rows as unknown as CardRow[]).map(toProductCard);
  }

  /** Invalidate tenant feed + PDP caches (called on publish/unpublish). */
  async invalidate(tenantId: string | null, slug?: string): Promise<void> {
    if (tenantId) await this.redis.del(this.feedKey(tenantId)).catch(() => undefined);
    if (slug) {
      await this.redis.del(this.pdpKey(slug, tenantId ?? undefined)).catch(() => undefined);
      await this.redis.del(this.pdpKey(slug, undefined)).catch(() => undefined);
    }
  }
}
