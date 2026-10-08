// SSOT Phase 075 §5.2 — Batch stock update use-case (lock -> txn -> audit)
// Canonical: apps/backend/src/modules/inventory/application/batch-stock-update.usecase.ts
// - Per line: tryLock (contention -> failedItems, BDD-1) -> guarded delta ->
//   upsert -> immutable log -> aggregate sync. Zod gate at entry (BDD-2).
// - Port-based (locks/repo/tx) for DB-free tests. Zero new deps.
import { BadRequestException, Injectable } from '@nestjs/common';
import { BatchStockUpdatePayloadSchema } from '@repo/shared';
import { applyDelta, assertLineTenant } from '../domain/inventory-adjustment.entity';
import type { WarehouseInventoryRepository } from '../domain/warehouse-stock.repository';

export interface BatchLocks {
  tryLock(key: string): Promise<boolean>;
  release(key: string): Promise<void>;
}

export interface BatchTx {
  run<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}

export interface BatchStockResult {
  success: boolean;
  totalUpdated: number;
  failedItems: Array<{ sku: string; reason: string }>;
  updatedAt: string;
}

@Injectable()
export class BatchStockUpdateUseCase {
  constructor(
    private readonly repo: WarehouseInventoryRepository,
    private readonly locks: BatchLocks,
    private readonly tx: BatchTx,
    private readonly lockKeyFor: (warehouseId: string, sku: string) => string,
  ) {}

  async execute(headerTenantId: string | undefined, body: unknown): Promise<BatchStockResult> {
    const parsed = BatchStockUpdatePayloadSchema.safeParse({
      ...((body ?? {}) as Record<string, unknown>),
      tenantId: (headerTenantId ?? '').trim(),
    });
    if (!parsed.success) throw new BadRequestException('Invalid batch stock payload');
    const { adjustments, updatedByUserId, tenantId } = parsed.data;
    const failedItems: Array<{ sku: string; reason: string }> = [];
    let totalUpdated = 0;

    for (const item of adjustments) {
      const lockKey = this.lockKeyFor(item.warehouseId, item.sku);
      if (!(await this.locks.tryLock(lockKey))) {
        failedItems.push({ sku: item.sku, reason: 'System busy, SKU lock timeout' });
        continue;
      }
      try {
        await this.tx.run(async (tx) => {
          const repo = this.repo.withTx ? this.repo.withTx(tx) : this.repo;
          const row = await repo.findSkuInWarehouse(item.sku, item.warehouseId);
          if (!row) throw new Error(`SKU ${item.sku} not found`);
          assertLineTenant(tenantId, row.tenantId);
          const newQty = applyDelta(row.stockQty, item.quantityDelta);
          await repo.upsertStock(item.warehouseId, row.physicalDetailId, newQty);
          await repo.appendMovementLog({
            warehouseId: item.warehouseId,
            sku: item.sku,
            previousQty: row.stockQty,
            newQty,
            quantityDelta: item.quantityDelta,
            adjustmentType: item.adjustmentType,
            remark: item.remark ?? 'Batch Update Execution',
            updatedBy: updatedByUserId,
          });
          await repo.syncPhysicalAggregate(row.physicalDetailId);
        });
        totalUpdated++;
      } catch (e) {
        failedItems.push({ sku: item.sku, reason: (e as Error).message });
      } finally {
        await this.locks.release(lockKey);
      }
    }

    return { success: failedItems.length === 0, totalUpdated, failedItems, updatedAt: new Date().toISOString() };
  }
}
