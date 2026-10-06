// SSOT Phase 008 §5.1/§6.1 — Prisma row -> domain product (Decimal-safe, payload-stripped)
// Canonical: apps/backend/src/modules/catalog/infrastructure/mappers/product.mapper.ts
import { toSatang } from '../../domain/value-objects/money.vo';

export interface DomainStock {
  stockQty: number;
  reservedQty: number;
  available: number;
  sku: string;
}

export interface DomainProduct {
  id: string;
  tenantId: string | null;
  sellerId: string;
  title: string;
  slug: string;
  productType: string;
  status: string;
  priceSatang: number;
  discountSatang: number | null;
  isPublished: boolean;
  deletedAt: Date | null;
  stock: DomainStock | null;
  ebook: { totalPages: number; previewPages: number } | null;
  course: { totalHours: number } | null;
  bundleChildIds: string[];
}

type DecimalLike = number | string | { toNumber(): number };

interface ProductRow {
  id: string;
  tenantId: string | null;
  sellerId: string;
  title: string;
  slug: string;
  productType: string;
  status: string;
  price: DecimalLike;
  discountPrice: DecimalLike | null;
  isPublished: boolean;
  deletedAt: Date | null;
  physicalDetail?: { stockQty: number; reservedQty: number; sku: string } | null;
  ebookDetail?: { totalPages: number; previewPages: number } | null;
  courseDetail?: { totalHours: number } | null;
  bundleChildren?: Array<{ childProductId: string }> | null;
}

export function toDomainProduct(row: ProductRow): DomainProduct {
  return {
    id: row.id,
    tenantId: row.tenantId,
    sellerId: row.sellerId,
    title: row.title,
    slug: row.slug,
    productType: row.productType,
    status: row.status,
    priceSatang: toSatang(row.price),
    discountSatang: row.discountPrice === null ? null : toSatang(row.discountPrice),
    isPublished: row.isPublished,
    deletedAt: row.deletedAt,
    stock: row.physicalDetail
      ? {
          stockQty: row.physicalDetail.stockQty,
          reservedQty: row.physicalDetail.reservedQty,
          available: Math.max(0, row.physicalDetail.stockQty - row.physicalDetail.reservedQty),
          sku: row.physicalDetail.sku,
        }
      : null,
    ebook: row.ebookDetail
      ? { totalPages: row.ebookDetail.totalPages, previewPages: row.ebookDetail.previewPages }
      : null,
    course: row.courseDetail ? { totalHours: row.courseDetail.totalHours } : null,
    bundleChildIds: (row.bundleChildren ?? []).map((b) => b.childProductId),
  };
}
