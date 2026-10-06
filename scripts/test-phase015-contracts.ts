// SSOT Phase 015 §10/Task 15.8 — atomic outbox + concurrency contracts (loop 3x)
// Run: npx tsx scripts/test-phase015-contracts.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  SlipVerificationRequestSchema,
  EasySlipBankDetailSchema,
  EasySlipResponseDataSchema,
  EasySlipVerifyResultSchema,
  SlipAtomicResponseSchema,
  OutboxEventTypeEnum,
  SlipRetryJobSchema,
} from '../packages/shared/src/schemas/payment-slip.schema';
import { EasySlipProvider } from '../apps/backend/src/modules/payment/providers/easyslip.provider';
import { EasySlipVerifyAdapter } from '../apps/backend/src/modules/payment/services/easyslip-verify.adapter';
import { SlipVerifyService } from '../apps/backend/src/modules/order/services/slip-verify.service';
import { OrderAtomicService } from '../apps/backend/src/modules/order/services/order-atomic.service';
import { EntitlementService } from '../apps/backend/src/modules/entitlement/services/entitlement.service';
import { EntitlementGrantService } from '../apps/backend/src/modules/entitlement/services/entitlement-grant.service';
import type { PrismaService } from '../apps/backend/src/infra/database/prisma.service';
import type { RedisClusterService } from '../apps/backend/src/infra/redis/redis-cluster.service';

const UID = '123e4567-e89b-12d3-a456-426614174000';
const OID = '423e4567-e89b-12d3-a456-426614174003';
const PID = '223e4567-e89b-12d3-a456-426614174001';
const PID2 = '223e4567-e89b-12d3-a456-426614174002';
const TID = 'tenant-acme';
let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

// ---------- fakes ----------
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

interface FakeOutboxRow {
  id: string; aggregateType: string; aggregateId: string; orderId: string | null;
  eventType: string; payload: unknown; isProcessed: boolean; processedAt: Date | null; createdAt: Date;
}

