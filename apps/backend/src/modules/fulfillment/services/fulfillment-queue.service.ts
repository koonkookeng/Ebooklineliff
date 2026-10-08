// SSOT Phase 076 BDD-1 — Batch courier booking service (queue -> booked)
// Canonical: apps/backend/src/modules/fulfillment/services/fulfillment-queue.service.ts
// - queueBatchBooking: Zod gate -> tenant assert -> one txn creates
//   FulfillmentBatch + QUEUED_FOR_BOOKING items -> xadd queue stream.
// - drainBatch: per item carrier book (failover on open circuit) -> atomic
//   BOOKED + tracking -> LINE tracking event (async seam) -> batch counters.
// - Port-based (repo/tx/queue/notify/carriers) for DB-free tests.
// - Zero new deps.
import { BadRequestException, Injectable } from '@nestjs/common';
import {
  BatchBookingRequestSchema,
  FULFILLMENT_QUEUE_STREAM,
  fulfillmentBatchNumber,
} from '@repo/shared';
import { assertQueueTenant } from '../domain/fulfillment.entity';
import type { FulfillmentRepository } from '../domain/fulfillment.repository';
import { carrierAdapterFor, type CarrierAdapter } from '../adapters/carrier.adapter';
import { failoverCarrier, isCircuitOpen, type BreakerStore } from '../application/circuit-breaker';

export interface QueueBus {
  xadd(stream: string, fields: Record<string, string | number>): Promise<unknown>;
}

export interface TrackingNotifier {
  trackingBooked(args: { tenantId: string; orderId: string; trackingNumber: string; courierProvider: string }): Promise<void>;
}

export interface QueueTx {
  run<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}

@Injectable()
export class FulfillmentQueueService {
  constructor(
    private readonly repo: FulfillmentRepository,
    private readonly tx: QueueTx,
    private readonly bus: QueueBus,
    private readonly notify: TrackingNotifier,
    private readonly breaker: BreakerStore,
    private readonly adapters: (provider: string) => CarrierAdapter = carrierAdapterFor,
  ) {}

  /** Enqueue up to 500 PAID orders for courier booking (BDD-1 <2s/100). */
  async queueBatchBooking(headerTenantId: string | undefined, body: unknown): Promise<{
    batchId: string; batchNumber: string; queued: number; failed: Array<{ orderId: string; reason: string }>;
  }> {
    const parsed = BatchBookingRequestSchema.safeParse({
      ...((body ?? {}) as Record<string, unknown>),
      tenantId: (headerTenantId ?? '').trim(),
    });
    if (!parsed.success) throw new BadRequestException('Invalid batch booking payload');
    const { tenantId, orderIds, courierProvider, warehouseId } = parsed.data;
    const failed: Array<{ orderId: string; reason: string }> = [];
    const queueable: string[] = [];

    for (const orderId of new Set(orderIds)) {
      const order = await this.repo.findQueueOrder(orderId);
      if (!order) { failed.push({ orderId, reason: 'Order not found' }); continue; }
      try {
        assertQueueTenant(tenantId, order.tenantId);
      } catch (e) {
        failed.push({ orderId, reason: (e as Error).message });
        continue;
      }
      if (order.paymentStatus !== 'VERIFIED') {
        failed.push({ orderId, reason: `Order not payable (${order.paymentStatus})` });
        continue;
      }
      if (order.trackingNumber) { failed.push({ orderId, reason: 'Already booked' }); continue; }
      const existing = await this.repo.findItemByOrder(orderId);
      if (existing && existing.status !== 'UNFULFILLED') {
        failed.push({ orderId, reason: `Already ${existing.status}` });
        continue;
      }
      queueable.push(orderId);
    }

    const batchNumber = fulfillmentBatchNumber(tenantId);
    const batch = await this.tx.run(async (tx) => {
      const repo = this.repo.withTx ? this.repo.withTx(tx) : this.repo;
      const created = await repo.createBatch({
        batchNumber,
        tenantId,
        courierProvider,
        totalOrders: queueable.length,
      });
      for (const orderId of queueable) {
        await repo.enqueueItem({ batchId: created.id, orderId, warehouseId, courierProvider });
      }
      return created;
    });

    if (queueable.length > 0) {
      await this.bus.xadd(FULFILLMENT_QUEUE_STREAM, {
        event: 'fulfillment.batch.queued',
        batchId: batch.id,
        tenantId,
        count: queueable.length,
        at: Date.now(),
      }).catch(() => undefined);
    }
    return { batchId: batch.id, batchNumber, queued: queueable.length, failed };
  }

  /** Drain one batch: book each item (failover) then finalize counters. */
  async drainBatch(batchId: string, tenantId: string, orderIds: string[]): Promise<{
    booked: number; failed: Array<{ orderId: string; reason: string }>;
  }> {
    const failed: Array<{ orderId: string; reason: string }> = [];
    let booked = 0;

    for (const orderId of orderIds) {
      const order = await this.repo.findQueueOrder(orderId);
      if (!order) { failed.push({ orderId, reason: 'Order not found' }); continue; }
      try {
        assertQueueTenant(tenantId, order.tenantId);
      } catch (e) {
        failed.push({ orderId, reason: (e as Error).message });
        await this.repo.updateBatchCounters(batchId, false);
        continue;
      }

      const item = await this.repo.findItemByOrder(orderId);
      if (item && item.batchId && item.batchId !== batchId) {
        failed.push({ orderId, reason: 'Not in this batch' });
        await this.repo.updateBatchCounters(batchId, false);
        continue;
      }
      const requested = item?.courierProvider ?? 'FLASH_EXPRESS';
      const active = isCircuitOpen(this.breaker, requested) ? failoverCarrier(this.breaker, requested) : requested;
      if (!active) {
        failed.push({ orderId, reason: 'All carriers unavailable' });
        await this.repo.updateBatchCounters(batchId, false);
        continue;
      }
      if (!item) { failed.push({ orderId, reason: 'Not enqueued' }); continue; }

      try {
        const adapter = this.adapters(active);
        const result = await adapter.book({
          tenantId,
          courierProvider: active,
          orderId: order.orderId,
          orderNumber: order.orderNumber,
          recipientName: order.recipientName,
          recipientPhone: order.recipientPhone,
          shippingAddress: order.shippingAddress,
          postalCode: order.postalCode,
          weightGrams: order.weightGrams,
          warehouseId: item.warehouseId,
        });
        await this.tx.run(async (tx) => {
          const repo = this.repo.withTx ? this.repo.withTx(tx) : this.repo;
          await repo.markBooked({
            orderId: order.orderId,
            warehouseId: result.warehouseId,
            courierProvider: active as string,
            trackingNumber: result.trackingNumber,
            sortingCode: result.sortingCode,
          });
        });
        this.breaker.recordSuccess(active);
        booked++;
        await this.repo.updateBatchCounters(batchId, true);
        await this.notify.trackingBooked({
          tenantId,
          orderId: order.orderId,
          trackingNumber: result.trackingNumber,
          courierProvider: active,
        }).catch(() => undefined);
      } catch (e) {
        const n = this.breaker.recordFailure(active);
        const next = n >= 3 ? failoverCarrier(this.breaker, active as string) : null;
        failed.push({ orderId, reason: next ? `Carrier busy, failed over to ${next}` : (e as Error).message });
        await this.repo.updateBatchCounters(batchId, false);
      }
    }

    await this.repo.finalizeBatch(batchId).catch(() => undefined);
    return { booked, failed };
  }
}
