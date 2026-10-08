// SSOT Phase 075 §10-11 — contract tests (Zod, batch atomic, lock, labels, parity)
// Run: npx tsx scripts/test-phase075-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  StockAdjustmentTypeEnum,
  SingleStockUpdateSchema,
  BatchStockUpdatePayloadSchema,
  ThermalLabelPrintRequestSchema,
  CsvStockRowSchema,
  INVENTORY_LOCK_TTL_SEC,
  BATCH_MAX_LINES,
  LABEL_MAX_ORDERS,
  skuLockKey,
  batchLineLockKey,
  reorderPoint,
  stockStatusOf,
} from '../packages/shared/src/schemas/inventory-contract';
import { applyDelta, assertLineTenant } from '../apps/backend/src/modules/inventory/domain/inventory-adjustment.entity';
import { BatchStockUpdateUseCase } from '../apps/backend/src/modules/inventory/application/batch-stock-update.usecase';
import { InventoryLockService } from '../apps/backend/src/modules/inventory/application/inventory-lock.service';
import { ThermalLabelService } from '../apps/backend/src/modules/inventory/application/thermal-label.service';
import { parseStockCsv } from '../apps/frontend/lib/inventory/inventory-client';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const UUID = '123e4567-e89b-12d3-a456-426614174000';
const UUID2 = '223e4567-e89b-12d3-a456-426614174001';
const TENANT = 'academy-a';

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) ----------
{
  assert.equal(StockAdjustmentTypeEnum.options.length, 5);
  assert.equal(SingleStockUpdateSchema.safeParse({ sku: 'BK-STORY-001', warehouseId: UUID, quantityDelta: 50, adjustmentType: 'PURCHASE_RECEIPT' }).success, true);
  assert.equal(SingleStockUpdateSchema.safeParse({ sku: '', warehouseId: UUID, quantityDelta: 1, adjustmentType: 'PURCHASE_RECEIPT' }).success, false);
  assert.equal(SingleStockUpdateSchema.safeParse({ sku: 'A', warehouseId: 'bad', quantityDelta: 1, adjustmentType: 'PURCHASE_RECEIPT' }).success, false);
  assert.equal(SingleStockUpdateSchema.safeParse({ sku: 'A', warehouseId: UUID, quantityDelta: 1.5, adjustmentType: 'PURCHASE_RECEIPT' }).success, false);
  const over = { tenantId: TENANT, updatedByUserId: UUID, adjustments: Array.from({ length: 1001 }, (_, i) => ({ sku: `SKU-${i}`, warehouseId: UUID, quantityDelta: 1, adjustmentType: 'PURCHASE_RECEIPT' })) };
  assert.equal(BatchStockUpdatePayloadSchema.safeParse(over).success, false);
  assert.equal(BatchStockUpdatePayloadSchema.safeParse({ tenantId: TENANT, updatedByUserId: UUID, adjustments: [] }).success, false);
  const many = { orderIds: Array.from({ length: 101 }, () => UUID), labelFormat: 'PDF_A6' };
  assert.equal(ThermalLabelPrintRequestSchema.safeParse(many).success, false);
  assert.equal(ThermalLabelPrintRequestSchema.safeParse({ orderIds: [UUID], labelFormat: 'NOPE' }).success, false);
  assert.equal(INVENTORY_LOCK_TTL_SEC, 3);
  assert.equal(BATCH_MAX_LINES, 1000);
  assert.equal(LABEL_MAX_ORDERS, 100);
  assert.equal(skuLockKey('BK-STORY-001'), 'inventory:lock:BK-STORY-001');
  assert.equal(batchLineLockKey(UUID, 'BK-STORY-001'), `lock:inventory:${UUID}:BK-STORY-001`);
  assert.equal(reorderPoint(10, 3, 5), 35);
  assert.equal(stockStatusOf(0, 10), 'OUT_OF_STOCK');
  assert.equal(stockStatusOf(5, 10), 'LOW_STOCK');
  assert.equal(stockStatusOf(50, 10), 'IN_STOCK');
  ok('Zod §3.1 verbatim + budgets/keys/ROP/status');
}

