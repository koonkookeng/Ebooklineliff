// SSOT Zod contracts — source: Phases/phase_000.md §3.1
import { z } from 'zod';

export const ContentAccessTypeEnum = z.enum([
  'FULL_PURCHASE',
  'SUBSCRIPTION',
  'CORPORATE_LICENSE',
  'TIME_LIMITED_RENTAL',
]);

export const ProductTypeEnum = z.enum([
  'PHYSICAL_BOOK',
  'EBOOK',
  'ELEARNING_COURSE',
  'LIVE_CLASS',
  'HYBRID_BUNDLE',
]);

export const OrderStatusEnum = z.enum([
  'PENDING_PAYMENT',
  'PAYMENT_VERIFYING',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'COMPLETED',
  'CANCELLED',
  'REFUNDED',
  // Phase 013: time-bound QR expiry (auto-cancel unpaid orders, slot release)
  'EXPIRED',
]);

export const SlipVerificationPayloadSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  orderStatus: OrderStatusEnum,
  entitlementGranted: z.boolean(),
});
export type SlipVerificationPayload = z.infer<typeof SlipVerificationPayloadSchema>;

export const EbookChunkPayloadSchema = z.object({
  pageNumber: z.number().int().positive(),
  vectorSvgContent: z.string(),
  forensicWatermarkData: z.object({
    watermarkText: z.string(),
    userIdHash: z.string(),
    timestamp: z.string(),
  }),
  hasPrevious: z.boolean(),
  hasNext: z.boolean(),
});
export type EbookChunkPayload = z.infer<typeof EbookChunkPayloadSchema>;

// BDD guards
export const RAM_GUARD_MB = 30;
export const SLIP_VERIFY_SLA_MS = 1000;