function fakePrisma(orderIds: string[] = [OID], opts?: { txThrows?: unknown }) {
  const orders = new Map<string, Record<string, unknown>>(
    orderIds.map((id, i) => [id, {
      id, orderNumber: `ORD-${i}`, userId: UID, netAmount: 450,
      orderStatus: 'PENDING_PAYMENT', paymentStatus: 'UNPAID', orderItems: [{ productId: PID }],
    }]),
  );
  const slips: unknown[] = [];
  const outbox: FakeOutboxRow[] = [];
  let seq = 0;
  const api = {
    order: {
      findUnique: async (args: { where: { id: string } }): Promise<Record<string, unknown> | null> => orders.get(args.where.id) ?? null,
      update: async (args: { where: { id: string }; data: Record<string, unknown> }): Promise<Record<string, never>> => {
        const o = orders.get(args.where.id);
        if (o) Object.assign(o, args.data);
        return {};
      },
    },
    orderItem: { findMany: async (): Promise<unknown[]> => [] },
    paymentSlip: {
      upsert: async (args: { where: { orderId: string }; create: Record<string, unknown>; update: Record<string, unknown> }): Promise<Record<string, never>> => {
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
      findMany: async (args: { where: { userId: string; productId: { in: string[] } } }): Promise<Array<{ id: string; productId: string; createdAt: Date }>> =>
        args.where.productId.in.map((pid) => ({ id: `ent-${pid.slice(0, 8)}`, productId: pid, createdAt: new Date('2026-10-06T12:00:00Z') })),
      upsert: async (args: { create: { productId: string } }): Promise<{ productId: string }> => ({ productId: args.create.productId }),
      findUnique: async (): Promise<null> => null,
    },
    product: {
      findMany: async (args: { where: { id: { in: string[] } } }): Promise<Array<{ id: string; title: string; productType: string }>> =>
        args.where.id.in.filter((id) => id === PID).map((id) => ({ id, title: 'Ebook A', productType: 'EBOOK' })),
    },
    outboxEvent: {
      create: async (args: { data: Record<string, unknown> }): Promise<{ id: string }> => {
        const row: FakeOutboxRow = {
          id: `obx-${++seq}`, aggregateType: String(args.data.aggregateType), aggregateId: String(args.data.aggregateId),
          orderId: (args.data.orderId as string | undefined) ?? null, eventType: String(args.data.eventType),
          payload: args.data.payload, isProcessed: false, processedAt: null, createdAt: new Date(),
        };
        outbox.push(row);
        return { id: row.id };
      },
      findMany: async (args: { where: { eventType?: string; isProcessed?: boolean }; take?: number }): Promise<FakeOutboxRow[]> => {
        let rows = [...outbox];
        if (args.where.eventType) rows = rows.filter((r) => r.eventType === args.where.eventType);
        if (args.where.isProcessed !== undefined) rows = rows.filter((r) => r.isProcessed === args.where.isProcessed);
        rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        return args.where && args.take ? rows.slice(0, args.take) : rows;
      },
      update: async (args: { where: { id: string }; data: Partial<FakeOutboxRow> }): Promise<Record<string, never>> => {
        const r = outbox.find((x) => x.id === args.where.id);
        if (r) Object.assign(r, args.data);
        return {};
      },
    },
    $transaction: (fn: (t: unknown) => Promise<unknown>): Promise<unknown> => {
      if (opts?.txThrows) return Promise.reject(opts.txThrows);
      return fn(api);
    },
  };
  return { api, orders, slips, outbox };
}

const castP = (v: unknown): PrismaService => v as PrismaService;
const castR = (v: unknown): RedisClusterService => v as RedisClusterService;
const grants = (redis: unknown): EntitlementGrantService => new EntitlementGrantService(castR(redis));

const bankDetail = (account: string, name: string): Record<string, unknown> => ({
  type: 'BANKAC',
  account: { name: { th: null, en: 'Name' }, bank: { id: '014', name, account } },
});

// ---------- 1. Zod SSOT ----------
async function sectionContracts(): Promise<void> {
  {
    assert.equal(SlipVerificationRequestSchema.safeParse({ orderId: OID, slipImageUrl: 'https://cdn/s.png' }).success, true);
    assert.equal(SlipVerificationRequestSchema.safeParse({ orderId: OID, slipImageUrl: 'https://cdn/s.png', userNote: 'x'.repeat(256) }).success, false);
    assert.equal(SlipVerificationRequestSchema.safeParse({ orderId: 'bad', slipImageUrl: 'https://cdn/s.png' }).success, false);
    const nested = {
      status: 200, message: 'ok',
      data: {
        transRef: 'T1', date: '2026-10-06', countryCode: 'TH',
        amount: { amount: 450, local: { amount: 450, currency: 'THB' } },
        sender: bankDetail('111', 'KBANK'), receiver: bankDetail('222', 'SCB'),
      },
    };
    assert.equal(EasySlipBankDetailSchema.safeParse(bankDetail('111', 'KBANK')).success, true);
    assert.equal(EasySlipResponseDataSchema.safeParse(nested.data).success, true);
    assert.equal(EasySlipVerifyResultSchema.safeParse(nested).success, true);
    assert.equal(EasySlipVerifyResultSchema.safeParse({ status: 200 }).success, false);
    assert.equal(SlipAtomicResponseSchema.safeParse({
      success: true, message: 'ok', orderId: OID, orderStatus: 'COMPLETED',
      transactionRef: 'T1', entitlementsGranted: [PID], processingTimeMs: 320,
    }).success, true);
    assert.equal(SlipAtomicResponseSchema.safeParse({
      success: true, message: 'ok', orderId: OID, orderStatus: 'REFUNDED',
      entitlementsGranted: [], processingTimeMs: 1,
    }).success, false, 'subset orderStatus only');
    assert.deepEqual(OutboxEventTypeEnum.options, ['PAYMENT_VERIFIED_ENTITLEMENT_GRANTED', 'SLIP_VERIFY_RETRY']);
    const job = SlipRetryJobSchema.parse({ orderId: OID, slipImageUrl: 'https://cdn/s.png', actorUserId: UID, nextRunAt: new Date(Date.now() + 30_000).toISOString() });
    assert.equal(job.attempts, 0);
    assert.equal(job.maxAttempts, 3);
    assert.equal(SlipRetryJobSchema.safeParse({ orderId: OID, slipImageUrl: 'bad', actorUserId: UID, nextRunAt: new Date().toISOString() }).success, false);
    ok('Zod SSOT (015 request/nested/response/outbox/retry shapes)');
  }
  {
    // SDL supplements carry the 015 enrichment
    const orderSDL = fs.readFileSync('apps/backend/src/api/graphql/schemas/order.graphql/schema.graphql', 'utf8');
    assert.ok(orderSDL.includes('EntitlementGrantResult'));
    assert.ok(orderSDL.includes('processingTimeMs'));
    const paySDL = fs.readFileSync('apps/backend/src/api/graphql/schemas/payment.graphql/schema.graphql', 'utf8');
    assert.ok(paySDL.includes('paymentVerificationStatus'));
    ok('GQL SDL (grant rows + timing + status query present)');
  }
}

// ---------- 2. Provider nested-schema path ----------
async function sectionProvider(): Promise<void> {
  {
    const seen: unknown[] = [];
    const prev = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init: unknown) => {
      seen.push(JSON.parse(String((init as Record<string, unknown>).body)));
      return {
        ok: true,
        json: async () => ({
          status: 200, message: 'ok',
          data: {
            transRef: 'NESTED1', date: '2026-10-06', countryCode: 'TH',
            amount: { amount: 450, local: { amount: 450, currency: 'THB' } },
            sender: bankDetail('1111111111', 'KBANK'),
            receiver: bankDetail('2222222222', 'SCB'),
          },
        }),
      };
    }) as typeof fetch;
    try {
      const provider = new EasySlipProvider();
      const res = await provider.verifySlipUrl('https://cdn/s.png');
      assert.equal(res.data?.transRef, 'NESTED1');
      assert.equal(res.data?.receivingBank, 'SCB', 'nested bank name mapped (not UNKNOWN)');
      assert.equal(res.data?.amount.value, 450);
      const adapter = new EasySlipVerifyAdapter(provider);
      const slip = await adapter.verify('https://cdn/s.png');
      assert.equal(slip.senderBank, 'KBANK');
      assert.deepEqual(seen[0], { image_url: 'https://cdn/s.png' });
    } finally {
      globalThis.fetch = prev;
    }
    ok('provider nested path (schema-validated vendor shape → spec contract)');
  }
}

