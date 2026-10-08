// SSOT Phase 075 §5.1 — Warehouse stock repository port
// Canonical: apps/backend/src/modules/inventory/domain/warehouse-stock.repository.ts
// - Port consumed by use-cases (DB-free contract tests); structural Prisma
//   implementation lives in infrastructure/prisma-inventory.repository.ts.
// - Zero new deps.
export interface SkuStockRow {
  physicalDetailId: string;
  sku: string;
  tenantId: string | null;
  warehouseId: string;
  stockQty: number;
  safetyStock: number;
}

export interface WarehouseInventoryRepository {
  /** Tx-bound view — all writes inside one atomic transaction (Gate 7). */
  withTx?(tx: unknown): WarehouseInventoryRepository;
  findSkuInWarehouse(sku: string, warehouseId: string): Promise<SkuStockRow | null>;
  findSkuGlobal(sku: string): Promise<{ physicalDetailId: string; tenantId: string | null } | null>;
  upsertStock(warehouseId: string, physicalDetailId: string, stockQty: number): Promise<void>;
  syncPhysicalAggregate(physicalDetailId: string): Promise<number>;
  appendMovementLog(args: {
    warehouseId: string; sku: string; previousQty: number; newQty: number;
    quantityDelta: number; adjustmentType: string; remark?: string; updatedBy: string;
  }): Promise<void>;
  listWarehouseStock(warehouseId: string, searchSku: string, skip: number, take: number): Promise<{
    rows: Array<{ sku: string; title: string; stockQty: number; safetyStock: number; rackLocation: string | null }>;
    total: number;
  }>;
  movementLogs(sku: string, take: number): Promise<Array<{
    id: string; sku: string; warehouseId: string; previousQty: number; newQty: number;
    quantityDelta: number; adjustmentType: string; remark: string | null; updatedBy: string; createdAt: Date;
  }>>;
  findOrdersForLabels(orderIds: string[], tenantId: string): Promise<Array<{
    id: string; orderNumber: string; trackingNumber: string | null; tenantId: string | null;
  }>>;
}
