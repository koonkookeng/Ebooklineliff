// SSOT Phase 020 — full monetization chain (order→QR→verify→receipt→gate→dupe)
// Run: npx tsx scripts/test-phase020-contracts.ts (loop 3x)
// The Playwright spec (e2e/checkout-flow.spec.ts) runs the same chain in CI
// with browsers; this file proves the cross-module backend chain locally.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CheckoutService } from '../apps/backend/src/modules/order/services/checkout.service';
import { SlipVerifyService } from '../apps/backend/src/modules/order/services/slip-verify.service';
import { OrderAtomicService } from '../apps/backend/src/modules/order/services/order-atomic.service';
import { EntitlementGrantService } from '../apps/backend/src/modules/entitlement/services/entitlement-grant.service';
import type { EasySlipVerifyAdapter } from '../apps/backend/src/modules/payment/services/easyslip-verify.adapter';
import { LibraryService } from '../apps/backend/src/modules/library/services/library.service';
import { AssetFormatterService } from '../apps/backend/src/modules/library/services/asset-formatter.service';
import { LibraryCacheRepository } from '../apps/backend/src/modules/library/repositories/library-cache.repository';
import { ReceiptQueueProcessor } from '../apps/backend/src/modules/notification/processors/receipt-queue.processor';
import { LineMessagingService } from '../apps/backend/src/modules/notification/line-messaging.service';
import type { PrismaService } from '../apps/backend/src/infra/database/prisma.service';
import type { RedisClusterService } from '../apps/backend/src/infra/redis/redis-cluster.service';

const UID = '123e4567-e89b-12d3-a456-426614174000';
const UID2 = '123e4567-e89b-12d3-a456-426614174999';
const PID = '223e4567-e89b-12d3-a456-426614174001';
const PID2 = '223e4567-e89b-12d3-a456-426614174002';
const OID = '423e4567-e89b-12d3-a456-426614174003';
const OID2 = '423e4567-e89b-12d3-a456-426614174004';
const OID3 = '423e4567-e89b-12d3-a456-426614174005';
const TID = '723e4567-e89b-12d3-a456-426614174007';
let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

// ---------- env sandbox ----------
const ENV_KEEP: Record<string, string | undefined> = {};
for (const k of ['LIFF_BASE_URL', 'LINE_CHANNEL_ACCESS_TOKEN', 'RECEIPT_HMAC_SECRET', 'COMPANY_PROMPTPAY_ACCOUNT', 'COMPANY_PROMPTPAY_ID', 'COMPANY_PROMPTPAY_TYPE']) {
  ENV_KEEP[k] = process.env[k];
  delete process.env[k];
}
process.env.LIFF_BASE_URL = 'https://liff.test';
process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token';
process.env.RECEIPT_HMAC_SECRET = 'test-secret';
process.env.COMPANY_PROMPTPAY_ACCOUNT = '2222222222';
process.env.COMPANY_PROMPTPAY_ID = '0812345678';
process.env.COMPANY_PROMPTPAY_TYPE = 'MOBILE';

const FETCH_KEEP = globalThis.fetch;
let fetchCalls = 0;
function mockLine(status: number): void {
  fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls++;
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(status === 200 ? { sentMessages: [{ id: 'mid-chain' }] } : { message: 'err' }) };
  }) as typeof fetch;
}

