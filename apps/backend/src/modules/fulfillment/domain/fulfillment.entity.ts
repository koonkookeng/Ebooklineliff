// SSOT Phase 076 §5 — Fulfillment domain entity (forward-only lifecycle)
// Canonical: apps/backend/src/modules/fulfillment/domain/fulfillment.entity.ts
// - Guards: QUEUED_FOR_BOOKING -> BOOKED -> LABEL_GENERATED -> PRINTED ladder;
//   CANCELLED/DELIVERY_FAILED terminal-any-state (073 RETURNED parity).
// - HMAC-SHA256 label token (Gate 4 anti-tamper QR) via node:crypto only.
// - Zero new deps.
import { createHmac } from 'node:crypto';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { assertFulfillmentForward, labelTokenPayload } from '@repo/shared';

export function assertBookingTransition(from: string, to: string): void {
  try {
    assertFulfillmentForward(from, to);
  } catch {
    throw new BadRequestException(`Illegal fulfillment transition ${from} -> ${to}`);
  }
}

export function assertQueueTenant(headerTenantId: string | undefined, rowTenantId: string | null | undefined): void {
  const header = (headerTenantId ?? '').trim();
  if (!header) throw new ForbiddenException('Missing X-Tenant-ID header context.');
  if (rowTenantId && rowTenantId !== header) {
    throw new ForbiddenException('Cross-tenant fulfillment access blocked.');
  }
}

/** HMAC-SHA256 anti-tamper token embedded in the label QR (Gate 4). */
export function signLabelToken(secret: string, orderId: string, trackingNumber: string, tenantId: string): string {
  return createHmac('sha256', secret).update(labelTokenPayload(orderId, trackingNumber, tenantId)).digest('hex');
}

/** Deterministic tracking number per carrier (adapter seam for live APIs). */
export function buildTrackingNumber(provider: string, orderNumber: string, at = Date.now()): string {
  const prefix =
    provider === 'FLASH_EXPRESS' ? 'TH' :
    provider === 'KEX_EXPRESS' ? 'KX' :
    provider === 'JT_EXPRESS' ? 'JT' :
    provider === 'THAILAND_POST' ? 'EP' : 'CF';
  const hash = Math.abs(
    [...`${orderNumber}:${at}`].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7),
  )
    .toString(36)
    .toUpperCase()
    .padStart(8, '0')
    .slice(-8);
  return `${prefix}${hash}TH`;
}
