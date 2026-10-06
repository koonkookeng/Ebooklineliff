// SSOT Phase 013 §10/Task 8 — dynamic QR + expiry + guard contract tests (loop 3x)
// Run: npx tsx scripts/test-phase013-contracts.ts
import assert from 'node:assert/strict';
import {
  PromptPayStatusEnum,
  CreatePromptPayQRInputSchema,
  PromptPayQRPayloadSchema,
  PromptPayExpiryStatusSchema,
  PROMPTPAY_RATE_LIMIT,
  PROMPTPAY_RATE_WINDOW_SEC,
  PROMPTPAY_FRAUD_STRIKES,
  PROMPTPAY_FRAUD_FREEZE_SEC,
} from '../packages/shared/src/schemas/promptpay.schema';
import { OrderStatusEnum } from '../packages/shared/src/schemas/sdid-contract';
import { calculateCRC16 } from '../apps/backend/src/modules/payment/utils/emvco-crc16.util';
import {
  crc16,
  buildPromptPayPayload,
  verifyPromptPayPayload,
} from '../apps/backend/src/modules/payment/services/promptpay-emv.builder';
import { PromptPayGuardService } from '../apps/backend/src/modules/payment/services/promptpay-guard.service';
import { PromptPayQrService } from '../apps/backend/src/modules/payment/services/promptpay-qr.service';
import { OrderExpiryService } from '../apps/backend/src/modules/order/services/order-expiry.service';
import { SlipVerifyService } from '../apps/backend/src/modules/order/services/slip-verify.service';
import { EntitlementGrantService } from '../apps/backend/src/modules/entitlement/services/entitlement-grant.service';
import type { PrismaService } from '../apps/backend/src/infra/database/prisma.service';
import type { RedisClusterService } from '../apps/backend/src/infra/redis/redis-cluster.service';

const UID = '123e4567-e89b-12d3-a456-426614174000';
const UID2 = '123e4567-e89b-12d3-a456-426614174099';
const OID = '423e4567-e89b-12d3-a456-426614174003';
const TID = '323e4567-e89b-12d3-a456-426614174002';
let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

// ---------- fakes ----------
interface FakeTxn {
  id: string; orderId: string; status: string; expiresAt: Date;
  baseAmount: number; fractionalCent: number; totalAmount: number;
  qrPayload: string; ref1: string; ref2: string | null; promptPayId: string;
}
interface FakeOrder {
  id: string; orderNumber: string; userId: string;
  netAmount: number; orderStatus: string; paymentStatus: string;
  orderItems: Array<{ productId: string }>;
}

function fakeRedis() {
  const store = new Map<string, string>();
  const events: Array<{ ch: string; msg: string }> = [];
  return {
    store,
    events,
    redis: {
      get: async (k: string): Promise<string | null> => store.get(k) ?? null,
      setex: async (k: string, _t: number, v: string): Promise<void> => { store.set(k, v); },
      setnx: async (k: string, v: string): Promise<boolean> => { if (store.has(k)) return false; store.set(k, v); return true; },
      del: async (k: string): Promise<void> => { store.delete(k); },
      publish: async (ch: string, msg: string): Promise<void> => { events.push({ ch, msg }); },
    },
  };
}

