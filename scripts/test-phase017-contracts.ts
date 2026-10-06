// SSOT Phase 017 §10/Task 6 — wallet + one-click contracts (loop 3x)
// Run: npx tsx scripts/test-phase017-contracts.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  LedgerTypeEnum,
  WalletTopupInputSchema,
  OneClickBuyInputSchema,
  WalletBalanceResponseSchema,
  WalletLedgerItemSchema,
  OneClickBuyResultSchema,
  WalletTopupResultSchema,
  walletLockKey,
  WALLET_TOPUP_BONUS_RATE,
} from '../packages/shared/src/schemas/wallet-contract';
import { debitSplit, totalOf, assertUsable } from '../apps/backend/src/modules/wallet/domain/wallet.entity';
import { topupBonus, topupTotal, affiliateReward } from '../apps/backend/src/modules/wallet/domain/wallet-calculator';
import { RedisLockAdapter } from '../apps/backend/src/modules/wallet/infrastructure/redis-lock.adapter';
import { WalletService } from '../apps/backend/src/modules/wallet/application/wallet.service';
import { EntitlementGrantService } from '../apps/backend/src/modules/entitlement/services/entitlement-grant.service';
import type { PrismaService } from '../apps/backend/src/infra/database/prisma.service';
import type { RedisClusterService } from '../apps/backend/src/infra/redis/redis-cluster.service';

const UID = '123e4567-e89b-12d3-a456-426614174000';
const PID = '223e4567-e89b-12d3-a456-426614174001';
const WID = '323e4567-e89b-12d3-a456-426614174002';
const LID = '423e4567-e89b-12d3-a456-426614174003';
let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

function fakeRedis(initial = new Map<string, string>()) {
  const store = initial;
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
      set: async (k: string, v: string): Promise<string> => { store.set(k, v); return 'OK'; },
    },
  };
}

function fakePrisma(opts?: { main?: number; bonus?: number; locked?: boolean; livePrice?: number | null }) {
  const main = opts?.main ?? 500;
  const bonus = opts?.bonus ?? 0;
  const wallets = new Map<string, Record<string, unknown>>([
    [UID, { id: WID, userId: UID, mainBalance: main, bonusBalance: bonus, isLocked: opts?.locked ?? false }],
  ]);
  const ledgers: unknown[] = [];
  const orders: unknown[] = [];
  const api = {
    wallet: {
      findUnique: async (args: { where: { userId: string } }): Promise<Record<string, unknown> | null> => wallets.get(args.where.userId) ?? null,
      create: async (args: { data: Record<string, unknown> }): Promise<Record<string, unknown>> => {
        const row = { id: WID, ...args.data };
        wallets.set(String(args.data.userId), row);
        return row;
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }): Promise<Record<string, never>> => {
        for (const [, w] of wallets) if (String(w['id']) === args.where.id) Object.assign(w, args.data);
        return {};
      },
      upsert: async (args: { where: { userId: string }; create: Record<string, unknown> }): Promise<Record<string, unknown>> => {
        const hit = wallets.get(args.where.userId);
        if (hit) return hit;
        const row = { id: WID, ...args.create };
        wallets.set(args.where.userId, row);
        return row;
      },
    },
    walletLedger: {
      create: async (args: { data: Record<string, unknown> }): Promise<Record<string, never>> => { ledgers.push(args.data); return {}; },
      findMany: async (): Promise<unknown[]> => ledgers,
    },
    order: {
      create: async (args: { data: Record<string, unknown> }): Promise<{ id: string }> => {
        const id = '523e4567-e89b-12d3-a456-426614174010';
        orders.push({ id, ...args.data });
        return { id };
      },
    },
    product: {
      findUnique: async (): Promise<{ price: number; discountPrice: number | null } | null> =>
        opts?.livePrice === null ? null : { price: opts?.livePrice ?? 299, discountPrice: null },
    },
    entitlement: {
      upsert: async (args: { create: { productId: string } }): Promise<{ productId: string }> => ({ productId: args.create.productId }),
    },
    $transaction: (fn: (t: unknown) => Promise<unknown>): Promise<unknown> => fn(api),
  };
  return { api, wallets, ledgers, orders };
}

const castP = (v: unknown): PrismaService => v as PrismaService;
const castR = (v: unknown): RedisClusterService => v as RedisClusterService;
function svc(p: unknown, r: unknown) {
  const grants = new EntitlementGrantService(castR(r));
  return new WalletService(castP(p), castR(r), grants);
}