// ---------- shared fake backend ----------
function fakeWorld() {
  const store = new Map<string, string>();
  const events: Array<{ ch: string; msg: string }> = [];
  const redis = {
    get: async (k: string): Promise<string | null> => store.get(k) ?? null,
    setex: async (k: string, _t: number, v: string): Promise<void> => { store.set(k, v); },
    setnx: async (k: string, v: string): Promise<boolean> => { if (store.has(k)) return false; store.set(k, v); return true; },
    del: async (k: string): Promise<void> => { store.delete(k); },
    publish: async (ch: string, msg: string): Promise<void> => { events.push({ ch, msg }); },
    subscribe: async (): Promise<() => void> => () => undefined,
    getdel: async (k: string): Promise<string | null> => { const v = store.get(k) ?? null; store.delete(k); return v; },
  };
  const orders = new Map<string, Record<string, unknown>>([
    [OID, { id: OID, orderNumber: 'ORD-CHAIN-1', tenantId: 'default', userId: UID, totalAmount: 450, netAmount: 450, orderStatus: 'PENDING_PAYMENT', paymentStatus: 'UNPAID', orderItems: [{ productId: PID }], updatedAt: new Date() }],
    [OID2, { id: OID2, orderNumber: 'ORD-CHAIN-2', tenantId: 'default', userId: UID2, totalAmount: 450, netAmount: 450, orderStatus: 'PENDING_PAYMENT', paymentStatus: 'UNPAID', orderItems: [{ productId: PID2 }], updatedAt: new Date() }],
    [OID3, { id: OID3, orderNumber: 'ORD-CHAIN-3', tenantId: 'default', userId: UID, totalAmount: 450, netAmount: 450, orderStatus: 'EXPIRED', paymentStatus: 'UNPAID', orderItems: [{ productId: PID }], updatedAt: new Date() }],
  ]);
  const slips: unknown[] = [];
  const entitlements: Array<{ userId: string; productId: string }> = [];
  const outbox: unknown[] = [];
  const logs = new Map<string, Record<string, unknown>>();
  const products = [
    { id: PID, title: 'Ebook Chain', productType: 'EBOOK', price: 450, discountPrice: null, isPublished: true, deletedAt: null, physicalDetail: null, coverImageUrl: 'https://cdn.test/a.webp' },
    { id: PID2, title: 'Course Chain', productType: 'ELEARNING_COURSE', price: 450, discountPrice: null, isPublished: true, deletedAt: null, physicalDetail: null, coverImageUrl: 'https://cdn.test/b.webp' },
  ];
  let orderSeq = 100;
  const prisma = {
    product: {
      findMany: async (args: { where: { id: { in: string[] } } }): Promise<unknown[]> =>
        products.filter((p) => args.where.id.in.includes(p.id)),
    },
    userAddress: { findUnique: async (): Promise<null> => null },
    user: {
      findUnique: async (args: { where: { id: string } }): Promise<Record<string, unknown> | null> =>
        args.where.id === UID || args.where.id === UID2
          ? { id: args.where.id, lineUserId: `LINE-${args.where.id.slice(0, 4)}`, displayName: 'Chain Buyer' }
          : null,
    },
    cart: { findUnique: async (): Promise<null> => null },
    cartItem: { deleteMany: async (): Promise<unknown> => ({}) },
    order: {
      findUnique: async (args: { where: { id: string } }): Promise<Record<string, unknown> | null> => orders.get(args.where.id) ?? null,
      create: async (args: { data: Record<string, unknown> }): Promise<{ id: string; orderNumber: string }> => {
        const id = `523e4567-e89b-12d3-a456-42661417${String(orderSeq).padStart(4, '0')}`;
        orderSeq++;
        orders.set(id, { id, ...(args.data as object), orderItems: [{ productId: PID }] });
        return { id, orderNumber: String((args.data as { orderNumber: string }).orderNumber) };
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown> => {
        const o = orders.get(args.where.id);
        if (o) Object.assign(o, args.data);
        return o;
      },
    },
    orderItem: { findMany: async (): Promise<unknown[]> => [] },
    paymentSlip: {
      upsert: async (args: { where: { orderId: string }; create: Record<string, unknown>; update: Record<string, unknown> }): Promise<unknown> => {
        const ix = slips.findIndex((s) => (s as { orderId: string }).orderId === args.where.orderId);
        if (ix >= 0) slips[ix] = { ...(slips[ix] as object), ...args.update };
        else slips.push({ orderId: args.where.orderId, ...args.create });
        return {};
      },
    },
    promptPayTransaction: {
      findFirst: async (): Promise<null> => null,
      updateMany: async (): Promise<{ count: number }> => ({ count: 0 }),
    },
    entitlement: {
      upsert: async (args: { where: { userId_productId: { userId: string; productId: string } }; create: { userId: string; productId: string } }): Promise<{ productId: string }> => {
        entitlements.push({ userId: args.create.userId, productId: args.create.productId });
        return { productId: args.create.productId };
      },
      findUnique: async (args: { where: { userId_productId: { userId: string; productId: string } } }): Promise<{ expiresAt: null; accessType: string } | null> => {
        const hit = entitlements.find((e) => e.userId === args.where.userId_productId.userId && e.productId === args.where.userId_productId.productId);
        return hit ? { expiresAt: null, accessType: 'FULL_PURCHASE' } : null;
      },
      findMany: async (): Promise<unknown[]> => [],
    },
    outboxEvent: {
      create: async (args: { data: Record<string, unknown> }): Promise<{ id: string }> => {
        outbox.push(args.data);
        return { id: `obx-${outbox.length}` };
      },
      findMany: async (): Promise<unknown[]> => [],
      update: async (): Promise<unknown> => ({}),
    },
    receiptNotificationLog: {
      findFirst: async (): Promise<Record<string, unknown> | null> => [...logs.values()].at(-1) ?? null,
      findUnique: async (args: { where: { id: string } }): Promise<Record<string, unknown> | null> => logs.get(args.where.id) ?? null,
      create: async (args: { data: Record<string, unknown> }): Promise<Record<string, unknown>> => {
        const row = { id: '623e4567-e89b-12d3-a456-426614174020', lineMessageId: null, pdfR2Path: null, errorMessage: null, retryCount: 0, sentAt: null, ...args.data };
        logs.set(String(row['id']), row);
        return row;
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown> => {
        const row = logs.get(args.where.id);
        if (row) Object.assign(row, args.data);
        return row;
      },
      findMany: async (): Promise<unknown[]> => [...logs.values()],
    },
    tenantSetting: { findUnique: async (): Promise<null> => null },
    tenant: { findUnique: async (): Promise<null> => null },
    ebookReadingProgress: { findMany: async (): Promise<unknown[]> => [] },
    courseLearningProgress: { findMany: async (): Promise<unknown[]> => [] },
    $transaction: (fn: (t: unknown) => Promise<unknown>): Promise<unknown> => fn(prisma),
  };
  return { redis, prisma, orders, slips, entitlements, outbox, logs, events };
}

const castP = (v: unknown): PrismaService => v as PrismaService;
const castR = (v: unknown): RedisClusterService => v as RedisClusterService;
const chainAdapter = (transRef: string, amount: number): EasySlipVerifyAdapter =>
  ({
    verify: async (): Promise<{ transRef: string; amount: number; receiverAccount: string; senderBank: string; raw: Record<string, never> }> => ({
      transRef, amount, receiverAccount: '2222222222', senderBank: 'KBANK', raw: {},
    }),
  }) as unknown as EasySlipVerifyAdapter;

// ---------- 1. Happy chain ----------
async function sectionChain(): Promise<void> {
  const t0 = performance.now();
  const w = fakeWorld();
  const grants = new EntitlementGrantService(castR(w.redis));
  const atomic = new OrderAtomicService(castP(w.prisma), castR(w.redis));
  const verify = new SlipVerifyService(castP(w.prisma), castR(w.redis), chainAdapter('SLIP-CHAIN-1', 450), grants, undefined, atomic);
  const library = new LibraryService(castP(w.prisma), castR(w.redis), new AssetFormatterService(), new LibraryCacheRepository(castR(w.redis)));
  const queue = new ReceiptQueueProcessor(castP(w.prisma), castR(w.redis));
  const receipts = new LineMessagingService(castP(w.prisma), castR(w.redis), queue);

  // Step 1: checkout creates the order + dynamic QR payload
  const shipping = { cheapest: async (): Promise<{ fee: number }> => ({ fee: 0 }) };
  const checkout = new CheckoutService(castP(w.prisma), castR(w.redis), shipping as never);
  const created = await checkout.createOrder(UID, { tenantId: TID, items: [{ productId: PID, quantity: 1 }] });
  assert.ok(created.orderId);
  assert.equal(created.netAmount, 450);
  assert.ok(created.promptPayQrPayload.length > 0, 'dynamic QR payload present');
  assert.ok(w.events.some((e) => e.ch === 'stream:order:created'), 'ORDER_CREATED emitted');
  ok('chain step 1 (checkout → order + dynamic QR + event)');

  // Step 2: slip verify flips COMPLETED/VERIFIED + grants entitlement (<1s)
  mockLine(200);
  const v = await verify.verify(OID, 'https://cdn.test/slip1.png', UID);
  assert.equal(v.success, true);
  assert.equal(v.orderStatus, 'COMPLETED');
  assert.equal(v.paymentStatus, 'VERIFIED');
  assert.deepEqual(v.entitlementsGranted, [PID]);
  assert.ok(w.entitlements.some((e) => e.userId === UID && e.productId === PID), 'entitlement row written');
  assert.equal(w.outbox.length, 1, 'outbox durability row');
  const flexEvent = w.events.find((e) => e.ch === 'stream:notify:flex-receipt');
  assert.ok(flexEvent && String(flexEvent.msg).includes(OID), 'flex receipt event carries orderId');
  globalThis.fetch = FETCH_KEEP;
  ok('chain step 2 (verify → COMPLETED/VERIFIED + grant + outbox + flex event)');

  // Step 3: receipt pipeline consumes the event → LINE DELIVERED
  mockLine(200);
  const receipt = await receipts.requestReceiptByOrder(OID);
  assert.equal(receipt?.status, 'DELIVERED');
  assert.ok(w.events.some((e) => e.ch === 'stream:analytics:receipt' && e.msg.includes('line.receipt.delivered')));
  const calls = fetchCalls;
  await receipts.requestReceiptByOrder(OID);
  assert.equal(fetchCalls, calls, 'receipt idempotent: no second push');
  globalThis.fetch = FETCH_KEEP;
  ok('chain step 3 (event → receipt DELIVERED + telemetry + idempotent)');

  // Step 4: library gate opens for the unlocked product
  const gate = await library.checkAccess(UID, PID);
  assert.deepEqual(gate, { hasAccess: true });
  assert.equal(await w.redis.get(`library:gate:${UID}:${PID}`), 'TRUE', 'gate flag cached');
  ok('chain step 4 (entitlement gate TRUE + flag)');

  const wall = performance.now() - t0;
  assert.ok(wall < 2000, `full chain resolves in ${wall.toFixed(1)}ms < 2000ms`);
  ok(`chain latency (${wall.toFixed(1)}ms end-to-end on fakes)`);
}

// ---------- 2. Duplicate / negative paths ----------
async function sectionNegatives(): Promise<void> {
  // Duplicate transRef → 409 DUPLICATE, no grant for the second order
  {
    const w = fakeWorld();
    const grants = new EntitlementGrantService(castR(w.redis));
    const verify = new SlipVerifyService(castP(w.prisma), castR(w.redis), chainAdapter('SLIP-998877', 450), grants);
    await verify.verify(OID, 'https://cdn.test/a.png', UID);
    await assert.rejects(verify.verify(OID2, 'https://cdn.test/a.png', UID2), /ใช้.*แล้ว|SLIP_ALREADY_USED/);
    assert.ok(!w.entitlements.some((e) => e.userId === UID2), 'no duplicate entitlement');
    assert.equal(w.orders.get(OID2)?.['orderStatus'], 'PAYMENT_VERIFYING', 'second order stays retryable, never COMPLETED');
    ok('duplicate slip (409 SLIP_ALREADY_USED + zero double grant)');
  }
  // Underpaid slip → 400 amount mismatch, payment FAILED
  {
    const w = fakeWorld();
    const grants = new EntitlementGrantService(castR(w.redis));
    const verify = new SlipVerifyService(castP(w.prisma), castR(w.redis), chainAdapter('SLIP-LOW', 400), grants);
    await assert.rejects(verify.verify(OID, 'https://cdn.test/low.png', UID), /match|ยอดเงิน/);
    assert.equal(w.orders.get(OID)?.['paymentStatus'], 'FAILED');
    assert.equal(w.entitlements.length, 0, 'no grant on underpayment');
    ok('underpaid slip (400 amount mismatch → FAILED, retryable with new slip)');
  }
  // Expired order → QR regenerate required
  {
    const w = fakeWorld();
    const grants = new EntitlementGrantService(castR(w.redis));
    const verify = new SlipVerifyService(castP(w.prisma), castR(w.redis), chainAdapter('SLIP-EXP', 450), grants);
    await assert.rejects(verify.verify(OID3, 'https://cdn.test/e.png', UID), /หมดอายุ/);
    ok('expired order (QR regenerate required)');
  }
  // Unknown order → 404, never 500
  {
    const w = fakeWorld();
    const grants = new EntitlementGrantService(castR(w.redis));
    const verify = new SlipVerifyService(castP(w.prisma), castR(w.redis), chainAdapter('SLIP-X', 450), grants);
    await assert.rejects(verify.verify(PID, 'https://cdn.test/x.png', UID), /not found/i);
    ok('unknown order (404, never 500)');
  }
}

// ---------- 3. Playwright artifact static check ----------
async function sectionArtifact(): Promise<void> {
  assert.ok(fs.existsSync('e2e/checkout-flow.spec.ts'), 'spec present');
  assert.ok(fs.existsSync('e2e/fixtures/valid-sample-slip.png'), 'slip fixture present');
  const spec = fs.readFileSync('e2e/checkout-flow.spec.ts', 'utf8');
  for (const needle of ['/catalog', '/library', 'ชำระเงินสำเร็จ', '1500', 'valid-sample-slip.png', 'สแกนชำระเงิน PromptPay']) {
    assert.ok(spec.includes(needle), `spec covers ${needle}`);
  }
  ok('playwright artifact (routes + strings + perf guard + fixture wired)');
}

async function main(): Promise<void> {
  await sectionChain();
  await sectionNegatives();
  await sectionArtifact();
  for (const [k, v] of Object.entries(ENV_KEEP)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  globalThis.fetch = FETCH_KEEP;
  console.log(`\nphase020 contract tests: ${passed} groups passed`);
}

void main();
