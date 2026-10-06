// SSOT Phase 008 §5.1 — Product entity invariants (pure; Prisma row in, decisions out)
// Canonical: apps/backend/src/modules/catalog/domain/entities/product.entity.ts
import { BadRequestException } from '@nestjs/common';
import type { CreateProduct } from '@repo/shared';

const DETAIL_BY_TYPE: Record<string, 'physicalDetail' | 'ebookDetail' | 'courseDetail' | null> = {
  PHYSICAL_BOOK: 'physicalDetail',
  EBOOK: 'ebookDetail',
  ELEARNING_COURSE: 'courseDetail',
  LIVE_CLASS: null,
  HYBRID_BUNDLE: null,
};

/** Creation-time invariants: type/detail coherence, bundle minimum, price coherence. */
export function assertCreatable(input: CreateProduct): void {
  const required = DETAIL_BY_TYPE[input.productType];
  if (required && !input[required]) {
    throw new BadRequestException(`Missing ${required} for ${input.productType}`);
  }
  if (input.productType === 'HYBRID_BUNDLE') {
    if (!input.bundleItemIds || input.bundleItemIds.length < 2) {
      throw new BadRequestException('HYBRID_BUNDLE requires at least 2 bundle items');
    }
    if (new Set(input.bundleItemIds).size !== input.bundleItemIds.length) {
      throw new BadRequestException('Duplicate bundle items');
    }
  } else if (input.bundleItemIds?.length) {
    throw new BadRequestException('Only HYBRID_BUNDLE accepts bundleItemIds');
  }
  if (input.discountPrice !== undefined && input.discountPrice >= input.price) {
    throw new BadRequestException('discountPrice must be below price');
  }
}

/** Publish-time invariants: published rows need their type detail + no soft-delete flag. */
export function assertPublishable(row: {
  productType: string;
  physicalDetail: unknown;
  ebookDetail: unknown;
  courseDetail: unknown;
  deletedAt: Date | null;
}): void {
  if (row.deletedAt) throw new BadRequestException('Cannot publish a deleted product');
  const required = DETAIL_BY_TYPE[row.productType];
  if (required && !row[required]) {
    throw new BadRequestException(`Missing ${required} for ${row.productType}`);
  }
}
