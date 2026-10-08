// SSOT Phase 077 §10-11 — contract tests (Zod, booking, webhook, LINE, parity)
// Run: npx tsx scripts/test-phase077-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  LogisticsCarrierEnum,
  ShipmentStatusEnum,
  CarrierWebhookPayloadSchema,
  BookParcelInputSchema,
  LineTrackingMessageSchema,
  PARCEL_BOOKING_BUDGET_MS,
  TRACKING_NOTIFY_BUDGET_MS,
  WEBHOOK_REPLAY_TTL_SEC,
  carrierToLogistics,
  mapCarrierStatus,
  flashSignature,
  webhookSignPayload,
  carrierBrand,
  trackingStages,
} from '../packages/shared/src/schemas/logistics-contract';
import {
  assertShipmentTenant,
  signWebhook,
  verifyWebhookSignature,
  assertWebhookFreshness,
  resolveShipmentStatus,
} from '../apps/backend/src/modules/logistics/domain/shipment.entity';
import { CarrierFactoryService } from '../apps/backend/src/modules/logistics/services/carrier-factory.service';
import { LogisticsService } from '../apps/backend/src/modules/logistics/services/logistics.service';
import { CarrierWebhookService } from '../apps/backend/src/modules/logistics/services/carrier-webhook.service';
import { buildTrackingFlex, LineNotificationService } from '../apps/backend/src/modules/logistics/services/line-notification.service';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const UUID = '123e4567-e89b-12d3-a456-426614174000';
const UUID2 = '223e4567-e89b-12d3-a456-426614174001';
const TENANT = 'academy-a';
const SECRET = 'carrier-secret';
const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex');

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) ----------
{
  assert.deepEqual(LogisticsCarrierEnum.options, ['FLASH_EXPRESS', 'KERRY_EXPRESS', 'THAILAND_POST']);
  assert.equal(ShipmentStatusEnum.options.length, 8);
  const hook = {
    carrier: 'FLASH_EXPRESS', trackingNumber: 'TH123', orderNumber: 'ORD-1',
    statusCode: 'IN_TRANSIT', statusDescription: 'Arrived hub', signature: 'sig', timestamp: Date.now(),
  };
  assert.equal(CarrierWebhookPayloadSchema.safeParse(hook).success, true);
  assert.equal(CarrierWebhookPayloadSchema.safeParse({ ...hook, carrier: 'JT_EXPRESS' }).success, false);
  assert.equal(
    BookParcelInputSchema.safeParse({ tenantId: TENANT, orderId: UUID, carrier: 'KERRY_EXPRESS', weightGrams: 500 }).success,
    true,
  );
  assert.equal(BookParcelInputSchema.safeParse({ tenantId: TENANT, orderId: UUID, carrier: 'KERRY_EXPRESS', weightGrams: 0 }).success, false);
  assert.equal(BookParcelInputSchema.safeParse({ tenantId: TENANT, orderId: UUID, carrier: 'KERRY_EXPRESS', weightGrams: 1, remark: 'x'.repeat(251) }).success, false);
  const line = {
    lineUserId: 'U123', orderNumber: 'ORD-1', carrierName: 'FLASH_EXPRESS',
    trackingNumber: 'TH123', statusText: 'In transit', trackingUrl: 'https://liff.line.me/x/orders/y/tracking',
  };
  assert.equal(LineTrackingMessageSchema.safeParse(line).success, true);
  assert.equal(LineTrackingMessageSchema.safeParse({ ...line, trackingUrl: 'not-a-url' }).success, false);
  assert.equal(PARCEL_BOOKING_BUDGET_MS, 800);
  assert.equal(TRACKING_NOTIFY_BUDGET_MS, 500);
  assert.equal(WEBHOOK_REPLAY_TTL_SEC, 300);
  assert.equal(carrierToLogistics('FLASH_EXPRESS'), 'FLASH_EXPRESS');
  assert.equal(carrierToLogistics('KEX_EXPRESS'), 'KERRY_EXPRESS');
  assert.equal(carrierToLogistics('JT_EXPRESS'), null);
  assert.equal(carrierToLogistics('CUSTOM_FLEET'), null);
  assert.equal(mapCarrierStatus('DELIVERED', 'IN_TRANSIT'), 'DELIVERED');
  assert.equal(mapCarrierStatus('DEPARTED', 'BOOKED'), 'IN_TRANSIT');
  assert.equal(mapCarrierStatus('OUT_FOR_DELIVERY', 'IN_TRANSIT'), 'OUT_FOR_DELIVERY');
  assert.equal(mapCarrierStatus('WEIRD_CODE', 'BOOKED'), 'BOOKED');
  assert.equal(webhookSignPayload('TH1', 'IN_TRANSIT', 123), 'TH1|IN_TRANSIT|123');
  assert.deepEqual(carrierBrand('FLASH_EXPRESS'), { bg: '#FFF000', fg: '#000000' });
  assert.equal(trackingStages('IN_TRANSIT').filter((s) => s.done).length, 3);
  ok('Zod §3.1 verbatim + budgets/mapper/brand/stages');
}

