// SSOT Phase 016 Task 8 — LIFF picker + analytics + order-cache contracts (loop 3x)
// Run: npx tsx scripts/test-phase016-contracts.ts
import assert from 'node:assert/strict';
import {
  SlipPickerSourceEnum,
  SlipPickerAnalyticsEventSchema,
  SLIP_PICKER_MAX_SOURCE_BYTES,
  SLIP_PICKER_TARGET_KB,
} from '../packages/shared/src/schemas/slip-picker.schema';
import { SlipPickerAnalyticsService } from '../apps/backend/src/modules/payment/services/slip-picker-analytics.service';
import type { RedisClusterService } from '../apps/backend/src/infra/redis/redis-cluster.service';

const OID = '423e4567-e89b-12d3-a456-426614174003';
const UID = '123e4567-e89b-12d3-a456-426614174000';
const TID = 'tenant-acme';
let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

function fakeRedis() {
  const events: Array<{ ch: string; msg: string }> = [];
  return {
    events,
    redis: {
      get: async (): Promise<null> => null,
      setex: async (): Promise<void> => undefined,
      setnx: async (): Promise<boolean> => true,
      del: async (): Promise<void> => undefined,
      publish: async (ch: string, msg: string): Promise<void> => { events.push({ ch, msg }); },
    },
  };
}

const castR = (v: unknown): RedisClusterService => v as RedisClusterService;

// ---------- 1. Zod picker SSOT ----------
async function sectionContracts(): Promise<void> {
  {
    assert.deepEqual(SlipPickerSourceEnum.options, ['liff-native', 'file-album', 'camera-capture']);
    const base = { orderId: OID, tenantId: TID };
    assert.equal(SlipPickerAnalyticsEventSchema.safeParse({ ...base, event: 'checkout_slip_selected', source: 'liff-native', fileSizeKbBefore: 1200 }).success, true);
    assert.equal(SlipPickerAnalyticsEventSchema.safeParse({ ...base, event: 'checkout_slip_compressed', fileSizeKbBefore: 1200, fileSizeKbAfter: 240 }).success, true);
    assert.equal(SlipPickerAnalyticsEventSchema.safeParse({ ...base, event: 'checkout_slip_uploaded', fileSizeKbAfter: 240, uploadLatencyMs: 900 }).success, true);
    assert.equal(SlipPickerAnalyticsEventSchema.safeParse({ ...base, event: 'checkout_slip_uploaded' }).success, true, 'sizes optional');
    assert.equal(SlipPickerAnalyticsEventSchema.safeParse({ ...base, event: 'checkout_slip_deleted' }).success, false);
    assert.equal(SlipPickerAnalyticsEventSchema.safeParse({ orderId: 'bad', event: 'checkout_slip_selected' }).success, false);
    assert.equal(SlipPickerAnalyticsEventSchema.safeParse({ ...base, event: 'checkout_slip_selected', source: 'webcam' }).success, false);
    assert.equal(SlipPickerAnalyticsEventSchema.safeParse({ ...base, event: 'checkout_slip_selected', fileSizeKbBefore: -1 }).success, false);
    assert.equal(SLIP_PICKER_MAX_SOURCE_BYTES, 10 * 1024 * 1024);
    assert.equal(SLIP_PICKER_TARGET_KB, 300);
    ok('Zod picker SSOT (sources + 3 analytics events + policy constants)');
  }
}

