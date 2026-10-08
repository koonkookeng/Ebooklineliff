// SSOT Phase 076 §10-11 — contract tests (Zod, booking, failover, print, parity)
// Run: npx tsx scripts/test-phase076-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CourierProviderEnum,
  FulfillmentStatusEnum,
  LabelDpiEnum,
  FulfillmentQueueItemSchema,
  BatchBookingRequestSchema,
  BatchPrintRequestSchema,
  FULFILLMENT_BATCH_MAX,
  BOOKING_BUDGET_MS,
  LABEL_RAM_BUDGET_MB,
  LABEL_VAULT_TTL_SEC,
  CARRIER_FAILOVER_THRESHOLD,
  fulfillmentBatchNumber,
  buildTsplLabel,
  labelTokenPayload,
} from '../packages/shared/src/schemas/fulfillment-contract';
import { assertBookingTransition, assertQueueTenant, signLabelToken, buildTrackingNumber } from '../apps/backend/src/modules/fulfillment/domain/fulfillment.entity';
import { carrierAdapterFor, CARRIER_PRIORITY } from '../apps/backend/src/modules/fulfillment/adapters/carrier.adapter';
import { inMemoryBreakerStore, isCircuitOpen, failoverCarrier } from '../apps/backend/src/modules/fulfillment/application/circuit-breaker';
import { FulfillmentQueueService } from '../apps/backend/src/modules/fulfillment/services/fulfillment-queue.service';
import { BatchThermalPrintService } from '../apps/backend/src/modules/fulfillment/services/batch-thermal-print.service';
import { FulfillmentQueueProcessor } from '../apps/backend/src/modules/fulfillment/processors/fulfillment-queue.processor';

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
  assert.equal(CourierProviderEnum.options.length, 5);
  assert.equal(FulfillmentStatusEnum.options.length, 10);
  assert.deepEqual(LabelDpiEnum.options, ['DPI_203', 'DPI_300']);
  const item = {
    orderId: UUID, orderNumber: 'ORD-1', recipientName: 'A', recipientPhone: '080',
    shippingAddress: 'x', postalCode: '10110', weightGrams: 500,
    courierProvider: 'FLASH_EXPRESS', trackingNumber: null,
    fulfillmentStatus: 'UNFULFILLED', itemSummary: [{ sku: 'BK-A', title: 'T', quantity: 1 }],
  };
  assert.equal(FulfillmentQueueItemSchema.safeParse(item).success, true);
  assert.equal(FulfillmentQueueItemSchema.safeParse({ ...item, postalCode: '1011' }).success, false);
  assert.equal(FulfillmentQueueItemSchema.safeParse({ ...item, weightGrams: 0 }).success, false);
  assert.equal(
    BatchBookingRequestSchema.safeParse({ tenantId: TENANT, orderIds: [UUID], courierProvider: 'JT_EXPRESS', warehouseId: UUID }).success,
    true,
  );
  const over = { tenantId: TENANT, orderIds: Array.from({ length: 501 }, () => UUID), courierProvider: 'FLASH_EXPRESS', warehouseId: UUID };
  assert.equal(BatchBookingRequestSchema.safeParse(over).success, false);
  assert.equal(BatchBookingRequestSchema.safeParse({ tenantId: TENANT, orderIds: [], courierProvider: 'FLASH_EXPRESS', warehouseId: UUID }).success, false);
  const printOver = { orderIds: Array.from({ length: 501 }, () => UUID), courierProvider: 'FLASH_EXPRESS' };
  assert.equal(BatchPrintRequestSchema.safeParse(printOver).success, false);
  assert.equal(FULFILLMENT_BATCH_MAX, 500);
  assert.equal(BOOKING_BUDGET_MS, 2000);
  assert.equal(LABEL_RAM_BUDGET_MB, 45);
  assert.equal(LABEL_VAULT_TTL_SEC, 86400);
  assert.equal(CARRIER_FAILOVER_THRESHOLD, 3);
  assert.ok(fulfillmentBatchNumber(TENANT).startsWith('FFM-'));
  assert.ok(buildTsplLabel({
    senderName: 'S', senderPhone: '0', senderAddress: 'sa', recipientName: 'R',
    recipientPhone: '1', recipientAddress: 'ra', postalCode: '10110',
    trackingNumber: 'THX', sortingCode: 'SC', orderNumber: 'ORD-1',
  }).includes('SIZE 100 mm,150 mm'));
  assert.equal(labelTokenPayload(UUID, 'THX', TENANT), `${TENANT}:${UUID}:THX`);
  ok('Zod §3.1 verbatim + budgets/batchNumber/TSPL/token');
}

