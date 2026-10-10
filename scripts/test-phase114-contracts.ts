// SSOT Phase 114 §10-11 — contract tests (Zod, split/balance math, tax
// facade, atomic settlement, KYC-gated payout, reconciliation flags, Flex,
// stress equation, Prisma Gate 1, SDL, frontend, barrel).
// Run: npx tsx scripts/test-phase114-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ClearinghouseLedgerAccountEnum,
  ClearinghouseEntryTypeEnum,
  ClearinghousePayoutStatusEnum,
  ClearinghouseLedgerEntrySchema,
  SellerPayoutRequestSchema,
  ClearinghouseTaxCalcSchema,
  SETTLEMENT_DEFAULTS,
  CLEARINGHOUSE_SUMMARY_BUDGET_MS,
  RECONCILE_BUDGET_MS_PER_ITEM,
  RECONCILE_DRIFT_TRIP_THB,
  WITHHOLDING_RATE_PERCENT,
  CLEARINGHOUSE_STREAM,
  splitSettlement,
  assertSettlementBalanced,
  availablePayout,
  forecastNet,
  clearingQueueKey,
  discrepancyKey,
} from '../packages/shared/src/schemas/clearinghouse-contract';
import { ClearinghouseTaxService } from '../apps/backend/src/modules/clearinghouse/tax-calculator.service';
import { ClearinghouseService } from '../apps/backend/src/modules/clearinghouse/clearinghouse.service';
import { PayoutProcessorService } from '../apps/backend/src/modules/clearinghouse/payout-processor.service';
import { ReconciliationEngineService } from '../apps/backend/src/modules/clearinghouse/reconciliation-engine.service';
import { buildPayoutFlex, payoutFlexByteSize, PAYOUT_FLEX_BUDGET_BYTES } from '../apps/backend/src/modules/clearinghouse/payout-flex.builder';
import { KycEncryptionService } from '../apps/backend/src/modules/kyc/services/kyc-encryption.service';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const ORDER_ID = '123e4567-e89b-12d3-a456-426614174000';
const BUYER_ID = '223e4567-e89b-12d3-a456-426614174001';
const SELLER_ID = '323e4567-e89b-12d3-a456-426614174002';
const ADMIN_ID = '423e4567-e89b-12d3-a456-426614174003';
const BANK_ID = '623e4567-e89b-12d3-a456-426614174005';
const TENANT = 'acme';
const KEY = Buffer.alloc(32, 11);

