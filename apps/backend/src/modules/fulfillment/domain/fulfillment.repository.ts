// SSOT Phase 076 §5.1 — Fulfillment repository port
// Canonical: apps/backend/src/modules/fulfillment/domain/fulfillment.repository.ts
// - Port consumed by services (DB-free contract tests); structural Prisma
//   implementation lives in infrastructure/prisma-fulfillment.repository.ts.
// - Zero new deps.
export interface QueueOrderRow {
  orderId: string;
  orderNumber: string;
  tenantId: string | null;
  paymentStatus: string;
  trackingNumber: string | null;
  recipientName: string;
  recipientPhone: string;
  shippingAddress: string;
  postalCode: string;
  weightGrams: number;
  items: Array<{ sku: string; title: string; quantity: number }>;
}

export interface FulfillmentItemRow {
  id: string;
  orderId: string;
  batchId: string | null;
  warehouseId: string;
  courierProvider: string;
  trackingNumber: string | null;
  sortingCode: string | null;
  labelUrl: string | null;
  status: string;
}

export interface FulfillmentRepository {
  /** Tx-bound view — booking writes stay inside one atomic transaction. */
  withTx?(tx: unknown): FulfillmentRepository;
  findQueueOrder(orderId: string): Promise<QueueOrderRow | null>;
  findItemByOrder(orderId: string): Promise<FulfillmentItemRow | null>;
  createBatch(args: {
    batchNumber: string;
    tenantId: string;
    courierProvider: string;
    totalOrders: number;
  }): Promise<{ id: string }>;
  enqueueItem(args: {
    batchId: string;
    orderId: string;
    warehouseId: string;
    courierProvider: string;
  }): Promise<void>;
  markBooked(args: {
    orderId: string;
    warehouseId: string;
    courierProvider: string;
    trackingNumber: string;
    sortingCode: string | null;
  }): Promise<void>;
  markLabel(args: { orderId: string; labelUrl: string; printed: boolean }): Promise<void>;
  updateBatchCounters(batchId: string, ok: boolean): Promise<void>;
  finalizeBatch(batchId: string): Promise<void>;
  listQueue(tenantId: string, status: string | null, skip: number, take: number): Promise<{
    rows: Array<{
      orderId: string;
      orderNumber: string;
      courierProvider: string;
      trackingNumber: string | null;
      status: string;
      updatedAt: Date;
    }>;
    total: number;
  }>;
  bookedItems(orderIds: string[], tenantId: string): Promise<Array<{
    orderId: string;
    orderNumber: string;
    trackingNumber: string;
    sortingCode: string | null;
    courierProvider: string;
    tenantId: string | null;
    recipientName: string;
    recipientPhone: string;
    shippingAddress: string;
    postalCode: string;
  }>>;
}
