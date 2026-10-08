// SSOT Phase 075 BDD-1 — Order-domain inventory lock facade (in-scope file)
// Canonical: apps/backend/src/modules/order/inventory-lock.service.ts
// (legacy src/backend/modules/order/inventory-lock.service.ts)
// - Thin order-domain facade over the inventory InventoryLockService:
//   checkout deducts with per-SKU Redlock + guarded decrement (no-negative).
// - Wiring into the live checkout pipeline is a later order-phase task
//   (order.service is READ_ONLY here); this phase proves the primitive.
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { InventoryLockService } from '../inventory/application/inventory-lock.service';

@Injectable()
export class OrderInventoryLockService {
  constructor(private readonly inventory: InventoryLockService) {}

  /** Reserve qty for an order line (throws OUT_OF_STOCK on contention). */
  reserveForOrder(args: { sku: string; warehouseId: string; qty: number; orderId: string; actorUserId: string }) {
    return this.inventory.deductForCheckout(args);
  }
}
