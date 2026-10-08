// SSOT Phase 077 §5.1 — Logistics repository port
// Canonical: apps/backend/src/modules/logistics/domain/logistics.repository.ts
// - Port consumed by services (DB-free contract tests); structural Prisma
//   implementation lives in infrastructure/prisma-logistics.repository.ts.
// - Zero new deps.
export interface ParcelOrderRow {
  orderId: string;
  orderNumber: string;
  tenantId: string | null;
  paymentStatus: string;
  userId: string;
  lineUserId: string | null;
}

export interface ShipmentRow {
  id: string;
  orderId: string;
  carrier: string;
  trackingNumber: string;
  status: string;
  tenantId: string | null;
}

export interface LogisticsRepository {
  /** Tx-bound view — webhook updates stay inside one atomic transaction. */
  withTx?(tx: unknown): LogisticsRepository;
  findParcelOrder(orderId: string): Promise<ParcelOrderRow | null>;
  findShipmentByTracking(trackingNumber: string): Promise<ShipmentRow | null>;
  upsertShipment(args: {
    orderId: string;
    carrier: string;
    trackingNumber: string;
    courierOrderId: string | null;
    labelUrl: string | null;
    weightGrams: number;
    shippingFee: number;
    senderName: string;
    senderPhone: string;
    recipientName: string;
    recipientPhone: string;
    destinationAddr: string;
  }): Promise<{ id: string }>;
  applyTrackingUpdate(args: {
    shipmentId: string;
    status: string;
    statusCode: string;
    statusText: string;
    location: string | undefined;
    rawPayload: unknown;
    eventTimestamp: Date;
  }): Promise<void>;
  appendWebhookLog(args: { carrier: string; payload: unknown; processed: boolean; error: string | null }): Promise<void>;
  carrierConfig(tenantId: string, carrier: string): Promise<{ mchId: string; apiSecret: string; isSandbox: boolean } | null>;
  /** LINE fan-out target for a tracking number (single-query join). */
  trackingNotifyTarget(trackingNumber: string): Promise<{
    orderId: string; orderNumber: string; lineUserId: string | null; tenantId: string | null;
  } | null>;
  shipmentDetail(orderId: string, tenantId: string): Promise<{
    orderNumber: string;
    carrier: string;
    trackingNumber: string;
    status: string;
    history: Array<{ statusCode: string; statusText: string; location: string | null; eventTimestamp: Date }>;
  } | null>;
}