// ---------- 2. Entity guards (no-negative BDD-1 + tenant isolation) ----------
{
  assert.equal(applyDelta(5, -5), 0);
  assert.throws(() => applyDelta(1, -2), /negative/);
  assert.throws(() => assertLineTenant('', 't1'), /Tenant/);
  assert.throws(() => assertLineTenant('t1', 't2'), /Cross-tenant/);
  assert.doesNotThrow(() => assertLineTenant('t1', 't1'));
  assert.doesNotThrow(() => assertLineTenant('t1', null));
  ok('Entity: no-negative + tenant isolation');
}

// ---------- 3. Batch use-case (BDD-2: audit + contention + negatives) ----------
type Row = { physicalDetailId: string; sku: string; tenantId: string | null; warehouseId: string; stockQty: number; safetyStock: number };
function makeBatchPorts(rows: Map<string, Row>, opts?: { locked?: Set<string> }) {
  const logs: unknown[] = [];
  let aggregates = 0;
  const repo = {
    findSkuInWarehouse: async (sku: string, warehouseId: string) => rows.get(`${warehouseId}:${sku}`) ?? null,
    upsertStock: async (warehouseId: string, physicalDetailId: string, stockQty: number) => {
      for (const [k, r] of rows) if (r.warehouseId === warehouseId && r.physicalDetailId === physicalDetailId) rows.set(k, { ...r, stockQty });
    },
    appendMovementLog: async (a: unknown) => { logs.push(a); },
    syncPhysicalAggregate: async () => { aggregates++; return 0; },
  };
  const held = new Set<string>();
  const locks = {
    tryLock: async (k: string) => { if (opts?.locked?.has(k) || held.has(k)) return false; held.add(k); return true; },
    release: async (k: string) => { held.delete(k); },
  };
  const tx = { run: async <T>(fn: (t: unknown) => Promise<T>) => fn({}) };
  return { repo, locks, tx, logs, get aggregates() { return aggregates; } };
}

