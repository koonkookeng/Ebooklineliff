// SSOT Phase 077 BDD-2 — Carrier webhook intake service (HMAC + replay)
// Canonical: apps/backend/src/modules/logistics/services/carrier-webhook.service.ts
// - ingest: Zod gate -> shipment lookup -> tenant secret -> HMAC verify ->
//   freshness + nonce replay guard -> atomic status+history -> LINE Flex
//   (<500ms budget, best-effort) -> webhook audit log.
// - Port-based (repo/tx/nonce/notify) for DB-free tests. Zero new deps.
import { BadRequestException, Injectable } from '@nestjs/common';
import { CarrierWebhookPayloadSchema, WEBHOOK_REPLAY_TTL_SEC } from '@repo/shared';
import {
  assertWebhookFreshness,
  resolveShipmentStatus,
  verifyWebhookSignature,
} from '../domain/shipment.entity';
import type { LogisticsRepository } from '../domain/logistics.repository';
import { LineNotificationService } from './line-notification.service';

export interface WebhookTx {
  run<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}

export interface NonceStore {
  /** SETNX with TTL — true when first seen (not a replay). */
  setnx(key: string, ttlSeconds: number): Promise<boolean>;
}

@Injectable()
export class CarrierWebhookService {
  constructor(
    private readonly repo: LogisticsRepository,
    private readonly tx: WebhookTx,
    private readonly nonce: NonceStore,
    private readonly line: LineNotificationService,
    private readonly liffId: string,
  ) {}

  async ingest(rawBody: unknown): Promise<{ status: string; trackingNumber: string }> {
    const parsed = CarrierWebhookPayloadSchema.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException('Invalid Webhook Payload Format');
    const payload = parsed.data;

    const shipment = await this.repo.findShipmentByTracking(payload.trackingNumber);
    if (!shipment) throw new BadRequestException('Shipment not found');
    const tenantId = shipment.tenantId ?? 'default';

    const config = await this.repo.carrierConfig(tenantId, payload.carrier);
    if (!config) throw new BadRequestException('Carrier not configured for tenant');
    verifyWebhookSignature(config.apiSecret, payload.trackingNumber, payload.statusCode, payload.timestamp, payload.signature);
    assertWebhookFreshness(payload.timestamp);

    const nonceKey = `webhook:nonce:${payload.carrier}:${payload.trackingNumber}:${payload.timestamp}`;
    if (!(await this.nonce.setnx(nonceKey, WEBHOOK_REPLAY_TTL_SEC))) {
      throw new BadRequestException('Duplicate webhook delivery');
    }

    const next = resolveShipmentStatus(payload.statusCode, shipment.status);
    await this.tx.run(async (tx) => {
      const repo = this.repo.withTx ? this.repo.withTx(tx) : this.repo;
      await repo.applyTrackingUpdate({
        shipmentId: shipment.id,
        status: next,
        statusCode: payload.statusCode,
        statusText: payload.statusDescription,
        location: payload.location,
        rawPayload: rawBody ?? {},
        eventTimestamp: new Date(payload.timestamp),
      });
    });
    await this.repo.appendWebhookLog({ carrier: payload.carrier, payload: rawBody ?? {}, processed: true, error: null });

    const target = await this.repo.trackingNotifyTarget(payload.trackingNumber);
    if (target?.lineUserId) {
      await this.line
        .sendTrackingFlexMessage({
          lineUserId: target.lineUserId,
          orderNumber: target.orderNumber,
          carrierName: payload.carrier,
          trackingNumber: payload.trackingNumber,
          statusText: payload.statusDescription,
          trackingUrl: `https://liff.line.me/${this.liffId}/orders/${target.orderId}/tracking`,
        })
        .catch(() => undefined);
    }

    return { status: 'SUCCESS', trackingNumber: payload.trackingNumber };
  }
}
