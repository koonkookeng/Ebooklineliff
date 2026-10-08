// SSOT Phase 074 §3.1 — Universal Product Builder Zod SSOT contract
// Canonical: packages/shared/src/schemas/product-builder.schema.ts
// (legacy src/shared/schemas/product-builder.schema.ts)
// - Spec-verbatim: Physical/Ebook/Course/Bundle spec schemas +
//   UniversalProductBuilderSchema with per-type refine (§3.1 Gate 1).
// - RISK_CALL notes (additive-only, documented):
//   - ProductTypeEnum REUSED from ./sdid-contract (Phase 000 owner).
//   - Slug regex fixed to /^[a-z0-9-]+$/ (spec draft had an escaped typo
//     `\[a-z0-9-\]`; semantics unchanged).
// - Helpers: wizard step list, autosave key/TTL, draft payload schema.
// - Zero new deps (zod only).
import { z } from 'zod';
import { ProductTypeEnum } from './sdid-contract';

export { ProductTypeEnum };

export const PhysicalDetailSpecSchema = z.object({
  isbn: z.string().optional(),
  weightGrams: z.number().int().positive('น้ำหนักต้องมากกว่า 0 กรัม'),
  stockQty: z.number().int().nonnegative('จำนวนสต็อกต้องไม่ติดลบ'),
  sku: z.string().min(3, 'SKU ต้องมีความยาวอย่างน้อย 3 ตัวอักษร'),
});
export type PhysicalDetailSpec = z.infer<typeof PhysicalDetailSpecSchema>;

export const EbookDetailSpecSchema = z.object({
  totalPages: z.number().int().positive('จำนวนหน้าต้องมากกว่า 0'),
  previewPages: z.number().int().nonnegative().default(10),
  storagePathR2: z.string().min(1, 'ต้องระบุเส้นทางจัดเก็บไฟล์ R2'),
  fileHash: z.string().min(1, 'ต้องมี File Hash เพื่อความถูกต้องของข้อมูล'),
});
export type EbookDetailSpec = z.infer<typeof EbookDetailSpecSchema>;

export const CourseLessonSpecSchema = z.object({
  lessonOrder: z.number().int().positive(),
  title: z.string().min(1, 'ต้องระบุชื่อบทเรียน'),
  videoHlsUrl: z.string().url('รูปแบบ URL ไม่ถูกต้อง'),
  durationSec: z.number().int().nonnegative(),
  isPreview: z.boolean().default(false),
});
export type CourseLessonSpec = z.infer<typeof CourseLessonSpecSchema>;

export const CourseSectionSpecSchema = z.object({
  sectionOrder: z.number().int().positive(),
  title: z.string().min(1, 'ต้องระบุชื่อหมวดหมู่บทเรียน'),
  lessons: z.array(CourseLessonSpecSchema).min(1, 'ต้องมีอย่างน้อย 1 บทเรียนในหมวดนี้'),
});
export type CourseSectionSpec = z.infer<typeof CourseSectionSpecSchema>;

export const CourseDetailSpecSchema = z.object({
  totalHours: z.number().nonnegative().default(0.0),
  sections: z.array(CourseSectionSpecSchema).default([]),
});
export type CourseDetailSpec = z.infer<typeof CourseDetailSpecSchema>;

export const BundleItemSpecSchema = z.object({
  childProductId: z.string().uuid(),
  quantity: z.number().int().positive().default(1),
});
export type BundleItemSpec = z.infer<typeof BundleItemSpecSchema>;

export const UniversalProductBuilderSchema = z.object({
  draftId: z.string().uuid().optional(),
  productType: ProductTypeEnum,
  title: z.string().min(3, 'ชื่อสินค้าต้องมีความยาวอย่างน้อย 3 ตัวอักษร').max(255),
  slug: z.string().min(3).regex(/^[a-z0-9-]+$/, 'Slug ต้องเป็นตัวอักษรเล็ก ตัวเลข และเครื่องหมาย - เท่านั้น'),
  description: z.string().min(10, 'คำอธิบายต้องมีความยาวอย่างน้อย 10 ตัวอักษร'),
  coverImageUrl: z.string().url('ต้องระบุ URL รูปปกที่ถูกต้อง'),
  price: z.number().positive('ราคาต้องมากกว่า 0 บาท'),
  discountPrice: z.number().positive().optional(),
  isPublished: z.boolean().default(false),

  physicalDetail: PhysicalDetailSpecSchema.optional(),
  ebookDetail: EbookDetailSpecSchema.optional(),
  courseDetail: CourseDetailSpecSchema.optional(),
  bundleItems: z.array(BundleItemSpecSchema).optional(),
}).refine((data) => {
  if (data.productType === 'PHYSICAL_BOOK' && !data.physicalDetail) return false;
  if (data.productType === 'EBOOK' && !data.ebookDetail) return false;
  if (data.productType === 'ELEARNING_COURSE' && !data.courseDetail) return false;
  if (data.productType === 'HYBRID_BUNDLE' && (!data.bundleItems || data.bundleItems.length === 0)) return false;
  return true;
}, {
  message: 'ข้อมูลรายละเอียดสินค้าไม่สอดคล้องกับประเภทสินค้าที่เลือก',
  path: ['productType'],
});

export type UniversalProductBuilderInput = z.infer<typeof UniversalProductBuilderSchema>;

/** Step-1 gate: basics only (wizard progresses before details exist). */
export const BuilderStepBasicsSchema = z.object({
  productType: ProductTypeEnum,
  title: z.string().min(3, 'ชื่อสินค้าต้องมีความยาวอย่างน้อย 3 ตัวอักษร').max(255),
  slug: z.string().min(3).regex(/^[a-z0-9-]+$/, 'Slug ต้องเป็นตัวอักษรเล็ก ตัวเลข และเครื่องหมาย - เท่านั้น'),
  description: z.string().min(10, 'คำอธิบายต้องมีความยาวอย่างน้อย 10 ตัวอักษร'),
  coverImageUrl: z.string().url('ต้องระบุ URL รูปปกที่ถูกต้อง'),
});

/** Step-3 gate: pricing only. */
export const BuilderStepPricingSchema = z.object({
  price: z.number().positive('ราคาต้องมากกว่า 0 บาท'),
  discountPrice: z.number().positive().optional(),
});

/** Wizard steps (§6.1). */
export const BUILDER_STEPS = [
  { id: 1, title: 'ประเภทสินค้า & ข้อมูลพื้นฐาน' },
  { id: 2, title: 'อัปโหลดไฟล์ & โครงสร้างเนื้อหา' },
  { id: 3, title: 'กำหนดราคา & คลังสินค้า' },
  { id: 4, title: 'ตรวจสอบ & ยืนยันการเผยแพร่' },
] as const;

/** Draft auto-save cadence: every 5s (BDD-1). */
export const BUILDER_AUTOSAVE_MS = 5000;
/** Draft Redis TTL: 24h (§5.2). */
export const BUILDER_DRAFT_TTL_SEC = 86400;
/** Presigned upload URL TTL: 15 min (§8.1). */
export const BUILDER_PRESIGN_TTL_SEC = 900;
/** Publish SLA: PRODUCT_PUBLISHED_EVENT within 800ms (BDD-3). */
export const BUILDER_PUBLISH_BUDGET_MS = 800;

/** Redis key for a seller draft (sub-ms autosave, BDD-1). */
export function builderDraftKey(sellerId: string, draftId: string): string {
  return `draft:${sellerId}:${draftId}`;
}