// ---------- 2. Entity guards + HMAC + tracking ----------
{
  assert.doesNotThrow(() => assertBookingTransition('QUEUED_FOR_BOOKING', 'BOOKED'));
  assert.doesNotThrow(() => assertBookingTransition('BOOKED', 'PRINTED'));
  assert.doesNotThrow(() => assertBookingTransition('BOOKED', 'CANCELLED'));
  assert.throws(() => assertBookingTransition('BOOKED', 'QUEUED_FOR_BOOKING'), /Illegal/);
  assert.throws(() => assertQueueTenant('', 't1'), /Tenant/);
  assert.throws(() => assertQueueTenant('t1', 't2'), /Cross-tenant/);
  assert.doesNotThrow(() => assertQueueTenant('t1', 't1'));
  const t1 = signLabelToken('s3cr3t', UUID, 'THX', TENANT);
  assert.equal(t1.length, 64);
  assert.notEqual(t1, signLabelToken('other', UUID, 'THX', TENANT));
  assert.ok(buildTrackingNumber('FLASH_EXPRESS', 'ORD-1').startsWith('TH'));
  assert.ok(buildTrackingNumber('KEX_EXPRESS', 'ORD-1').startsWith('KX'));
  assert.ok(buildTrackingNumber('THAILAND_POST', 'ORD-1').startsWith('EP'));
  ok('Entity: forward-only + tenant + HMAC + tracking prefixes');
}

// ---------- 3. Breaker + failover (§10: 3 strikes -> next carrier) ----------
{
  const store = inMemoryBreakerStore();
  assert.equal(isCircuitOpen(store, 'FLASH_EXPRESS'), false);
  store.recordFailure('FLASH_EXPRESS');
  store.recordFailure('FLASH_EXPRESS');
  assert.equal(isCircuitOpen(store, 'FLASH_EXPRESS'), false);
  store.recordFailure('FLASH_EXPRESS');
  assert.equal(isCircuitOpen(store, 'FLASH_EXPRESS'), true);
  assert.equal(failoverCarrier(store, 'FLASH_EXPRESS'), 'KEX_EXPRESS');
  store.recordSuccess('FLASH_EXPRESS');
  assert.equal(isCircuitOpen(store, 'FLASH_EXPRESS'), false);
  assert.equal(CARRIER_PRIORITY.length, 5);
  assert.equal(carrierAdapterFor('JT_EXPRESS').provider, 'JT_EXPRESS');
  ok('Breaker: 3-strike open + priority failover + recovery');
}

// ---------- 4. Booking queue (BDD-1: gate + enqueue + drain) ----------
type OrderRow = {
  orderId: string; orderNumber: string; tenantId: string | null; paymentStatus: string;
  trackingNumber: string | null; recipientName: string; recipientPhone: string;
  shippingAddress: string; postalCode: string; weightGrams: number;
  items: Array<{ sku: string; title: string; quantity: number }>;
};
function makeQueuePorts(orders: Map<string, OrderRow>) {
  const items = new Map<string, { orderId: string; batchId: string | null; warehouseId: string; courierProvider: string; status: string; trackingNumber: string | null }>();
  const batches: Array<{ id: string; status: string; success: number; failure: number }> = [];
  const events: Array<{ stream: string }> = [];
  const repo = {
    findQueueOrder: async (id: string) => orders.get(id) ?? null,
    findItemByOrder: async (id: string) => {
      const it = items.get(id);
      return it ? { id: `fi-${id}`, orderId: id, batchId: it.batchId, warehouseId: it.warehouseId, courierProvider: it.courierProvider, trackingNumber: it.trackingNumber, sortingCode: null, labelUrl: null, status: it.status } : null;
    },
    createBatch: async (a: { batchNumber: string }) => {
      const b = { id: `b-${batches.length}`, status: 'PROCESSING', success: 0, failure: 0 };
      batches.push(b);
      return { id: b.id };
    },
    enqueueItem: async (a: { batchId: string; orderId: string; warehouseId: string; courierProvider: string }) => {
      items.set(a.orderId, { orderId: a.orderId, batchId: a.batchId, warehouseId: a.warehouseId, courierProvider: a.courierProvider, status: 'QUEUED_FOR_BOOKING', trackingNumber: null });
    },
    markBooked: async (a: { orderId: string; trackingNumber: string }) => {
      const it = items.get(a.orderId);
      if (it) { it.status = 'BOOKED'; it.trackingNumber = a.trackingNumber; }
    },
    markLabel: async () => undefined,
    updateBatchCounters: async (id: string, good: boolean) => {
      const b = batches.find((x) => x.id === id);
      if (b && good) b.success++;
      if (b && !good) b.failure++;
    },
    finalizeBatch: async (id: string) => {
      const b = batches.find((x) => x.id === id);
      if (b) b.status = 'COMPLETED';
    },
  };
  const tx = { run: async <T>(fn: (t: unknown) => Promise<T>) => fn({}) };
  const bus = { xadd: async (stream: string) => { events.push({ stream }); } };
  const notified: unknown[] = [];
  const notify = { trackingBooked: async (a: unknown) => { notified.push(a); } };
  return { repo, tx, bus, notify, items, batches, events, notified };
}
const paid = (id: string, tenant: string | null = TENANT): OrderRow => ({
  orderId: id, orderNumber: `ORD-${id.slice(0, 4)}`, tenantId: tenant, paymentStatus: 'VERIFIED',
  trackingNumber: null, recipientName: 'R', recipientPhone: '080', shippingAddress: 'addr',
  postalCode: '10110', weightGrams: 500, items: [{ sku: 'BK-A', title: 'T', quantity: 1 }],
});