function fakePrisma(opts?: { orders?: FakeOrder[]; txns?: FakeTxn[]; clashAll?: boolean }) {
  const orders = new Map((opts?.orders ?? []).map((o) => [o.id, { ...o }]));
  const txns = new Map((opts?.txns ?? []).map((t) => [t.orderId, { ...t }]));
  const clashAll = opts?.clashAll ?? false;
  const api = {
    order: {
      findUnique: async (args: { where: { id: string } }): Promise<FakeOrder | null> => orders.get(args.where.id) ?? null,
      update: async (args: { where: { id: string }; data: Partial<FakeOrder> }): Promise<FakeOrder | null> => {
        const o = orders.get(args.where.id);
        if (o) Object.assign(o, args.data);
        return o ?? null;
      },
    },
    promptPayTransaction: {
      findFirst: async (args: { where: { orderId?: string; totalAmount?: number; status?: string; expiresAt?: unknown } }): Promise<FakeTxn | null> => {
        if (clashAll) return { id: 'clash', orderId: 'other', status: 'PENDING', expiresAt: new Date(Date.now() + 600_000), baseAmount: 0, fractionalCent: 0, totalAmount: args.where.totalAmount ?? 0, qrPayload: '', ref1: '', ref2: null, promptPayId: '' };
        for (const t of txns.values()) {
          if (args.where.orderId && t.orderId !== args.where.orderId) continue;
          if (args.where.status && t.status !== args.where.status) continue;
          if (args.where.totalAmount !== undefined && t.totalAmount !== args.where.totalAmount) continue;
          // Liveness applies only when the caller constrains expiresAt (allocator path).
          if (args.where.expiresAt && t.expiresAt.getTime() <= Date.now()) continue;
          return { ...t };
        }
        return null;
      },
      findUnique: async (args: { where: { orderId: string } }): Promise<FakeTxn | null> => {
        const t = txns.get(args.where.orderId);
        return t ? { ...t } : null;
      },
      findMany: async (args: { where: { status?: string } }): Promise<Array<{ orderId: string }>> =>
        [...txns.values()].filter((t) => !args.where.status || t.status === args.where.status).map((t) => ({ orderId: t.orderId })),
      upsert: async (args: { where: { orderId: string }; create: Record<string, unknown>; update: Record<string, unknown> }): Promise<{ expiresAt: Date }> => {
        const cur = txns.get(args.where.orderId);
        const merged = { ...(cur ?? { id: 'txn-new', orderId: args.where.orderId }), ...args.update, ...(!cur ? args.create : {}) } as FakeTxn;
        txns.set(args.where.orderId, merged);
        return { expiresAt: merged.expiresAt };
      },
      update: async (args: { where: { id: string }; data: Partial<FakeTxn> }): Promise<FakeTxn | null> => {
        for (const t of txns.values()) {
          if (t.id === args.where.id) {
            Object.assign(t, args.data);
            return { ...t };
          }
        }
        return null;
      },
      updateMany: async (args: { where: { orderId: string; status?: string }; data: Partial<FakeTxn> }): Promise<{ count: number }> => {
        let count = 0;
        for (const t of txns.values()) {
          if (t.orderId === args.where.orderId && (!args.where.status || t.status === args.where.status)) {
            Object.assign(t, args.data);
            count++;
          }
        }
        return { count };
      },
    },
    orderItem: { findMany: async (): Promise<Array<{ productId: string }>> => [] },
    paymentSlip: { upsert: async (): Promise<Record<string, never>> => ({}) },
    entitlement: {
      upsert: async (args: { create: { productId: string } }): Promise<{ productId: string }> => ({ productId: args.create.productId }),
      findUnique: async (): Promise<null> => null,
    },
    $transaction: (fn: (t: unknown) => Promise<unknown>): Promise<unknown> => fn(api),
  };
  return { api, orders, txns };
}

const castP = (v: unknown): PrismaService => v as PrismaService;
const castR = (v: unknown): RedisClusterService => v as RedisClusterService;

function pendingOrder(over?: Partial<FakeOrder>): FakeOrder {
  return {
    id: OID, orderNumber: 'EB20261006ABCDEF', userId: UID,
    netAmount: 500, orderStatus: 'PENDING_PAYMENT', paymentStatus: 'UNPAID', orderItems: [], ...over,
  };
}

