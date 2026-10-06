// SSOT Phase 015 §3.1 — Atomic slip verification Zod domain contract
// Canonical: packages/shared/src/schemas/payment-slip.schema.ts
// (legacy src/shared/schemas/payment-slip.schema.ts)
// Reconciled with Phase 014 (no duplicate concepts):
// - enums re-exported from sdid-contract / payment.schema (zero-redundant);
// - EasySlip NESTED vendor shape validates the provider tolerance path
//   (the flat spec shape lives in slip-verification.schema.ts);
// - SlipVerificationResponseSchema(015) validates the OUTBOX completion
//   payload written by OrderAtomicService (transactionRef alias kept);
// - the live v1 API keeps the Phase-014 superset input (URL-or-base64).
import { z } from 'zod';
import { OrderStatusEnum } from './sdid-contract';

export { OrderStatusEnum };

export const SlipVerificationRequestSchema = z.object({
  orderId: z.string().uuid({ message: 'Invalid Order ID format' }),
  slipImageUrl: z.string().url({ message: 'Invalid Slip Image URL' }),
  userNote: z.string().max(255).optional(),
});
export type SlipVerificationRequest = z.infer<typeof SlipVerificationRequestSchema>;

export const EasySlipBankDetailSchema = z.object({
  type: z.string(),
  account: z.object({
    name: z.object({
      th: z.string().nullable().optional(),
      en: z.string().nullable().optional(),
    }),
    bank: z.object({
      id: z.string(),
      name: z.string(),
      account: z.string(),
    }),
  }),
});
export type EasySlipBankDetail = z.infer<typeof EasySlipBankDetailSchema>;

export const EasySlipResponseDataSchema = z.object({
  transRef: z.string(),
  date: z.string(),
  countryCode: z.string(),
  amount: z.object({
    amount: z.number(),
    local: z.object({
      amount: z.number().nullable().optional(),
      currency: z.string().nullable().optional(),
    }),
  }),
  sender: EasySlipBankDetailSchema,
  receiver: EasySlipBankDetailSchema,
});
export type EasySlipResponseData = z.infer<typeof EasySlipResponseDataSchema>;

export const EasySlipVerifyResultSchema = z.object({
  status: z.number(),
  message: z.string(),
  data: EasySlipResponseDataSchema.optional(),
});
export type EasySlipVerifyResult = z.infer<typeof EasySlipVerifyResultSchema>;

/** Outbox completion record (spec §5.2 table row D payload, validated on write). */
export const SlipAtomicResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  orderId: z.string().uuid(),
  orderStatus: z.enum(['COMPLETED', 'PAYMENT_VERIFYING', 'FAILED']),
  transactionRef: z.string().optional(),
  entitlementsGranted: z.array(z.string().uuid()),
  processingTimeMs: z.number(),
});
export type SlipAtomicResponse = z.infer<typeof SlipAtomicResponseSchema>;

/** Outbox event types for the verify bounded context. */
export const OutboxEventTypeEnum = z.enum([
  'PAYMENT_VERIFIED_ENTITLEMENT_GRANTED',
  'SLIP_VERIFY_RETRY',
]);
export type OutboxEventType = z.infer<typeof OutboxEventTypeEnum>;

/** Background retry job (spec §10: provider 502/503 → reprocess within 30s). */
export const SlipRetryJobSchema = z.object({
  orderId: z.string().uuid(),
  slipImageUrl: z.string().url(),
  actorUserId: z.string().uuid(),
  tenantId: z.string().min(1).optional(),
  attempts: z.number().int().nonnegative().default(0),
  maxAttempts: z.number().int().positive().default(3),
  nextRunAt: z.string().datetime(),
});
export type SlipRetryJob = z.infer<typeof SlipRetryJobSchema>;