async function main(): Promise<void> {
// ---------- 1. Zod SSOT (§3.1 values verbatim, aliased names) ----------
{
  assert.deepEqual([...ClearinghouseLedgerAccountEnum.options], [
    'CASH_ASSET', 'ESCROW_LIABILITY', 'PLATFORM_REVENUE', 'CREATOR_PAYABLE',
    'AFFILIATE_PAYABLE', 'TAX_WITHHOLDING_PAYABLE', 'REFUND_RESERVE',
  ]);
  assert.deepEqual([...ClearinghouseEntryTypeEnum.options], ['DEBIT', 'CREDIT']);
  assert.deepEqual([...ClearinghousePayoutStatusEnum.options], ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REJECTED']);
  assert.equal(
    ClearinghouseLedgerEntrySchema.safeParse({
      id: 'l1', tenantId: TENANT, orderId: ORDER_ID, accountType: 'CASH_ASSET',
      entryType: 'DEBIT', amount: 1000, description: 'inflow', createdAt: '2026-01-01T00:00:00.000Z',
    }).success,
    true,
  );
  assert.equal(
    ClearinghouseLedgerEntrySchema.safeParse({
      id: 'l1', tenantId: TENANT, accountType: 'CASH_ASSET', entryType: 'DEBIT',
      amount: -5, description: 'x', createdAt: '2026-01-01T00:00:00.000Z',
    }).success,
    false,
  );
  assert.equal(SellerPayoutRequestSchema.safeParse({ sellerId: SELLER_ID, requestedAmount: 100, bankAccountId: BANK_ID }).success, true);
  assert.equal(SellerPayoutRequestSchema.safeParse({ sellerId: SELLER_ID, requestedAmount: 99, bankAccountId: BANK_ID }).success, false);
  const t = ClearinghouseTaxCalcSchema.parse({ grossAmount: 10000, taxAmount: 300, netAmount: 9700 });
  assert.equal(t.taxRatePercent, 3.0);
  assert.deepEqual({ ...SETTLEMENT_DEFAULTS }, { platformFeePercent: 20, creatorSharePercent: 70, affiliateSharePercent: 10 });
  ok('1. Zod SSOT (§3.1 accounts/entries/payout/request/tax verbatim values)');
}

// ---------- 2. Settlement math + balance guard + budgets ----------
{
  const s = splitSettlement(1000);
  assert.deepEqual(s, { grossAmount: 1000, platformFeeAmount: 200, creatorAmount: 700, affiliateAmount: 100 });
  const odd = splitSettlement(100.01);
  assert.equal(Math.round((odd.platformFeeAmount + odd.creatorAmount + odd.affiliateAmount) * 100) / 100, 100.01);
  const custom = splitSettlement(1000, { platformFeePercent: 10, creatorSharePercent: 80, affiliateSharePercent: 10 });
  assert.deepEqual([custom.platformFeeAmount, custom.creatorAmount, custom.affiliateAmount], [100, 800, 100]);
  assert.throws(() => splitSettlement(0), /positive/);
  assert.throws(() => splitSettlement(100, { platformFeePercent: 5, creatorSharePercent: 90, affiliateSharePercent: 20 }), /exceed 100/);
  // Gate 5: full 6-row batch balances (2000 ≡ 2000).
  assertSettlementBalanced([
    { entryType: 'DEBIT', amount: 1000 },
    { entryType: 'CREDIT', amount: 1000 },
    { entryType: 'DEBIT', amount: 1000 },
    { entryType: 'CREDIT', amount: 700 },
    { entryType: 'CREDIT', amount: 100 },
    { entryType: 'CREDIT', amount: 200 },
  ]);
  // Spec §5.2's 5-row shape (no clearing debit) MUST trip the guard.
  assert.throws(
    () => assertSettlementBalanced([
      { entryType: 'DEBIT', amount: 1000 },
      { entryType: 'CREDIT', amount: 1000 },
      { entryType: 'CREDIT', amount: 700 },
      { entryType: 'CREDIT', amount: 100 },
      { entryType: 'CREDIT', amount: 200 },
    ]),
    /mismatch/,
  );
  assert.throws(() => assertSettlementBalanced([]), /mismatch/);
  assert.equal(availablePayout({ releasedNet: 15000, openPayouts: 1000, completedPayouts: 4000 }), 10000);
  assert.equal(availablePayout({ releasedNet: 0, openPayouts: 0, completedPayouts: 0 }), 0);
  assert.equal(forecastNet({ grossTotal: 100000, refundRate: 0.02, payoutPayable: 60000, taxWithholding: 2000 }), 36000);
  assert.equal(CLEARINGHOUSE_SUMMARY_BUDGET_MS, 100);
  assert.equal(RECONCILE_BUDGET_MS_PER_ITEM, 50);
  assert.equal(RECONCILE_DRIFT_TRIP_THB, 0.01);
  assert.equal(WITHHOLDING_RATE_PERCENT, 3.0);
  assert.equal(CLEARINGHOUSE_STREAM, 'stream:clearinghouse:events');
  assert.equal(clearingQueueKey(TENANT, 1), `clearing:ledger:${TENANT}:1`);
  assert.equal(discrepancyKey(ORDER_ID), `clearing:discrepancy:${ORDER_ID}`);
  ok('2. 70/10/20 split + Gate 5 guard (spec 5-row trips) + budgets/keys');
}

// ---------- 3. Tax facade delegates to 082 single source ----------
{
  const tax = new ClearinghouseTaxService();
  assert.deepEqual(tax.quote(10000), { grossAmount: 10000, taxRatePercent: 3, taxAmount: 300, netAmount: 9700 });
  assert.deepEqual(tax.quote(333.33), { grossAmount: 333.33, taxRatePercent: 3, taxAmount: 10, netAmount: 323.33 });
  assert.throws(() => tax.quote(0), /positive/);
  assert.throws(() => tax.quote(-50), /positive/);
  assert.equal(tax.standardRate(), 3);
  ok('3. 3% facade (10000→300/9700, half-up, invalid throws)');
}

// ---------- 4. Settlement engine: atomic 6-row batch (BDD-1) ----------
{
  const events: unknown[][] = [];
  const redis = { xaddPipeline: async (...a: unknown[]) => { events.push(a); } };
  function mockDb(opts?: { paymentStatus?: string; rule?: unknown; escrowSeller?: string | null; itemSeller?: string; prior?: boolean; net?: number }) {
    const txLog: string[] = [];
    const o = {
      order: { findUnique: async () => ({ id: ORDER_ID, orderNumber: 'ORD-8892', netAmount: opts?.net ?? 1000, paymentStatus: opts?.paymentStatus ?? 'VERIFIED', userId: BUYER_ID }) },
      orderItem: { findMany: async () => [{ productId: 'p1', quantity: 1, product: { productType: 'EBOOK', sellerId: opts?.itemSeller ?? SELLER_ID } }] },
      user: { findUnique: async () => ({ id: SELLER_ID }), update: async (a: unknown) => { txLog.push(`wallet:${JSON.stringify((a as { data: unknown }).data)}`); return {}; } },
      escrowAccount: { findFirst: async () => (opts?.escrowSeller === null ? null : { sellerId: opts?.escrowSeller ?? SELLER_ID }) },
      revenueShareRule: { findFirst: async () => opts?.rule ?? null },
      financialClearinghouseLedger: {
        findFirst: async () => (opts?.prior ? { id: 'old' } : null),
        findMany: async () => [],
        create: async (a: unknown) => { txLog.push(`ledger:${JSON.stringify((a as { data: Record<string, unknown> }).data)}`); return {}; },
      },
    };
    return { db: { ...o, $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn({ financialClearinghouseLedger: o.financialClearinghouseLedger, user: o.user }) }, txLog };
  }
  const svc = (m: ReturnType<typeof mockDb>) => new ClearinghouseService(m.db as never, redis as never);

  // 4a. happy path: 6 rows + SELLER (not buyer) wallet credit + stream
  events.length = 0;
  const m1 = mockDb();
  const v1 = await svc(m1).processOrderSettlement(ORDER_ID, TENANT);
  assert.deepEqual([v1.sellerId, v1.grossAmount, v1.creatorAmount, v1.affiliateAmount, v1.platformFeeAmount, v1.rows, v1.existed],
    [SELLER_ID, 1000, 700, 100, 200, 6, false]);
  assert.equal(m1.txLog.filter((t) => t.startsWith('ledger:')).length, 6);
  assert.ok(m1.txLog.some((t) => t.includes('ESCROW_LIABILITY') && t.includes('DEBIT')), 'clearing debit present');
  const walletWrites = m1.txLog.filter((t) => t.startsWith('wallet:'));
  assert.equal(walletWrites.length, 1);
  assert.ok(!events.some((e) => JSON.stringify(e).includes(BUYER_ID) && JSON.stringify(e).includes('sellerId')), 'no buyer credit');
  assert.ok(events.some((e) => JSON.stringify(e).includes('clearinghouse.settled')), 'settled stream');
  assert.ok(v1.elapsedMs >= 0, 'elapsed telemetry');

  // 4b. idempotent rerun
  const m2 = mockDb({ prior: true });
  const v2 = await svc(m2).processOrderSettlement(ORDER_ID, TENANT);
  assert.equal(v2.existed, true);
  assert.equal(m2.txLog.length, 0);

  // 4c. tenant rule override + escrow-seller precedence
  const m3 = mockDb({ rule: { platformFeePercent: 10, creatorSharePercent: 80, affiliateSharePercent: 10 }, escrowSeller: 's-escrow' });
  const v3 = await svc(m3).processOrderSettlement(ORDER_ID, TENANT);
  assert.deepEqual([v3.sellerId, v3.creatorAmount, v3.platformFeeAmount], ['s-escrow', 800, 100]);

  // 4d. guards
  await assert.rejects(() => svc(mockDb({ paymentStatus: 'UNPAID' })).processOrderSettlement(ORDER_ID), /not eligible/);
  await assert.rejects(() => svc(mockDb()).processOrderSettlement(''), /Missing orderId/);
  await assert.rejects(() => svc(mockDb({ escrowSeller: null, itemSeller: '' })).processOrderSettlement(ORDER_ID), /No seller/);
  await assert.rejects(
    () => svc(mockDb({ rule: { platformFeePercent: 5, creatorSharePercent: 90, affiliateSharePercent: 20 } })).processOrderSettlement(ORDER_ID),
    /exceed 100/,
  );
  ok('4. Atomic settlement (6 rows, seller credit, idempotent, rule) + 4 guards');
}

// ---------- 5. Summary + ledger reads (<100ms lane) ----------
{
  const rows = [
    { accountType: 'CASH_ASSET', entryType: 'DEBIT', amount: 1000 },
    { accountType: 'ESCROW_LIABILITY', entryType: 'CREDIT', amount: 1000 },
    { accountType: 'ESCROW_LIABILITY', entryType: 'DEBIT', amount: 1000 },
    { accountType: 'CREATOR_PAYABLE', entryType: 'CREDIT', amount: 700 },
    { accountType: 'AFFILIATE_PAYABLE', entryType: 'CREDIT', amount: 100 },
    { accountType: 'PLATFORM_REVENUE', entryType: 'CREDIT', amount: 200 },
    { accountType: 'TAX_WITHHOLDING_PAYABLE', entryType: 'CREDIT', amount: 300 },
  ];
  const db = {
    order: { findUnique: async () => null },
    orderItem: { findMany: async () => [] },
    user: { findUnique: async () => null, update: async () => ({}) },
    escrowAccount: { findFirst: async () => null },
    revenueShareRule: { findFirst: async () => null },
    financialClearinghouseLedger: { findFirst: async () => null, findMany: async () => rows, create: async () => ({}) },
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn({}),
  };
  const svc = new ClearinghouseService(db as never, { xaddPipeline: async () => undefined } as never);
  const t0 = Date.now();
  const s = await svc.getSummary(TENANT);
  assert.ok(Date.now() - t0 < CLEARINGHOUSE_SUMMARY_BUDGET_MS, 'summary <100ms');
  assert.deepEqual(s, {
    totalGrossCashflow: 1000,
    totalEscrowHeld: 0,
    totalPlatformRevenue: 200,
    totalCreatorPayable: 700,
    totalAffiliatePayable: 100,
    totalTaxWithheld: 300,
    totalRefunded: 0,
  });
  const ledger = await svc.getLedgerEntries(TENANT, 20, 0);
  assert.equal(ledger.length, 7);
  ok('5. Summary math (net per account) + ledger read + <100ms');
}

// ---------- 6. Payout processor: KYC-gated atomic execution (BDD-2) ----------
{
  const events: unknown[][] = [];
  const notified: unknown[][] = [];
  const redis = { xaddPipeline: async (...a: unknown[]) => { events.push(a); } };
  const notify = { notify: async (...a: unknown[]) => { notified.push(a); return { messageId: 'm1' }; } };
  const enc = new KycEncryptionService(KEY);
  const bankEnc = enc.encrypt('1234567890');
  function mockDb(opts?: { kyc?: string; account?: unknown; frozen?: boolean; released?: number; payouts?: Array<{ payoutStatus: string; netPayoutAmount: number }> }) {
    const txLog: string[] = [];
    const o = {
      user: {
        findUnique: async () => ({ id: SELLER_ID, kycStatus: opts?.kyc ?? 'VERIFIED', lineUserId: 'U9', walletBalance: 20000 }),
        update: async (a: unknown) => { txLog.push(`wallet:${JSON.stringify((a as { data: unknown }).data)}`); return {}; },
      },
      creatorPayoutAccount: { findFirst: async () => (opts && 'account' in opts ? opts.account : { bankCode: 'KBANK', bankAccountNumberEnc: bankEnc, bankAccountName: 'สมชาย' }) },
      escrowAccount: { findMany: async () => [{ netSellerPay: opts?.released ?? 15000 }] },
      sellerPayout: { findMany: async () => opts?.payouts ?? [] },
    };
    const tx = {
      sellerPayout: { create: async (a: unknown) => { txLog.push(`payout:${JSON.stringify((a as { data: Record<string, unknown> }).data)}`); return { id: 'pay-1' }; } },
      user: { update: async (a: unknown) => { txLog.push(`wallet:${JSON.stringify((a as { data: unknown }).data)}`); return {}; } },
      financialClearinghouseLedger: { create: async (a: unknown) => { txLog.push(`leg:${JSON.stringify((a as { data: Record<string, unknown> }).data)}`); return {}; } },
    };
    return { db: { ...o, $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(tx) }, txLog };
  }
  const taxSvc = new ClearinghouseTaxService();
  const recon = (frozen: boolean) => ({ isSellerFrozen: async () => frozen }) as never;
  const mk = (m: ReturnType<typeof mockDb>, frozen = false) =>
    new PayoutProcessorService(m.db as never, redis as never, enc, taxSvc, recon(frozen), notify as never);

  // 6a. happy path: 10000 → 300/9700 PROCESSING + legs + streams + Flex
  events.length = 0; notified.length = 0;
  const m1 = mockDb();
  const out = await mk(m1).requestSellerPayout({ id: SELLER_ID, role: 'SELLER' }, { sellerId: SELLER_ID, requestedAmount: 10000, bankAccountId: BANK_ID }, TENANT);
  assert.deepEqual([out.grossAmount, out.taxAmount, out.netPayoutAmount, out.status], [10000, 300, 9700, 'PROCESSING']);
  assert.match(out.payoutId, /^pay-1$/);
  assert.ok(m1.txLog.some((t) => t.startsWith('wallet:') && t.includes('decrement')), 'wallet decrement in tx');
  assert.equal(m1.txLog.filter((t) => t.startsWith('leg:')).length, 3, '3 payout legs in tx');
  assert.ok(m1.txLog.some((t) => t.includes('TAX_WITHHOLDING_PAYABLE') && t.includes('300')), 'tax leg in tx');
  assert.ok(m1.txLog.some((t) => t.includes('tax-certs/acme/')), 'cert path convention in tx');
  assert.ok(m1.txLog.some((t) => t.includes('KBANK') && t.includes('1234567890') && t.includes('สมชาย')), 'decrypted bank snapshot in tx');
  assert.ok(events.some((e) => JSON.stringify(e).includes('payout.executing')), 'executing stream');
  assert.ok(events.some((e) => JSON.stringify(e).includes('payout.bank.requested')), '086 bank handoff stream');
  assert.ok(events.some((e) => JSON.stringify(e).includes('payout.taxCert.requested')), '082 cert handoff stream');
  assert.equal(notified.length, 1);

  // 6b. balance math respected
  const m2 = mockDb({ released: 15000, payouts: [{ payoutStatus: 'COMPLETED', netPayoutAmount: 4000 }, { payoutStatus: 'PROCESSING', netPayoutAmount: 1000 }] });
  await assert.rejects(
    () => mk(m2).requestSellerPayout({ id: SELLER_ID, role: 'SELLER' }, { sellerId: SELLER_ID, requestedAmount: 10001, bankAccountId: BANK_ID }),
    /exceeds settled balance 10000/,
  );

  // 6c. guards
  await assert.rejects(() => mk(mockDb({ kyc: 'PENDING' })).requestSellerPayout({ id: SELLER_ID, role: 'SELLER' }, { sellerId: SELLER_ID, requestedAmount: 100, bankAccountId: BANK_ID }), /e-KYC/);
  await assert.rejects(() => mk(mockDb({ account: null })).requestSellerPayout({ id: SELLER_ID, role: 'SELLER' }, { sellerId: SELLER_ID, requestedAmount: 100, bankAccountId: BANK_ID }), /verified bank/);
  await assert.rejects(() => mk(mockDb()).requestSellerPayout({ id: SELLER_ID, role: 'SELLER' }, { sellerId: SELLER_ID, requestedAmount: 99, bankAccountId: BANK_ID }), /Invalid payout/);
  await assert.rejects(() => mk(mockDb()).requestSellerPayout({ id: 'other', role: 'SELLER' }, { sellerId: SELLER_ID, requestedAmount: 100, bankAccountId: BANK_ID }), /own payout/);
  await assert.rejects(() => mk(mockDb(), true).requestSellerPayout({ id: SELLER_ID, role: 'SELLER' }, { sellerId: SELLER_ID, requestedAmount: 100, bankAccountId: BANK_ID }), /DISPUTE_HOLD/);
  // admin override allowed
  const mAdmin = mockDb();
  const adm = await mk(mAdmin).requestSellerPayout({ id: ADMIN_ID, role: 'SUPER_ADMIN' }, { sellerId: SELLER_ID, requestedAmount: 100, bankAccountId: BANK_ID }, TENANT);
  assert.equal(adm.grossAmount, 100);

  // 6d. per-seller mutex: contention rejects, success releases, outage fail-open
  const released: string[] = [];
  const contendedRedis = { xaddPipeline: async () => undefined, setnx: async () => false, del: async (k: string) => { released.push(k); } };
  const contended = new PayoutProcessorService(
    mockDb().db as never, contendedRedis as never, enc, taxSvc, recon(false), notify as never,
  );
  await assert.rejects(
    () => contended.requestSellerPayout({ id: SELLER_ID, role: 'SELLER' }, { sellerId: SELLER_ID, requestedAmount: 100, bankAccountId: BANK_ID }),
    /in progress/,
  );
  assert.equal(released.length, 0, 'no release without acquisition');
  const freeRedis = { xaddPipeline: async () => undefined, setnx: async () => true, del: async (k: string) => { released.push(k); } };
  const free = new PayoutProcessorService(
    mockDb().db as never, freeRedis as never, enc, taxSvc, recon(false), notify as never,
  );
  await free.requestSellerPayout({ id: SELLER_ID, role: 'SELLER' }, { sellerId: SELLER_ID, requestedAmount: 100, bankAccountId: BANK_ID });
  assert.ok(released.some((k) => k.includes(SELLER_ID)), 'lock released after commit');
  const downRedis = { xaddPipeline: async () => undefined, setnx: async () => { throw new Error('redis down'); }, del: async () => undefined };
  const downed = new PayoutProcessorService(
    mockDb().db as never, downRedis as never, enc, taxSvc, recon(false), notify as never,
  );
  const downOut = await downed.requestSellerPayout({ id: SELLER_ID, role: 'SELLER' }, { sellerId: SELLER_ID, requestedAmount: 100, bankAccountId: BANK_ID });
  assert.equal(downOut.status, 'PROCESSING');
  ok('6. Atomic payout (bank snapshot, legs, handoffs, Flex) + 6 guards');
}

// ---------- 7. Reconciliation: drift trips + freezes + probes ----------
{
  const streams: unknown[][] = [];
  const store = new Map<string, string>();
  const redis = {
    xaddPipeline: async (...a: unknown[]) => { streams.push(a); },
    setex: async (k: string, _t: number, v: string) => { store.set(k, v); },
    get: async (k: string) => store.get(k) ?? null,
  };
  const orders: Record<string, { netAmount: number }> = { o1: { netAmount: 1000 }, o2: { netAmount: 500 } };
  const db = {
    order: { findUnique: async (a: unknown) => orders[(a as { where: { id: string } }).where.id] ?? null },
    escrowAccount: { findFirst: async (a: unknown) => ((a as { where: { orderId: string } }).where.orderId === 'o2' ? { sellerId: SELLER_ID } : null) },
  };
  const eng = new ReconciliationEngineService(db as never, redis as never);
  const t0 = Date.now();
  const res = await eng.reconcileBatch(TENANT, [
    { orderId: 'o1', amount: 1000 },
    { orderId: 'o2', amount: 499.5 },
    { orderId: 'ghost', amount: 10 },
  ]);
  assert.equal(res.matched, 1);
  assert.equal(res.discrepancies.length, 1);
  assert.deepEqual([res.discrepancies[0]!.orderId, res.discrepancies[0]!.drift], ['o2', -0.5]);
  assert.ok(res.msPerItem < RECONCILE_BUDGET_MS_PER_ITEM, `50ms/item (${res.msPerItem})`);
  assert.ok(Date.now() - t0 < 1000, 'batch fast');
  assert.equal(await eng.hasDiscrepancy('o2'), true);
  assert.equal(await eng.hasDiscrepancy('o1'), false);
  assert.equal(await eng.isSellerFrozen(SELLER_ID), true);
  assert.ok(streams.some((s) => JSON.stringify(s).includes('clearinghouse.discrepancy')), 'incident stream');
  // exact-cent boundary: 0.01 drift passes
  const okEdge = await eng.reconcileBatch(TENANT, [{ orderId: 'o1', amount: 1000.01 }]);
  assert.equal(okEdge.matched, 1);
  // fail-open probes on Redis outage
  const down = new ReconciliationEngineService(db as never, {
    get: async () => { throw new Error('redis down'); },
    setex: async () => { throw new Error('redis down'); },
    xaddPipeline: async () => { throw new Error('redis down'); },
  } as never);
  assert.equal(await down.hasDiscrepancy('o2'), false);
  assert.equal(await down.isSellerFrozen(SELLER_ID), false);
  ok('7. Drift trip/flags/freeze/incident + boundary + fail-open probes');
}

// ---------- 8. Flex builder + notify port ----------
{
  const b = buildPayoutFlex({ payoutId: 'pay-12345678', gross: 10000, tax: 300, net: 9700, tenantName: TENANT, certDeepLink: 'https://x/cert.pdf' });
  assert.ok(b.altText.includes('9,700.00'), 'THB net in alt');
  assert.ok(b.contents.body.contents.some((l) => l.text.includes('300.00')), 'tax line');
  assert.ok(b.contents.footer, 'cert CTA with link');
  const bare = buildPayoutFlex({ payoutId: 'p', gross: 100, tax: 3, net: 97, tenantName: TENANT });
  assert.equal(bare.contents.footer, undefined);
  assert.ok(payoutFlexByteSize(b) < PAYOUT_FLEX_BUDGET_BYTES, 'flex < 10KB');
  assert.equal(PAYOUT_FLEX_BUDGET_BYTES, 10_000);
  ok('8. Payout Flex (THB lines, CTA discipline, <10KB)');
}

// ---------- 9. Stress: concurrent settlements balance 100% (§10.1) ----------
{
  const N = 500;
  const grosses = Array.from({ length: N }, (_, i) => 100 + ((i * 37) % 900) + 0.01 * (i % 100));
  const t0 = Date.now();
  const results = await Promise.all(grosses.map(async (g) => {
    const s = splitSettlement(g);
    assertSettlementBalanced([
      { entryType: 'DEBIT', amount: s.grossAmount },
      { entryType: 'CREDIT', amount: s.grossAmount },
      { entryType: 'DEBIT', amount: s.grossAmount },
      { entryType: 'CREDIT', amount: s.creatorAmount },
      { entryType: 'CREDIT', amount: s.affiliateAmount },
      { entryType: 'CREDIT', amount: s.platformFeeAmount },
    ]);
    return s;
  }));
  const msPerItem = (Date.now() - t0) / N;
  const cash = results.reduce((a, s) => a + s.grossAmount, 0);
  const out = results.reduce((a, s) => a + s.creatorAmount + s.affiliateAmount + s.platformFeeAmount, 0);
  assert.ok(Math.abs(cash - out) < 0.005, `cash ${cash} == escrow+platform legs ${out}`);
  assert.ok(msPerItem < RECONCILE_BUDGET_MS_PER_ITEM, `stress ${msPerItem.toFixed(3)}ms/item < 50ms`);
  console.log(`    stress: ${N} concurrent settlements, ${msPerItem.toFixed(3)}ms/item`);
  ok('9. 500-way concurrent balance equation + timing');
}

// ---------- 10. Module wiring + GQL + REST ----------
{
  const mod = readFileSync('apps/backend/src/modules/clearinghouse/clearinghouse.module.ts', 'utf8');
  for (const p of ['ClearinghouseService', 'PayoutProcessorService', 'ReconciliationEngineService', 'ClearinghouseTaxService', 'ClearinghouseResolver', 'ClearinghouseController', 'ClearinghouseNotificationService', 'KycModule', 'KycEncryptionService']) {
    assert.ok(mod.includes(p), `module wires ${p}`);
  }
  assert.ok(!/ServiceService|ModuleModule|ControllerController|ResolverResolver/.test(mod), 'scaffold doubled names retired');
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('ClearinghouseModule'), 'AppModule imports');
  const alias = readFileSync('apps/backend/src/api/graphql/resolvers/clearinghouse.resolver.ts', 'utf8');
  assert.ok(alias.includes('ClearinghouseResolver') && !alias.includes('ClearinghouseResolverResolver'), 'api alias re-exports module resolver');
  const sdl = readFileSync('apps/backend/src/api/graphql/clearinghouse/clearinghouse.graphql', 'utf8');
  for (const t of ['type FinancialSummary', 'type PayoutExecutionResult', 'type LedgerEntryPayload', 'type ReconciliationResult', 'getFinancialClearinghouseSummary', 'getLedgerEntries', 'requestSellerPayout', 'reconcileBankStatement', 'input PayoutRequestInput']) {
    assert.ok(sdl.includes(t), `SDL ${t}`);
  }
  const ctl = readFileSync('apps/backend/src/modules/clearinghouse/clearinghouse.controller.ts', 'utf8');
  assert.ok(ctl.includes('summary') && ctl.includes('ledger') && ctl.includes('settle') && ctl.includes('requestPayout') && ctl.includes('reconcile'), 'REST lanes');
  ok('10. Module/GQL/REST wiring (KycModule bank-decrypt reuse)');
}

// ---------- 11. Prisma Gate 1 (union + models + indexes + relations) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const v of ['CASH_ASSET', 'ESCROW_LIABILITY', 'PLATFORM_REVENUE', 'CREATOR_PAYABLE', 'TAX_WITHHOLDING_PAYABLE', 'REFUND_RESERVE', 'AFFILIATE_PAYABLE']) {
    assert.ok(prisma.includes(v), `LedgerAccountType union ${v}`);
  }
  assert.ok(prisma.includes('enum TransactionEntryType'), 'TransactionEntryType enum');
  for (const m of ['model FinancialClearinghouseLedger', 'model SellerPayout', 'model RevenueShareRule']) {
    assert.ok(prisma.includes(m), m);
  }
  assert.ok(prisma.includes('referenceCode String?              @unique'), 'idempotency key unique');
  assert.ok(prisma.includes('@@unique([tenantId, productType])'), 'rule uniqueness');
  assert.ok(prisma.includes('transRef           String?                        @unique'), 'payout transRef unique');
  assert.ok(prisma.includes('clearingEntries      FinancialClearinghouseLedger[]'), 'Order back-relation');
  assert.ok(prisma.includes('sellerPayouts      SellerPayout[]'), 'User back-relation');
  assert.ok(prisma.includes('@@index([holdingUntil])'), '113 sweep index intact');
  ok('11. Prisma Gate 1 (enum union + 3 models + keys + relations)');
}