// ---------- 3. EntitlementService ----------
async function sectionEntitlements(): Promise<void> {
  {
    const p = fakePrisma();
    const svc = new EntitlementService(castP(p.api));
    assert.deepEqual(await svc.listGrantResults(UID, []), []);
    assert.deepEqual(await svc.listGrantResults('', [PID]), []);
    const rows = await svc.listGrantResults(UID, [PID, PID2, PID]);
    assert.equal(rows.length, 2, 'dedupe repeat productIds');
    assert.equal(rows[0]?.productTitle, 'Ebook A');
    assert.equal(rows[0]?.productType, 'EBOOK');
    assert.equal(rows[1]?.productTitle, PID2, 'unknown product falls back to id');
    ok('entitlement read (enriched grant rows + dedupe + fallback)');
  }
}

// ---------- 4. Outbox + retry worker ----------
async function sectionAtomic(): Promise<void> {
  {
    const f = fakeRedis();
    const p = fakePrisma();
    const atomic = new OrderAtomicService(castP(p.api), castR(f.redis));
    const good = await atomic.recordGrantCompleted(p.api, {
      success: true, message: 'ok', orderId: OID, orderStatus: 'COMPLETED',
      transactionRef: 'T1', entitlementsGranted: [PID], processingTimeMs: 300,
    });
    assert.equal(good.recorded, true);
    assert.equal(p.outbox.length, 1);
    assert.equal(p.outbox[0]?.eventType, 'PAYMENT_VERIFIED_ENTITLEMENT_GRANTED');
    const bad = await atomic.recordGrantCompleted(p.api, { success: true, orderId: OID, orderStatus: 'REFUNDED' });
    assert.equal(bad.recorded, false, 'drift never fails the payment path');
    assert.ok(f.events.some((e) => e.ch === 'stream:monitor:contract-drift'));
    ok('outbox write (validated completion + drift-safe)');
  }
  {
    const f = fakeRedis();
    const p = fakePrisma();
    const atomic = new OrderAtomicService(castP(p.api), castR(f.redis));
    assert.deepEqual(await atomic.enqueueSlipRetry({ orderId: 'bad', slipImageUrl: 'https://cdn/s.png', actorUserId: UID }), { queued: false });
    assert.deepEqual(await atomic.enqueueSlipRetry({ orderId: OID, slipImageUrl: 'https://cdn/s.png', actorUserId: UID }), { queued: true });
    assert.deepEqual(await atomic.enqueueSlipRetry({ orderId: OID, slipImageUrl: 'https://cdn/s.png', actorUserId: UID }), { queued: false }, 'idempotent while pending');
    assert.ok(f.events.some((e) => e.ch === 'stream:payment:slip-retry-enqueued'));
    const stop = atomic.startOutboxWorker(60_000);
    stop();
    ok('retry enqueue (validated + idempotent + event + worker starter)');
  }
  {
    const f = fakeRedis();
    const p = fakePrisma();
    const atomic = new OrderAtomicService(castP(p.api), castR(f.redis));
    await atomic.recordGrantCompleted(p.api, {
      success: true, message: 'ok', orderId: OID, orderStatus: 'COMPLETED',
      transactionRef: 'T1', entitlementsGranted: [PID], processingTimeMs: 300,
    });
    await atomic.enqueueSlipRetry({ orderId: OID, slipImageUrl: 'https://cdn/s.png', actorUserId: UID });
    const { dispatched } = await atomic.dispatchPending(50);
    assert.equal(dispatched.length, 1, 'retry rows skipped by dispatcher');
    assert.ok(f.events.some((e) => e.ch === 'stream:outbox:PAYMENT_VERIFIED_ENTITLEMENT_GRANTED'));
    assert.equal(p.outbox.find((r) => r.eventType === 'PAYMENT_VERIFIED_ENTITLEMENT_GRANTED')?.isProcessed, true);
    assert.equal(p.outbox.find((r) => r.eventType === 'SLIP_VERIFY_RETRY')?.isProcessed, false);
    ok('dispatch (namespaced stream + retry skip + processed marks)');
  }
  {
    // drain: due success / not-due skip / exhausted → FAILED
    const f = fakeRedis();
    const p = fakePrisma();
    const atomic = new OrderAtomicService(castP(p.api), castR(f.redis));
    await atomic.enqueueSlipRetry({ orderId: OID, slipImageUrl: 'https://cdn/s.png', actorUserId: UID });
    p.outbox[0].payload = { ...(p.outbox[0]?.payload as object), nextRunAt: new Date(Date.now() - 1000).toISOString() };
    const okVerify = async (): Promise<{ success: boolean }> => ({ success: true });
    const r1 = await atomic.drainSlipRetries(10, okVerify);
    assert.deepEqual([r1.processed, r1.succeeded], [1, 1]);

    await atomic.enqueueSlipRetry({ orderId: OID, slipImageUrl: 'https://cdn/s.png', actorUserId: UID });
    const last = p.outbox[p.outbox.length - 1];
    if (last) last.payload = { ...(last.payload as object), nextRunAt: new Date(Date.now() - 1000).toISOString(), attempts: 2 };
    const failVerify = async (): Promise<{ success: boolean }> => ({ success: false });
    const r2 = await atomic.drainSlipRetries(10, failVerify);
    assert.equal(r2.exhausted, 1);
    assert.equal(p.orders.get(OID)?.paymentStatus, 'FAILED');

    await atomic.enqueueSlipRetry({ orderId: OID, slipImageUrl: 'https://cdn/s.png', actorUserId: UID });
    const future = p.outbox[p.outbox.length - 1];
    if (future) future.payload = { ...(future.payload as object), nextRunAt: new Date(Date.now() + 600_000).toISOString() };
    const r3 = await atomic.drainSlipRetries(10, okVerify);
    assert.equal(r3.processed, 0, 'not-due rows untouched');

    const before = p.outbox.length;
    p.outbox.push({
      id: 'obx-bad', aggregateType: 'ORDER', aggregateId: OID, orderId: OID,
      eventType: 'SLIP_VERIFY_RETRY', payload: { nope: true }, isProcessed: false, processedAt: null, createdAt: new Date(),
    });
    const r4 = await atomic.drainSlipRetries(10, okVerify);
    assert.equal(p.outbox.length, before + 1, 'corrupt row marked, not retried');
    assert.equal(r4.processed, 1);
    ok('retry drain (success / not-due / exhaust→FAILED / corrupt)');
  }
}

