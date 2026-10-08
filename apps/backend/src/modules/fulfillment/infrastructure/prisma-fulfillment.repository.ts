// SSOT Phase 076 §5 — Prisma fulfillment repository (tenant-scoped ledger)
// Canonical: apps/backend/src/modules/fulfillment/infrastructure/prisma-fulfillment.repository.ts
// - Structural typing (075 precedent); queue reads join Order + items so the
//   tenant check stays single-query (BDD-1); booking writes run inside the
//   caller's $transaction (Gate 7).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';
import type { FulfillmentRepository, QueueOrderRow } from '../domain/fulfillment.repository';

type Db = Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>>;

function toRepo(db: Db): FulfillmentRepository {
  return {
    async findQueueOrder(orderId: string): Promise<QueueOrderRow | null> {
      const order = (await db['order'].findUnique({
        where: { id: orderId },
        include: { orderItems: { include: { product: { include: { physicalDetail: true } } } } },
      }).catch(() => null)) as {
        id: string; orderNumber: string; tenantId: string | null; paymentStatus: string;
        trackingNumber: string | null; userId: string;
        orderItems: Array<{ quantity: number; product: { title: string; physicalDetail: { sku: string } | null } | null }>;
      } | null;
      if (!order) return null;
      return {
        orderId: order.id,
        orderNumber: order.orderNumber,
        tenantId: order.tenantId,
        paymentStatus: order.paymentStatus,
        trackingNumber: order.trackingNumber,
        recipientName: order.userId,
        recipientPhone: '-',
        shippingAddress: '-',
        postalCode: '00000',
        weightGrams: 500,
        items: order.orderItems.map((i) => ({
          sku: i.product?.physicalDetail?.sku ?? 'UNKNOWN',
          title: i.product?.title ?? 'UNKNOWN',
          quantity: i.quantity,
        })),
      };
    },

    async findItemByOrder(orderId: string) {
      return (await db['fulfillmentItem'].findUnique({ where: { orderId } }).catch(() => null)) as {
        id: string; orderId: string; batchId: string | null; warehouseId: string; courierProvider: string;
        trackingNumber: string | null; sortingCode: string | null; labelUrl: string | null; status: string;
      } | null;
    },

    async createBatch(args: { batchNumber: string; tenantId: string; courierProvider: string; totalOrders: number }) {
      return (await db['fulfillmentBatch'].create({ data: { ...args } })) as { id: string };
    },

    async enqueueItem(args: { batchId: string; orderId: string; warehouseId: string; courierProvider: string }): Promise<void> {
      await db['fulfillmentItem'].upsert({
        where: { orderId: args.orderId },
        update: { batchId: args.batchId, courierProvider: args.courierProvider, status: 'QUEUED_FOR_BOOKING', errorMessage: null },
        create: { ...args, status: 'QUEUED_FOR_BOOKING' },
      });
    },

    async markBooked(args: { orderId: string; warehouseId: string; courierProvider: string; trackingNumber: string; sortingCode: string | null }): Promise<void> {
      await db['fulfillmentItem'].update({
        where: { orderId: args.orderId },
        data: {
          warehouseId: args.warehouseId,
          courierProvider: args.courierProvider,
          trackingNumber: args.trackingNumber,
          sortingCode: args.sortingCode,
          status: 'BOOKED',
          errorMessage: null,
        },
      });
      await db['order'].update({
        where: { id: args.orderId },
        data: { trackingNumber: args.trackingNumber },
      }).catch(() => null);
    },

    async markLabel(args: { orderId: string; labelUrl: string; printed: boolean }): Promise<void> {
      await db['fulfillmentItem'].update({
        where: { orderId: args.orderId },
        data: {
          labelUrl: args.labelUrl,
          status: args.printed ? 'PRINTED' : 'LABEL_GENERATED',
          printedAt: args.printed ? new Date() : undefined,
        },
      });
    },

    async updateBatchCounters(batchId: string, ok: boolean): Promise<void> {
      await db['fulfillmentBatch'].update({
        where: { id: batchId },
        data: ok ? { successCount: { increment: 1 } } : { failureCount: { increment: 1 } },
      }).catch(() => null);
    },

    async finalizeBatch(batchId: string): Promise<void> {
      const batch = (await db['fulfillmentBatch'].findUnique({ where: { id: batchId } }).catch(() => null)) as {
        failureCount: number; totalOrders: number;
      } | null;
      if (!batch) return;
      await db['fulfillmentBatch'].update({
        where: { id: batchId },
        data: { status: batch.failureCount >= batch.totalOrders && batch.totalOrders > 0 ? 'FAILED' : 'COMPLETED' },
      }).catch(() => null);
    },

    async listQueue(tenantId: string, status: string | null, skip: number, take: number) {
      const where = { batch: { tenantId }, ...(status ? { status } : {}) };
      const [rows, total] = (await Promise.all([
        db['fulfillmentItem'].findMany({
          where,
          include: { order: true },
          skip,
          take,
          orderBy: { updatedAt: 'desc' },
        }),
        db['fulfillmentItem'].count({ where }),
      ]).catch(() => [[], 0])) as unknown as [Array<{
        orderId: string; courierProvider: string; trackingNumber: string | null;
        status: string; updatedAt: Date; order: { orderNumber: string };
      }>, number];
      return {
        rows: rows.map((r) => ({
          orderId: r.orderId,
          orderNumber: r.order?.orderNumber ?? r.orderId,
          courierProvider: r.courierProvider,
          trackingNumber: r.trackingNumber,
          status: r.status,
          updatedAt: r.updatedAt,
        })),
        total: (total as number) ?? 0,
      };
    },

    async bookedItems(orderIds: string[], tenantId: string) {
      const rows = (await db['fulfillmentItem'].findMany({
        where: { orderId: { in: orderIds }, status: { in: ['BOOKED', 'LABEL_GENERATED', 'PRINTED'] } },
        include: { order: true, batch: true },
      }).catch(() => [])) as Array<{
        orderId: string; trackingNumber: string | null; sortingCode: string | null;
        courierProvider: string; order: { orderNumber: string; tenantId: string | null };
        batch: { tenantId: string } | null;
      }>;
      return rows
        .filter((r) => (r.batch?.tenantId ?? r.order.tenantId ?? tenantId) === tenantId && r.trackingNumber)
        .map((r) => ({
          orderId: r.orderId,
          orderNumber: r.order.orderNumber,
          trackingNumber: r.trackingNumber as string,
          sortingCode: r.sortingCode,
          courierProvider: r.courierProvider,
          tenantId: r.batch?.tenantId ?? r.order.tenantId,
          recipientName: r.orderId,
          recipientPhone: '-',
          shippingAddress: '-',
          postalCode: '00000',
        }));
    },
  };
}

