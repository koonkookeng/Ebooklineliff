// SSOT Phase 075 BDD-1 — Checkout inventory lock (guarded deduction)
// Canonical: apps/backend/src/modules/inventory/application/inventory-lock.service.ts
// - deductForCheckout: withLock per SKU -> guarded `stockQty >= qty` Synced
//   decrement (no-negative by construction) -> audit log -> aggregate sync.
//   Contention/exhaustion surface as OUT_OF_STOCK (<150ms, BDD-1).
// - Standalone (order.service is READ_ONLY in this phase; checkout wires it
//   in the order pipeline phase). Zero new deps.
import { Injectable } from '@nestjs/common';
import { applyDelta } from '../domain/inventory-adjustment.entity';
import type { WarehouseInventoryRepository } from '../domain/warehouse-stock.repository';

export interface CheckoutLocks {
  withLock<T>(key: string, fn: () => Promise<T>): Promise<T>;
}

@Injectable()
export class InventoryLockService {
  constructor(
    private readonly repo: WarehouseInventoryRepository,
    private readonly locks: CheckoutLocks,
    private readonly tx: { run<T>(fn: (tx: unknown) => Promise<T>): Promise<T> },
    private readonly lockKeyFor: (sku: string) => string,
  ) {}

  /** Deduct qty for one SKU at one warehouse (throws OUT_OF_STOCK). */
  async deductForCheckout(args: {
    sku: string; warehouseId: string; qty: number; orderId: string; actorUserId: string;
  }): Promise<{ remaining: number }> {
    return this.locks.withLock(this.lockKeyFor(args.sku), async () =>
      this.tx.run(async (tx) => {
        const repo = this.repo.withTx ? this.repo.withTx(tx) : this.repo;
        const row = await repo.findSkuInWarehouse(args.sku, args.warehouseId);
        if (!row || row.stockQty < args.qty) throw new Error('OUT_OF_STOCK');
        const newQty = applyDelta(row.stockQty, -args.qty);
        await repo.upsertStock(args.warehouseId, row.physicalDetailId, newQty);
        await repo.appendMovementLog({
          warehouseId: args.warehouseId,
          sku: args.sku,
          previousQty: row.stockQty,
          newQty,
          quantityDelta: -args.qty,
          adjustmentType: 'SALES_DEDUCTION',
          remark: `checkout:${args.orderId}`,
          updatedBy: args.actorUserId,
        });
        await repo.syncPhysicalAggregate(row.physicalDetailId);
        return { remaining: newQty };
      }),
    );
  }
}
