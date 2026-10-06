// SSOT Phase 019 §3.1 — Transactional LINE receipt Zod domain contract
// Canonical: packages/shared/src/schemas/line-receipt.schema.ts
// (legacy src/shared/schemas/line-receipt.schema.ts)
// Zero-redundant: product types reuse ProductTypeEnum from ./sdid-contract.
import { z } from 'zod';
import { ProductTypeEnum } from './sdid-contract';

export { ProductTypeEnum };

/** Delivery lifecycle for API responses (Prisma ReceiptStatus is the persisted subset). */
export const ReceiptDeliveryStatusEnum = z.enum([
  'PENDING',
  'COMPOSING',
  'SENT',
  'DELIVERED',
  'FAILED_RETRYING',
  'FAILED_PERMANENT',
]);
export type ReceiptDeliveryStatus = z.infer<typeof ReceiptDeliveryStatusEnum>;

export const ReceiptLineItemSchema = z.object({
  title: z.string(),
  productType: ProductTypeEnum,
  quantity: z.number().int().positive(),
  unitPrice: z.number().nonnegative(),
  totalPrice: z.number().nonnegative(),
});
export type ReceiptLineItem = z.infer<typeof ReceiptLineItemSchema>;

export const LineReceiptPayloadSchema = z.object({
  orderId: z.string().uuid(),
  orderNumber: z.string(),
  lineUserId: z.string(),
  tenantId: z.string(),
  tenantName: z.string(),
  tenantLogoUrl: z.string().url(),
  buyerDisplayName: z.string(),
  netAmount: z.number().positive(),
  vatAmount: z.number().nonnegative(),
  paymentMethod: z.string(),
  paidAt: z.string().datetime(),
  items: z.array(ReceiptLineItemSchema),
  pdfDownloadUrl: z.string().url(),
  liffRedirectUrl: z.string().url(),
});
export type LineReceiptPayload = z.infer<typeof LineReceiptPayloadSchema>;

/** Persisted log row shape (mirrors Prisma ReceiptNotificationLog + delivery view). */
export const ReceiptLogSchema = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
  orderNumber: z.string(),
  lineUserId: z.string(),
  status: ReceiptDeliveryStatusEnum,
  lineMessageId: z.string().nullable(),
  pdfR2Path: z.string().nullable(),
  pdfDownloadUrl: z.string().url().nullable(),
  errorMessage: z.string().nullable(),
  retryCount: z.number().int().nonnegative(),
  sentAt: z.string().datetime().nullable(),
});
export type ReceiptLog = z.infer<typeof ReceiptLogSchema>;

/** Time-bound HMAC download ticket (24h expiry, §8.1). */
export const ReceiptDownloadTicketSchema = z.object({
  logId: z.string().uuid(),
  exp: z.number().int().positive(),
  sig: z.string().min(1),
});
export type ReceiptDownloadTicket = z.infer<typeof ReceiptDownloadTicketSchema>;

/** Flex payload budget: <10KB (§2.1). */
export const FLEX_MAX_BYTES = 10 * 1024;
/** Push retry ceiling (§BDD scenario 2: max 3 attempts). */
export const RECEIPT_MAX_RETRIES = 3;
/** Signed download URL lifetime: 24h (§8.1). */
export const RECEIPT_URL_TTL_SEC = 24 * 60 * 60;

/** 7% VAT included in Thai retail prices (back-calculated, satang-rounded). */
export function vatIncluded(netAmount: number): number {
  if (!Number.isFinite(netAmount) || netAmount <= 0) return 0;
  return Math.round((netAmount * 7) / 107 * 100) / 100;
}

/** R2 vault key: receipts/{tenantId}/{year}/{orderNumber}.pdf (§6.1). */
export function receiptR2Key(tenantId: string, orderNumber: string, now = new Date()): string {
  const safeTenant = tenantId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'default';
  const safeOrder = orderNumber.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  return `receipts/${safeTenant}/${now.getUTCFullYear()}/${safeOrder}.pdf`;
}