// ---------- 1. Zod SSOT ----------
async function sectionContracts(): Promise<void> {
  {
    assert.deepEqual(PromptPayStatusEnum.options, ['PENDING', 'PAID', 'EXPIRED', 'CANCELLED']);
    assert.ok((OrderStatusEnum.options as readonly string[]).includes('EXPIRED'), 'Phase013 order EXPIRED');
    assert.equal(CreatePromptPayQRInputSchema.safeParse({ orderId: OID }).success, true);
    assert.equal(CreatePromptPayQRInputSchema.safeParse({ orderId: OID, expireMinutes: 3 }).success, false);
    assert.equal(CreatePromptPayQRInputSchema.safeParse({ orderId: OID, expireMinutes: 61 }).success, false);
    assert.equal(CreatePromptPayQRInputSchema.safeParse({ orderId: 'bad' }).success, false);
    const parsed = CreatePromptPayQRInputSchema.parse({ orderId: OID });
    assert.equal(parsed.expireMinutes, 15);
    assert.equal(parsed.useFractionalCent, true);
    assert.equal(PromptPayQRPayloadSchema.safeParse({
      qrCodePayload: '0002010', orderNumber: 'EB1', reference1: 'R1',
      baseAmount: 500, fractionalCent: 0.47, totalAmount: 500.47,
      expiresAt: new Date(Date.now() + 900_000).toISOString(), timeRemainingSec: 900,
    }).success, true);
    assert.equal(PromptPayExpiryStatusSchema.safeParse({ orderId: OID, status: 'PENDING', isExpired: false }).success, true);
    assert.equal(PromptPayExpiryStatusSchema.safeParse({ orderId: OID, status: 'NOPE', isExpired: false }).success, false);
    assert.equal(PROMPTPAY_RATE_LIMIT, 5);
    assert.equal(PROMPTPAY_RATE_WINDOW_SEC, 600);
    assert.equal(PROMPTPAY_FRAUD_STRIKES, 3);
    assert.equal(PROMPTPAY_FRAUD_FREEZE_SEC, 900);
    ok('Zod SSOT (promptpay schemas + EXPIRED + policy constants)');
  }

  // ---------- 2. CRC16 equivalence ----------
  {
    const vectors = ['', 'hello', '00020101021229370016A0000006770101110113006681234567853037645406199.005802TH62070015EB20261006ABCDEF6304'];
    for (const v of vectors) {
      assert.equal(calculateCRC16(v), crc16(v), `CRC match for len=${v.length}`);
    }
    const payload = buildPromptPayPayload({ proxyType: 'MOBILE', proxyValue: '0812345678' }, 500.47, 'EB20261006ABCDEF');
    assert.equal(payload.slice(-4), calculateCRC16(payload.slice(0, -4)), 'spec CRC verifies Phase012 payload');
    assert.equal(verifyPromptPayPayload(payload), true);
    ok('EMVCo CRC16 (spec algorithm == canonical crc16 + payload verify)');
  }
}

// ---------- 3. Guard: rate-limit + fraud ----------
async function sectionGuard(): Promise<void> {
  {
    const f = fakeRedis();
    const guard = new PromptPayGuardService(castR(f.redis));
    for (let i = 0; i < PROMPTPAY_RATE_LIMIT; i++) await guard.assertAllowed(UID);
    await assert.rejects(guard.assertAllowed(UID), /5 ครั้ง/);
    // window reset: backdate stamps beyond the window
    const old = JSON.stringify([Date.now() - (PROMPTPAY_RATE_WINDOW_SEC + 5) * 1000]);
    f.store.set(`pp_rl:{${UID}}`, old);
    await guard.assertAllowed(UID);
    ok('guard rate-limit (5/10min cap + window prune)');
  }
  {
    const f = fakeRedis();
    const guard = new PromptPayGuardService(castR(f.redis));
    await guard.assertAllowed(UID2);
    await guard.recordSlipFailure(UID2);
    await guard.recordSlipFailure(UID2);
    await guard.assertAllowed(UID2);
    await guard.recordSlipFailure(UID2);
    await assert.rejects(guard.assertAllowed(UID2), /ระงับ/);
    await guard.clearOnSuccess(UID2);
    await guard.assertAllowed(UID2);
    await assert.rejects(guard.assertAllowed(''), /Missing user id/);
    ok('guard fraud (3 strikes → 15min freeze → clear on success)');
  }
}

