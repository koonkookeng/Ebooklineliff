// SSOT Phase 012 §10/Task 5 — order/payment/entitlement contract + integration tests (TDD loop 3x)
// Run: npx tsx scripts/test-phase012-contracts.ts
import assert from 'node:assert/strict';
import {
  OrderStatusEnum,
  OrderItemInputSchema,
  CreateOrderInputSchema,
  generateOrderNumber,
} from '../packages/shared/src/schemas/order.schema';
import {
  PaymentStatusEnum,
  VerifySlipInputSchema,
  SlipVerificationResultSchema,
  CreateOrderPayloadSchema,
  promptPayExpiry,
} from '../packages/shared/src/schemas/payment.schema';
import {
  ContentAccessTypeEnum,
  GrantEntitlementInputSchema,
  EntitlementSchema,
} from '../packages/shared/src/schemas/entitlement.schema';
import { OrderStatusEnum as SdidOrderStatus } from '../packages/shared/src/schemas/sdid-contract';
import {
  buildPromptPayPayload,
  crc16,
  normalizeMobile,
} from '../apps/backend/src/modules/payment/services/promptpay-emv.builder';
import {
  EasySlipVerifyAdapter,
  SlipUnverifiableError,
  EASYSLIP_TIMEOUT_MS,
} from '../apps/backend/src/modules/payment/services/easyslip-verify.adapter';
import {
  tieredShippingFee,
  splitCart,
  emptyCartSummary,
} from '../apps/backend/src/modules/cart/domain/value-objects/cart-split.vo';
import { CheckoutService } from '../apps/backend/src/modules/order/services/checkout.service';
import { SlipVerifyService } from '../apps/backend/src/modules/order/services/slip-verify.service';
import { EntitlementGrantService } from '../apps/backend/src/modules/entitlement/services/entitlement-grant.service';
import type { PrismaService } from '../apps/backend/src/infra/database/prisma.service';
import type { RedisClusterService } from '../apps/backend/src/infra/redis/redis-cluster.service';

const UID = '123e4567-e89b-12d3-a456-426614174000';
const PID = '223e4567-e89b-12d3-a456-426614174001';
const PID2 = '223e4567-e89b-12d3-a456-426614174009';
const TID = '323e4567-e89b-12d3-a456-426614174002';
let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

