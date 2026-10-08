// SSOT Phase 077 BDD-1 — Parcel booking service (carrier API -> Shipment)
// Canonical: apps/backend/src/modules/logistics/services/logistics.service.ts
// - bookParcel: Zod gate -> tenant assert -> VERIFIED order -> carrier API
//   (<800ms budget) -> atomic Shipment upsert + Order.trackingNumber ->
//   logistics.shipment.created event (Gate 8).
// - Port-based (repo/tx/factory/bus) for DB-free tests. Zero new deps.
import { BadRequestException, Injectable } from '@nestjs/common';
import { BookParcelInputSchema, LOGISTICS_EVENT_STREAM } from '@repo/shared';
import { assertShipmentTenant } from '../domain/shipment.entity';
import type { LogisticsRepository } from '../domain/logistics.repository';
import { CarrierFactoryService } from './carrier-factory.service';

export interface LogisticsTx {
  run<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}

export interface LogisticsBus {
  xadd(stream: string, fields: Record<string, string | number>): Promise<unknown>;
}

@Injectable()
export class LogisticsService {
  constructor(
    private readonly repo: LogisticsRepository,
    private readonly tx: LogisticsTx,
    private readonly carriers: CarrierFactoryService,
    private readonly bus: LogisticsBus,
  ) {}

  async bookParcel(headerTenantId: string | undefined, body: unknown): Promise<{
    shipmentId: string; trackingNumber: string; labelUrl: string | null;
  }> {
    const parsed = BookParcelInputSchema.safeParse({
      ...((body ?? {}) as Record<string, unknown>),
      tenantId: (headerTenantId ?? '').trim(),
    });
    if (!parsed.success) throw new BadRequestException('Invalid parcel booking payload');
    const { tenantId, orderId, carrier, weightGrams, remark } = parsed.data;

    const order = await this.repo.findParcelOrder(orderId);
    if (!order) throw new BadRequestException('Order not found');
    assertShipmentTenant(tenantId, order.tenantId);
    if (order.paymentStatus !== 'VERIFIED') {
      throw new BadRequestException(`Order not payable (${order.paymentStatus})`);
    }

    const config = await this.repo.carrierConfig(tenantId, carrier);
    if (!config) throw new BadRequestException(`Carrier ${carrier} not configured for tenant`);
    const adapter = this.carriers.forCarrier(carrier);

    const booked = await adapter.bookParcel({
      mchId: config.mchId,
      mchKey: config.apiSecret,
      outTradeNo: order.orderNumber,
      senderName: tenantId,
      senderPhone: '-',
      senderAddress: tenantId,
      recipientName: order.userId,
      recipientPhone: '-',
      recipientAddress: orderId,
      weightGrams,
      remark,
      isSandbox: config.isSandbox,
    });

    const saved = await this.tx.run(async (tx) => {
      const repo = this.repo.withTx ? this.repo.withTx(tx) : this.repo;
      return repo.upsertShipment({
        orderId: order.orderId,
        carrier,
        trackingNumber: booked.trackingNumber,
        courierOrderId: booked.courierOrderId,
        labelUrl: booked.labelUrl,
        weightGrams,
        shippingFee: 0,
        senderName: tenantId,
        senderPhone: '-',
        recipientName: order.userId,
        recipientPhone: '-',
        destinationAddr: orderId,
      });
    });

    await this.bus.xadd(LOGISTICS_EVENT_STREAM, {
      event: 'logistics.shipment.created',
      tenantId,
      orderId,
      trackingNumber: booked.trackingNumber,
      carrier,
      at: Date.now(),
    }).catch(() => undefined);

    return { shipmentId: saved.id, trackingNumber: booked.trackingNumber, labelUrl: booked.labelUrl };
  }
}