// ---------- 4. QR service: generate + status ----------
async function sectionQr(): Promise<void> {
  process.env.COMPANY_PROMPTPAY_ID = '0812345678';
  process.env.COMPANY_PROMPTPAY_TYPE = 'MOBILE';
  {
    const f = fakeRedis();
    const p = fakePrisma({ orders: [pendingOrder()] });
    const guard = new PromptPayGuardService(castR(f.redis));
    const expiry = new OrderExpiryService(castP(p.api), castR(f.redis));
    const svc = new PromptPayQrService(castP(p.api), castR(f.redis), guard, expiry);
    const t0 = performance.now();
    const qr = await svc.generateDynamicQR(UID, { orderId: OID });
    const ms = performance.now() - t0;
    assert.ok(qr.totalAmount > 500 && qr.totalAmount < 501, `fractional total ${qr.totalAmount}`);
    assert.ok(qr.fractionalCent >= 0.01 && qr.fractionalCent <= 0.99);
    assert.equal(qr.baseAmount, 500);
    assert.equal(qr.reference1, 'EB20261006ABCDEF'.replace(/[^a-zA-Z0-9]/g, '').slice(-15));
    assert.equal(qr.timeRemainingSec, 900);
    assert.ok(verifyPromptPayPayload(qr.qrCodePayload), 'payload CRC valid');
    assert.ok(ms < 100, `generate ${ms.toFixed(1)}ms < 100ms self-heal budget`);
    assert.ok(f.store.has(`pp_expiry:${OID}`), 'Redis TTL key set');
    assert.ok(f.events.some((e) => e.ch === 'stream:payment:qr-generated'), 'generated event');
    const st = await svc.getStatus(UID, OID);
    assert.equal(st.status, 'PENDING');
    assert.equal(st.isExpired, false);
    ok('qr generate (fractional + CRC + TTL + events + status, <100ms)');
  }
  {
    // uniqueness across live totals: 25 distinct orders never share a total
    const f = fakeRedis();
    const ids = Array.from({ length: 25 }, (_, i) => `423e4567-e89b-12d3-a456-4266141740${String(i).padStart(2, '0')}`);
    const p = fakePrisma({ orders: ids.map((id) => ({ ...pendingOrder(), id })) });
    const guard = new PromptPayGuardService(castR(f.redis));
    const expiry = new OrderExpiryService(castP(p.api), castR(f.redis));
    const svc = new PromptPayQrService(castP(p.api), castR(f.redis), guard, expiry);
    const totals = new Set<number>();
    for (const id of ids) {
      f.store.delete(`pp_rl:{${UID}}`);
      const qr = await svc.generateDynamicQR(UID, { orderId: id });
      assert.ok(!totals.has(qr.totalAmount), `no repeat total (${qr.totalAmount})`);
      totals.add(qr.totalAmount);
    }
    ok('fractional allocator (25 distinct orders, zero collisions)');
  }
  {
    // saturated pool → 0.00 fallback + collision alert
    const f = fakeRedis();
    const p = fakePrisma({ orders: [pendingOrder()], clashAll: true });
    const guard = new PromptPayGuardService(castR(f.redis));
    const expiry = new OrderExpiryService(castP(p.api), castR(f.redis));
    const svc = new PromptPayQrService(castP(p.api), castR(f.redis), guard, expiry);
    const qr = await svc.generateDynamicQR(UID, { orderId: OID });
    assert.equal(qr.fractionalCent, 0);
    assert.equal(qr.totalAmount, 500);
    assert.ok(f.events.some((e) => e.ch === 'stream:payment:fractional-collision'));
    ok('fractional fallback (saturated pool → 0.00 + collision event)');
  }
  {
    // guards: wrong owner / paid order / bad input / missing merchant
    const f = fakeRedis();
    const p = fakePrisma({ orders: [pendingOrder(), pendingOrder({ id: 'other', userId: UID2, orderStatus: 'COMPLETED', paymentStatus: 'VERIFIED' })] });
    const guard = new PromptPayGuardService(castR(f.redis));
    const expiry = new OrderExpiryService(castP(p.api), castR(f.redis));
    const svc = new PromptPayQrService(castP(p.api), castR(f.redis), guard, expiry);
    await assert.rejects(svc.generateDynamicQR(UID, { orderId: '723e4567-e89b-12d3-a456-426614174007' }), /not found/i);
    await assert.rejects(svc.generateDynamicQR(UID2, { orderId: OID }), /not found/i);
    const PAID_OID = '823e4567-e89b-12d3-a456-426614174008';
    const paid = fakePrisma({ orders: [pendingOrder({ id: PAID_OID, orderStatus: 'COMPLETED', paymentStatus: 'VERIFIED' })] });
    const svcPaid = new PromptPayQrService(castP(paid.api), castR(f.redis), guard, expiry);
    await assert.rejects(svcPaid.generateDynamicQR(UID, { orderId: PAID_OID }), /ชำระเงินแล้ว/);
    await assert.rejects(svc.generateDynamicQR('', { orderId: OID }), /Missing user id/);
    await assert.rejects(svc.generateDynamicQR(UID, { orderId: 'bad' }), /Invalid QR/);
    delete process.env.COMPANY_PROMPTPAY_ID;
    await assert.rejects(svc.generateDynamicQR(UID, { orderId: OID, useFractionalCent: false }), /not configured/);
    process.env.COMPANY_PROMPTPAY_ID = '0812345678';
    ok('qr guards (owner + payable-state + input + merchant config)');
  }
  {
    // regenerate from EXPIRED resets the order atomically
    const f = fakeRedis();
    const p = fakePrisma({ orders: [pendingOrder({ orderStatus: 'EXPIRED' })] });
    const guard = new PromptPayGuardService(castR(f.redis));
    const expiry = new OrderExpiryService(castP(p.api), castR(f.redis));
    const svc = new PromptPayQrService(castP(p.api), castR(f.redis), guard, expiry);
    const qr = await svc.generateDynamicQR(UID, { orderId: OID });
    assert.ok(qr.totalAmount >= 500);
    assert.equal(p.orders.get(OID)?.orderStatus, 'PENDING_PAYMENT');
    assert.equal(p.orders.get(OID)?.paymentStatus, 'UNPAID');
    ok('qr regenerate (EXPIRED → PENDING_PAYMENT + UNPAID reset)');
  }
}