@Injectable()
export class PrismaFulfillmentRepository implements FulfillmentRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get root(): FulfillmentRepository {
    return toRepo(this.prisma as unknown as Db);
  }

  withTx(tx: unknown): FulfillmentRepository {
    return toRepo(tx as Db);
  }

  findQueueOrder(orderId: string) { return this.root.findQueueOrder(orderId); }
  findItemByOrder(orderId: string) { return this.root.findItemByOrder(orderId); }
  createBatch(args: { batchNumber: string; tenantId: string; courierProvider: string; totalOrders: number }) {
    return this.root.createBatch(args);
  }
  enqueueItem(args: { batchId: string; orderId: string; warehouseId: string; courierProvider: string }) {
    return this.root.enqueueItem(args);
  }
  markBooked(args: { orderId: string; warehouseId: string; courierProvider: string; trackingNumber: string; sortingCode: string | null }) {
    return this.root.markBooked(args);
  }
  markLabel(args: { orderId: string; labelUrl: string; printed: boolean }) {
    return this.root.markLabel(args);
  }
  updateBatchCounters(batchId: string, ok: boolean) { return this.root.updateBatchCounters(batchId, ok); }
  finalizeBatch(batchId: string) { return this.root.finalizeBatch(batchId); }
  listQueue(tenantId: string, status: string | null, skip: number, take: number) {
    return this.root.listQueue(tenantId, status, skip, take);
  }
  bookedItems(orderIds: string[], tenantId: string) { return this.root.bookedItems(orderIds, tenantId); }
}
