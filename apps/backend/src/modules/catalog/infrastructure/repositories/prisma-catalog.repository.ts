// SSOT Phase 008 §5.1/§6.1/BDD — Prisma catalog repository (atomic bundle create, soft-delete,
// guarded stock, tenant-isolated stripped reads, versioned edge cache)
// Canonical: apps/backend/src/modules/catalog/infrastructure/repositories/prisma-catalog.repository.ts
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../infra/database/prisma.service';
import { RedisClusterService } from '../../../../infra/redis/redis-cluster.service';
import { CreateProductSchema, ListCatalogQuerySchema, type CreateProduct, type ListCatalogQuery } from '@repo/shared';
import { assertCreatable, assertPublishable } from '../../domain/entities/product.entity';
import { assertEbookCoherent } from '../../domain/entities/ebook-detail.entity';
import { assertReservable } from '../../domain/entities/physical-detail.entity';
import { normalizeSku } from '../../domain/value-objects/sku.vo';
import { productCreatedEvent } from '../../domain/events/product-created.event';
import { stockReservedEvent } from '../../domain/events/stock-reserved.event';
import { toDomainProduct, type DomainProduct } from '../mappers/product.mapper';

// Payload striping (§6.1): list cards carry only render-critical fields (<30MB LIFF RAM).
const LIST_SELECT = {
  id: true,
  tenantId: true,
  sellerId: true,
  title: true,
  slug: true,
  productType: true,
  status: true,
  price: true,
  discountPrice: true,
  isPublished: true,
  deletedAt: true,
  physicalDetail: { select: { stockQty: true, reservedQty: true, sku: true } },
  ebookDetail: { select: { totalPages: true, previewPages: true } },
  courseDetail: { select: { totalHours: true } },
  bundleChildren: { select: { childProductId: true } },
} as const;

const ITEM_INCLUDE = {
  physicalDetail: true,
  ebookDetail: { include: { chapters: true } },
  courseDetail: { include: { sections: { include: { lessons: true } } } },
  bundleChildren: { include: { childProduct: { select: { id: true, title: true, slug: true, productType: true, price: true } } } },
  categories: { include: { category: true } },
  tags: { include: { tag: true } },
} as const;

