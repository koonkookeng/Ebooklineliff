// SSOT Phase 076 §3.1 — Fulfillment queue + batch thermal print Zod contract
// Canonical: packages/shared/src/schemas/fulfillment-contract.ts
// (legacy src/shared/schemas/fulfillment-contract.ts)
// - Spec-verbatim: CourierProviderEnum / FulfillmentStatusEnum / LabelDpiEnum /
//   FulfillmentQueueItemSchema / BatchPrintRequestSchema / BatchPrintResponseSchema.
// - RISK_CALL deviations (additive-only, documented):
//   (a) no bullmq dep (agent.md Deny heavy deps): queue is a port-based FIFO
//       (enqueue/dequeue/ack) bound to Redis xadd at the module — same event
//       shape the BullMQ processor would consume;
//   (b) no qrcode.react/jsbarcode (§6.1 asks them): labels render dep-free
//       (text Code128 payload + HMAC-SHA256 QR payload string, Gate 4) so the
//       LIFF bundle stays lean;
//   (c) tenantId is z.string().min(1) (x-tenant-identifier slug hint,
//       Phase 071/073 runtime vocabulary) — uuid strictness would 400 dashboard calls.
// - Pure helpers: batchNumber, TSPL 100x150 builder, HMAC label token,
//   forward-only status guard. Zero new deps (zod only).
import { z } from 'zod';

export const CourierProviderEnum = z.enum([
  'FLASH_EXPRESS',
  'KEX_EXPRESS',
  'JT_EXPRESS',
  'THAILAND_POST',
  'CUSTOM_FLEET',
]);
export type CourierProvider = z.infer<typeof CourierProviderEnum>;

export const FulfillmentStatusEnum = z.enum([
  'UNFULFILLED',
  'QUEUED_FOR_BOOKING',
  'BOOKED',
  'LABEL_GENERATED',
  'PRINTED',
  'PACKED',
  'IN_TRANSIT',
  'DELIVERED',
  'DELIVERY_FAILED',
  'CANCELLED',
]);
export type FulfillmentStatus = z.infer<typeof FulfillmentStatusEnum>;

export const LabelDpiEnum = z.enum(['DPI_203', 'DPI_300']);
export type LabelDpi = z.infer<typeof LabelDpiEnum>;

export const FulfillmentQueueItemSchema = z.object({
  orderId: z.string().uuid(),
  orderNumber: z.string(),
  recipientName: z.string(),
  recipientPhone: z.string(),
  shippingAddress: z.string(),
  postalCode: z.string().length(5),
  weightGrams: z.number().positive(),
  courierProvider: CourierProviderEnum,
  trackingNumber: z.string().nullable(),
  fulfillmentStatus: FulfillmentStatusEnum,
  itemSummary: z.array(
    z.object({
      sku: z.string(),
      title: z.string(),
      quantity: z.number().int().positive(),
    }),
  ),
});
export type FulfillmentQueueItem = z.infer<typeof FulfillmentQueueItemSchema>;

export const BatchBookingRequestSchema = z.object({
  tenantId: z.string().min(1),
  orderIds: z.array(z.string().uuid()).min(1).max(500),
  courierProvider: CourierProviderEnum,
  warehouseId: z.string().uuid('Invalid Warehouse ID'),
});
export type BatchBookingRequest = z.infer<typeof BatchBookingRequestSchema>;

export const BatchPrintRequestSchema = z.object({
  orderIds: z.array(z.string().uuid()).min(1).max(500),
  courierProvider: CourierProviderEnum,
  labelDpi: LabelDpiEnum.default('DPI_203'),
  autoUpdateStatusToPrinted: z.boolean().default(true),
});
export type BatchPrintRequest = z.infer<typeof BatchPrintRequestSchema>;

export const BatchPrintResponseSchema = z.object({
  success: z.boolean(),
  totalProcessed: z.number(),
  failedOrders: z.array(
    z.object({
      orderId: z.string(),
      reason: z.string(),
    }),
  ),
  pdfBufferBase64: z.string().optional(),
  rawTsplCommands: z.string().optional(),
});
export type BatchPrintResponse = z.infer<typeof BatchPrintResponseSchema>;