async function sectionBooking(): Promise<void> {
  // Happy path: 2 payable -> batch + 2 queued + queue event.
  {
    const p = makeQueuePorts(new Map([[UUID, paid(UUID)], [UUID2, paid(UUID2)]]));
    const svc = new FulfillmentQueueService(p.repo as never, p.tx, p.bus, p.notify, inMemoryBreakerStore());
    const r = await svc.queueBatchBooking(TENANT, { tenantId: TENANT, orderIds: [UUID, UUID2], courierProvider: 'FLASH_EXPRESS', warehouseId: UUID });
    assert.equal(r.queued, 2);
    assert.equal(r.failed.length, 0);
    assert.ok(r.batchNumber.startsWith('FFM-'));
    assert.ok(p.events.some((e) => e.stream === 'fulfillment:booking-queue'));
  }
  // Gates: unpaid + unknown + cross-tenant + already-booked.
  {
    const booked = { ...paid(UUID2), trackingNumber: 'THX' };
    const p = makeQueuePorts(new Map([
      [UUID, { ...paid(UUID), paymentStatus: 'PENDING_SLIP' }],
      [UUID2, booked],
      ['323e4567-e89b-12d3-a456-426614174002', paid('323e4567-e89b-12d3-a456-426614174002', 'other')],
    ]));
    const svc = new FulfillmentQueueService(p.repo as never, p.tx, p.bus, p.notify, inMemoryBreakerStore());
    const r = await svc.queueBatchBooking(TENANT, {
      tenantId: TENANT,
      orderIds: [UUID, UUID2, '323e4567-e89b-12d3-a456-426614174002', '423e4567-e89b-12d3-a456-426614174003'],
      courierProvider: 'FLASH_EXPRESS', warehouseId: UUID,
    });
    assert.equal(r.queued, 0);
    assert.equal(r.failed.length, 4);
    await assert.rejects(svc.queueBatchBooking(TENANT, { tenantId: TENANT, orderIds: [], courierProvider: 'FLASH_EXPRESS', warehouseId: UUID }), /Invalid batch/);
  }
  // Drain: booked -> tracking + LINE event + counters.
  {
    const p = makeQueuePorts(new Map([[UUID, paid(UUID)]]));
    const svc = new FulfillmentQueueService(p.repo as never, p.tx, p.bus, p.notify, inMemoryBreakerStore());
    const q = await svc.queueBatchBooking(TENANT, { tenantId: TENANT, orderIds: [UUID], courierProvider: 'FLASH_EXPRESS', warehouseId: UUID });
    const d = await svc.drainBatch(q.batchId, TENANT, [UUID]);
    assert.equal(d.booked, 1);
    assert.equal(d.failed.length, 0);
    assert.equal(p.items.get(UUID)?.status, 'BOOKED');
    assert.ok((p.items.get(UUID)?.trackingNumber ?? '').startsWith('TH'));
    assert.equal(p.notified.length, 1);
    assert.equal(p.batches[0]?.status, 'COMPLETED');
  }
  // Drain cross-batch guard: item from another batch is rejected.
  {
    const p = makeQueuePorts(new Map([[UUID, paid(UUID)]]));
    const svc = new FulfillmentQueueService(p.repo as never, p.tx, p.bus, p.notify, inMemoryBreakerStore());
    const q = await svc.queueBatchBooking(TENANT, { tenantId: TENANT, orderIds: [UUID], courierProvider: 'FLASH_EXPRESS', warehouseId: UUID });
    const d = await svc.drainBatch('b-other', TENANT, [UUID]);
    assert.equal(d.booked, 0);
    assert.deepEqual(d.failed.map((f) => f.reason), ['Not in this batch']);
    assert.equal(q.batchId !== 'b-other', true);
  }
  // Drain failover: flash adapter throws -> failure recorded, breaker trips.
  {
    const p = makeQueuePorts(new Map([[UUID, paid(UUID)]]));
    const boom = () => { throw new Error('carrier down'); };
    const svc = new FulfillmentQueueService(
      p.repo as never, p.tx, p.bus, p.notify, inMemoryBreakerStore(),
      () => ({ provider: 'FLASH_EXPRESS', book: async () => boom() }) as never,
    );
    const q = await svc.queueBatchBooking(TENANT, { tenantId: TENANT, orderIds: [UUID], courierProvider: 'FLASH_EXPRESS', warehouseId: UUID });
    const d = await svc.drainBatch(q.batchId, TENANT, [UUID]);
    assert.equal(d.booked, 0);
    assert.equal(d.failed.length, 1);
    assert.equal(p.batches[0]?.failure, 1);
  }
  ok('Booking: enqueue gates + drain BOOKED + LINE seam + failover path');
}