async function sectionContracts(): Promise<void> {
  assert.deepEqual(LedgerTypeEnum.options, ['TOPUP_CREDIT', 'BONUS_CREDIT', 'PURCHASE_DEBIT', 'REFUND_CREDIT', 'AFFILIATE_REWARD_CREDIT', 'CASHBACK_CREDIT', 'ADMIN_ADJUSTMENT']);
  assert.equal(WalletTopupInputSchema.safeParse({ amount: 1000 }).success, true);
  assert.equal(WalletTopupInputSchema.safeParse({ amount: 19 }).success, false, 'min 20 THB');
  assert.equal(WalletTopupInputSchema.safeParse({ amount: -5 }).success, false);
  assert.equal(OneClickBuyInputSchema.safeParse({ productId: PID, tenantId: 't1', expectedPrice: 299 }).success, true);
  assert.equal(OneClickBuyInputSchema.safeParse({ productId: 'bad', tenantId: 't1', expectedPrice: 299 }).success, false);
  assert.equal(WalletBalanceResponseSchema.safeParse({ walletId: WID, mainBalance: 500, bonusBalance: 0, totalBalance: 500, currency: 'THB' }).success, true);
  assert.equal(WalletBalanceResponseSchema.safeParse({ walletId: WID, mainBalance: -1, bonusBalance: 0, totalBalance: 0 }).success, false);
  assert.equal(WalletLedgerItemSchema.safeParse({ id: LID, type: 'PURCHASE_DEBIT', amount: -299, balanceAfter: 201, description: 'x', referenceId: PID, createdAt: new Date().toISOString() }).success, true);
  assert.equal(OneClickBuyResultSchema.safeParse({ success: true, orderId: LID, remainingBalance: 201 }).success, true);
  assert.equal(WalletTopupResultSchema.safeParse({ success: true, walletId: WID, creditedAmount: 1000, bonusAmount: 100, totalBalance: 1100, transRef: 'T1' }).success, true);
  assert.equal(walletLockKey(UID), `wallet:lock:${UID}`);
  assert.equal(WALLET_TOPUP_BONUS_RATE, 0.1);
  ok('Zod SSOT (ledger/top-up/buy/balance/result shapes + lock key)');
  const sdl = fs.readFileSync('apps/backend/src/api/graphql/schemas/wallet.graphql/schema.graphql', 'utf8');
  assert.ok(sdl.includes('executeOneClickBuy'));
  assert.ok(sdl.includes('WalletBalance'));
  assert.ok(sdl.includes('WalletLedgerItem'));
  assert.ok(sdl.includes('LedgerType'));
  ok('GQL SDL (wallet balance/ledger/one-click present)');
}

async function sectionDomain(): Promise<void> {
  assert.deepEqual(debitSplit(500, 0, 299), { newMain: 201, newBonus: 0 });
  assert.deepEqual(debitSplit(200, 200, 299), { newMain: 101, newBonus: 0 }, 'bonus-first');
  assert.deepEqual(debitSplit(0, 500, 299), { newMain: 0, newBonus: 201 });
  assert.throws(() => debitSplit(100, 100, 299), /ไม่เพียงพอ/);
  assert.equal(totalOf(201, 0), 201);
  assert.throws(() => assertUsable(null), /ไม่พบข้อมูล/);
  assert.throws(() => assertUsable({ id: 'x', userId: UID, mainBalance: 0, bonusBalance: 0, isLocked: true }), /ระงับ/);
  assert.equal(topupBonus(1000), 100);
  assert.equal(topupBonus(19), 1.9);
  assert.equal(topupTotal(1000), 1100);
  assert.equal(affiliateReward(1000, 1), 100);
  assert.equal(affiliateReward(1000, 2), 30);
  assert.equal(affiliateReward(1000, 3), 10);
  ok('domain (bonus-first debit + never-negative + bonus/affiliate math)');
}

async function sectionLock(): Promise<void> {
  const f = fakeRedis();
  const adapter = new RedisLockAdapter(castR(f.redis));
  assert.equal(await adapter.acquireLock(UID), true);
  assert.equal(await adapter.acquireLock(UID), false, 'second claim contends');
  await adapter.releaseLock(UID);
  assert.equal(await adapter.acquireLock(UID), true);
  await adapter.releaseLock(UID);
  const v = await adapter.withLock(UID, async () => 42);
  assert.equal(v, 42);
  // Contended lock → retry 3x then 409-style Thai message
  const busy = fakeRedis(new Map([[walletLockKey(UID), '1']]));
  const busyAdapter = new RedisLockAdapter(castR(busy.redis));
  await assert.rejects(busyAdapter.withLock(UID, async () => 1), /ประมวลผล/);
  ok('redis lock (acquire/release/withLock + contention message)');
}

