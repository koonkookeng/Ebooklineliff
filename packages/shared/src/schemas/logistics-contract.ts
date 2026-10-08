// SSOT Phase 077 §3.1 — Multi-carrier logistics + LINE tracking Zod contract
// Canonical: packages/shared/src/schemas/logistics-contract.ts
// (legacy src/shared/schemas/logistics-contract.ts)
// - Spec-verbatim: LogisticsCarrierEnum / ShipmentStatusEnum /
//   CarrierWebhookPayloadSchema / BookParcelInputSchema /
//   LineTrackingMessageSchema (§3.1).
// - RISK_CALL deviations (additive-only, documented):
//   (a) tenantId is z.string().min(1) (x-tenant-identifier slug hint,
//       Phase 071/073 runtime vocabulary) — uuid strictness would 400 calls;
//   (b) 076 CourierProvider (5 values) maps onto LogisticsCarrier (3) via
//       carrierToLogistics(): JT_EXPRESS/CUSTOM_FLEET stay in the 076
//       FulfillmentItem ledger (no Shipment row) — Shipment covers only the
//       3 API-integrated carriers;
//   (c) no node-fetch dep (§5.2/§6.1 ask it): carrier HTTP attaches through
//       an injected fetch port (global fetch), zero new deps.
// - Pure helpers: flash signature, webhook HMAC, status mapper, flex card,
//   carrier brand tokens. Zero new deps (zod only).
import { z } from 'zod';

export const LogisticsCarrierEnum = z.enum([
  'FLASH_EXPRESS',
  'KERRY_EXPRESS',
  'THAILAND_POST',
]);
export type LogisticsCarrier = z.infer<typeof LogisticsCarrierEnum>;

export const ShipmentStatusEnum = z.enum([
  'PENDING_BOOKING',
  'BOOKED',
  'PICKED_UP',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'FAILED_ATTEMPT',
  'RETURNED',
]);
export type ShipmentStatus = z.infer<typeof ShipmentStatusEnum>;

export const CarrierWebhookPayloadSchema = z.object({
  carrier: LogisticsCarrierEnum,
  trackingNumber: z.string().min(1),
  orderNumber: z.string().min(1),
  statusCode: z.string(),
  statusDescription: z.string(),
  location: z.string().optional(),
  signature: z.string(),
  timestamp: z.number(),
});
export type CarrierWebhookPayload = z.infer<typeof CarrierWebhookPayloadSchema>;

export const BookParcelInputSchema = z.object({
  tenantId: z.string().min(1),
  orderId: z.string().uuid(),
  carrier: LogisticsCarrierEnum,
  weightGrams: z.number().positive(),
  widthCm: z.number().positive().optional(),
  lengthCm: z.number().positive().optional(),
  heightCm: z.number().positive().optional(),
  pickupDate: z.string().optional(),
  remark: z.string().max(250).optional(),
});
export type BookParcelInput = z.infer<typeof BookParcelInputSchema>;

export const LineTrackingMessageSchema = z.object({
  lineUserId: z.string(),
  orderNumber: z.string(),
  carrierName: z.string(),
  trackingNumber: z.string(),
  statusText: z.string(),
  estimatedDelivery: z.string().optional(),
  trackingUrl: z.string().url(),
});
export type LineTrackingMessage = z.infer<typeof LineTrackingMessageSchema>;

/** Booking SLA: pno + label URL within 800ms (BDD-1). */
export const PARCEL_BOOKING_BUDGET_MS = 800;
/** LINE notify SLA: tracking card within 500ms (BDD-2). */
export const TRACKING_NOTIFY_BUDGET_MS = 500;
/** Webhook replay window: 5 minutes (§8). */
export const WEBHOOK_REPLAY_TTL_SEC = 300;
/** Webhook HMAC header name. */
export const WEBHOOK_SIGNATURE_HEADER = 'x-carrier-signature';
/** Shipment event stream (§7). */
export const LOGISTICS_EVENT_STREAM = 'stream:logistics:events';
/** LINE retry stream (§10: 5xx -> exponential backoff x3). */
export const LINE_RETRY_STREAM = 'line:tracking:retry';

/** 076 CourierProvider -> 077 LogisticsCarrier (null = ledger-only). */
export function carrierToLogistics(provider: string): string | null {
  switch (provider) {
    case 'FLASH_EXPRESS': return 'FLASH_EXPRESS';
    case 'KERRY_EXPRESS':
    case 'KEX_EXPRESS': return 'KERRY_EXPRESS';
    case 'THAILAND_POST': return 'THAILAND_POST';
    default: return null;
  }
}

/** Carrier status codes -> ShipmentStatus (§5.3 mapping). */
export function mapCarrierStatus(statusCode: string, fallback: string): string {
  const code = statusCode.toUpperCase();
  if (['DELIVERED', 'COMPLETED', 'SIGNED'].includes(code)) return 'DELIVERED';
  if (['IN_TRANSIT', 'DEPARTED', 'ARRIVED_HUB'].includes(code)) return 'IN_TRANSIT';
  if (['OUT_FOR_DELIVERY', 'DISPATCHED'].includes(code)) return 'OUT_FOR_DELIVERY';
  if (['PICKED_UP', 'PICKUP', 'RECEIVED'].includes(code)) return 'PICKED_UP';
  if (['FAILED_ATTEMPT', 'FAILED', 'EXCEPTION'].includes(code)) return 'FAILED_ATTEMPT';
  if (['RETURNED', 'RTO'].includes(code)) return 'RETURNED';
  return fallback;
}

/**
 * Flash Open API v2 signature: sorted k=v joined + &key=, SHA256 UPPER.
 * Hash is injected so the helper stays runnable in edge/frontend tests
 * (server passes a node:crypto SHA-256 hex function).
 */
export function flashSignature(
  params: Record<string, string | number>,
  mchKey: string,
  sha256Hex: (s: string) => string,
): string {
  const query = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
  return sha256Hex(`${query}&key=${mchKey}`).toUpperCase();
}

/** Canonical webhook signing payload: tracking|status|timestamp. */
export function webhookSignPayload(trackingNumber: string, statusCode: string, timestamp: number): string {
  return `${trackingNumber}|${statusCode}|${timestamp}`;
}

/** Carrier brand tokens (§2.1). */
export function carrierBrand(carrier: string): { bg: string; fg: string } {
  switch (carrier) {
    case 'FLASH_EXPRESS': return { bg: '#FFF000', fg: '#000000' };
    case 'KERRY_EXPRESS':
    case 'KEX_EXPRESS': return { bg: '#FF5500', fg: '#FFFFFF' };
    case 'THAILAND_POST': return { bg: '#ED1C24', fg: '#FFFFFF' };
    default: return { bg: '#1DB446', fg: '#FFFFFF' };
  }
}

/** LIFF tracking stepper stages for a shipment status. */
export function trackingStages(status: string): Array<{ key: string; label: string; done: boolean }> {
  const order = ['BOOKED', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'];
  const ix = order.indexOf(status);
  const labels: Record<string, string> = {
    BOOKED: 'จองพัสดุแล้ว',
    PICKED_UP: 'รับพัสดุแล้ว',
    IN_TRANSIT: 'กำลังขนส่ง',
    OUT_FOR_DELIVERY: 'นำจ่ายวันนี้',
    DELIVERED: 'จัดส่งสำเร็จ',
  };
  return order.map((key) => ({ key, label: labels[key] as string, done: ix >= 0 && order.indexOf(key) <= ix }));
}
