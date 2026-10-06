// SSOT Phase 012 §3.1 — Payment Zod domain contract (PromptPay + slip verification)
// Canonical: packages/shared/src/schemas/payment.schema.ts
// (legacy src/shared/schemas/payment.schema.ts)
import { z } from 'zod';
import { OrderStatusEnum } from './sdid-contract';
export { OrderStatusEnum };

export const PaymentStatusEnum = z.enum(['UNPAID', 'PENDING_SLIP', 'VERIFIED', 'FAILED', 'REFUNDED']);
export type PaymentStatus = z.infer<typeof PaymentStatusEnum>;

export const VerifySlipInputSchema = z.object({
  orderId: z.string().uuid(),
  slipImageUrl: z.string().url('Invalid slip image URL'),
});
export type VerifySlipInput = z.infer<typeof VerifySlipInputSchema>;

export const SlipVerificationResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  orderId: z.string().uuid(),
  orderStatus: OrderStatusEnum,
  paymentStatus: PaymentStatusEnum,
  transRef: z.string().nullable(),
  entitlementsGranted: z.array(z.string().uuid()),
});
export type SlipVerificationResult = z.infer<typeof SlipVerificationResultSchema>;

export const PromptPayPayloadSchema = z.object({
  orderId: z.string().uuid(),
  orderNumber: z.string(),
  promptPayQrPayload: z.string().min(1),
  amount: z.number().positive(),
  expiresAt: z.string(),
});
export type PromptPayPayload = z.infer<typeof PromptPayPayloadSchema>;

export const CreateOrderPayloadSchema = z.object({
  orderId: z.string().uuid(),
  orderNumber: z.string(),
  netAmount: z.number().nonnegative(),
  promptPayQrPayload: z.string().min(1),
  expiresAt: z.string(),
});
export type CreateOrderPayload = z.infer<typeof CreateOrderPayloadSchema>;

/** QR expiry: 15 min from now (matches checkout stock-lock window). */
export function promptPayExpiry(now = new Date()): string {
  return new Date(now.getTime() + 15 * 60_000).toISOString();
}