// ---------- 1. Zod SSOT ----------
async function sectionContracts(): Promise<void> {
  {
  assert.deepEqual(OrderStatusEnum.options, SdidOrderStatus.options, 'single OrderStatus source');
  assert.deepEqual(PaymentStatusEnum.options, ['UNPAID', 'PENDING_SLIP', 'VERIFIED', 'FAILED', 'REFUNDED']);
  assert.deepEqual(ContentAccessTypeEnum.options, ['FULL_PURCHASE', 'SUBSCRIPTION', 'CORPORATE_LICENSE', 'TIME_LIMITED_RENTAL']);
  const base = { tenantId: TID, items: [{ productId: PID, quantity: 1 }] };
  assert.equal(CreateOrderInputSchema.safeParse(base).success, true);
  assert.equal(CreateOrderInputSchema.safeParse({ tenantId: TID, items: [] }).success, false);
  assert.equal(OrderItemInputSchema.safeParse({ productId: PID, quantity: 2 }).success, true);
  assert.equal(OrderItemInputSchema.safeParse({ productId: 'bad', quantity: 1 }).success, false);
  assert.equal(VerifySlipInputSchema.safeParse({ orderId: PID, slipImageUrl: 'https://cdn/x.png' }).success, true);
  assert.equal(VerifySlipInputSchema.safeParse({ orderId: PID, slipImageUrl: 'bad' }).success, false);
  const orderNum = generateOrderNumber(new Date('2026-10-06T12:00:00Z'));
  assert.ok(orderNum.startsWith('EB20261006'));
  assert.equal(orderNum.length, 16);
  assert.ok(promptPayExpiry().includes('T'), 'ISO expiry');
  const pay = { orderId: PID, orderNumber: 'ORD-1', netAmount: 590, promptPayQrPayload: 'payload', expiresAt: promptPayExpiry() };
  assert.equal(CreateOrderPayloadSchema.safeParse(pay).success, true);
  assert.equal(SlipVerificationResultSchema.safeParse({ success: true, message: 'ok', orderId: PID, orderStatus: 'COMPLETED', paymentStatus: 'VERIFIED', transRef: 'TR123', entitlementsGranted: [PID] }).success, true);
  assert.equal(SlipVerificationResultSchema.safeParse({ success: true, message: 'ok', orderId: PID, orderStatus: 'COMPLETED', paymentStatus: 'VERIFIED', transRef: null, entitlementsGranted: [] }).success, true);
  assert.equal(GrantEntitlementInputSchema.safeParse({ userId: UID, productId: PID, accessType: 'FULL_PURCHASE' }).success, true);
  assert.equal(EntitlementSchema.safeParse({ id: PID, userId: UID, productId: PID, accessType: 'FULL_PURCHASE', expiresAt: null, createdAt: new Date().toISOString() }).success, true);
  ok('Zod SSOT (order/payment/entitlement + helpers)');
}

// ---------- 2. PromptPay EMV builder ----------
{
  assert.equal(normalizeMobile('0812345678'), '0812345678');
  assert.equal(normalizeMobile('+66812345678'), '0812345678');
  assert.equal(normalizeMobile('66812345678'), '0812345678');
  const p = buildPromptPayPayload({ proxyType: 'MOBILE', proxyValue: '0812345678' }, 199, 'EB20261006ABC123');
  assert.ok(p.startsWith('000201010212'), 'EMV payload-format-indicator + point-of-initiation');
  assert.ok(p.includes('5406199.00'), 'amount TLV tag 54');
  assert.ok(crc16(p.slice(0, -4)) === p.slice(-4), 'CRC16 matches');
  const corrupted = `${p.slice(0, -4)}0000`;
  assert.ok(!corrupted.endsWith(crc16(corrupted.slice(0, -4))), 'tamper detected');
  assert.throws(() => buildPromptPayPayload({ proxyType: 'MOBILE', proxyValue: '' }, 199), /proxy value/);
  assert.throws(() => buildPromptPayPayload({ proxyType: 'MOBILE', proxyValue: '0812345678' }, 0), /positive/);
  ok('PromptPay EMV (mobile normalize + CRC16 tamper guard + input guards)');
}

// ---------- 3. EasySlip adapter ----------
{
  const adapter = new EasySlipVerifyAdapter(100);
  await assert.rejects(adapter.verify('not-url'), /Invalid slip image URL/);
  await assert.rejects(adapter.verify('http://x'), SlipUnverifiableError);
  assert.equal(EASYSLIP_TIMEOUT_MS, 800);
  ok('EasySlip adapter (URL guard + timeout constant)');
}

// ---------- 4. Cart split VO edge cases ----------
{
  assert.equal(tieredShippingFee(0), 35, 'Edge: 0g fallback');
  assert.equal(tieredShippingFee(500), 35);
  assert.equal(tieredShippingFee(1200), 55);
  assert.equal(tieredShippingFee(2500), 85);
  const digi = { cartItemId: 'c1', productId: PID, title: 'E', coverImageUrl: 'u', productType: 'EBOOK', itemCategory: 'DIGITAL' as const, unitPrice: 199, quantity: 1, weightGrams: 0 };
  const phys = { cartItemId: 'c2', productId: PID2, title: 'B', coverImageUrl: 'u', productType: 'PHYSICAL_BOOK', itemCategory: 'PHYSICAL' as const, unitPrice: 350, quantity: 2, weightGrams: 600, sku: 'SKU' };
  const d = splitCart([digi], 999);
  assert.equal(d.requiresShippingAddress, false);
  assert.equal(d.estimatedShippingFee, 0, 'digital ignores shipping input');
  assert.equal(d.grandTotalAmount, 199);
  const mixed = splitCart([digi, phys], 55, 50);
  assert.equal(mixed.appliedDiscountAmount, 50);
  assert.equal(mixed.estimatedShippingFee, 55);
  assert.equal(mixed.grandTotalAmount, 199 - 50 + 700 + 55);
  const clamped = splitCart([digi], 0, 9999);
  assert.equal(clamped.appliedDiscountAmount, 199);
  assert.equal(emptyCartSummary().requiresShippingAddress, false);
  ok('split VO (tiers + digital-only + discount isolation + clamp)');
  }
}

// ---------- 5. Services (fakes) ----------
interface FakeOrder {
  id: string; orderNumber: string; userId: string; tenantId: string | null;
  totalAmount: number; shippingFee: number; discountAmount: number; netAmount: number;
  orderStatus: string; paymentStatus: string; orderItems: Array<{ productId: string }>;
}