@Injectable()
export class PrismaCatalogRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
  ) {}

  private versionKey(tenantId: string | null): string {
    return `catalog:ver:${tenantId ?? 'global'}`;
  }

  private async version(tenantId: string | null): Promise<number> {
    const raw = await this.redis.get(this.versionKey(tenantId)).catch(() => null);
    return raw ? Number(raw) || 0 : 0;
  }

  private async bumpVersion(tenantId: string | null): Promise<void> {
    // Monotonic generation: list-cache keys embed it, so discovery invalidates in <100ms (BDD).
    await this.redis
      .setex(this.versionKey(tenantId), 86400, String((await this.version(tenantId)) + 1))
      .catch(() => undefined);
  }

  private publish(event: unknown): Promise<void> {
    return this.redis.publish('catalog-events', JSON.stringify(event)).catch(() => undefined).then(() => undefined);
  }

  async create(raw: CreateProduct): Promise<DomainProduct> {
    const parsed = CreateProductSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException('Invalid product payload');
    const input = parsed.data;
    assertCreatable(input);
    const sku = input.physicalDetail ? normalizeSku(input.physicalDetail.sku) : undefined;
    if (input.ebookDetail) assertEbookCoherent(input.ebookDetail.totalPages, input.ebookDetail.previewPages);

    const created = await this.prisma.$transaction(async (tx) => {
      if (input.bundleItemIds?.length) {
        const found = await tx.product.findMany({
          where: { id: { in: input.bundleItemIds }, deletedAt: null },
          select: { id: true },
        });
        if (found.length !== input.bundleItemIds.length) {
          throw new BadRequestException('Unknown or deleted bundle item');
        }
      }
      return tx.product.create({
        data: {
          tenantId: input.tenantId ?? undefined,
          sellerId: input.sellerId,
          title: input.title,
          slug: input.slug,
          description: input.description,
          coverImageUrl: input.coverImageUrl,
          productType: input.productType,
          price: input.price,
          discountPrice: input.discountPrice ?? undefined,
          physicalDetail: input.physicalDetail
            ? { create: { ...input.physicalDetail, ...(sku ? { sku } : {}) } }
            : undefined,
          ebookDetail: input.ebookDetail ? { create: { ...input.ebookDetail } } : undefined,
          courseDetail: input.courseDetail ? { create: { ...input.courseDetail } } : undefined,
          bundleChildren: input.bundleItemIds?.length
            ? { create: input.bundleItemIds.map((childProductId) => ({ childProductId })) }
            : undefined,
          categories: input.categoryIds?.length
            ? { create: input.categoryIds.map((categoryId) => ({ categoryId })) }
            : undefined,
          tags: input.tagIds?.length ? { create: input.tagIds.map((tagId) => ({ tagId })) } : undefined,
        },
        select: LIST_SELECT,
      });
    });

    await this.bumpVersion(input.tenantId ?? null).catch(() => undefined);
    await this.publish(productCreatedEvent({ productId: created.id, tenantId: input.tenantId ?? null, productType: created.productType }));
    return toDomainProduct(created);
  }

  async publishProduct(productId: string): Promise<DomainProduct> {
    const row = await this.prisma.product
      .findUnique({ where: { id: productId }, include: { physicalDetail: true, ebookDetail: true, courseDetail: true } })
      .catch(() => null);
    if (!row || row.deletedAt) throw new NotFoundException('Product not found');
    assertPublishable({
      productType: row.productType,
      physicalDetail: row.physicalDetail,
      ebookDetail: row.ebookDetail,
      courseDetail: row.courseDetail,
      deletedAt: row.deletedAt,
    });
    const updated = await this.prisma.product.update({
      where: { id: productId },
      data: { status: 'PUBLISHED', isPublished: true },
      select: LIST_SELECT,
    });
    await this.bumpVersion(updated.tenantId).catch(() => undefined);
    return toDomainProduct(updated);
  }

  /** Soft-delete: unpublish + timestamp; stock rows untouched for pending fulfillment (BDD). */
  async softDelete(productId: string): Promise<DomainProduct> {
    const row = await this.prisma.product.findUnique({ where: { id: productId } }).catch(() => null);
    if (!row || row.deletedAt) throw new NotFoundException('Product not found');
    const updated = await this.prisma.product.update({
      where: { id: productId },
      data: { isPublished: false, deletedAt: new Date() },
      select: LIST_SELECT,
    });
    await this.redis.del(`catalog:item:${updated.slug}`).catch(() => undefined);
    await this.bumpVersion(updated.tenantId).catch(() => undefined);
    await this.publish({ event: 'product.unpublished', productId, slug: updated.slug, tenantId: updated.tenantId });
    return toDomainProduct(updated);
  }

  async updateStock(productId: string, deltaQty: number): Promise<DomainProduct> {
    if (!Number.isInteger(deltaQty)) throw new BadRequestException('Invalid stock delta');
    const updated = await this.prisma.$transaction(async (tx) => {
      const detail = await tx.physicalDetail.findUnique({ where: { productId } });
      if (!detail) throw new NotFoundException('Physical stock not found');
      const nextStock = detail.stockQty + deltaQty;
      if (nextStock < 0) throw new BadRequestException('Stock cannot go negative');
      if (nextStock < detail.reservedQty) throw new BadRequestException('Stock below reserved quantity');
      await tx.physicalDetail.update({ where: { productId }, data: { stockQty: nextStock } });
      return tx.product.findUniqueOrThrow({ where: { id: productId }, select: LIST_SELECT });
    });
    await this.bumpVersion(updated.tenantId).catch(() => undefined);
    return toDomainProduct(updated);
  }

  async reserveStock(productId: string, qty: number): Promise<number> {
    const available = await this.prisma.$transaction(async (tx) => {
      const detail = await tx.physicalDetail.findUnique({ where: { productId } });
      if (!detail) throw new NotFoundException('Physical stock not found');
      assertReservable(detail.stockQty, detail.reservedQty, qty);
      const next = await tx.physicalDetail.update({
        where: { productId },
        data: { reservedQty: detail.reservedQty + qty },
      });
      return Math.max(0, next.stockQty - next.reservedQty);
    });
    const owner = await this.prisma.product
      .findUnique({ where: { id: productId }, select: { tenantId: true } })
      .catch(() => null);
    await this.bumpVersion(owner?.tenantId ?? null).catch(() => undefined);
    await this.publish(stockReservedEvent({ productId, qty, availableAfter: available }));
    return available;
  }

  async getBySlug(slug: string): Promise<DomainProduct & { description: string }> {
    const cached = await this.redis.get(`catalog:item:${slug}`).catch(() => null);
    if (cached) return JSON.parse(cached) as DomainProduct & { description: string };
    const row = await this.prisma.product
      .findUnique({ where: { slug }, include: ITEM_INCLUDE })
      .catch(() => null);
    if (!row || row.deletedAt || !row.isPublished) throw new NotFoundException('Product not found');
    const mapped = {
      ...toDomainProduct(row),
      description: row.description,
      bundleChildrenDetail: row.bundleChildren.map((b) => b.childProduct),
    };
    await this.redis.setex(`catalog:item:${slug}`, 300, JSON.stringify(mapped)).catch(() => undefined);
    return mapped;
  }

  async list(raw: ListCatalogQuery): Promise<{ items: DomainProduct[]; page: number; pageSize: number }> {
    const parsed = ListCatalogQuerySchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException('Invalid catalog query');
    const q = parsed.data;
    const ver = await this.version(q.tenantId ?? null);
    const key = `catalog:list:${q.tenantId ?? 'all'}:${q.productType ?? 'all'}:${q.search ?? '-'}:${q.page}:${q.pageSize}:v${ver}`;
    const cached = await this.redis.get(key).catch(() => null);
    if (cached) return JSON.parse(cached) as { items: DomainProduct[]; page: number; pageSize: number };

    const rows = await this.prisma.product.findMany({
      where: {
        deletedAt: null,
        isPublished: true,
        ...(q.tenantId ? { tenantId: q.tenantId } : {}),
        ...(q.productType ? { productType: q.productType } : {}),
        ...(q.search ? { title: { contains: q.search, mode: 'insensitive' } } : {}),
      },
      select: LIST_SELECT,
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    });
    const result = { items: rows.map(toDomainProduct), page: q.page, pageSize: q.pageSize };
    await this.redis.setex(key, 120, JSON.stringify(result)).catch(() => undefined);
    return result;
  }
}