// ---------- 12. Frontend Gate 3 (5 states, trace, format, proxies) ----------
{
  const admin = readFileSync('apps/frontend/app/(admin)/financial-clearinghouse/page.tsx', 'utf8');
  for (const s of ['FIN_INIT', 'IDLE', 'RECONCILING', 'SETTLED', 'DISPUTE_HOLD']) {
    assert.ok(admin.includes(s), `dashboard state ${s}`);
  }
  assert.ok(admin.includes('dispute-hold-banner') && admin.includes('settled-badge'), 'hold banner + settled badge');
  const creator = readFileSync('apps/frontend/app/(creator)/payout-center/page.tsx', 'utf8');
  for (const s of ['FIN_INIT', 'IDLE', 'LOADING', 'SETTLED', 'ERROR']) {
    assert.ok(creator.includes(s), `payout center state ${s}`);
  }
  assert.ok(creator.includes('payout-settled') && creator.includes('50 ทวิ'), 'settled receipt + cert link');
  const cards = readFileSync('apps/frontend/components/clearing/ClearingSummaryCards.tsx', 'utf8');
  assert.ok(cards.includes('metric-gross') && cards.includes('metric-tax') && cards.includes('Audit trace'), 'metric cards + trace modal');
  const table = readFileSync('apps/frontend/components/clearing/LedgerTable.tsx', 'utf8');
  assert.ok(table.includes('ledger-row') && table.includes('payout-available') && table.includes('100'), 'ledger rows + payout floor');
  const lib = readFileSync('apps/frontend/lib/clearing/clearing-client.ts', 'utf8');
  assert.ok(lib.includes('formatThb') && lib.includes('minimumFractionDigits: 2'), '2-decimal accuracy UI');
  assert.ok(!lib.includes('recharts') && !lib.includes('lucide') && !lib.includes('framer'), 'no heavy viz deps');
  for (const p of [
    'apps/frontend/app/api/v1/admin/clearing/summary/route.ts',
    'apps/frontend/app/api/v1/admin/clearing/ledger/route.ts',
    'apps/frontend/app/api/v1/admin/clearing/settle/route.ts',
    'apps/frontend/app/api/v1/admin/clearing/reconcile/route.ts',
    'apps/frontend/app/api/v1/creator/payout/request/route.ts',
    'apps/frontend/app/api/v1/creator/payout/balance/route.ts',
  ]) {
    assert.ok(readFileSync(p, 'utf8').includes('localhost:4000'), `proxy backend: ${p}`);
  }
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  for (const e of ['ClearinghouseLedgerEntrySchema', 'SellerPayoutRequestSchema', 'splitSettlement', 'assertSettlementBalanced', 'forecastNet', 'CLEARINGHOUSE_STREAM']) {
    assert.ok(barrel.includes(e), `barrel ${e}`);
  }
  ok('12. Frontend 5-state + trace + 2-dec + 6 proxies + barrel');
}
}

main()
  .then(() => console.log(`\nPhase 114 contracts: ${passed}/12 groups passed`))
  .catch((err) => {
    console.error('\nPhase 114 contracts FAILED:', err);
    process.exit(1);
  });