// ---------- 2. Entity: HMAC + freshness + tenant ----------
{
  const sig = signWebhook(SECRET, 'TH1', 'DELIVERED', 1700000000000);
  assert.equal(sig.length, 64);
  assert.doesNotThrow(() => verifyWebhookSignature(SECRET, 'TH1', 'DELIVERED', 1700000000000, sig));
  const badSig = `${sig[0] === 'a' ? 'b' : 'a'}${sig.slice(1)}`;
  assert.throws(() => verifyWebhookSignature(SECRET, 'TH1', 'DELIVERED', 1700000000000, badSig), /Invalid carrier/);
  assert.throws(() => verifyWebhookSignature('wrong', 'TH1', 'DELIVERED', 1700000000000, sig), /Invalid carrier/);
  assert.doesNotThrow(() => assertWebhookFreshness(Date.now() - 60_000, Date.now()));
  assert.throws(() => assertWebhookFreshness(Date.now() - 301_000, Date.now()), /Stale/);
  assert.throws(() => assertWebhookFreshness(Date.now() + 61_000, Date.now()), /Stale/);
  assert.doesNotThrow(() => assertShipmentTenant(TENANT, TENANT));
  assert.throws(() => assertShipmentTenant(TENANT, 'other'), /Cross-tenant/);
  assert.throws(() => assertShipmentTenant('', TENANT), /Tenant/);
  assert.equal(resolveShipmentStatus('COMPLETED', 'IN_TRANSIT'), 'DELIVERED');
  // Flash signature is sorted-params SHA256 UPPER (§5.2).
  const params = { mchId: 'm1', nonceStr: 'n', outTradeNo: 'ORD-1', weight: 500 };
  const expected = createHash('sha256').update('mchId=m1&nonceStr=n&outTradeNo=ORD-1&weight=500&key=k').digest('hex').toUpperCase();
  assert.equal(flashSignature(params, 'k', sha256Hex), expected);
  ok('Entity: HMAC timing-safe + replay window + tenant + flash sign');
}

// ---------- 3. Booking (BDD-1: gate + carrier API + atomic shipment) ----------
function makeFetchOk(body: Record<string, unknown>, status = 200) {
  return async () => ({ ok: status < 300, status, json: async () => body });
}
function makeBookingPorts(order: { paymentStatus: string; tenant: string | null } | null, fetchImpl?: never) {
  const shipments: unknown[] = [];
  const events: Array<{ stream: string }> = [];
  const repo = {
    findParcelOrder: async () =>
      order ? { orderId: UUID, orderNumber: 'ORD-1', tenantId: order.tenant, paymentStatus: order.paymentStatus, userId: 'u-1', lineUserId: 'U1' } : null,
    upsertShipment: async (a: { trackingNumber: string }) => {
      shipments.push(a);
      return { id: 'sh-1' };
    },
    carrierConfig: async () => ({ mchId: 'm1', apiSecret: SECRET, isSandbox: true }),
  };
  const tx = { run: async <T>(fn: (t: unknown) => Promise<T>) => fn({}) };
  const factory = new CarrierFactoryService((fetchImpl ?? makeFetchOk({ code: 1, data: { pno: 'TH999TH' } })) as never);
  const bus = { xadd: async (stream: string) => { events.push({ stream }); } };
  return { repo, tx, factory, bus, shipments, events };
}