// ---------- 2. Analytics ingest service ----------
async function sectionIngest(): Promise<void> {
  {
    const f = fakeRedis();
    const svc = new SlipPickerAnalyticsService(castR(f.redis));
    await assert.rejects(svc.handleIngest({ orderId: OID, event: 'checkout_slip_selected' }, undefined), /Unauthorized/);
    await assert.rejects(
      svc.handleIngest({ orderId: OID, event: 'nope' }, UID),
      /Invalid picker analytics event/,
    );
    const ack = await svc.handleIngest({ orderId: OID, tenantId: TID, event: 'checkout_slip_selected', source: 'file-album', fileSizeKbBefore: 900 }, UID);
    assert.deepEqual(ack, { received: true });
    assert.equal(f.events.length, 1);
    assert.equal(f.events[0]?.ch, 'stream:analytics:payments');
    const msg = JSON.parse(f.events[0]?.msg ?? '{}') as Record<string, unknown>;
    assert.equal(msg.userId, UID);
    assert.equal(msg.event, 'checkout_slip_selected');
    assert.ok(typeof msg.at === 'string');

    // pipeline ordering: selected → compressed → uploaded
    await svc.handleIngest({ orderId: OID, event: 'checkout_slip_compressed', fileSizeKbBefore: 900, fileSizeKbAfter: 220 }, UID);
    await svc.handleIngest({ orderId: OID, event: 'checkout_slip_uploaded', fileSizeKbAfter: 220, uploadLatencyMs: 800 }, UID);
    const seq = f.events.map((e) => (JSON.parse(e.msg) as { event: string }).event);
    assert.deepEqual(seq, ['checkout_slip_selected', 'checkout_slip_compressed', 'checkout_slip_uploaded']);
    ok('analytics ingest (auth/input guards + ack + ordered fan-out)');
  }
  {
    // Redis outage never fails the ack (analytics are best-effort by design)
    const throwing = {
      get: async (): Promise<null> => null,
      setex: async (): Promise<void> => undefined,
      setnx: async (): Promise<boolean> => true,
      del: async (): Promise<void> => undefined,
      publish: async (): Promise<void> => { throw new Error('redis down'); },
    };
    const svc = new SlipPickerAnalyticsService(castR(throwing));
    const ack = await svc.handleIngest({ orderId: OID, event: 'checkout_slip_selected' }, UID);
    assert.deepEqual(ack, { received: true });
    ok('analytics resilience (redis outage still acks)');
  }
}

// ---------- 3. Frontend lib: order read + analytics emit + offline guards ----------
async function sectionLib(): Promise<void> {
  const prevFetch = globalThis.fetch;
  try {
    // fetchOrderDetail: URL shape + error mapping
    const calls: string[] = [];
    globalThis.fetch = (async (url: unknown) => {
      calls.push(String(url));
      return { ok: true, json: async () => ({ id: OID, netAmount: 450 }) };
    }) as typeof fetch;
    const { fetchOrderDetail } = await import('../apps/frontend/lib/checkout');
    const order = await fetchOrderDetail(OID);
    assert.equal(order.id, OID);
    assert.deepEqual(calls, [`/api/checkout/orders/${OID}`]);

    globalThis.fetch = (async () => ({ ok: false, status: 404, json: async () => ({ message: 'gone' }) })) as unknown as typeof fetch;
    await assert.rejects(fetchOrderDetail(OID), /gone/);
    globalThis.fetch = (async () => ({ ok: false, status: 500, json: async () => { throw new Error('no json'); } })) as unknown as typeof fetch;
    await assert.rejects(fetchOrderDetail(OID), /ไม่พบข้อมูลคำสั่งซื้อ/);

    // emitSlipPickerAnalytics: posts to the v1 proxy path, swallows failure
    const posts: Array<{ url: string; body: string }> = [];
    globalThis.fetch = (async (url: unknown, init: unknown) => {
      posts.push({ url: String(url), body: String((init as Record<string, unknown>).body) });
      return { ok: true, json: async () => ({ received: true }) };
    }) as typeof fetch;
    const { emitSlipPickerAnalytics } = await import('../apps/frontend/lib/slip-picker');
    await emitSlipPickerAnalytics({ orderId: OID, tenantId: TID, event: 'checkout_slip_selected', source: 'camera-capture', fileSizeKbBefore: 500 });
    assert.equal(posts[0]?.url, '/api/v1/payment/slip-analytics');
    assert.ok(posts[0]?.body.includes('checkout_slip_selected'));
    globalThis.fetch = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    await emitSlipPickerAnalytics({ orderId: OID, event: 'checkout_slip_uploaded' });
    ok('lib fetchers (order read + error map + analytics emit/fallback)');

    // offline cache + LIFF guards under Node (no indexedDB / no LIFF host)
    const { readCachedOrderStatus, writeCachedOrderStatus, tryLiffChooseImage } = await import('../apps/frontend/lib/slip-picker');
    assert.equal(await writeCachedOrderStatus({ orderId: OID, orderStatus: 'PENDING_PAYMENT', paymentStatus: 'UNPAID', netAmount: 450 }), false);
    assert.equal(await readCachedOrderStatus(OID), null);
    assert.equal(await tryLiffChooseImage(), null, 'Node has no LIFF host → fallback');
    ok('offline/LIFF guards (graceful null without browser APIs)');
  } finally {
    globalThis.fetch = prevFetch;
  }
}

async function main(): Promise<void> {
  await sectionContracts();
  await sectionIngest();
  await sectionLib();
  console.log(`\nphase016 contract tests: ${passed} groups passed`);
}

void main();
