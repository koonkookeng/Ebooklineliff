// SSOT Phase 073 §3.1 — Merchant Dashboard Zod SSOT contract
// Canonical: packages/shared/src/schemas/merchant-contract.ts
// - Spec-verbatim: MerchantProductUpsertSchema / PayoutRequestSchema /
//   MerchantAnalyticsFilterSchema (§3.1 Gate 1).
// - RISK_CALL notes (additive-only, documented):
//   - ProductTypeEnum REUSED from ./sdid-contract (Phase 000 owner; Zero
//     Redundant) — not redefined.
//   - tenantId is z.string().min(1) (slug hint from x-tenant-identifier),
//     matching Phase 071 runtime vocabulary, not uuid.
// - Pure finance math: 3% e-Withholding Tax + flat fee + net payout (single
//   decimal-2 source; BDD-3: 50000 -> tax 1500 + fee 10 -> net 48490).
// - Zero new deps (zod only).
import { z } from 'zod';
import { ProductTypeEnum } from './sdid-contract';

export { ProductTypeEnum };

export const OrderFulfillmentStatusEnum = z.enum([
  'UNFULFILLED',
  'PACKED',
  'SHIPPED',
  'DELIVERED',
  'RETURNED',
]);
export type OrderFulfillmentStatus = z.infer<typeof OrderFulfillmentStatusEnum>;

export const MerchantProductUpsertSchema = z.object({
  id: z.string().uuid().optional(),
  tenantId: z.string().min(1),
  title: z.string().min(3, 'ชื่อสินค้าต้องมีความยาวอย่างน้อย 3 ตัวอักษร'),
  slug: z.string().min(3),
  description: z.string(),
  coverImageUrl: z.string().url('รูปแบบ URL ของรูปปกไม่ถูกต้อง'),
  productType: ProductTypeEnum,
  price: z.number().positive('ราคาต้องมากกว่า 0'),
  discountPrice: z.number().nonnegative().optional(),
  isPublished: z.boolean().default(false),

  physicalDetail: z.object({
    isbn: z.string().optional(),
    weightGrams: z.number().int().positive('น้ำหนักต้องเป็นจำนวนเต็มบวก (กรัม)'),
    stockQty: z.number().int().nonnegative(),
    sku: z.string().min(1),
    warehouseLocation: z.string().optional(),
  }).optional(),

  ebookDetail: z.object({
    previewPages: z.number().int().default(10),
    storagePathR2: z.string().min(1),
    allowDownloadPdf: z.boolean().default(false),
  }).optional(),

  courseDetail: z.object({
    dripContentDays: z.number().int().default(0),
    certificateEnabled: z.boolean().default(true),
  }).optional(),
});
export type MerchantProductUpsert = z.infer<typeof MerchantProductUpsertSchema>;

export const PayoutRequestSchema = z.object({
  tenantId: z.string().min(1),
  requestedAmount: z.number().min(1000, 'ขั้นต่ำการถอนเงินคือ 1,000 บาท'),
  bankAccountId: z.string().uuid(),
  notes: z.string().optional(),
});
export type PayoutRequest = z.infer<typeof PayoutRequestSchema>;

export const MerchantAnalyticsFilterSchema = z.object({
  tenantId: z.string().min(1),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  productType: ProductTypeEnum.optional(),
  groupBy: z.enum(['DAY', 'WEEK', 'MONTH']).default('DAY'),
});
export type MerchantAnalyticsFilter = z.infer<typeof MerchantAnalyticsFilterSchema>;

/** e-Withholding Tax rate 3% (BDD-3) + flat processing fee 10 THB. */
export const WITHHOLDING_TAX_RATE = 0.03;
export const PAYOUT_PROCESSING_FEE = 10;
export const PAYOUT_MIN_AMOUNT = 1000;

/** toFixed-2 decimal helper (single rounding source, Gate 7). */
export function toBaht(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 3% withholding on the gross (BDD-3: 50000 -> 1500). */
export function withholdingTaxFor(grossAmount: number): number {
  return toBaht(grossAmount * WITHHOLDING_TAX_RATE);
}

/** Net payout: gross - 3% tax - 10 fee (BDD-3: 50000 -> 48490). */
export function netPayoutFor(grossAmount: number): { tax: number; fee: number; net: number } {
  const tax = withholdingTaxFor(grossAmount);
  const fee = PAYOUT_PROCESSING_FEE;
  return { tax, fee, net: toBaht(grossAmount - tax - fee) };
}

/** Redis edge key for a merchant daily-analytics row cache. */
export function merchantAnalyticsKey(tenantId: string, dateIso: string): string {
  return `merchant:analytics:${tenantId}:${dateIso.slice(0, 10)}`;
}
/** Analytics row cache TTL: 1h (intraday rows refresh, Gate 8). */
export const MERCHANT_ANALYTICS_TTL_SEC = 3600;