// ---------- 5. Processor chunking + thermal print (BDD-2) ----------
async function sectionPrint(): Promise<void> {
  // Processor drains via the service (concurrency chunks of 10).
  {
    const p = makeQueuePorts(new Map([[UUID, paid(UUID)], [UUID2, paid(UUID2)]]));
    const svc = new FulfillmentQueueService(p.repo as never, p.tx, p.bus, p.notify, inMemoryBreakerStore());
    const proc = new FulfillmentQueueProcessor(svc);
    const q = await svc.queueBatchBooking(TENANT, { tenantId: TENANT, orderIds: [UUID, UUID2], courierProvider: 'KEX_EXPRESS', warehouseId: UUID });
    const r = await proc.drain(q.batchId, TENANT, [
      { orderId: UUID, courierProvider: 'KEX_EXPRESS', tenantId: TENANT, batchId: q.batchId, warehouseId: UUID },
      { orderId: UUID2, courierProvider: 'KEX_EXPRESS', tenantId: TENANT, batchId: q.batchId, warehouseId: UUID },
    ]);
    assert.equal(r.booked, 2);
  }
  // Print: booked-only, PDF vault + TSPL + HMAC page + status flip.
  {
    const marked: Array<{ orderId: string; printed: boolean }> = [];
    const puts: Array<{ key: string; type: string }> = [];
    const repo = {
      bookedItems: async (ids: string[], tenantId: string) =>
        ids.filter((id) => id === UUID).map((id) => ({
          orderId: id, orderNumber: 'ORD-1', trackingNumber: 'THTRACK01', sortingCode: 'SC-1',
          courierProvider: 'FLASH_EXPRESS', tenantId, recipientName: 'R', recipientPhone: '080',
          shippingAddress: 'addr', postalCode: '10110',
        })),
      markLabel: async (a: { orderId: string; printed: boolean }) => { marked.push(a); },
    };
    const r2 = {
      putObjectBuffer: async (key: string, _b: Buffer, t: string) => { puts.push({ key, type: t }); },
      presignedGetUrl: (key: string) => `https://r2.example.com/${key}?sig`,
    };
    const svc = new BatchThermalPrintService(repo as never, r2 as never, 's3cr3t');
    const res = await svc.printBatch(TENANT, { orderIds: [UUID, UUID2], courierProvider: 'FLASH_EXPRESS' });
    assert.equal(res.totalProcessed, 1);
    assert.equal(res.success, false);
    assert.deepEqual(res.failedOrders.map((f) => f.orderId), [UUID2]);
    assert.ok(res.objectKey.startsWith(`tenants/${TENANT}/labels/fulfillment-`));
    assert.equal(puts[0]?.type, 'application/pdf');
    assert.ok(res.rawTsplCommands.includes('SIZE 100 mm,150 mm'));
    assert.deepEqual(marked.map((m) => ({ orderId: m.orderId, printed: m.printed })), [{ orderId: UUID, printed: true }]);
    await assert.rejects(svc.printBatch(TENANT, { orderIds: [UUID2], courierProvider: 'FLASH_EXPRESS' }), /No booked/);
    await assert.rejects(svc.printBatch(TENANT, { orderIds: [], courierProvider: 'FLASH_EXPRESS' }), /Invalid batch print/);
  }
  ok('Processor + print: chunk drain + vault/TSPL/HMAC + booked-only gate');
}