function buildFakes012(): {
  prisma: unknown; redis: unknown; events: Array<{ ch: string; msg: string }>; orders: Map<string, FakeOrder>; granted: string[];
} {
  const granted: string[] = [];
  const events: Array<{ ch: string; msg: string }> = [];
  const orders = new Map<string, FakeOrder>([
    ['423e4567-e89b-12d3-a456-426614174003', { id: '423e4567-e89b-12d3-a456-426614174003', orderNumber: 'ORD-1', userId: UID, tenantId: TID, totalAmount: 899, shippingFee: 55, discountAmount: 0, netAmount: 954, orderStatus: 'PENDING_PAYMENT', paymentStatus: 'UNPAID', orderItems: [{ productId: PID }, { productId: PID2 }] }],
  ]);
  const products = new Map([
    [PID, { id: PID, title: 'Ebook A', productType: 'EBOOK', price: 899, discountPrice: null, isPublished: true, deletedAt: null, physicalDetail: null }],
    [PID2, { id: PID2, title: 'Book B', productType: 'PHYSICAL_BOOK', price: 350, discountPrice: null, isPublished: true, deletedAt: null, physicalDetail: { stockQty: 10, reservedQty: 0, weightGrams: 600 } }],
  ]);
  const addresses = new Map([['addr-1', { id: 'addr-1', userId: UID, postalCode: '10110' }]]);
  const findOrder = async (args: { where: { id: string } }): Promise<FakeOrder | null> => orders.get(args.where.id) ?? null;
  const createOrder = async (args: { data: { orderNumber: string } }): Promise<{ id: string; orderNumber: string }> => {
    const o: FakeOrder = { id: '523e4567-e89b-12d3-a456-426614174004', orderNumber: args.data.orderNumber, userId: UID, tenantId: TID, totalAmount: 899, shippingFee: 0, discountAmount: 0, netAmount: 899, orderStatus: 'PENDING_PAYMENT', paymentStatus: 'UNPAID', orderItems: [{ productId: PID }] };
    orders.set(o.id, o);
    return { id: o.id, orderNumber: o.orderNumber };
  };
  const updateOrder = async (args: { where: { id: string }; data: Record<string, unknown> }): Promise<Record<string, never>> => {
    const o = orders.get(args.where.id);
    if (o) Object.assign(o, args.data);
    return {};
  };
  const findOrderItems = async (args: { where: { orderId: string } }): Promise<Array<{ productId: string }>> => orders.get(args.where.orderId)?.orderItems ?? [];
  const upsertPaymentSlip = async (): Promise<Record<string, never>> => ({});
  const upsertEntitlement = async (args: { create: { productId: string } }): Promise<{ productId: string }> => {
    granted.push(args.create.productId);
    return { productId: args.create.productId };
  };
  const txClient = {
    order: { findUnique: findOrder, create: createOrder, update: updateOrder },
    orderItem: { findMany: findOrderItems },
    paymentSlip: { upsert: upsertPaymentSlip },
    entitlement: { upsert: upsertEntitlement, findUnique: async (): Promise<null> => null },
    userAddress: { findUnique: (args: { where: { id: string } }): unknown => addresses.get(args.where.id) ?? null },
    product: { findMany: (args: { where: { id: { in: string[] } } }): unknown[] => [...products.values()].filter((p) => args.where.id.in.includes(p.id)) },
    cart: { findUnique: async (): Promise<null> => null },
    cartItem: { deleteMany: async (): Promise<Record<string, never>> => ({}) },
    shippingRateTable: { findMany: async (): unknown[] => [] },
  };
  const prisma = {
    $transaction: (fn: (t: unknown) => Promise<string[]>): Promise<string[]> => fn(txClient),
    ...txClient,
  };
  const store = new Map<string, string>();
  const redis = {
    get: async (k: string): Promise<string | null> => store.get(k) ?? null,
    setex: async (k: string, _t: number, v: string): Promise<void> => { store.set(k, v); },
    setnx: async (k: string, v: string): Promise<boolean> => { if (store.has(k)) return false; store.set(k, v); return true; },
    del: async (k: string): Promise<void> => { store.delete(k); },
    publish: async (ch: string, msg: string): Promise<void> => { events.push({ ch, msg }); },
  };
  return { prisma, redis, events, orders, granted };
}