/** Booking batch cap: 500 orders (BDD-1). */
export const FULFILLMENT_BATCH_MAX = 500;
/** Booking SLA: 100 items < 2s (BDD-1). */
export const BOOKING_BUDGET_MS = 2000;
/** Label RAM ceiling while spooling 500+ labels (Gate 5). */
export const LABEL_RAM_BUDGET_MB = 45;
/** Label vault TTL: 24h auto-delete ( §8.1). */
export const LABEL_VAULT_TTL_SEC = 86400;
/** Carrier failover: 3 consecutive failures -> next carrier (§10). */
export const CARRIER_FAILOVER_THRESHOLD = 3;
/** Booking queue stream (BullMQ-compatible job shape, port FIFO). */
export const FULFILLMENT_QUEUE_STREAM = 'fulfillment:booking-queue';
/** Packing velocity telemetry stream (§7.1). */
export const FULFILLMENT_TELEMETRY_STREAM = 'fulfillment:telemetry';

/** Human batch number: FFM-<tenant-slice>-<base36 time>. */
export function fulfillmentBatchNumber(tenantId: string, at = Date.now()): string {
  const slice = tenantId.replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase().padEnd(3, 'X');
  return `FFM-${slice}-${at.toString(36).toUpperCase()}`;
}

/** Forward-only status ladder (RETURNED terminal/any-state, 073 parity). */
const FULFILLMENT_FLOW = [
  'UNFULFILLED',
  'QUEUED_FOR_BOOKING',
  'BOOKED',
  'LABEL_GENERATED',
  'PRINTED',
  'PACKED',
  'IN_TRANSIT',
  'DELIVERED',
] as const;

export function assertFulfillmentForward(from: string, to: string): void {
  if (to === 'CANCELLED' || to === 'DELIVERY_FAILED' || to === 'RETURNED') return;
  const a = (FULFILLMENT_FLOW as readonly string[]).indexOf(from);
  const b = (FULFILLMENT_FLOW as readonly string[]).indexOf(to);
  if (a === -1 || b === -1 || b < a) {
    throw new Error(`Illegal fulfillment transition ${from} -> ${to}`);
  }
}

/** TSPL 100x150mm label program (203/300 DPI switch via DENSITY). */
export function buildTsplLabel(args: {
  senderName: string;
  senderPhone: string;
  senderAddress: string;
  recipientName: string;
  recipientPhone: string;
  recipientAddress: string;
  postalCode: string;
  trackingNumber: string;
  sortingCode: string;
  orderNumber: string;
  dpi?: LabelDpi;
}): string {
  const density = args.dpi === 'DPI_300' ? 12 : 8;
  const q = (s: string): string => s.replace(/"/g, "'").slice(0, 90);
  return [
    `SIZE 100 mm,150 mm`,
    `DENSITY ${density}`,
    `GAP 3 mm,0 mm`,
    `CLS`,
    `TEXT 50,30,"3",0,1,1,"SENDER: ${q(args.senderName)} (${q(args.senderPhone)})"`,
    `TEXT 50,60,"2",0,1,1,"${q(args.senderAddress)}"`,
    `LINE 30,90,770,90,3`,
    `TEXT 50,110,"4",0,1,1,"TO: ${q(args.recipientName)} (${q(args.recipientPhone)})"`,
    `TEXT 50,150,"3",0,1,1,"${q(args.recipientAddress)}"`,
    `TEXT 50,220,"5",0,2,2,"ZIP: ${q(args.postalCode)}"`,
    `LINE 30,280,770,280,3`,
    `BARCODE 100,310,"128",120,1,0,3,3,"${q(args.trackingNumber)}"`,
    `TEXT 250,440,"4",0,1,1,"SORT: ${q(args.sortingCode)} ORD:${q(args.orderNumber)}"`,
    `PRINT 1,1`,
  ].join('\n');
}

/** Anti-tamper label token payload (HMAC-SHA256 computed server-side, Gate 4). */
export function labelTokenPayload(orderId: string, trackingNumber: string, tenantId: string): string {
  return `${tenantId}:${orderId}:${trackingNumber}`;
}
