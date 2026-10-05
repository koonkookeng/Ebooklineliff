// SSOT Phase 004 §3.1 — GraphQL input + webhook payload Zod contracts
import { z } from 'zod';

// GraphQL input validation schemas
export const AuthenticateLineLiffInputSchema = z.object({
  accessToken: z.string().min(10, 'Invalid LINE Access Token'),
  tenantId: z.string().uuid('Invalid Tenant ID'),
});

export const GetEbookChunkInputSchema = z.object({
  productId: z.string().uuid(),
  pageNumber: z.number().int().positive(),
});

export const CreateOrderInputSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().positive().default(1),
      }),
    )
    .min(1, 'Order must contain at least one item'),
  couponCode: z.string().optional(),
  shippingAddressId: z.string().uuid().optional(),
});

// RESTful webhook payload schemas
export const EasySlipWebhookPayloadSchema = z.object({
  event: z.string(),
  transRef: z.string(),
  date: z.string(),
  amount: z.object({
    value: z.number().positive(),
  }),
  sender: z.object({
    bank: z.object({ id: z.string(), name: z.string() }),
    account: z.object({ name: z.string(), value: z.string() }),
  }),
  receiver: z.object({
    bank: z.object({ id: z.string(), name: z.string() }),
    account: z.object({ name: z.string(), value: z.string() }),
  }),
  rawImageBase64: z.string().optional(),
});

export type AuthenticateLineLiffInput = z.infer<typeof AuthenticateLineLiffInputSchema>;
export type GetEbookChunkInput = z.infer<typeof GetEbookChunkInputSchema>;
export type CreateOrderInput = z.infer<typeof CreateOrderInputSchema>;
export type EasySlipWebhookPayload = z.infer<typeof EasySlipWebhookPayloadSchema>;
