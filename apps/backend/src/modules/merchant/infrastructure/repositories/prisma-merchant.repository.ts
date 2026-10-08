// SSOT Phase 073 §5 — Prisma merchant repository (tenant-scoped writes)
// Canonical: apps/backend/src/modules/merchant/infrastructure/repositories/prisma-merchant.repository.ts
// - Every read/write carries tenantId (BDD-1 isolation; no unscoped queries).
// - Payout creation runs inside prisma.$transaction (Gate 7 atomic).
// - Structural prisma typing (Phase 027/029 precedent). Zero new deps.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../infra/database/prisma.service';
import type { MerchantProductUpsert } from '@repo/shared';

export interface MerchantRepository {
  findProductBySlug(tenantId: string, slug: string): Promise<{ id: string } | null>;
  createProduct(input: MerchantProductUpsert): Promise<{ id: string; slug: string }>;
  updateProduct(id: string, input: MerchantProductUpsert): Promise<{ id: string; slug: string }>;
  findMerchantByTenant(tenantId: string): Promise<{ id: string; tenantId: string } | null>;
  createPayoutAtomic(profileId: string, amounts: { gross: number; tax: number; fee: number; net: number }): Promise<{ id: string; netAmount: unknown }>;
  findOrderTenant(orderId: string): Promise<string | null>;
  upsertFulfillment(args: {
    orderId: string; warehouseId: string; status: string; courierName?: string;
    trackingNumber?: string; shippingLabelUrl?: string;
  }): Promise<{ id: string; status: string }>;
  analyticsRange(tenantId: string, from: Date, to: Date): Promise<Array<{
    recordDate: Date; totalGmv: unknown; totalOrders: number;
    ebookSalesCount: number; courseSalesCount: number; physicalSalesCount: number; newStudentsCount: number;
  }>>;
}

function detailsOf(input: MerchantProductUpsert): Record<string, unknown> {
  const base = {
    title: input.title,
    slug: input.slug,
    description: input.description,
    coverImageUrl: input.coverImageUrl,
    productType: input.productType,
    price: input.price,
    ...(typeof input.discountPrice === 'number' ? { discountPrice: input.discountPrice } : {}),
    isPublished: input.isPublished,
  };
  if (input.productType === 'PHYSICAL_BOOK' && input.physicalDetail) {
    return {
      ...base,
      physicalDetail: {
        ...(input.id ? {} : {
          create: {
            isbn: input.physicalDetail.isbn,
            weightGrams: input.physicalDetail.weightGrams,
            stockQty: input.physicalDetail.stockQty,
            sku: input.physicalDetail.sku,
          },
        }),
        ...(input.id ? {
          upsert: {
            create: {
              isbn: input.physicalDetail.isbn,
              weightGrams: input.physicalDetail.weightGrams,
              stockQty: input.physicalDetail.stockQty,
              sku: input.physicalDetail.sku,
            },
            update: {
              ...(input.physicalDetail.isbn ? { isbn: input.physicalDetail.isbn } : {}),
              weightGrams: input.physicalDetail.weightGrams,
              stockQty: input.physicalDetail.stockQty,
              sku: input.physicalDetail.sku,
            },
          },
        } : {}),
      },
    };
  }
  if (input.productType === 'EBOOK' && input.ebookDetail) {
    const ebook = {
      previewPages: input.ebookDetail.previewPages,
      storagePathR2: input.ebookDetail.storagePathR2,
      totalPages: 0,
      fileHash: 'pending',
    };
    return { ...base, ebookDetail: input.id ? { upsert: { create: ebook, update: ebook } } : { create: ebook } };
  }
  if ((input.productType === 'ELEARNING_COURSE' || input.productType === 'LIVE_CLASS') && input.courseDetail) {
    const course = {
      certificateEnabled: input.courseDetail.certificateEnabled,
      dripContentEnabled: input.courseDetail.dripContentDays > 0,
    };
    return { ...base, courseDetail: input.id ? { upsert: { create: course, update: course } } : { create: course } };
  }
  return base;
}

@Injectable()
export class PrismaMerchantRepository implements MerchantRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get db(): Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>> {
    return this.prisma as unknown as Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>>;
  }

  async findProductBySlug(tenantId: string, slug: string) {
    return (await this.db['product'].findFirst({ where: { tenantId, slug } }).catch(() => null)) as { id: string } | null;
  }

  async createProduct(input: MerchantProductUpsert) {
    const created = (await this.db['product'].create({
      data: { tenantId: input.tenantId, sellerId: input.tenantId, ...detailsOf(input) },
    })) as unknown as { id: string; slug: string };
    return { id: created.id, slug: created.slug };
  }

  async updateProduct(id: string, input: MerchantProductUpsert) {
    const updated = (await this.db['product'].update({ where: { id }, data: detailsOf(input) })) as unknown as { id: string; slug: string };
    return { id: updated.id, slug: updated.slug };
  }

  async findMerchantByTenant(tenantId: string) {
    return (await this.db['merchantProfile'].findUnique({ where: { tenantId } }).catch(() => null)) as { id: string; tenantId: string } | null;
  }

  async createPayoutAtomic(profileId: string, amounts: { gross: number; tax: number; fee: number; net: number }) {
    return this.prisma.$transaction(async (tx) => {
      const t = tx as unknown as Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>>;
      return (await t['payoutTransaction'].create({
        data: {
          merchantProfileId: profileId,
          grossAmount: amounts.gross,
          withholdingTax: amounts.tax,
          processingFee: amounts.fee,
          netAmount: amounts.net,
          payoutStatus: 'PENDING',
        },
      })) as unknown as { id: string; netAmount: unknown };
    });
  }

  async findOrderTenant(orderId: string) {
    const order = (await this.db['order'].findUnique({ where: { id: orderId } }).catch(() => null)) as { tenantId: string | null } | null;
    return order?.tenantId ?? null;
  }

  async upsertFulfillment(args: {
    orderId: string; warehouseId: string; status: string; courierName?: string;
    trackingNumber?: string; shippingLabelUrl?: string;
  }) {
    const data = {
      warehouseId: args.warehouseId,
      status: args.status,
      ...(args.courierName ? { courierName: args.courierName } : {}),
      ...(args.trackingNumber ? { trackingNumber: args.trackingNumber } : {}),
      ...(args.shippingLabelUrl ? { shippingLabelUrl: args.shippingLabelUrl } : {}),
      ...(args.status === 'SHIPPED' ? { shippedAt: new Date() } : {}),
      ...(args.status === 'DELIVERED' ? { deliveredAt: new Date() } : {}),
    };
    return (await this.db['orderFulfillment'].upsert({
      where: { orderId: args.orderId },
      create: { orderId: args.orderId, ...data },
      update: data,
    })) as unknown as { id: string; status: string };
  }

  async analyticsRange(tenantId: string, from: Date, to: Date) {
    return (await this.db['merchantAnalyticsDaily'].findMany({
      where: { tenantId, recordDate: { gte: from, lte: to } },
      orderBy: { recordDate: 'asc' },
    }).catch(() => [])) as Array<{
      recordDate: Date; totalGmv: unknown; totalOrders: number;
      ebookSalesCount: number; courseSalesCount: number; physicalSalesCount: number; newStudentsCount: number;
    }>;
  }
}