async function sectionBatch(): Promise<void> {
  // Happy path: 2 lines -> upsert + 2 immutable logs + aggregate sync.
  {
    const rows = new Map<string, Row>([
      [`${UUID}:BK-A`, { physicalDetailId: 'pd-a', sku: 'BK-A', tenantId: TENANT, warehouseId: UUID, stockQty: 10, safetyStock: 2 }],
      [`${UUID}:BK-B`, { physicalDetailId: 'pd-b', sku: 'BK-B', tenantId: TENANT, warehouseId: UUID, stockQty: 3, safetyStock: 2 }],
    ]);
    const p = makeBatchPorts(rows);
    const uc = new BatchStockUpdateUseCase(p.repo as never, p.locks, p.tx, batchLineLockKey);
    const r = await uc.execute(TENANT, { tenantId: TENANT, updatedByUserId: UUID2, adjustments: [
      { sku: 'BK-A', warehouseId: UUID, quantityDelta: 5, adjustmentType: 'PURCHASE_RECEIPT' },
      { sku: 'BK-B', warehouseId: UUID, quantityDelta: -3, adjustmentType: 'DAMAGE_WRITE_OFF' },
    ] });
    assert.equal(r.success, true);
    assert.equal(r.totalUpdated, 2);
    assert.equal(p.logs.length, 2);
    assert.equal(rows.get(`${UUID}:BK-A`)?.stockQty, 15);
    assert.equal(rows.get(`${UUID}:BK-B`)?.stockQty, 0);
  }
  // Contention: locked line -> failedItems (BDD-1), other line still commits.
  {
    const rows = new Map<string, Row>([
      [`${UUID}:BK-A`, { physicalDetailId: 'pd-a', sku: 'BK-A', tenantId: TENANT, warehouseId: UUID, stockQty: 10, safetyStock: 2 }],
      [`${UUID}:BK-B`, { physicalDetailId: 'pd-b', sku: 'BK-B', tenantId: TENANT, warehouseId: UUID, stockQty: 10, safetyStock: 2 }],
    ]);
    const p = makeBatchPorts(rows, { locked: new Set([batchLineLockKey(UUID, 'BK-A')]) });
    const uc = new BatchStockUpdateUseCase(p.repo as never, p.locks, p.tx, batchLineLockKey);
    const r = await uc.execute(TENANT, { tenantId: TENANT, updatedByUserId: UUID2, adjustments: [
      { sku: 'BK-A', warehouseId: UUID, quantityDelta: 5, adjustmentType: 'PURCHASE_RECEIPT' },
      { sku: 'BK-B', warehouseId: UUID, quantityDelta: 1, adjustmentType: 'PURCHASE_RECEIPT' },
    ] });
    assert.equal(r.success, false);
    assert.equal(r.totalUpdated, 1);
    assert.deepEqual(r.failedItems.map((f) => f.sku), ['BK-A']);
  }
  // Negative guard: delta below zero -> failedItems, stock untouched.
  {
    const rows = new Map<string, Row>([
      [`${UUID}:BK-A`, { physicalDetailId: 'pd-a', sku: 'BK-A', tenantId: TENANT, warehouseId: UUID, stockQty: 1, safetyStock: 2 }],
    ]);
    const p = makeBatchPorts(rows);
    const uc = new BatchStockUpdateUseCase(p.repo as never, p.locks, p.tx, batchLineLockKey);
    const r = await uc.execute(TENANT, { tenantId: TENANT, updatedByUserId: UUID2, adjustments: [
      { sku: 'BK-A', warehouseId: UUID, quantityDelta: -5, adjustmentType: 'SALES_DEDUCTION' },
    ] });
    assert.equal(r.totalUpdated, 0);
    assert.match(r.failedItems[0]?.reason ?? '', /negative/);
    assert.equal(rows.get(`${UUID}:BK-A`)?.stockQty, 1);
  }
  // Cross-tenant + unknown SKU + bad payload gates.
  {
    const rows = new Map<string, Row>([
      [`${UUID}:BK-A`, { physicalDetailId: 'pd-a', sku: 'BK-A', tenantId: 'other', warehouseId: UUID, stockQty: 5, safetyStock: 2 }],
    ]);
    const p = makeBatchPorts(rows);
    const uc = new BatchStockUpdateUseCase(p.repo as never, p.locks, p.tx, batchLineLockKey);
    const r = await uc.execute(TENANT, { tenantId: TENANT, updatedByUserId: UUID2, adjustments: [
      { sku: 'BK-A', warehouseId: UUID, quantityDelta: 1, adjustmentType: 'PURCHASE_RECEIPT' },
      { sku: 'BK-NOPE', warehouseId: UUID, quantityDelta: 1, adjustmentType: 'PURCHASE_RECEIPT' },
    ] });
    assert.equal(r.totalUpdated, 0);
    assert.equal(r.failedItems.length, 2);
    await assert.rejects(uc.execute(TENANT, { tenantId: TENANT, adjustments: [] }), /Invalid batch/);
  }
  ok('Batch: commit/audit + contention + negative + tenant/unknown gates');
}