// ---------- 5. Expiry lifecycle ----------
async function sectionExpiry(): Promise<void> {
  {
    const f = fakeRedis();
    const past = new Date(Date.now() - 1000);
    const txn: FakeTxn = { id: 'txn-1', orderId: OID, status: 'PENDING', expiresAt: past, baseAmount: 500, fractionalCent: 0.47, totalAmount: 500.47, qrPayload: 'p', ref1: 'R', ref2: null, promptPayId: '0812345678' };
    const p = fakePrisma({ orders: [pendingOrder()], txns: [txn] });
    const expiry = new OrderExpiryService(castP(p.api), castR(f.redis));
    const r = await expiry.expireOrder(OID);
    assert.equal(r.expired, true);
    assert.equal(p.txns.get(OID)?.status, 'EXPIRED', 'slot released');
    assert.equal(p.orders.get(OID)?.orderStatus, 'EXPIRED');
    assert.ok(f.events.some((e) => e.ch === 'stream:payment:qr-expired'));
    assert.ok(f.events.some((e) => e.ch === 'stream:notify:order-expired'));
    const again = await expiry.expireOrder(OID);
    assert.equal(again.expired, false, 'idempotent replay');
    ok('expiry (atomic flip + slot release + dual events + idempotent)');
  }
  {
    // never expires paid/completed money; skips live QR
    const f = fakeRedis();
    const p = fakePrisma({
      orders: [pendingOrder({ id: 'paid', orderStatus: 'COMPLETED', paymentStatus: 'VERIFIED' })],
      txns: [{ id: 't-paid', orderId: 'paid', status: 'PAID', expiresAt: new Date(Date.now() - 5000), baseAmount: 1, fractionalCent: 0, totalAmount: 1, qrPayload: '', ref1: '', ref2: null, promptPayId: '' }],
    });
    const expiry = new OrderExpiryService(castP(p.api), castR(f.redis));
    assert.equal((await expiry.expireOrder('paid')).expired, false);
    assert.equal((await expiry.expireOrder('missing')).expired, false);
    assert.equal((await expiry.expireOrder('')).expired, false);
    const live = fakePrisma({
      orders: [pendingOrder()],
      txns: [{ id: 't-live', orderId: OID, status: 'PENDING', expiresAt: new Date(Date.now() + 600_000), baseAmount: 500, fractionalCent: 0.1, totalAmount: 500.1, qrPayload: '', ref1: '', ref2: null, promptPayId: '' }],
    });
    const expiryLive = new OrderExpiryService(castP(live.api), castR(f.redis));
    assert.equal((await expiryLive.expireOrder(OID)).expired, false, 'live QR untouched');
    ok('expiry guards (paid/missing/live never transition)');
  }
  {
    // sweeper picks only due rows; lazy status flips past-due inline
    const f = fakeRedis();
    const p = fakePrisma({
      orders: [pendingOrder(), pendingOrder({ id: 'o-live', orderStatus: 'PENDING_PAYMENT' })],
      txns: [
        { id: 't-due', orderId: OID, status: 'PENDING', expiresAt: new Date(Date.now() - 1000), baseAmount: 500, fractionalCent: 0.2, totalAmount: 500.2, qrPayload: '', ref1: '', ref2: null, promptPayId: '' },
        { id: 't-live', orderId: 'o-live', status: 'PENDING', expiresAt: new Date(Date.now() + 600_000), baseAmount: 100, fractionalCent: 0.3, totalAmount: 100.3, qrPayload: '', ref1: '', ref2: null, promptPayId: '' },
      ],
    });
    const expiry = new OrderExpiryService(castP(p.api), castR(f.redis));
    const swept = await expiry.sweepExpired(50);
    assert.deepEqual(swept.swept, [OID]);
    assert.equal(p.orders.get('o-live')?.orderStatus, 'PENDING_PAYMENT');
    const stop = expiry.startSweeper(60_000);
    stop();
    await expiry.handleTtlKey('o-live');
    assert.equal(p.orders.get('o-live')?.orderStatus, 'PENDING_PAYMENT', 'keyspace entry respects liveness');
    ok('sweeper (due-only sweep + stopper + keyspace entry)');
  }
  {
    // lazy status: past-due PENDING → EXPIRED via getStatus
    const f = fakeRedis();
    const p = fakePrisma({
      orders: [pendingOrder()],
      txns: [{ id: 't-due', orderId: OID, status: 'PENDING', expiresAt: new Date(Date.now() - 1000), baseAmount: 500, fractionalCent: 0.2, totalAmount: 500.2, qrPayload: '', ref1: '', ref2: null, promptPayId: '' }],
    });
    const guard = new PromptPayGuardService(castR(f.redis));
    const expiry = new OrderExpiryService(castP(p.api), castR(f.redis));
    const svc = new PromptPayQrService(castP(p.api), castR(f.redis), guard, expiry);
    const st = await svc.getStatus(UID, OID);
    assert.equal(st.status, 'EXPIRED');
    assert.equal(st.isExpired, true);
    ok('lazy expiry (getStatus flips past-due PENDING → EXPIRED)');
  }
}

