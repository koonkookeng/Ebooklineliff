// SSOT Phase 014 §3.1 — Instant auto-slip verification Zod domain contract
// Canonical: packages/shared/src/schemas/slip-verification.schema.ts
// (legacy src/shared/schemas/slip-verification.schema.ts)
// Zero-redundant: OrderStatusEnum owned by ./sdid-contract, PaymentStatusEnum
// by ./payment.schema; transport result (array grants + timing) stays in
// payment.schema — this file owns the v1 API + provider validation shapes.
import { z } from 'zod';
import { OrderStatusEnum } from './sdid-contract';
import { PaymentStatusEnum } from './payment.schema';

export { OrderStatusEnum, PaymentStatusEnum };

/** v1 verify input: exactly one image source required (URL or raw base64). */
export const SlipVerificationInputSchema = z.object({
  orderId: z.string().uuid('Invalid Order ID format'),
  slipImageUrl: z.string().url('Invalid slip image URL').optional(),
  slipBase64: z.string().min(1, 'Slip image base64 payload is required').optional(),
  filename: z.string().max(255).default('slip.png'),
  contentType: z.string().max(100).default('image/png'),
  tenantId: z.string().min(1, 'Tenant ID is required'),
  // Phase 014 §8: forensic hash passthrough (R2-upload flow already hashed).
  slipSha256: z.string().length(64).optional(),
}).refine((v) => v.slipImageUrl ?? v.slipBase64, {
  message: 'Either slipImageUrl or slipBase64 is required',
});
export type SlipVerificationInput = z.infer<typeof SlipVerificationInputSchema>;
export type SlipVerificationRequest = z.input<typeof SlipVerificationInputSchema>;

export const EasySlipDataSchema = z.object({
  transRef: z.string(),
  sendingBank: z.string(),
  receivingBank: z.string(),
  receivingAccount: z.string(),
  amount: z.object({
    value: z.number().positive(),
  }),
  date: z.string(),
});
export type EasySlipData = z.infer<typeof EasySlipDataSchema>;

export const EasySlipResponseSchema = z.object({
  status: z.number(),
  message: z.string().optional(),
  data: EasySlipDataSchema.optional(),
});
export type EasySlipResponse = z.infer<typeof EasySlipResponseSchema>;

export const SlipVerificationResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  orderId: z.string().uuid(),
  orderStatus: OrderStatusEnum,
  paymentStatus: PaymentStatusEnum,
  transRef: z.string().nullable(),
  entitlementGranted: z.boolean(),
  processedInMs: z.number(),
});
export type SlipVerificationResponse = z.infer<typeof SlipVerificationResponseSchema>;

/** Redis anti-replay lock TTL: 30 days (spec §5.3 step 6). */
export const SLIP_TRANSREF_LOCK_SEC = 30 * 24 * 60 * 60;

/** Client-side compression ceiling: 300 KB (spec §2.1, RAM < 20MB). */
export const SLIP_CLIENT_MAX_KB = 300;