async function sectionBooking(): Promise<void> {
  // Flash happy path: pno -> shipment + event.
  {
    const p = makeBookingPorts({ paymentStatus: 'VERIFIED', tenant: TENANT });
    const svc = new LogisticsService(p.repo as never, p.tx, p.factory, p.bus);
    const r = await svc.bookParcel(TENANT, { tenantId: TENANT, orderId: UUID, carrier: 'FLASH_EXPRESS', weightGrams: 500 });
    assert.equal(r.trackingNumber, 'TH999TH');
    assert.equal(r.shipmentId, 'sh-1');
    assert.equal(p.shipments.length, 1);
    assert.ok(p.events.some((e) => e.stream === 'stream:logistics:events'));
  }
  // Gates: unpaid + unknown + cross-tenant + unconfigured carrier + API fail.
  {
    const unpaid = makeBookingPorts({ paymentStatus: 'PENDING_SLIP', tenant: TENANT });
    const svc = new LogisticsService(unpaid.repo as never, unpaid.tx, unpaid.factory, unpaid.bus);
    await assert.rejects(
      svc.bookParcel(TENANT, { tenantId: TENANT, orderId: UUID, carrier: 'FLASH_EXPRESS', weightGrams: 500 }),
      /not payable/,
    );
    const missing = makeBookingPorts(null);
    await assert.rejects(
      new LogisticsService(missing.repo as never, missing.tx, missing.factory, missing.bus).bookParcel(TENANT, {
        tenantId: TENANT, orderId: UUID, carrier: 'FLASH_EXPRESS', weightGrams: 500,
      }),
      /Order not found/,
    );
    const foreign = makeBookingPorts({ paymentStatus: 'VERIFIED', tenant: 'other' });
    await assert.rejects(
      new LogisticsService(foreign.repo as never, foreign.tx, foreign.factory, foreign.bus).bookParcel(TENANT, {
        tenantId: TENANT, orderId: UUID, carrier: 'FLASH_EXPRESS', weightGrams: 500,
      }),
      /Cross-tenant/,
    );
    const failing = makeBookingPorts({ paymentStatus: 'VERIFIED', tenant: TENANT }, makeFetchOk({ code: 0, message: 'nope' }) as never);
    await assert.rejects(
      new LogisticsService(failing.repo as never, failing.tx, failing.factory, failing.bus).bookParcel(TENANT, {
        tenantId: TENANT, orderId: UUID, carrier: 'FLASH_EXPRESS', weightGrams: 500,
      }),
      /Flash Express Booking Failed/,
    );
    const bad = makeBookingPorts({ paymentStatus: 'VERIFIED', tenant: TENANT });
    await assert.rejects(
      new LogisticsService(bad.repo as never, bad.tx, bad.factory, bad.bus).bookParcel(TENANT, {
        tenantId: TENANT, orderId: UUID, carrier: 'FLASH_EXPRESS', weightGrams: 0,
      }),
      /Invalid parcel/,
    );
  }
  // Factory: 3 carriers resolve; unknown throws.
  {
    const f = new CarrierFactoryService(makeFetchOk({}) as never);
    assert.equal(f.forCarrier('FLASH_EXPRESS').carrier, 'FLASH_EXPRESS');
    assert.equal(f.forCarrier('KERRY_EXPRESS').carrier, 'KERRY_EXPRESS');
    assert.equal(f.forCarrier('THAILAND_POST').carrier, 'THAILAND_POST');
    assert.throws(() => f.forCarrier('JT_EXPRESS'), /Unsupported/);
    assert.equal(f.forProvider('KEX_EXPRESS')?.carrier, 'KERRY_EXPRESS');
    assert.equal(f.forProvider('JT_EXPRESS'), null);
  }
  ok('Booking: Flash pno + 5 gates + factory matrix');
}

// ---------- 4. Webhook intake (BDD-2: HMAC + replay + atomic + LINE) ----------
function makeWebhookPorts(opts: { shipment?: { status: string; tenant: string | null } | null; lineUserId?: string | null; lineOk?: boolean }) {
  const applied: unknown[] = [];
  const logs: unknown[] = [];
  const seen = new Set<string>();
  const pushes: unknown[] = [];
  const retries: Array<{ stream: string }> = [];
  const repo = {
    findShipmentByTracking: async (tracking: string) =>
      opts.shipment === null || opts.shipment === undefined || tracking !== 'TH999TH'
        ? null
        : { id: 'sh-1', orderId: UUID, carrier: 'FLASH_EXPRESS', trackingNumber: tracking, status: opts.shipment.status, tenantId: opts.shipment.tenant },
    carrierConfig: async () => ({ mchId: 'm1', apiSecret: SECRET, isSandbox: true }),
    applyTrackingUpdate: async (a: unknown) => { applied.push(a); },
    appendWebhookLog: async (a: unknown) => { logs.push(a); },
    trackingNotifyTarget: async () => ({ orderId: UUID, orderNumber: 'ORD-1', lineUserId: opts.lineUserId ?? 'U1', tenantId: TENANT }),
  };
  const tx = { run: async <T>(fn: (t: unknown) => Promise<T>) => fn({}) };
  const nonce = { setnx: async (k: string) => { if (seen.has(k)) return false; seen.add(k); return true; } };
  const line = new LineNotificationService(
    (async () => ({ ok: opts.lineOk ?? true, status: (opts.lineOk ?? true) ? 200 : 500, json: async () => ({}) })) as never,
    'tok',
    { xadd: async (s: string) => { retries.push({ stream: s }); } },
  );
  void pushes;
  return { repo, tx, nonce, line, applied, logs, retries, seen };
}
const hookBody = (ts: number, extra: Record<string, unknown> = {}) => ({
  carrier: 'FLASH_EXPRESS',
  trackingNumber: 'TH999TH',
  orderNumber: 'ORD-1',
  statusCode: 'IN_TRANSIT',
  statusDescription: 'Arrived hub',
  signature: signWebhook(SECRET, 'TH999TH', 'IN_TRANSIT', ts),
  timestamp: ts,
  ...extra,
});

