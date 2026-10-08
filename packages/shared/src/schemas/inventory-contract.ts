// SSOT Phase 075 §3.1 — Inventory Zod SSOT contract
// Canonical: packages/shared/src/schemas/inventory-contract.ts
// (legacy src/shared/schemas/inventory-contract.ts)
// - Spec-verbatim: StockAdjustmentTypeEnum / SingleStockUpdateSchema /
//   BatchStockUpdatePayloadSchema / ThermalLabelPrintRequestSchema (§3.1).
// - RISK_CALL (additive-only, documented): BatchStockUpdatePayloadSchema.
//   tenantId is z.string().min(1) (slug hint from x-tenant-identifier),
//   matching the Phase 071/073 runtime vocabulary — uuid strictness would
//   400 every dashboard call. updatedByUserId/warehouseId stay uuid.
// - Pure helpers: SKU lock keys, ROP calculator (§7.1), CSV row gate,
//   label bytes budget. Zero new deps (zod only).
import { z } from 'zod';

export const StockAdjustmentTypeEnum = z.enum([
  'PURCHASE_RECEIPT',
  'SALES_DEDUCTION',
  'CUSTOMER_RETURN',
  'DAMAGE_WRITE_OFF',
  'MANUAL_AUDIT_ADJUST',
]);
export type StockAdjustmentType = z.infer<typeof StockAdjustmentTypeEnum>;

export const SingleStockUpdateSchema = z.object({
  sku: z.string().min(1, 'SKU Code is required'),
  warehouseId: z.string().uuid('Invalid Warehouse ID'),
  quantityDelta: z.number().int('Quantity must be an integer'),
  adjustmentType: StockAdjustmentTypeEnum,
  remark: z.string().max(255).optional(),
});
export type SingleStockUpdate = z.infer<typeof SingleStockUpdateSchema>;

export const BatchStockUpdatePayloadSchema = z.object({
  tenantId: z.string().min(1),
  updatedByUserId: z.string().uuid(),
  adjustments: z.array(SingleStockUpdateSchema).min(1).max(1000, 'Max 1000 items per batch'),
});
export type BatchStockUpdatePayload = z.infer<typeof BatchStockUpdatePayloadSchema>;

export const ThermalLabelPrintRequestSchema = z.object({
  orderIds: z.array(z.string().uuid()).min(1).max(100),
  labelFormat: z.enum(['PDF_A6', 'ZPL_4X6', 'TSPL_100X150']),
  includePackingList: z.boolean().default(true),
});
export type ThermalLabelPrintRequest = z.infer<typeof ThermalLabelPrintRequestSchema>;

/** CSV row gate (sku,warehouseId,delta,type) — row-index errors for §2.2. */
export const CsvStockRowSchema = z.object({
  sku: z.string().min(1),
  warehouseId: z.string().uuid('Invalid Warehouse ID'),
  quantityDelta: z.number().int(),
  adjustmentType: StockAdjustmentTypeEnum,
  remark: z.string().max(255).optional(),
});
export type CsvStockRow = z.infer<typeof CsvStockRowSchema>;

/** BDD-1: Redlock key per SKU (exclusive checkout deduction). */
export function skuLockKey(sku: string): string {
  return `inventory:lock:${sku}`;
}
/** Batch per-line lock (warehouse-scoped, §5.2). */
export function batchLineLockKey(warehouseId: string, sku: string): string {
  return `lock:inventory:${warehouseId}:${sku}`;
}
/** Lock TTL: 3s (§5.2). */
export const INVENTORY_LOCK_TTL_SEC = 3;
/** Batch SLA: 500 lines < 800ms (BDD-2). */
export const BATCH_UPDATE_BUDGET_MS = 800;
/** Batch cap: 1000 lines (BDD-2). */
export const BATCH_MAX_LINES = 1000;
/** Label batch cap: 100 orders (§3.1). */
export const LABEL_MAX_ORDERS = 100;
/** Analytics stream for velocity + batch events (§7.1). */
export const INVENTORY_EVENT_STREAM = 'inventory:events';

/**
 * Reorder point (§7.1): ROP = avgDailySales * leadTimeDays + safetyStock.
 * Pure helper — the AI velocity worker consumes it (Zero Redundant).
 */
export function reorderPoint(avgDailySales: number, leadTimeDays: number, safetyStock: number): number {
  return Math.max(0, Math.ceil(avgDailySales * leadTimeDays + safetyStock));
}

/** Stock status badge vocabulary (§2.2 IDLE). */
export function stockStatusOf(stockQty: number, safetyStock: number): 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK' {
  if (stockQty <= 0) return 'OUT_OF_STOCK';
  if (stockQty <= safetyStock) return 'LOW_STOCK';
  return 'IN_STOCK';
}