// ---------- 6. Slip-verify × fractional integration ----------
async function sectionSlip(): Promise<void> {
  const mockEasyslip = (amount: number) => ({
    verify: async (): Promise<{ transRef: string; amount: number; receiverAccount: string; senderBank: string; raw: Record<string, never> }> => ({
      transRef: 'TR123', amount, receiverAccount: '', senderBank: 'BANK', raw: {},
    }),
  });
  const grants = (redis: unknown): EntitlementGrantService => new EntitlementGrantService(castR(redis));
  {
    // slip below QR total (500.00 vs 500.47) → rejected + fraud strike
    const f = fakeRedis();
    const p = fakePrisma({
      orders: [pendingOrder()],
      txns: [{ id: 't1', orderId: OID, status: 'PENDING', expiresAt: new Date(Date.now() + 600_000), baseAmount: 500, fractionalCent: 0.47, totalAmount: 500.47, qrPayload: '', ref1: '', ref2: null, promptPayId: '' }],
    });
    const guard = new PromptPayGuardService(castR(f.redis));
    const verify = new SlipVerifyService(castP(p.api), castR(f.redis), mockEasyslip(500) as never, grants(f.redis), guard);
    await assert.rejects(verify.verify(OID, 'https://cdn/slip.png', UID), /does not match/);
    const fraud = JSON.parse(f.store.get(`pp_fraud:{${UID}}`) ?? '{}') as { strikes?: number };
    assert.equal(fraud.strikes, 1);
    ok('slip × fractional (underpay vs QR total rejected + strike)');
  }
  {
    // exact fractional amount → VERIFIED + txn PAID + strikes cleared
    const f = fakeRedis();
    f.store.set(`pp_fraud:{${UID}}`, JSON.stringify({ strikes: 2, suspendedUntil: 0 }));
    const p = fakePrisma({
      orders: [pendingOrder()],
      txns: [{ id: 't1', orderId: OID, status: 'PENDING', expiresAt: new Date(Date.now() + 600_000), baseAmount: 500, fractionalCent: 0.47, totalAmount: 500.47, qrPayload: '', ref1: '', ref2: null, promptPayId: '' }],
    });
    const guard = new PromptPayGuardService(castR(f.redis));
    const verify = new SlipVerifyService(castP(p.api), castR(f.redis), mockEasyslip(500.47) as never, grants(f.redis), guard);
    const res = await verify.verify(OID, 'https://cdn/slip.png', UID);
    assert.equal(res.paymentStatus, 'VERIFIED');
    assert.equal(p.txns.get(OID)?.status, 'PAID', 'QR lifecycle closed');
    assert.equal(f.store.has(`pp_fraud:{${UID}}`), false, 'strikes cleared');
    ok('slip × fractional (exact 500.47 VERIFIED + PAID + fraud cleared)');
  }
  {
    // EXPIRED orders cannot verify — regenerate first
    const f = fakeRedis();
    const p = fakePrisma({ orders: [pendingOrder({ orderStatus: 'EXPIRED' })] });
    const guard = new PromptPayGuardService(castR(f.redis));
    const verify = new SlipVerifyService(castP(p.api), castR(f.redis), mockEasyslip(500) as never, grants(f.redis), guard);
    await assert.rejects(verify.verify(OID, 'https://cdn/slip.png', UID), /หมดอายุ/);
    ok('slip × expiry (EXPIRED order rejected until regenerate)');
  }
}

async function main(): Promise<void> {
  await sectionContracts();
  await sectionGuard();
  await sectionQr();
  await sectionExpiry();
  await sectionSlip();
  console.log(`\nphase013 contract tests: ${passed} groups passed`);
}

void main();