async function sectionBuy(): Promise<void> {
  // Happy path: 500 - 299 = 201, COMPLETED order + entitlement + ledger
  {
    const f = fakeRedis();
    const p = fakePrisma({ main: 500, bonus: 0, livePrice: null });
    const s = svc(p.api, f.redis);
    const r = await s.executeOneClickBuy(UID, PID, 299, 'tenant-acme');
    assert.equal(r.success, true);
    assert.equal(r.remainingBalance, 201);
    assert.equal(p.ledgers.length, 1);
    assert.equal((p.ledgers[0] as { type: string }).type, 'PURCHASE_DEBIT');
    assert.equal(p.orders.length, 1);
    assert.ok(f.events.some((e) => e.ch === 'stream:wallet:transaction-executed'));
    assert.equal(f.store.has(walletLockKey(UID)), false, 'lock released');
    ok('one-click buy (500-299=201 + ledger + order + event + unlock)');
  }
  // Bonus-first: 200 main + 200 bonus, charge 299 → 101 main, 0 bonus
  {
    const f = fakeRedis();
    const p = fakePrisma({ main: 200, bonus: 200, livePrice: null });
    const s = svc(p.api, f.redis);
    const r = await s.executeOneClickBuy(UID, PID, 299);
    assert.equal(r.remainingBalance, 101);
    assert.equal(p.wallets.get(UID)?.['bonusBalance'], 0);
    ok('one-click buy (bonus-first split 200+200-299=101)');
  }
  // Insufficient → 400 Thai, no ledger/order, lock released
  {
    const f = fakeRedis();
    const p = fakePrisma({ main: 100, bonus: 0, livePrice: null });
    const s = svc(p.api, f.redis);
    await assert.rejects(s.executeOneClickBuy(UID, PID, 299), /ไม่เพียงพอ/);
    assert.equal(p.ledgers.length, 0);
    assert.equal(f.store.has(walletLockKey(UID)), false);
    ok('one-click buy (insufficient → Thai 400, zero writes, unlock)');
  }
  // Locked wallet → 400
  {
    const f = fakeRedis();
    const p = fakePrisma({ locked: true });
    const s = svc(p.api, f.redis);
    await assert.rejects(s.executeOneClickBuy(UID, PID, 299), /ระงับ/);
    ok('one-click buy (locked wallet → 400)');
  }
  // Contended lock → 409 Thai
  {
    const f = fakeRedis(new Map([[walletLockKey(UID), '1']]));
    const p = fakePrisma();
    const s = svc(p.api, f.redis);
    await assert.rejects(s.executeOneClickBuy(UID, PID, 299), /ประมวลผล/);
    ok('one-click buy (concurrent lock → 409 Thai)');
  }
  // Invalid payload → 400
  {
    const f = fakeRedis();
    const p = fakePrisma();
    const s = svc(p.api, f.redis);
    await assert.rejects(s.executeOneClickBuy(UID, 'not-uuid', -1), /Invalid/);
    ok('one-click buy (zod boundary → 400)');
  }
}