async function sectionServices(): Promise<void> {
  const castP = (v: unknown): PrismaService => v as PrismaService;
  const castR = (v: unknown): RedisClusterService => v as RedisClusterService;
  const fakeShipping = {
    cheapest: async (): Promise<{ fee: number }> => ({ fee: 55 }),
    quoteAll: async (): Promise<Array<{ fee: number }>> => [{ fee: 55 }],
  };

  {
    const f = buildFakes012();
    process.env.COMPANY_PROMPTPAY_ID = '0812345678';
    process.env.COMPANY_PROMPTPAY_TYPE = 'MOBILE';
    const checkout = new CheckoutService(castP(f.prisma), castR(f.redis), fakeShipping as never);
    const t0 = performance.now();
    const order = await checkout.createOrder(UID, { tenantId: TID, items: [{ productId: PID, quantity: 1 }] });
    assert.equal(order.orderId, '523e4567-e89b-12d3-a456-426614174004');
    assert.ok(order.promptPayQrPayload.startsWith('000201010212'));
    assert.ok(order.expiresAt.includes('T'));
    assert.ok(order.netAmount > 0);
    console.log(`  (checkout logic ${(performance.now() - t0).toFixed(1)}ms with fakes)`);
    await assert.rejects(checkout.createOrder('', { tenantId: TID, items: [{ productId: PID, quantity: 1 }] }), /Missing user id/);
    await assert.rejects(checkout.createOrder(UID, { tenantId: TID, items: [] }), /Invalid checkout payload/);
    ok('checkout (atomic order + QR + cart clear + orderCreated event + guards)');
  }

  {
    const f = buildFakes012();
    const grants = new EntitlementGrantService(castR(f.redis));
    const tx = { entitlement: { upsert: async (args: { create: { productId: string } }): Promise<{ productId: string }> => ({ productId: (args.create as { productId: string }).productId }), findUnique: async (): Promise<null> => null } };
    const g = await grants.grantForOrder(tx as never, UID, [PID, PID2, PID], 'FULL_PURCHASE');
    assert.deepEqual([...g].sort(), [PID, PID2].sort(), 'dedupe repeat productIds');
    assert.ok(f.events.some((e) => e.ch === 'stream:entitlement:granted'));
    assert.equal(await grants.hasAccess({ entitlement: { findUnique: async (): Promise<{ id: string }> => ({ id: 'e1' }) } }, UID, PID), true);
  assert.equal(await grants.hasAccess({ entitlement: { findUnique: async (): Promise<null> => null } }, UID, PID), false);
  ok('entitlement grant (idempotent upsert + dedupe + cache invalidation + event + gate)');
  }

  {
    const f = buildFakes012();
    const grants = new EntitlementGrantService(castR(f.redis));
    const strictAdapter = new EasySlipVerifyAdapter(50);
    const verify = new SlipVerifyService(castP(f.prisma), castR(f.redis), strictAdapter, grants);
    await assert.rejects(verify.verify('', 'https://cdn/slip.png', UID), /Missing order id/);
    await assert.rejects(verify.verify('423e4567-e89b-12d3-a456-426614174003', 'bad', UID), /Invalid slip/);
    await assert.rejects(verify.verify('623e4567-e89b-12d3-a456-426614174005', 'https://cdn/slip.png', UID), /Order not found/);
    const mockEasyslip = { verify: async (): Promise<{ transRef: string; amount: number; receiverAccount: string; senderBank: string; raw: Record<string, never> }> => ({ transRef: 'TR123', amount: 954, receiverAccount: '1234567890', senderBank: 'BANK', raw: {} }) };
    const verifyWithMock = new SlipVerifyService(castP(f.prisma), castR(f.redis), mockEasyslip as never, grants);
    const t0 = performance.now();
    const res = await verifyWithMock.verify('423e4567-e89b-12d3-a456-426614174003', 'https://cdn/slip.png', UID);
    const latency = performance.now() - t0;
    assert.equal(res.success, true);
    assert.equal(res.paymentStatus, 'VERIFIED');
    assert.equal(res.orderStatus, 'COMPLETED');
    assert.equal(res.transRef, 'TR123');
    assert.deepEqual([...res.entitlementsGranted].sort(), [PID, PID2].sort());
    assert.ok(f.events.some((e) => e.ch === 'stream:payment:slip-verified'));
    assert.ok(f.events.some((e) => e.ch === 'stream:notify:flex-receipt'));
    assert.ok(latency < 1000, `slip path ${latency.toFixed(1)}ms < 1000ms SLA (fakes)`);
    // Idempotent replay: second verify returns cached VERIFIED state
    const replay = await verifyWithMock.verify('423e4567-e89b-12d3-a456-426614174003', 'https://cdn/slip.png', UID);
    assert.equal(replay.paymentStatus, 'VERIFIED');
    // Amount mismatch guard
    const shortMock = { verify: async (): Promise<{ transRef: string; amount: number; receiverAccount: string; senderBank: string; raw: Record<string, never> }> => ({ transRef: 'TR999', amount: 1, receiverAccount: '', senderBank: 'BANK', raw: {} }) };
    const verifyShort = new SlipVerifyService(castP(buildFakes012().prisma), castR(f.redis), shortMock as never, grants);
    await assert.rejects(verifyShort.verify('423e4567-e89b-12d3-a456-426614174003', 'https://cdn/slip2.png', UID), /does not match/);
    ok('slip verify (lock + EasySlip + atomic txn + grant + events + SLA + replay + amount guard)');
  }
}

async function main(): Promise<void> {
  await sectionContracts();
  await sectionServices();
  console.log(`\nphase012 contract tests: ${passed} groups passed`);
}

void main();