// ---------- 5. Verify integration: outbox-in-txn + P2002 + retry enqueue ----------
async function sectionVerify(): Promise<void> {
  const mockEasyslip = (transRef: string, amount: number): EasySlipVerifyAdapter => ({
    verify: async (): Promise<{ transRef: string; amount: number; receiverAccount: string; senderBank: string; raw: Record<string, never> }> => ({
      transRef, amount, receiverAccount: '', senderBank: 'BANK', raw: {},
    }),
  }) as unknown as EasySlipVerifyAdapter;

  {
    const f = fakeRedis();
    const p = fakePrisma();
    const atomic = new OrderAtomicService(castP(p.api), castR(f.redis));
    const verify = new SlipVerifyService(castP(p.api), castR(f.redis), mockEasyslip('ATOMIC1', 450), grants(f.redis), undefined, atomic);
    const res = await verify.verify(OID, 'https://cdn/s.png', UID);
    assert.equal(res.success, true);
    const row = p.outbox.find((r) => r.eventType === 'PAYMENT_VERIFIED_ENTITLEMENT_GRANTED');
    assert.ok(row, 'outbox row written inside the atomic txn');
    assert.equal((row?.payload as { transactionRef?: string }).transactionRef, 'ATOMIC1');
    assert.deepEqual((row?.payload as { entitlementsGranted?: string[] }).entitlementsGranted, [PID]);
    ok('verify → outbox row (validated payload in-txn)');
  }
  {
    const f = fakeRedis();
    const p = fakePrisma([OID], { txThrows: { code: 'P2002' } });
    const verify = new SlipVerifyService(castP(p.api), castR(f.redis), mockEasyslip('RACE1', 450), grants(f.redis));
    await assert.rejects(verify.verify(OID, 'https://cdn/s.png', UID), /ใช้ซ้ำ/);
    ok('P2002 backstop → 409 Conflict (never 500)');
  }
  {
    const f = fakeRedis();
    const p = fakePrisma();
    const atomic = new OrderAtomicService(castP(p.api), castR(f.redis));
    const down = {
      verify: async (): Promise<never> => {
        const { SlipUnverifiableError: E } = await import('../apps/backend/src/modules/payment/providers/easyslip.provider');
        throw new E('EasySlip timeout');
      },
    } as unknown as EasySlipVerifyAdapter;
    const verify = new SlipVerifyService(castP(p.api), castR(f.redis), down, grants(f.redis), undefined, atomic);
    await assert.rejects(verify.verify(OID, 'https://cdn/s.png', UID), /timeout/);
    assert.equal(p.orders.get(OID)?.paymentStatus, 'PENDING_SLIP', 'buyer stays retryable');
    assert.ok(p.outbox.some((r) => r.eventType === 'SLIP_VERIFY_RETRY'), 'retry enqueued for 30s re-drive');
    ok('provider outage → retryable order + retry row');
  }
}