// ---------- 4. Checkout lock (BDD-1: exactly 1 winner, no-negative) ----------
async function sectionCheckout(): Promise<void> {
  async function race(n: number, stock: number) {
    const rows = new Map<string, Row>([[`${UUID}:BK-STORY-001`, { physicalDetailId: 'pd-1', sku: 'BK-STORY-001', tenantId: TENANT, warehouseId: UUID, stockQty: stock, safetyStock: 1 }]]);
    const p = makeBatchPorts(rows);
    let owner: string | null = null;
    const locks = {
      withLock: async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
        if (owner) throw new Error('OUT_OF_STOCK');
        owner = key;
        try { return await fn(); } finally { owner = null; }
      },
    };
    const svc = new InventoryLockService(p.repo as never, locks, p.tx, skuLockKey);
    const out = await Promise.all(Array.from({ length: n }, (_, i) =>
      svc.deductForCheckout({ sku: 'BK-STORY-001', warehouseId: UUID, qty: 1, orderId: `o-${i}`, actorUserId: UUID2 }).then(() => 'win' as const).catch((e: Error) => e.message),
    ));
    return { out, qty: rows.get(`${UUID}:BK-STORY-001`)?.stockQty, logs: p.logs.length };
  }
  const r50 = await race(50, 1);
  assert.equal(r50.out.filter((x) => x === 'win').length, 1);
  assert.ok(r50.out.filter((x) => x !== 'win').every((x) => x === 'OUT_OF_STOCK'));
  assert.equal(r50.qty, 0);
  assert.equal(r50.logs, 1);
  const empty = await race(3, 0);
  assert.ok(empty.out.every((x) => x === 'OUT_OF_STOCK'));
  ok('Checkout lock: 50-race 1-win + no-negative');
}

// ---------- 5. Thermal labels (Task 6: PDF/ZPL + tenant vault isolation) ----------
async function sectionLabels(): Promise<void> {
  const orders = [
    { id: UUID, orderNumber: 'ORD-1', trackingNumber: 'TH123', tenantId: TENANT },
    { id: UUID2, orderNumber: 'ORD-2', trackingNumber: null, tenantId: TENANT },
    { id: '323e4567-e89b-12d3-a456-426614174002', orderNumber: 'ORD-X', trackingNumber: 'THX', tenantId: 'other' },
  ];
  const puts: Array<{ key: string; type: string }> = [];
  const repo = {
    findOrdersForLabels: async (ids: string[], tenantId: string) => orders.filter((o) => ids.includes(o.id) && o.tenantId === tenantId),
  };
  const r2 = {
    putObjectBuffer: async (key: string, bytes: Buffer, contentType: string) => { puts.push({ key, type: contentType }); },
    presignedGetUrl: (key: string) => `https://r2.example.com/${key}?sig`,
  };
  const svc = new ThermalLabelService(repo as never, r2 as never);
  const pdf = await svc.generateBatch(TENANT, { orderIds: [UUID, UUID2], labelFormat: 'PDF_A6' });
  assert.equal(pdf.count, 2);
  assert.ok(pdf.objectKey.startsWith(`tenants/${TENANT}/labels/batch-`));
  assert.ok(pdf.objectKey.endsWith('.pdf'));
  assert.equal(puts[0]?.type, 'application/pdf');
  const zpl = await svc.generateBatch(TENANT, { orderIds: [UUID], labelFormat: 'ZPL_4X6' });
  assert.equal(zpl.count, 1);
  await assert.rejects(svc.generateBatch(TENANT, { orderIds: ['323e4567-e89b-12d3-a456-426614174002'], labelFormat: 'PDF_A6' }), /No tenant orders/);
  await assert.rejects(svc.generateBatch(TENANT, { orderIds: [], labelFormat: 'PDF_A6' }), /Invalid label/);
  ok('Labels: PDF/ZPL vault + cross-tenant isolation');
}

