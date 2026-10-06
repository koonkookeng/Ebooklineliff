// SSOT Phase 010 §3.1 — Storefront feed & multi-format PDP Zod domain contract
// Canonical: packages/shared/src/schemas/storefront.schema.ts
// (legacy src/shared/schemas/storefront.schema.ts)
// Zero-redundant policy: ProductTypeEnum owned by ./sdid-contract; re-exported type only via barrel.
import { z } from 'zod';
import { ProductTypeEnum } from './sdid-contract';

export const StorefrontBannerSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  imageUrl: z.string().url(),
  targetUrl: z.string().default('/'),
  displayOrder: z.number().int().default(0),
});
export type StorefrontBanner = z.infer<typeof StorefrontBannerSchema>;

export const CategoryQuickLinkSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  productCount: z.number().int().nonnegative().default(0),
});
export type CategoryQuickLink = z.infer<typeof CategoryQuickLinkSchema>;

export const ProductCardSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  slug: z.string(),
  coverImageUrl: z.string().url(),
  productType: ProductTypeEnum,
  price: z.number().positive(),
  discountPrice: z.number().positive().nullable(),
  rating: z.number().min(0).max(5).default(5.0),
  soldCount: z.number().int().nonnegative().default(0),
  isBestseller: z.boolean().default(false),
});
export type ProductCard = z.infer<typeof ProductCardSchema>;

const PhysicalDetailCardSchema = z.object({
  isbn: z.string().nullable(),
  weightGrams: z.number().int().nonnegative(),
  stockQty: z.number().int().nonnegative(),
});

const EbookDetailCardSchema = z.object({
  totalPages: z.number().int().positive(),
  previewPages: z.number().int().nonnegative(),
});

const CourseLessonCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  durationSec: z.number().int().nonnegative(),
  isPreview: z.boolean(),
});

const CourseSectionCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  lessons: z.array(CourseLessonCardSchema),
});

const CourseDetailCardSchema = z.object({
  totalHours: z.number().nonnegative(),
  totalLessons: z.number().int().nonnegative(),
  sections: z.array(CourseSectionCardSchema),
});

export const ProductDetailSchema = ProductCardSchema.extend({
  description: z.string(),
  sellerId: z.string().uuid(),
  sellerName: z.string(),
  sellerAvatarUrl: z.string().url().nullable(),
  physicalDetail: PhysicalDetailCardSchema.nullable(),
  ebookDetail: EbookDetailCardSchema.nullable(),
  courseDetail: CourseDetailCardSchema.nullable(),
});
export type ProductDetail = z.infer<typeof ProductDetailSchema>;

export const StorefrontFeedSchema = z.object({
  banners: z.array(StorefrontBannerSchema),
  categories: z.array(CategoryQuickLinkSchema),
  featuredProducts: z.array(ProductCardSchema),
  bestsellerProducts: z.array(ProductCardSchema),
  newReleases: z.array(ProductCardSchema),
});
export type StorefrontFeed = z.infer<typeof StorefrontFeedSchema>;

/** Effective price (discount wins when below price); satang-safe integer math. */
export function effectivePrice(card: Pick<ProductCard, 'price' | 'discountPrice'>): number {
  if (card.discountPrice !== null && card.discountPrice < card.price) return card.discountPrice;
  return card.price;
}

/** Discount percent 0-100 (0 when no valid discount). */
export function discountPercent(card: Pick<ProductCard, 'price' | 'discountPrice'>): number {
  if (card.discountPrice === null || card.discountPrice >= card.price || card.price <= 0) return 0;
  return Math.round((1 - card.discountPrice / card.price) * 100);
}