// ---------- 6. Concurrency: 20 parallel same-slip verifies ----------
async function sectionConcurrency(): Promise<void> {
  {
    const ids = Array.from({ length: 20 }, (_, i) => `523e4567-e89b-12d3-a456-426614174${String(i).padStart(3, '0')}`);
    const f = fakeRedis();
    const p = fakePrisma(ids);
    const sharedAdapter = {
      verify: async (): Promise<{ transRef: string; amount: number; receiverAccount: string; senderBank: string; raw: Record<string, never> }> => ({
        transRef: 'CONCURRENT9', amount: 450, receiverAccount: '', senderBank: 'BANK', raw: {},
      }),
    } as unknown as EasySlipVerifyAdapter;
    const t0 = performance.now();
    const results = await Promise.all(ids.map(async (id) => {
      const verify = new SlipVerifyService(castP(p.api), castR(f.redis), sharedAdapter, grants(f.redis));
      try {
        await verify.verify(id, `https://cdn/${id}.png`, UID);
        return 'ok';
      } catch (e) {
        return (e as Error).message;
      }
    }));
    const wall = performance.now() - t0;
    const wins = results.filter((r) => r === 'ok');
    const replays = results.filter((r) => r.includes('SLIP_ALREADY_USED'));
    assert.equal(wins.length, 1, 'exactly one winner');
    assert.equal(replays.length, 19, 'nineteen 409 replays');
    assert.equal(p.slips.length, 1, 'single payment slip row');
    const completed = [...p.orders.values()].filter((o) => o.orderStatus === 'COMPLETED');
    assert.equal(completed.length, 1, 'single COMPLETED order, no double grant');
    assert.ok(wall < 800, `20-way race resolves in ${wall.toFixed(1)}ms < 800ms`);
    ok('concurrency (20-way same-slip race → 1 win + 19×409 + no double grant)');
  }
}

async function main(): Promise<void> {
  await sectionContracts();
  await sectionProvider();
  await sectionEntitlements();
  await sectionAtomic();
  await sectionVerify();
  await sectionConcurrency();
  console.log(`\nphase015 contract tests: ${passed} groups passed`);
}

void main();