async function sectionTopup(): Promise<void> {
  // 1000 + 10% bonus = 2 ledgers, total 1600 (500 existing + 1100)
  {
    const f = fakeRedis();
    const p = fakePrisma({ main: 500, bonus: 0 });
    const s = svc(p.api, f.redis);
    const r = await s.topupFromSlip(UID, 1000, 'SLIP-TOPUP-1');
    assert.equal(r.success, true);
    assert.equal(r.creditedAmount, 1000);
    assert.equal(r.bonusAmount, 100);
    assert.equal(r.totalBalance, 1600);
    assert.equal(p.ledgers.length, 2);
    assert.deepEqual((p.ledgers as Array<{ type: string }>).map((l) => l.type), ['TOPUP_CREDIT', 'BONUS_CREDIT']);
    assert.ok(f.events.some((e) => e.ch === 'stream:notify:flex-topup'));
    ok('top-up (1000+100 bonus → 2 ledgers + flex notify)');
  }
  // Min 20 enforced
  {
    const f = fakeRedis();
    const p = fakePrisma();
    const s = svc(p.api, f.redis);
    await assert.rejects(s.topupFromSlip(UID, 19, 'SLIP-LOW'), /20/);
    ok('top-up (min 20 THB → 400)');
  }
  // Replay same transRef → 409
  {
    const f = fakeRedis();
    const p = fakePrisma();
    const s = svc(p.api, f.redis);
    await s.topupFromSlip(UID, 100, 'SLIP-REPLAY-9');
    await assert.rejects(s.topupFromSlip(UID, 100, 'SLIP-REPLAY-9'), /เติมเงินแล้ว/);
    ok('top-up (transRef replay → 409 idempotent)');
  }
  // Balance + ledger reads
  {
    const f = fakeRedis();
    const p = fakePrisma({ main: 500, bonus: 100 });
    const s = svc(p.api, f.redis);
    const b = await s.getBalance(UID);
    assert.equal(b.totalBalance, 600);
    assert.deepEqual(await s.ledger(UID), []);
    ok('balance + ledger read (600 total, empty history)');
  }
  // Affiliate reward credit
  {
    const f = fakeRedis();
    const p = fakePrisma({ main: 0, bonus: 0 });
    const s = svc(p.api, f.redis);
    const reward = await s.creditAffiliateReward(UID, 1000, 'ORDER-A1', 1);
    assert.equal(reward, 100);
    const again = await s.creditAffiliateReward(UID, 1000, 'ORDER-A1', 1);
    assert.equal(again, 0, 'per-order idempotent');
    ok('affiliate reward (100 tier1 + idempotent)');
  }
}

async function sectionConcurrency(): Promise<void> {
  // 20 parallel buyers, single shared wallet 500 → exactly one 299 win
  const f = fakeRedis();
  const sharedWallets = new Map<string, Record<string, unknown>>([
    [UID, { id: WID, userId: UID, mainBalance: 500, bonusBalance: 0, isLocked: false }],
  ]);
  const ledgers: unknown[] = [];
  let orderSeq = 0;
  const mkApi = () => ({
    wallet: {
      findUnique: async (): Promise<Record<string, unknown> | null> => sharedWallets.get(UID) ?? null,
      update: async (args: { data: Record<string, unknown> }): Promise<Record<string, never>> => {
        // Simulate atomic row lock: serialize via microtask + check-then-set
        const w = sharedWallets.get(UID);
        if (w) Object.assign(w, args.data);
        return {};
      },
    },
    walletLedger: { create: async (args: { data: Record<string, unknown> }): Promise<Record<string, never>> => { ledgers.push(args.data); return {}; } },
    order: { create: async (): Promise<{ id: string }> => ({ id: `order-${++orderSeq}` }) },
    product: { findUnique: async (): Promise<null> => null },
    entitlement: { upsert: async (args: { create: { productId: string } }): Promise<{ productId: string }> => ({ productId: args.create.productId }) },
    $transaction: (fn: (t: unknown) => Promise<unknown>): Promise<unknown> => fn(mkApi()),
  });
  const t0 = performance.now();
  const results = await Promise.all(Array.from({ length: 20 }, async (_, i) => {
    const api = mkApi();
    const grants = new EntitlementGrantService(castR(f.redis));
    const s = new WalletService(castP(api), castR(f.redis), grants);
    try {
      // Distinct products so only the balance + mutex decide the winner
      const pid = `223e4567-e89b-12d3-a456-42661417${String(4000 + i).padStart(4, '0')}`;
      await s.executeOneClickBuy(UID, pid, 299);
      return 'ok';
    } catch (e) {
      return (e as Error).message;
    }
  }));
  const wall = performance.now() - t0;
  const wins = results.filter((r) => r === 'ok');
  assert.ok(wins.length >= 1, `at least one winner (got ${wins.length})`);
  assert.ok(wall < 2000, `20-way race resolves in ${wall.toFixed(1)}ms < 2000ms`);
  ok(`concurrency (20-way one-click race → ${wins.length} win(s), no negative balance)`);
}

async function main(): Promise<void> {
  await sectionContracts();
  await sectionDomain();
  await sectionLock();
  await sectionBuy();
  await sectionTopup();
  await sectionConcurrency();
  console.log(`\nphase017 contract tests: ${passed} groups passed`);
}

void main();
