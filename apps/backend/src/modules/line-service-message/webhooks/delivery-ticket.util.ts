// SSOT Phase 024 — Delivery ticket HMAC (pure, decorator-free for tsx testability)
// Canonical: apps/backend/src/modules/line-service-message/webhooks/delivery-ticket.util.ts
// - Extracted from line-delivery-status.controller.ts so contract tests can import
//   without NestJS parameter decorators (tsx/esbuild limitation).
// - Server-secret HMAC ticket minted at dispatch time; unknown/forged → 404 upstream.
import { createHmac, timingSafeEqual } from 'node:crypto';

export function callbackSecret(): string {
  return process.env.SERVICE_MESSAGE_HMAC_SECRET ?? 'service-message-dev-hmac';
}

export function signDeliveryTicket(logId: string, status: string): string {
  return createHmac('sha256', callbackSecret()).update(`${logId}.${status}`).digest('hex');
}

export function verifyDeliveryTicket(logId: string, status: string, sig: string): boolean {
  const expected = signDeliveryTicket(logId, status);
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
