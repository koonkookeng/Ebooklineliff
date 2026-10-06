// SSOT Phase 013 §3.1 — Dynamic PromptPay QR Zod domain contract
// Canonical: packages/shared/src/schemas/promptpay.schema.ts
// (legacy src/shared/schemas/promptpay-schema.ts)
// Zero-redundant: EMVCo payload/CRC owned by backend promptpay-emv.builder;
// QR image renders client-side via react-qr-code (zero-egress, zero new deps),
// so qrCodeBase64 stays an optional future server-render slot.
import { z } from 'zod';

export const PromptPayStatusEnum = z.enum(['PENDING', 'PAID', 'EXPIRED', 'CANCELLED']);
export type PromptPayStatus = z.infer<typeof PromptPayStatusEnum>;

export const CreatePromptPayQRInputSchema = z.object({
  orderId: z.string().uuid(),
  expireMinutes: z.number().int().min(5).max(60).default(15),
  useFractionalCent: z.boolean().default(true),
});
export type CreatePromptPayQRInput = z.infer<typeof CreatePromptPayQRInputSchema>;
/** Client request shape (defaults optional at the boundary, applied server-side). */
export type CreatePromptPayQRRequest = z.input<typeof CreatePromptPayQRInputSchema>;

export const PromptPayQRPayloadSchema = z.object({
  qrCodePayload: z.string().min(1),
  qrCodeBase64: z.string().optional(),
  orderNumber: z.string(),
  reference1: z.string(),
  reference2: z.string().optional(),
  baseAmount: z.number().positive(),
  fractionalCent: z.number().min(0).max(0.99),
  totalAmount: z.number().positive(),
  expiresAt: z.string().datetime(),
  timeRemainingSec: z.number().int().nonnegative(),
});
export type PromptPayQRPayload = z.infer<typeof PromptPayQRPayloadSchema>;

export const PromptPayExpiryStatusSchema = z.object({
  orderId: z.string().uuid(),
  status: PromptPayStatusEnum,
  isExpired: z.boolean(),
});
export type PromptPayExpiryStatus = z.infer<typeof PromptPayExpiryStatusSchema>;

/** QR time-to-live window in seconds (matches Phase 012 stock-lock window). */
export const PROMPTPAY_DEFAULT_TTL_SEC = 15 * 60;

/** Rate-limit: max QR generations per user per 10 minutes (spec §8). */
export const PROMPTPAY_RATE_LIMIT = 5;
export const PROMPTPAY_RATE_WINDOW_SEC = 10 * 60;

/** Fraud: slip-failure suspensions (spec §7) — 3 strikes → 15-min QR freeze. */
export const PROMPTPAY_FRAUD_STRIKES = 3;
export const PROMPTPAY_FRAUD_FREEZE_SEC = 15 * 60;
