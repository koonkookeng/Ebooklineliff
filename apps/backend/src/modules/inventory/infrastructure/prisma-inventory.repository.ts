// SSOT Phase 075 §5 — Prisma inventory repository (tenant-scoped ledger)
// Canonical: apps/backend/src/modules/inventory/infrastructure/prisma-inventory.repository.ts
// - Structural typing (Phase 027/029 precedent); every SKU lookup joins its
//   warehouse row so tenant checks stay single-query (BDD-1).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';
import type { SkuStockRow, WarehouseInventoryRepository } from '../domain/warehouse-stock.repository';

type Db = Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>>;

/** Row mappers shared by the root and tx-bound repositories. */
function toRepo(db: Db): WarehouseInventoryRepository {
  return {
    async findSkuInWarehouse(sku: string, warehouseId: string): Promise<SkuStockRow | null> {
      const detail = (await db['physicalDetail'].findUnique({ where: { sku } }).catch(() => null)) as {
        id: string;
      } | null;
      if (!detail) return null;
      const stock = (await db['warehouseStock'].findUnique({
        where: { warehouseId_physicalDetailId: { warehouseId, physicalDetailId: detail.id } },
      }).catch(() => null)) as { stockQty: number; safetyStock: number } | null;
      // Tenant via Product ownership (PhysicalDetail has no tenantId column).
      const product = (await db['product'].findFirst({
        where: { physicalDetail: { id: detail.id } },
      }).catch(() => null)) as { tenantId: string | null } | null;
      return {
        physicalDetailId: detail.id,
        sku,
        tenantId: product?.tenantId ?? null,
        warehouseId,
        stockQty: stock?.stockQty ?? 0,
        safetyStock: stock?.safetyStock ?? 10,
      };
    },

    async findSkuGlobal(sku: string) {
      const detail = (await db['physicalDetail'].findUnique({ where: { sku } }).catch(() => null)) as { id: string } | null;
      if (!detail) return null;
      const product = (await db['product'].findFirst({
        where: { physicalDetail: { id: detail.id } },
      }).catch(() => null)) as { tenantId: string | null } | null;
      return { physicalDetailId: detail.id, tenantId: product?.tenantId ?? null };
    },

    async upsertStock(warehouseId: string, physicalDetailId: string, stockQty: number): Promise<void> {
      await db['warehouseStock'].upsert({
        where: { warehouseId_physicalDetailId: { warehouseId, physicalDetailId } },
        update: { stockQty },
        create: { warehouseId, physicalDetailId, stockQty },
      });
    },

    async syncPhysicalAggregate(physicalDetailId: string): Promise<number> {
      const agg = (await db['warehouseStock'].aggregate({
        where: { physicalDetailId },
        _sum: { stockQty: true },
      }).catch(() => ({ _sum: { stockQty: 0 } }))) as { _sum: { stockQty: number | null } };
      const total = agg._sum.stockQty ?? 0;
      await db['physicalDetail'].update({ where: { id: physicalDetailId }, data: { stockQty: total } }).catch(() => null);
      return total;
    },

    async appendMovementLog(args: {
      warehouseId: string; sku: string; previousQty: number; newQty: number;
      quantityDelta: number; adjustmentType: string; remark?: string; updatedBy: string;
    }): Promise<void> {
      await db['stockMovementLog'].create({ data: { ...args } });
    },

    async listWarehouseStock(warehouseId: string, searchSku: string, skip: number, take: number) {
      const skuFilter = searchSku ? { physicalDetail: { sku: { contains: searchSku, mode: 'insensitive' } } } : {};
      const [rows, total] = (await Promise.all([
        db['warehouseStock'].findMany({
          where: { warehouseId, ...skuFilter },
          include: { physicalDetail: { include: { product: true } } },
          skip,
          take,
          orderBy: { updatedAt: 'desc' },
        }),
        db['warehouseStock'].count({ where: { warehouseId, ...skuFilter } }),
      ]).catch(() => [[], 0])) as unknown as [Array<{
        stockQty: number; safetyStock: number; rackLocation: string | null;
        physicalDetail: { sku: string; product: { title: string } | null };
      }>, number];
      const mapped = rows.map((r) => ({
        sku: r.physicalDetail.sku,
        title: r.physicalDetail.product?.title ?? r.physicalDetail.sku,
        stockQty: r.stockQty,
        safetyStock: r.safetyStock,
        rackLocation: r.rackLocation,
      }));
      return { rows: mapped, total: (total as number) ?? mapped.length };
    },

    async movementLogs(sku: string, take: number) {
      return (await db['stockMovementLog'].findMany({
        where: { sku },
        orderBy: { createdAt: 'desc' },
        take,
      }).catch(() => [])) as Array<{
        id: string; sku: string; warehouseId: string; previousQty: number; newQty: number;
        quantityDelta: number; adjustmentType: string; remark: string | null; updatedBy: string; createdAt: Date;
      }>;
    },

    async findOrdersForLabels(orderIds: string[], tenantId: string) {
      const rows = (await db['order'].findMany({
        where: { id: { in: orderIds } },
      }).catch(() => [])) as Array<{ id: string; orderNumber: string; trackingNumber: string | null; tenantId: string | null }>;
      return rows.filter((r) => (r.tenantId ?? tenantId) === tenantId);
    },
  };
}

@Injectable()
export class PrismaInventoryRepository implements WarehouseInventoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get root(): WarehouseInventoryRepository {
    return toRepo(this.prisma as unknown as Db);
  }

  /** Tx-bound repository — all writes inside one atomic transaction. */
  withTx(tx: unknown): WarehouseInventoryRepository {
    return toRepo(tx as Db);
  }

  findSkuInWarehouse(sku: string, warehouseId: string) {
    return this.root.findSkuInWarehouse(sku, warehouseId);
  }

  findSkuGlobal(sku: string) {
    return this.root.findSkuGlobal(sku);
  }

  upsertStock(warehouseId: string, physicalDetailId: string, stockQty: number) {
    return this.root.upsertStock(warehouseId, physicalDetailId, stockQty);
  }

  syncPhysicalAggregate(physicalDetailId: string) {
    return this.root.syncPhysicalAggregate(physicalDetailId);
  }

  appendMovementLog(args: {
    warehouseId: string; sku: string; previousQty: number; newQty: number;
    quantityDelta: number; adjustmentType: string; remark?: string; updatedBy: string;
  }) {
    return this.root.appendMovementLog(args);
  }

  listWarehouseStock(warehouseId: string, searchSku: string, skip: number, take: number) {
    return this.root.listWarehouseStock(warehouseId, searchSku, skip, take);
  }

  movementLogs(sku: string, take: number) {
    return this.root.movementLogs(sku, take);
  }

  findOrdersForLabels(orderIds: string[], tenantId: string) {
    return this.root.findOrdersForLabels(orderIds, tenantId);
  }
}
