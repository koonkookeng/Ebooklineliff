// SSOT Phase 024 §3.1 — LINE Service Message dispatcher Zod SSOT Contract
// Canonical: packages/shared/src/schemas/service-message-contract.ts
// NOTE (RISK_CALL deviations, see ADR-024):
// - tenantId/userId are z.string().min(1), not uuid: tenant hints use opaque slugs
//   ('default') and User ids flow as strings at the edge (Phase 023 precedent).
// - lineUserId is min(1), not min(10): dev/mock flows use short ids; real LINE UIDs pass anyway.
// - Queue is DB-rows + Redis streams (zero-new-deps, Phase 019 precedent), not BullMQ:
//   neither @nestjs/bull nor bullmq is in backend deps.
import { z } from 'zod';

export const ServiceMessageTypeEnum = z.enum([
  'ORDER_CONFIRMATION',
  'PAYMENT_RECEIPT',
  'EBOOK_GRANT_ACCESS',
  'COURSE_ENROLLMENT',
  'SHIPPING_TRACKING',
  'AUTHENTICATION_OTP',
]);

export const ServiceMessageDispatchPayloadSchema = z.object({
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  lineUserId: z.string().min(1),
  messageType: ServiceMessageTypeEnum,
  templateId: z.string().uuid().optional(),
  parameters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  fallbackPhone: z.string().optional(),
});

export const DispatchStatusEnum = z.enum(['QUEUED', 'PROCESSING', 'DELIVERED', 'FAILED', 'FALLBACK_SENT']);

export const ServiceMessageDeliveryStatusSchema = z.object({
  jobId: z.string(),
  status: DispatchStatusEnum,
  deliveredAt: z.string().datetime().optional(),
  errorCode: z.string().optional(),
  costIncurred: z.number().default(0.0), // Zero-Broadcast Rule Verification
});

export const FlexCompileInputSchema = z.object({
  templateJson: z.record(z.string(), z.unknown()),
  parameters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});

export type ServiceMessageType = z.infer<typeof ServiceMessageTypeEnum>;
export type ServiceMessageDispatchPayload = z.infer<typeof ServiceMessageDispatchPayloadSchema>;
export type DispatchStatus = z.infer<typeof DispatchStatusEnum>;
export type ServiceMessageDeliveryStatus = z.infer<typeof ServiceMessageDeliveryStatusSchema>;
export type FlexCompileInput = z.infer<typeof FlexCompileInputSchema>;

/** Max flex image bytes (§2.1 constraint: R2 WebP/PNG ≤500KB). */
export const FLEX_IMAGE_MAX_BYTES = 500 * 1024;
/** Retry/backoff policy (§1.3: exponential, max 3 attempts). */
export const DISPATCH_MAX_RETRIES = 3;
export const DISPATCH_BACKOFF_MS = [1000, 2000, 4000];
/** Circuit breaker: consecutive failures before fallback routing (§10). */
export const DISPATCH_CIRCUIT_THRESHOLD = 5;
