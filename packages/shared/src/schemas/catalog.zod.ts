// SSOT Phase 008 §3.1 — Product catalog Zod domain contract (multi-format: physical/ebook/course/bundle)
// Canonical: packages/shared/src/schemas/catalog.zod.ts (legacy src/shared/schemas/catalog.zod.ts)
import { z } from 'zod';

// NOTE: ProductTypeEnum is owned by ./sdid-contract (Phase 000 SSOT) — re-exported here under
// the Phase 008 §3.1 vocabulary (zero-redundant policy, single source of truth).
import { ProductTypeEnum } from './sdid-contract';
export { ProductTypeEnum };

export const ProductStatusEnum = z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED', 'SUSPENDED']);
export type ProductStatus = z.infer<typeof ProductStatusEnum>;

export const CreatePhysicalDetailSchema = z.object({
  isbn: z.string().min(10).max(20).optional(),
  weightGrams: z.number().int().positive(),
  lengthCm: z.number().positive().optional(),
  widthCm: z.number().positive().optional(),
  heightCm: z.number().positive().optional(),
  stockQty: z.number().int().nonnegative().default(0),
  sku: z.string().min(3).max(64),
});
export type CreatePhysicalDetail = z.infer<typeof CreatePhysicalDetailSchema>;

export const CreateEbookDetailSchema = z.object({
  totalPages: z.number().int().positive(),
  previewPages: z.number().int().nonnegative().default(10),
  storagePathR2: z.string().min(1),
  fileHash: z.string().length(64), // SHA-256
});
export type CreateEbookDetail = z.infer<typeof CreateEbookDetailSchema>;

export const CreateCourseDetailSchema = z.object({
  totalHours: z.number().nonnegative().default(0.0),
  certificateEnabled: z.boolean().default(true),
  dripContentEnabled: z.boolean().default(false),
});
export type CreateCourseDetail = z.infer<typeof CreateCourseDetailSchema>;

export const CreateProductSchema = z.object({
  tenantId: z.string().uuid().optional(),
  sellerId: z.string().uuid(),
  title: z.string().min(2).max(255),
  slug: z.string().min(2).max(255).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().min(1),
  coverImageUrl: z.string().url(),
  productType: ProductTypeEnum,
  price: z.number().positive(),
  discountPrice: z.number().positive().optional(),
  physicalDetail: CreatePhysicalDetailSchema.optional(),
  ebookDetail: CreateEbookDetailSchema.optional(),
  courseDetail: CreateCourseDetailSchema.optional(),
  bundleItemIds: z.array(z.string().uuid()).min(2).optional(),
  categoryIds: z.array(z.string().uuid()).optional(),
  tagIds: z.array(z.string().uuid()).optional(),
});
export type CreateProduct = z.infer<typeof CreateProductSchema>;

export const UpdateStockSchema = z.object({
  productId: z.string().uuid(),
  deltaQty: z.number().int(),
});
export type UpdateStock = z.infer<typeof UpdateStockSchema>;

export const ListCatalogQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
  productType: ProductTypeEnum.optional(),
  search: z.string().max(128).optional(),
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(60).default(20),
});
export type ListCatalogQuery = z.infer<typeof ListCatalogQuerySchema>;