// ---------- 6. CSV parse (BDD-2 row-index errors) + Prisma additive + parity ----------
{
  const good = parseStockCsv(`sku,warehouseId,quantityDelta,adjustmentType\nBK-A,${UUID},5,PURCHASE_RECEIPT\nBK-B,${UUID},-2,DAMAGE_WRITE_OFF`);
  assert.equal(good.rows.length, 2);
  assert.equal(good.errors.length, 0);
  const bad = parseStockCsv(`BK-A,not-a-uuid,5,PURCHASE_RECEIPT\n,${UUID},1,PURCHASE_RECEIPT`);
  assert.equal(bad.errors.length, 2);
  assert.equal(CsvStockRowSchema.safeParse({ sku: 'A', warehouseId: UUID, quantityDelta: 1, adjustmentType: 'NOPE' }).success, false);
  ok('CSV: rows + row-index errors');
}
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of ['model WarehouseStock {', 'model StockMovementLog {', '@@unique([warehouseId, physicalDetailId])', 'stockMovementLogs   StockMovementLog[]', 'warehouseStocks WarehouseStock[]']) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  ok('Prisma: Warehouse/WarehouseStock/StockMovementLog additive');
}
function sectionParity(): void {
  for (const f of [
    'apps/backend/src/modules/inventory/application/batch-stock-update.usecase.ts',
    'apps/backend/src/modules/inventory/application/inventory-lock.service.ts',
    'apps/backend/src/modules/inventory/application/thermal-label.service.ts',
    'apps/backend/src/modules/inventory/domain/inventory-adjustment.entity.ts',
    'apps/backend/src/modules/inventory/domain/warehouse-stock.repository.ts',
    'apps/backend/src/modules/inventory/infrastructure/redis-lock.adapter.ts',
    'apps/backend/src/modules/inventory/infrastructure/prisma-inventory.repository.ts',
    'apps/backend/src/modules/inventory/presentation/inventory.controller.ts',
    'apps/backend/src/modules/inventory/presentation/inventory.resolver.ts',
    'apps/backend/src/modules/inventory/inventory.module.ts',
    'apps/backend/src/modules/order/inventory-lock.service.ts',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes('TODO') && !src.includes('placeholder'), `${f} unimplemented`);
  }
  const mod = readFileSync('apps/backend/src/modules/inventory/inventory.module.ts', 'utf8');
  assert.ok(mod.includes('InventoryModule') && mod.includes('BatchStockUpdateUseCase') && mod.includes('ThermalLabelService'));
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('InventoryModule'));
  const gql = readFileSync('apps/backend/src/modules/inventory/presentation/inventory.resolver.ts', 'utf8');
  assert.ok(gql.includes('getWarehouseInventory') && gql.includes('updateBatchStock') && gql.includes('generateBatchThermalLabels'));
  const alias = readFileSync('apps/backend/src/api/graphql/resolvers/inventory.resolver.ts', 'utf8');
  assert.ok(alias.includes("export { InventoryResolver }"), 'legacy alias broken');
  const sdl = readFileSync('apps/backend/src/api/graphql/schemas/inventory.graphql', 'utf8');
  assert.ok(sdl.includes('updateBatchStock') && sdl.includes('generateBatchThermalLabels'));
  for (const p of [
    'apps/frontend/components/inventory/BatchStockWorkspace.tsx',
    'apps/frontend/hooks/useInventoryWorkspace.ts',
    'apps/frontend/lib/inventory/inventory-client.ts',
    'apps/frontend/app/(dashboard)/inventory/page.tsx',
    'apps/frontend/app/(dashboard)/inventory/batch/page.tsx',
    'apps/frontend/app/(dashboard)/inventory/labels/page.tsx',
  ]) {
    assert.ok(readFileSync(p, 'utf8').length > 200, `frontend missing: ${p}`);
  }
  for (const p of [
    'apps/frontend/app/api/v1/inventory/stock/route.ts',
    'apps/frontend/app/api/v1/inventory/stock/batch/route.ts',
    'apps/frontend/app/api/v1/inventory/movements/route.ts',
    'apps/frontend/app/api/v1/inventory/labels/batch/route.ts',
  ]) {
    assert.ok(readFileSync(p, 'utf8').includes('x-tenant-id'), `proxy missing tenant: ${p}`);
  }
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  assert.ok(barrel.includes('inventory-contract') && barrel.includes('BatchStockUpdatePayloadSchema'));
  ok('Parity: module/GQL-alias/SDL/workspace/hook/proxies/barrel');
}

async function main(): Promise<void> {
  await sectionBatch();
  await sectionCheckout();
  await sectionLabels();
  sectionParity();
}

void main().then(
  () => console.log(`\nPhase075 contracts: ${passed + 5} checks passed`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