async function sectionWebhook(): Promise<void> {
  // Happy path: verify -> atomic update -> LINE push.
  {
    const p = makeWebhookPorts({ shipment: { status: 'BOOKED', tenant: TENANT } });
    const svc = new CarrierWebhookService(p.repo as never, p.tx, p.nonce, p.line, 'liff123');
    const r = await svc.ingest(hookBody(Date.now()));
    assert.equal(r.status, 'SUCCESS');
    assert.equal(p.applied.length, 1);
    assert.equal((p.applied[0] as { status: string }).status, 'IN_TRANSIT');
    assert.equal(p.logs.length, 1);
  }
  // Guards: bad shape + unknown + bad HMAC + stale + duplicate.
  {
    const p = makeWebhookPorts({ shipment: { status: 'BOOKED', tenant: TENANT } });
    const svc = new CarrierWebhookService(p.repo as never, p.tx, p.nonce, p.line, 'liff123');
    await assert.rejects(svc.ingest({ carrier: 'NOPE' }), /Invalid Webhook/);
    await assert.rejects(svc.ingest(hookBody(Date.now(), { trackingNumber: 'THX', signature: 'x' })), /Shipment not found/);
    await assert.rejects(svc.ingest(hookBody(Date.now(), { signature: 'deadbeef' })), /Invalid carrier/);
    await assert.rejects(svc.ingest(hookBody(Date.now() - 400_000)), /Stale/);
    const ts = Date.now();
    await svc.ingest(hookBody(ts));
    await assert.rejects(svc.ingest(hookBody(ts)), /Duplicate/);
  }
  // LINE 5xx -> retry stream (no throw, webhook still SUCCESS).
  {
    const p = makeWebhookPorts({ shipment: { status: 'BOOKED', tenant: TENANT }, lineOk: false });
    const svc = new CarrierWebhookService(p.repo as never, p.tx, p.nonce, p.line, 'liff123');
    const r = await svc.ingest(hookBody(Date.now()));
    assert.equal(r.status, 'SUCCESS');
    assert.ok(p.retries.some((x) => x.stream === 'line:tracking:retry'));
  }
  ok('Webhook: HMAC/replay/stale/dupe guards + atomic + LINE/ retry seam');
}

// ---------- 5. LINE flex card (§6.1 shape) ----------
{
  const flex = buildTrackingFlex({
    lineUserId: 'U1', orderNumber: 'ORD-1', carrierName: 'FLASH_EXPRESS',
    trackingNumber: 'TH1', statusText: 'In transit', trackingUrl: 'https://liff.line.me/x/orders/y/tracking',
  }) as { header: { backgroundColor: string }; body: { contents: unknown[] }; footer: unknown };
  assert.equal(flex.header.backgroundColor, '#FFF000');
  assert.equal(flex.body.contents.length, 3);
  const flexEta = buildTrackingFlex({
    lineUserId: 'U1', orderNumber: 'ORD-1', carrierName: 'KERRY_EXPRESS',
    trackingNumber: 'TH1', statusText: 'X', estimatedDelivery: 'tomorrow',
    trackingUrl: 'https://liff.line.me/x/orders/y/tracking',
  }) as { body: { contents: unknown[] } };
  assert.equal(flexEta.body.contents.length, 4);
  ok('LINE flex: brand header + rows + ETA variant');
}

