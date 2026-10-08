// SSOT Phase 077 §5/§8 — Shipment domain entity (webhook trust)
// Canonical: apps/backend/src/modules/logistics/domain/shipment.entity.ts
// - Guards: HMAC-SHA256 webhook signature (timing-safe), 5-min replay
//   window, tenant isolation on every mutation.
// - Zero new deps (node:crypto only).
import { createHmac, timingSafeEqual } from 'node:crypto';
import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { WEBHOOK_REPLAY_TTL_SEC, mapCarrierStatus, webhookSignPayload } from '@repo/shared';

export function assertShipmentTenant(headerTenantId: string | undefined, rowTenantId: string | null | undefined): void {
  const header = (headerTenantId ?? '').trim();
  if (!header) throw new ForbiddenException('Missing X-Tenant-ID header context.');
  if (rowTenantId && rowTenantId !== header) {
    throw new ForbiddenException('Cross-tenant shipment access blocked.');
  }
}

/** HMAC-SHA256 of the canonical signing payload (Gate 4). */
export function signWebhook(secret: string, trackingNumber: string, statusCode: string, timestamp: number): string {
  return createHmac('sha256', secret).update(webhookSignPayload(trackingNumber, statusCode, timestamp)).digest('hex');
}

export function verifyWebhookSignature(
  secret: string,
  trackingNumber: string,
  statusCode: string,
  timestamp: number,
  signature: string,
): void {
  const expected = signWebhook(secret, trackingNumber, statusCode, timestamp);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new UnauthorizedException('Invalid carrier webhook signature');
  }
}

/** Reject webhooks older than 5 minutes (§8 replay guard). */
export function assertWebhookFreshness(timestamp: number, now = Date.now()): void {
  const ageSec = (now - timestamp) / 1000;
  if (!Number.isFinite(ageSec) || ageSec < -60 || ageSec > WEBHOOK_REPLAY_TTL_SEC) {
    throw new BadRequestException('Stale or future-dated webhook payload');
  }
}

export function resolveShipmentStatus(statusCode: string, current: string): string {
  return mapCarrierStatus(statusCode, current);
}
