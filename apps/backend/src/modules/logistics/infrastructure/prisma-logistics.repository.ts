// SSOT Phase 077 §5 — Prisma logistics repository (tenant-scoped ledger)
// Canonical: apps/backend/src/modules/logistics/infrastructure/prisma-logistics.repository.ts
// - Structural typing (076 precedent); webhook lookups join Order+User so
//   the LINE fan-out stays single-query (BDD-2 <500ms).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';
import type { LogisticsRepository, ParcelOrderRow, ShipmentRow } from '../domain/logistics.repository';

type Db = Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>>;

function toRepo(db: Db): LogisticsRepository {
  return {
    async findParcelOrder(orderId: string): Promise<ParcelOrderRow | null> {
      const order = (await db['order'].findUnique({
        where: { id: orderId },
        include: { user: true },
      }).catch(() => null)) as {
        id: string; orderNumber: string; tenantId: string | null; paymentStatus: string;
        userId: string; user: { lineUserId: string | null } | null;
      } | null;
      if (!order) return null;
      return {
        orderId: order.id,
        orderNumber: order.orderNumber,
        tenantId: order.tenantId,
        paymentStatus: order.paymentStatus,
        userId: order.userId,
        lineUserId: order.user?.lineUserId ?? null,
      };
    },

    async findShipmentByTracking(trackingNumber: string): Promise<ShipmentRow | null> {
      const s = (await db['shipment'].findUnique({
        where: { trackingNumber },
        include: { order: true },
      }).catch(() => null)) as {
        id: string; orderId: string; carrier: string; trackingNumber: string; status: string;
        order: { tenantId: string | null };
      } | null;
      if (!s) return null;
      return {
        id: s.id,
        orderId: s.orderId,
        carrier: s.carrier,
        trackingNumber: s.trackingNumber,
        status: s.status,
        tenantId: s.order?.tenantId ?? null,
      };
    },

    async upsertShipment(args: {
      orderId: string; carrier: string; trackingNumber: string; courierOrderId: string | null;
      labelUrl: string | null; weightGrams: number; shippingFee: number; senderName: string;
      senderPhone: string; recipientName: string; recipientPhone: string; destinationAddr: string;
    }) {
      const row = (await db['shipment'].upsert({
        where: { orderId: args.orderId },
        update: {
          carrier: args.carrier,
          trackingNumber: args.trackingNumber,
          courierOrderId: args.courierOrderId,
          labelUrl: args.labelUrl,
          status: 'BOOKED',
        },
        create: { ...args, status: 'BOOKED' },
      })) as { id: string };
      await db['order'].update({
        where: { id: args.orderId },
        data: { trackingNumber: args.trackingNumber, orderStatus: 'PROCESSING' },
      }).catch(() => null);
      return { id: row.id };
    },

    async applyTrackingUpdate(args: {
      shipmentId: string; status: string; statusCode: string; statusText: string;
      location: string | undefined; rawPayload: unknown; eventTimestamp: Date;
    }): Promise<void> {
      await db['shipment'].update({
        where: { id: args.shipmentId },
        data: { status: args.status },
      });
      await db['trackingHistory'].create({
        data: {
          shipmentId: args.shipmentId,
          statusCode: args.statusCode,
          statusText: args.statusText,
          location: args.location ?? null,
          rawPayload: args.rawPayload ?? {},
          eventTimestamp: args.eventTimestamp,
        },
      });
    },

    async appendWebhookLog(args: { carrier: string; payload: unknown; processed: boolean; error: string | null }): Promise<void> {
      await db['logisticsWebhookLog'].create({ data: { ...args } }).catch(() => null);
    },

    async carrierConfig(tenantId: string, carrier: string) {
      return (await db['carrierApiConfig'].findUnique({
        where: { tenantId_carrier: { tenantId, carrier } },
      }).catch(() => null)) as { mchId: string; apiSecret: string; isSandbox: boolean } | null;
    },

    async trackingNotifyTarget(trackingNumber: string) {
      const s = (await db['shipment'].findUnique({
        where: { trackingNumber },
        include: { order: { include: { user: true } } },
      }).catch(() => null)) as {
        orderId: string;
        order: { orderNumber: string; tenantId: string | null; user: { lineUserId: string | null } | null };
      } | null;
      if (!s) return null;
      return {
        orderId: s.orderId,
        orderNumber: s.order.orderNumber,
        lineUserId: s.order.user?.lineUserId ?? null,
        tenantId: s.order.tenantId,
      };
    },

    async shipmentDetail(orderId: string, tenantId: string) {
      const s = (await db['shipment'].findUnique({
        where: { orderId },
        include: { order: true, trackingLogs: { orderBy: { eventTimestamp: 'asc' } } },
      }).catch(() => null)) as {
        carrier: string; trackingNumber: string; status: string;
        order: { orderNumber: string; tenantId: string | null };
        trackingLogs: Array<{ statusCode: string; statusText: string; location: string | null; eventTimestamp: Date }>;
      } | null;
      if (!s || (s.order?.tenantId ?? tenantId) !== tenantId) return null;
      return {
        orderNumber: s.order.orderNumber,
        carrier: s.carrier,
        trackingNumber: s.trackingNumber,
        status: s.status,
        history: s.trackingLogs,
      };
    },
  };
}

@Injectable()
export class PrismaLogisticsRepository implements LogisticsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get root(): LogisticsRepository {
    return toRepo(this.prisma as unknown as Db);
  }

  withTx(tx: unknown): LogisticsRepository {
    return toRepo(tx as Db);
  }

  findParcelOrder(orderId: string) { return this.root.findParcelOrder(orderId); }
  findShipmentByTracking(trackingNumber: string) { return this.root.findShipmentByTracking(trackingNumber); }
  upsertShipment(args: {
    orderId: string; carrier: string; trackingNumber: string; courierOrderId: string | null;
    labelUrl: string | null; weightGrams: number; shippingFee: number; senderName: string;
    senderPhone: string; recipientName: string; recipientPhone: string; destinationAddr: string;
  }) { return this.root.upsertShipment(args); }
  applyTrackingUpdate(args: {
    shipmentId: string; status: string; statusCode: string; statusText: string;
    location: string | undefined; rawPayload: unknown; eventTimestamp: Date;
  }) { return this.root.applyTrackingUpdate(args); }
  appendWebhookLog(args: { carrier: string; payload: unknown; processed: boolean; error: string | null }) {
    return this.root.appendWebhookLog(args);
  }
  carrierConfig(tenantId: string, carrier: string) { return this.root.carrierConfig(tenantId, carrier); }
  trackingNotifyTarget(trackingNumber: string) { return this.root.trackingNotifyTarget(trackingNumber); }
  shipmentDetail(orderId: string, tenantId: string) { return this.root.shipmentDetail(orderId, tenantId); }
}