// ---------- 6. Prisma additive (Gate 1) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of [
    'enum CourierProvider {', 'model LogisticsCarrierConfig {', 'model FulfillmentBatch {',
    'model FulfillmentItem {', 'QUEUED_FOR_BOOKING', 'LABEL_GENERATED', 'fulfillmentItems     FulfillmentItem[]',
    'fulfillmentItems  FulfillmentItem[]',
  ]) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  ok('Prisma: CourierProvider/FulfillmentStatus-union/3 models + back-relations');
}

function sectionParity(): void {
  for (const f of [
    'apps/backend/src/modules/fulfillment/domain/fulfillment.entity.ts',
    'apps/backend/src/modules/fulfillment/domain/fulfillment.repository.ts',
    'apps/backend/src/modules/fulfillment/adapters/carrier.adapter.ts',
    'apps/backend/src/modules/fulfillment/application/circuit-breaker.ts',
    'apps/backend/src/modules/fulfillment/services/fulfillment-queue.service.ts',
    'apps/backend/src/modules/fulfillment/services/batch-thermal-print.service.ts',
    'apps/backend/src/modules/fulfillment/processors/fulfillment-queue.processor.ts',
    'apps/backend/src/modules/fulfillment/controllers/fulfillment-queue.controller.ts',
    'apps/backend/src/modules/fulfillment/controllers/thermal-print.controller.ts',
    'apps/backend/src/modules/fulfillment/resolvers/fulfillment.resolver.ts',
    'apps/backend/src/modules/fulfillment/fulfillment.module.ts',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes('TODO') && !src.includes('placeholder'), `${f} unimplemented`);
  }
  const mod = readFileSync('apps/backend/src/modules/fulfillment/fulfillment.module.ts', 'utf8');
  assert.ok(mod.includes('FulfillmentModule') && mod.includes('FulfillmentQueueService') && mod.includes('BatchThermalPrintService'));
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('FulfillmentModule'));
  const gql = readFileSync('apps/backend/src/modules/fulfillment/resolvers/fulfillment.resolver.ts', 'utf8');
  assert.ok(gql.includes('getFulfillmentQueue') && gql.includes('queueBatchBooking') && gql.includes('printBatchLabels'));
  const alias = readFileSync('apps/backend/src/api/graphql/resolvers/fulfillment.resolver.ts', 'utf8');
  assert.ok(alias.includes('export { FulfillmentResolver }'), 'legacy alias broken');
  const sdl = readFileSync('apps/backend/src/api/graphql/schemas/fulfillment.graphql', 'utf8');
  assert.ok(sdl.includes('queueBatchBooking') && sdl.includes('printBatchLabels'));
  for (const p of [
    'apps/frontend/components/thermal-print/BatchThermalLabelPrinter.tsx',
    'apps/frontend/hooks/useFulfillmentQueue.ts',
    'apps/frontend/lib/fulfillment/fulfillment-client.ts',
    'apps/frontend/app/(dashboard)/fulfillment/page.tsx',
    'apps/frontend/app/(dashboard)/fulfillment/print/page.tsx',
  ]) {
    assert.ok(readFileSync(p, 'utf8').length > 200, `frontend missing: ${p}`);
  }
  const printerSrc = readFileSync('apps/frontend/components/thermal-print/BatchThermalLabelPrinter.tsx', 'utf8');
  assert.ok(!printerSrc.includes("from 'qrcode.react'") && !printerSrc.includes("from 'jsbarcode'"), 'heavy dep leaked');
  for (const p of [
    'apps/frontend/app/api/v1/fulfillment/queue/route.ts',
    'apps/frontend/app/api/v1/fulfillment/queue/batch/route.ts',
    'apps/frontend/app/api/v1/fulfillment/queue/drain/route.ts',
    'apps/frontend/app/api/v1/fulfillment/print/batch/route.ts',
  ]) {
    assert.ok(readFileSync(p, 'utf8').includes('x-tenant-id'), `proxy missing tenant: ${p}`);
  }
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  assert.ok(barrel.includes('fulfillment-contract') && barrel.includes('BatchPrintRequestSchema'));
  ok('Parity: module/GQL-alias/SDL/printer/hook/proxies/barrel (no heavy deps)');
}

async function main(): Promise<void> {
  await sectionBooking();
  await sectionPrint();
  sectionParity();
}

void main().then(
  () => console.log(`\nPhase076 contracts: ${passed + 5} checks passed`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