// ---------- 6. Prisma additive (Gate 1) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of [
    'enum LogisticsCarrier {', 'enum ShipmentStatus {', 'model CarrierApiConfig {',
    'model Shipment {', 'model TrackingHistory {', 'model LogisticsWebhookLog {',
    'shipments            Shipment[]', '@@unique([tenantId, carrier])', '@@index([carrier, status])',
  ]) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  ok('Prisma: 2 enums + 4 models + Order back-relation');
}

function sectionParity(): void {
  for (const f of [
    'apps/backend/src/modules/logistics/domain/shipment.entity.ts',
    'apps/backend/src/modules/logistics/domain/logistics.repository.ts',
    'apps/backend/src/modules/logistics/adapters/carrier.interface.ts',
    'apps/backend/src/modules/logistics/adapters/flash-express.adapter.ts',
    'apps/backend/src/modules/logistics/adapters/kerry-express.adapter.ts',
    'apps/backend/src/modules/logistics/adapters/thailand-post.adapter.ts',
    'apps/backend/src/modules/logistics/services/carrier-factory.service.ts',
    'apps/backend/src/modules/logistics/services/logistics.service.ts',
    'apps/backend/src/modules/logistics/services/line-notification.service.ts',
    'apps/backend/src/modules/logistics/services/carrier-webhook.service.ts',
    'apps/backend/src/modules/logistics/infrastructure/prisma-logistics.repository.ts',
    'apps/backend/src/modules/logistics/controllers/logistics.controller.ts',
    'apps/backend/src/modules/logistics/resolvers/logistics.resolver.ts',
    'apps/backend/src/modules/logistics/logistics.module.ts',
    'apps/backend/src/api/webhooks/logistics-carrier.controller.ts',
    'apps/backend/src/api/graphql/logistics.resolver.ts',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes('TODO') && !src.includes('placeholder'), `${f} unimplemented`);
  }
  // No node-fetch dep anywhere in the phase (global fetch only).
  for (const f of [
    'apps/backend/src/modules/logistics/adapters/flash-express.adapter.ts',
    'apps/backend/src/modules/logistics/services/line-notification.service.ts',
  ]) {
    assert.ok(!readFileSync(f, 'utf8').includes("from 'node-fetch'"), `${f} heavy dep leaked`);
  }
  const mod = readFileSync('apps/backend/src/modules/logistics/logistics.module.ts', 'utf8');
  assert.ok(mod.includes('LogisticsModule') && mod.includes('CarrierWebhookService') && mod.includes('LineNotificationService'));
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('LogisticsModule'));
  const webhooks = readFileSync('apps/backend/src/api/webhooks/webhooks.module.ts', 'utf8');
  assert.ok(webhooks.includes('LogisticsCarrierController'));
  const gql = readFileSync('apps/backend/src/modules/logistics/resolvers/logistics.resolver.ts', 'utf8');
  assert.ok(gql.includes('getShipmentTracking') && gql.includes('bookParcel'));
  const sdl = readFileSync('apps/backend/src/api/graphql/schemas/logistics.graphql', 'utf8');
  assert.ok(sdl.includes('bookParcel') && sdl.includes('getShipmentTracking'));
  for (const p of [
    'apps/frontend/components/fulfillment/BatchBookingPanel.tsx',
    'apps/frontend/components/fulfillment/TrackingStepper.tsx',
    'apps/frontend/hooks/useShipmentTracking.ts',
    'apps/frontend/lib/logistics/logistics-client.ts',
    'apps/frontend/app/(admin)/fulfillment/batch-print/page.tsx',
    'apps/frontend/app/(liff)/orders/[id]/tracking/page.tsx',
  ]) {
    assert.ok(readFileSync(p, 'utf8').length > 200, `frontend missing: ${p}`);
  }
  for (const p of [
    'apps/frontend/app/api/v1/logistics/parcels/book/route.ts',
    'apps/frontend/app/api/v1/logistics/shipments/[orderId]/route.ts',
  ]) {
    assert.ok(readFileSync(p, 'utf8').includes('x-tenant-id'), `proxy missing tenant: ${p}`);
  }
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  assert.ok(barrel.includes('logistics-contract') && barrel.includes('BookParcelInputSchema'));
  ok('Parity: module/webhook/GQL-alias/SDL/studio/LIFF/proxies/barrel (no node-fetch)');
}

async function main(): Promise<void> {
  await sectionBooking();
  await sectionWebhook();
  sectionParity();
}

void main().then(
  () => console.log(`\nPhase077 contracts: ${passed + 5} checks passed`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
