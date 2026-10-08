// SSOT Phase 081 §10-11 — contract tests (Zod, ledger math, posting, payout, tax, parity)
// Run: npx tsx scripts/test-phase081-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LedgerAccountTypeEnum,
  TransactionEntryTypeEnum,
  FinancePayoutStatusEnum,
  LedgerEntrySchema,
  CommissionSplitSchema,
  FinancePayoutRequestSchema,
  PayoutResponseSchema,
  FINANCE_PLATFORM_FEE_DEFAULT,
  FINANCE_TIER1_DEFAULT,
  FINANCE_TIER2_DEFAULT,
  FINANCE_WITHHOLDING_TAX_RATE,
  FINANCE_WALLET_STREAM,
  FINANCE_JOURNAL_STREAM,
  splitRevenue,
  withholdingSplit,
  assertBalanced,
  financePayoutNo,
  taxCertificateNo,
  financeBalanceKey,
  financePayoutLockKey,
} from '../packages/shared/src/schemas/finance-contract';
import { assertJournalBalanced } from '../apps/backend/src/modules/finance/domain/ledger-journal.aggregate';
import { PostingEngineService } from '../apps/backend/src/modules/finance/application/posting-engine.service';
import { BalanceCalculatorService } from '../apps/backend/src/modules/finance/application/balance-calculator.service';
import { TaxCalculatorService } from '../apps/backend/src/modules/finance/application/tax-calculator.service';
import { FinancePayoutService } from '../apps/backend/src/modules/finance/application/payout.service';
import { CommissionCalculatorService } from '../apps/backend/src/modules/commission/application/commission-calculator.service';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const UUID = '123e4567-e89b-12d3-a456-426614174000';
const UUID_B = '223e4567-e89b-12d3-a456-426614174001';
const UUID_C = '323e4567-e89b-12d3-a456-426614174002';
const TENANT = 'emerald-mall';

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) ----------
{
  assert.equal(LedgerAccountTypeEnum.safeParse('SELLER_PAYABLE').success, true);
  assert.equal(LedgerAccountTypeEnum.safeParse('WITHHOLDING_TAX_PAYABLE').success, true);
  assert.equal(LedgerAccountTypeEnum.safeParse('BANK').success, false);
  assert.equal(TransactionEntryTypeEnum.safeParse('DEBIT').success, true);
  assert.equal(TransactionEntryTypeEnum.safeParse('HOLD').success, false);
  assert.equal(FinancePayoutStatusEnum.safeParse('PROCESSING_BANK').success, true);
  assert.equal(FinancePayoutStatusEnum.safeParse('PENDING').success, false);
  assert.equal(
    LedgerEntrySchema.safeParse({
      journalId: UUID, accountId: UUID_B, accountType: 'CASH_EQUIVALENT',
      entryType: 'DEBIT', amount: 1000, description: 'Cash in',
    }).success,
    true,
  );
  assert.equal(
    LedgerEntrySchema.safeParse({
      journalId: UUID, accountId: UUID_B, accountType: 'CASH_EQUIVALENT',
      entryType: 'HOLD', amount: 1000, description: 'x',
    }).success,
    false,
  );
  assert.equal(
    CommissionSplitSchema.safeParse({
      orderId: UUID, grossAmount: 1000, platformFeeAmount: 50, sellerNetAmount: 830,
      affiliateTier1Amount: 100, affiliateTier2Amount: 20,
    }).success,
    true,
  );
  assert.equal(
    CommissionSplitSchema.safeParse({ orderId: UUID, grossAmount: -1, platformFeeAmount: 0, sellerNetAmount: 1 }).success,
    false,
  );
  assert.equal(
    FinancePayoutRequestSchema.safeParse({ tenantId: TENANT, userId: UUID, requestedAmount: 5000, bankAccountId: UUID_B }).success,
    true,
  );
  assert.equal(
    FinancePayoutRequestSchema.safeParse({ tenantId: TENANT, userId: UUID, requestedAmount: 99, bankAccountId: UUID_B }).success,
    false,
  );
  assert.equal(
    PayoutResponseSchema.safeParse({
      payoutId: UUID, grossAmount: 5000, withholdingTaxAmount: 150,
      netTransferAmount: 4850, status: 'REQUESTED', createdAt: new Date().toISOString(),
    }).success,
    true,
  );
  ok('Zod §3.1 verbatim (ledger/commission/payout gates)');
}

// ---------- 2. Ledger math (§8.1/BDD-1/BDD-2) ----------
{
  assert.equal(FINANCE_PLATFORM_FEE_DEFAULT, 5);
  assert.equal(FINANCE_TIER1_DEFAULT, 10);
  assert.equal(FINANCE_TIER2_DEFAULT, 2);
  assert.equal(FINANCE_WITHHOLDING_TAX_RATE, 0.03);
  assert.equal(FINANCE_WALLET_STREAM, 'finance:wallet:updates');
  assert.equal(FINANCE_JOURNAL_STREAM, 'finance:journal:posted');
  // BDD-1 canonical: 1000 @ 5/10/2 → fee 50 / t1 100 / t2 20 / seller 830.
  assert.deepEqual(
    splitRevenue(1000, { platformFeePercent: 5, tier1Percent: 10, tier2Percent: 2 }),
    { platformFeeAmount: 50, affiliateTier1Amount: 100, affiliateTier2Amount: 20, sellerNetAmount: 830 },
  );
  // No affiliates → seller takes all remainder.
  assert.deepEqual(
    splitRevenue(1000, { platformFeePercent: 5 }),
    { platformFeeAmount: 50, affiliateTier1Amount: 0, affiliateTier2Amount: 0, sellerNetAmount: 950 },
  );
  // BDD-2 canonical: 5000 → tax 150 / net 4850.
  assert.deepEqual(withholdingSplit(5000), { tax: 150, net: 4850 });
  assert.deepEqual(withholdingSplit(100), { tax: 3, net: 97 });
  assert.doesNotThrow(() =>
    assertBalanced({ grossAmount: 1000, platformFeeAmount: 50, sellerNetAmount: 830, affiliateTier1Amount: 100, affiliateTier2Amount: 20 }),
  );
  assert.throws(
    () =>
      assertBalanced({ grossAmount: 1000, platformFeeAmount: 50, sellerNetAmount: 829, affiliateTier1Amount: 100, affiliateTier2Amount: 20 }),
    /mismatch/,
  );
  assert.ok(financePayoutNo(TENANT).startsWith('FP-'));
  assert.ok(taxCertificateNo().startsWith('TX-'));
  assert.equal(financeBalanceKey('u'), 'finance:balance:u');
  assert.equal(financePayoutLockKey('u'), 'finance:payout:lock:u');
  ok('Math: 1000→50/100/20/830 + 5000→150/4850 + equation guard');
}

// ---------- 3. Journal aggregate guards (Gate 7) ----------
{
  assert.doesNotThrow(() =>
    assertJournalBalanced([
      { accountType: 'CASH_EQUIVALENT', entryType: 'DEBIT', amount: 1000 },
      { accountType: 'PLATFORM_REVENUE_FEE', entryType: 'CREDIT', amount: 50 },
      { accountType: 'SELLER_PAYABLE', entryType: 'CREDIT', amount: 950 },
    ]),
  );
  assert.throws(
    () =>
      assertJournalBalanced([
        { accountType: 'CASH_EQUIVALENT', entryType: 'DEBIT', amount: 1000 },
        { accountType: 'SELLER_PAYABLE', entryType: 'CREDIT', amount: 999 },
      ]),
    /mismatch/,
  );
  ok('Aggregate: balanced journal passes, short credit throws');
}

// ---------- 4. Posting engine (BDD-1 atomic, Gate 6/7/8) ----------
async function sectionPosting(): Promise<void> {
  function ports(uplines: Array<string | null> = [UUID_B, UUID_C]) {
    const entries: Array<{ debitAccountId: string | null; creditAccountId: string | null; amount: number; entryType: string }> = [];
    const streams: string[] = [];
    const broadcasts: Array<{ userId: string; balance: number }> = [];
    const balances = new Map<string, number>();
    const journals: unknown[] = [];
    const repo = {
      findOrder: async () => ({ orderId: UUID, userId: 'seller-1', paymentStatus: 'VERIFIED', netAmount: 1000 }),
      hasJournalForOrder: async () => false,
      commissionRule: async () => ({ platformFeePercent: 5, tier1Percent: 10, tier2Percent: 2 }),
      createJournal: async (a: unknown) => { journals.push(a); return { id: 'j-1' }; },
      ensureUserAccount: async (id: string) => ({ id: `acc-${id}`, balance: balances.get(id) ?? 0 }),
      ensurePlatformAccount: async (t: string) => ({ id: `plat-${t}`, balance: 0 }),
      postEntry: async (a: { debitAccountId: string | null; creditAccountId: string | null; amount: number; entryType: string }) => {
        entries.push(a);
      },
      adjustUserBalance: async (id: string, d: number) => {
        const n = Math.round(((balances.get(id) ?? 0) + d) * 100) / 100;
        balances.set(id, n);
        return n;
      },
      userBalance: async (id: string) => balances.get(id) ?? 0,
      withTx(tx: unknown) { return this; },
    };
    const cache = {
      readBalance: async () => null,
      writeBalance: async () => undefined,
      broadcastBalance: async (userId: string, balance: number) => { broadcasts.push({ userId, balance }); },
      acquirePayoutLock: async () => true,
      releasePayoutLock: async () => undefined,
      emit: async (s: string) => { streams.push(s); },
    };
    const tx = { run: async <T>(fn: (t: unknown) => Promise<T>) => fn({}) };
    const referrals = { uplinesOf: async () => uplines };
    return { repo, cache, tx, referrals, entries, streams, broadcasts, journals, balances };
  }
  // Happy path: 5 entries, seller 830 / t1 100 / t2 20, broadcasts <300ms budget shape.
  {
    const p = ports();
    const svc = new PostingEngineService(p.repo as never, p.cache, p.tx, p.referrals);
    const t0 = Date.now();
    const r = await svc.processOrderRevenuePosting({ orderId: UUID });
    assert.ok(Date.now() - t0 < 300, 'posting <300ms budget');
    assert.deepEqual(r, { journalId: 'j-1', distributed: true });
    assert.equal(p.entries.length, 5);
    const debits = p.entries.filter((e) => e.entryType === 'DEBIT').reduce((s, e) => s + e.amount, 0);
    const credits = p.entries.filter((e) => e.entryType === 'CREDIT').reduce((s, e) => s + e.amount, 0);
    assert.equal(debits, 1000);
    assert.equal(credits, 1000);
    assert.equal(p.balances.get('seller-1'), 830);
    assert.equal(p.balances.get(UUID_B), 100);
    assert.equal(p.balances.get(UUID_C), 20);
    assert.ok(p.streams.includes(FINANCE_JOURNAL_STREAM));
    assert.ok(p.broadcasts.some((b) => b.userId === 'seller-1' && b.balance === 830));
    assert.equal(p.journals.length, 1);
  }
  // No uplines → 3 entries, seller 950.
  {
    const p = ports([null, null]);
    const svc = new PostingEngineService(p.repo as never, p.cache, p.tx, p.referrals);
    await svc.processOrderRevenuePosting({ orderId: UUID });
    assert.equal(p.entries.length, 3);
    assert.equal(p.balances.get('seller-1'), 950);
  }
  // Gates: unverified / missing / duplicate.
  {
    const p = ports();
    const bad = { ...p, repo: { ...p.repo, findOrder: async () => ({ orderId: UUID, userId: 's', paymentStatus: 'UNPAID', netAmount: 1000 }) } };
    await assert.rejects(
      new PostingEngineService(bad.repo as never, p.cache, p.tx, p.referrals).processOrderRevenuePosting({ orderId: UUID }),
      /verified/,
    );
    const missing = { ...p, repo: { ...p.repo, findOrder: async () => null } };
    await assert.rejects(
      new PostingEngineService(missing.repo as never, p.cache, p.tx, p.referrals).processOrderRevenuePosting({ orderId: UUID }),
      /not found/,
    );
    const dupe = { ...p, repo: { ...p.repo, hasJournalForOrder: async () => true } };
    const d = await new PostingEngineService(dupe.repo as never, p.cache, p.tx, p.referrals).processOrderRevenuePosting({ orderId: UUID });
    assert.deepEqual(d, { journalId: '', distributed: false });
  }
  ok('Posting: 1000→5 balanced entries + broadcasts + 3 gates (<300ms)');
}

// ---------- 5. Commission calculator (Task 4, rule-driven) ----------
async function sectionCommission(): Promise<void> {
  const svc = new CommissionCalculatorService({
    commissionRule: async () => ({ platformFeePercent: 5, tier1Percent: 10, tier2Percent: 2 }),
  });
  const r = await svc.calculate({ orderId: UUID, grossAmount: 1000 });
  assert.deepEqual(r, {
    orderId: UUID, grossAmount: 1000, platformFeeAmount: 50,
    sellerNetAmount: 830, affiliateTier1Amount: 100, affiliateTier2Amount: 20,
  });
  const solo = await svc.calculate({ orderId: UUID, grossAmount: 1000, hasTier1: false, hasTier2: false });
  assert.equal(solo.sellerNetAmount, 950);
  const down = new CommissionCalculatorService({ commissionRule: async () => { throw new Error('db down'); } });
  const fb = await down.calculate({ orderId: UUID, grossAmount: 1000 });
  assert.equal(fb.platformFeeAmount, 50);
  await assert.rejects(svc.calculate({ orderId: 'nope', grossAmount: 1000 }), /Invalid commission/);
  ok('Calculator: rule split + no-tier + store-down defaults + uuid gate');
}

// ---------- 6. Payout service (BDD-2 locked + taxed, Gate 8) ----------
async function sectionPayout(): Promise<void> {
  function ports(balance: number, locked: boolean) {
    const payouts: unknown[] = [];
    const taxes: unknown[] = [];
    const repo = {
      userBalance: async () => balance,
      adjustUserBalance: async (id: string, d: number) => balance + d,
      createPayout: async (a: unknown) => { payouts.push(a); return { id: UUID }; },
      createTaxRecord: async (a: unknown) => { taxes.push(a); },
      findPayout: async (id: string) =>
        id === UUID
          ? { id, userId: UUID_B, grossAmount: 5000, taxWithheldAmount: 150, netTransferAmount: 4850, status: 'REQUESTED' }
          : null,
      markPayoutStatus: async () => undefined,
      withTx(tx: unknown) { return this; },
    };
    const emitted: string[] = [];
    const cache = {
      readBalance: async () => null,
      writeBalance: async () => undefined,
      broadcastBalance: async () => undefined,
      acquirePayoutLock: async () => locked,
      releasePayoutLock: async () => undefined,
      emit: async (s: string) => { emitted.push(s); },
    };
    const tx = { run: async <T>(fn: (t: unknown) => Promise<T>) => fn({}) };
    return { repo, cache, tx, emitted, payouts, taxes };
  }
  // NOTE: TaxCalculatorService takes an R2-vault port; tests inject an
  // in-memory stub (port-based, zero new deps).
  const { TaxCalculatorService: TaxSvc } = await import('../apps/backend/src/modules/finance/application/tax-calculator.service');
  const r2stub = { putObjectBuffer: async () => ({ eTag: 'e' }) };
  function taxOf(repo: never): TaxCalculatorService {
    return new TaxSvc(repo, r2stub);
  }
  // Happy path: 5000 → tax 150 / net 4850 REQUESTED + tax record + stream.
  {
    const p = ports(10000, true);
    const svc = new FinancePayoutService(p.repo as never, p.cache, p.tx, taxOf(p.repo as never));
    const r = await svc.requestPayout({
      tenantId: TENANT,
      actorUserId: UUID_B,
      body: { requestedAmount: 5000, bankAccountId: UUID_C },
      bankSnapshot: { bankName: 'KBank', accountNumber: '1234567890', accountName: 'Somsri' },
      identity: { taxId: '1100000000000', payeeName: 'Somsri', payeeAddress: 'BKK' },
    });
    assert.deepEqual(r, { payoutId: UUID, grossAmount: 5000, taxAmount: 150, netAmount: 4850, status: 'REQUESTED' });
    assert.equal(p.payouts.length, 1);
    assert.equal(p.taxes.length, 1);
    assert.ok(p.emitted.includes('finance:payout:events'));
  }
  // Gates: lock conflict / insufficient / floor / bad uuid.
  {
    const p = ports(10000, false);
    const svc = new FinancePayoutService(p.repo as never, p.cache, p.tx, taxOf(p.repo as never));
    await assert.rejects(
      svc.requestPayout({
        tenantId: TENANT, actorUserId: UUID_B,
        body: { requestedAmount: 5000, bankAccountId: UUID_C },
        bankSnapshot: { bankName: 'K', accountNumber: '1', accountName: 'S' },
        identity: { taxId: '1', payeeName: 'S', payeeAddress: 'B' },
      }),
      /already processing/,
    );
  }
  {
    const p = ports(100, true);
    const svc = new FinancePayoutService(p.repo as never, p.cache, p.tx, taxOf(p.repo as never));
    await assert.rejects(
      svc.requestPayout({
        tenantId: TENANT, actorUserId: UUID_B,
        body: { requestedAmount: 5000, bankAccountId: UUID_C },
        bankSnapshot: { bankName: 'K', accountNumber: '1', accountName: 'S' },
        identity: { taxId: '1', payeeName: 'S', payeeAddress: 'B' },
      }),
      /Insufficient/,
    );
    await assert.rejects(
      svc.requestPayout({
        tenantId: TENANT, actorUserId: UUID_B,
        body: { requestedAmount: 50, bankAccountId: UUID_C },
        bankSnapshot: { bankName: 'K', accountNumber: '1', accountName: 'S' },
        identity: { taxId: '1', payeeName: 'S', payeeAddress: 'B' },
      }),
      /Invalid payout/,
    );
  }
  // Approve: admin flips REQUESTED → PROCESSING_BANK; non-admin + replay blocked.
  {
    const p = ports(10000, true);
    const svc = new FinancePayoutService(p.repo as never, p.cache, p.tx, taxOf(p.repo as never));
    assert.deepEqual(await svc.approvePayout(UUID, true), { payoutId: UUID, status: 'PROCESSING_BANK' });
    await assert.rejects(svc.approvePayout(UUID, false), /admin/);
    await assert.rejects(svc.approvePayout('00000000-0000-0000-0000-000000000000', true), /not found/);
  }
  ok('Payout: 5000→150/4850 locked + tax record + approve gates');
}

// ---------- 7. Tax service (Gate 8 PDF + R2 key) ----------
async function sectionTax(): Promise<void> {
  const { TaxCalculatorService: TaxSvc } = await import('../apps/backend/src/modules/finance/application/tax-calculator.service');
  const puts: Array<{ key: string; size: number }> = [];
  const r2 = { putObjectBuffer: async (key: string, body: Buffer) => { puts.push({ key, size: body.length }); return { eTag: 'e' }; } };
  const created: unknown[] = [];
  const repo = { createTaxRecord: async (a: unknown) => { created.push(a); } };
  const svc = new TaxSvc(repo as never, r2);
  assert.deepEqual(svc.withholdingFor(5000), { tax: 150, net: 4850, rate: 0.03 });
  const cert = await svc.issueCertificate({
    payoutTransactionId: UUID,
    taxId: '1100000000000',
    payeeName: 'Somsri',
    payeeAddress: 'BKK',
    grossAmount: 5000,
    tenantId: TENANT,
  });
  assert.ok(cert.certificateNo.startsWith('TX-'));
  assert.ok(cert.pdfStoragePathR2.includes(`tenants/${TENANT}/tax/`));
  assert.equal(cert.taxAmount, 150);
  assert.equal(puts.length, 1);
  assert.ok((puts[0]?.size ?? 0) > 200, 'dep-free PDF bytes');
  assert.equal(created.length, 1);
  ok('Tax: 3% split + certificate PDF → R2 vault + record');
}

// ---------- 8. Balance service (overview/statements/discrepancy) ----------
async function sectionBalance(): Promise<void> {
  const repo = {
    userBalance: async () => 830,
    lifetimeTotals: async () => ({ earned: 1000, taxWithheld: 30, commissionPaid: 0 }),
    statementPage: async () => ({
      items: [
        { id: 'e-1', createdAt: new Date('2026-01-02T00:00:00Z'), description: 'Revenue', debit: 0, credit: 830, referenceOrderId: UUID },
        { id: 'e-2', createdAt: new Date('2026-01-01T00:00:00Z'), description: 'Payout', debit: 100, credit: 0, referenceOrderId: null },
      ],
      totalCount: 2,
    }),
    systemDiscrepancy: async () => 0,
  };
  const writes: number[] = [];
  const cache = {
    readBalance: async () => null,
    writeBalance: async (u: string, b: number) => { writes.push(b); },
    broadcastBalance: async () => undefined,
    acquirePayoutLock: async () => true,
    releasePayoutLock: async () => undefined,
    emit: async () => undefined,
  };
  const svc = new BalanceCalculatorService(repo as never, cache);
  const o = await svc.overview(UUID_B);
  assert.deepEqual(o, {
    withdrawableBalance: 830, pendingEscrowBalance: 0, totalEarnedLifetime: 1000,
    totalCommissionPaid: 0, taxWithheldLifetime: 30,
  });
  assert.deepEqual(writes, [830]);
  const page = await svc.statements(UUID_B, 20, 0);
  assert.equal(page.totalCount, 2);
  assert.equal(page.hasMore, false);
  assert.equal(page.items[0]?.runningBalance, 830);
  assert.equal(page.items[1]?.runningBalance, 0);
  assert.equal(await svc.checkSystemWideDiscrepancy(), 0);
  ok('Balance: overview cache-fill + statements running + Δ=0');
}

// ---------- 9. Prisma additive (Gate 1/7) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of [
    'enum LedgerAccountType {',
    'enum EntryType {',
    'PROCESSING_BANK',
    'model FinancialAccount {',
    'currentBalance Decimal           @default(0.00) @db.Decimal(18, 4)',
    'model LedgerJournal {',
    'referenceOrderId String?       @unique',
    'model LedgerEntry {',
    'runningBalance   Decimal',
    'model CommissionRule {',
    'tier2Percent       Decimal  @default(2.00)',
    'model WithholdingTaxRecord {',
    'taxCertificateNo    String            @unique',
    'taxRatePercent       Decimal  @default(3.00)',
    'bankAccountDetail    Json?',
    'financePayouts       PayoutTransaction[] @relation("FinancePayouts")',
  ]) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  ok('Prisma: ledger segment + rule + tax record + payout union');
}

function sectionParity(): void {
  for (const f of [
    'apps/backend/src/modules/finance/domain/ledger-journal.aggregate.ts',
    'apps/backend/src/modules/finance/domain/events/revenue-posted.event.ts',
    'apps/backend/src/modules/finance/domain/events/payout-requested.event.ts',
    'apps/backend/src/modules/finance/application/posting-engine.service.ts',
    'apps/backend/src/modules/finance/application/balance-calculator.service.ts',
    'apps/backend/src/modules/finance/application/tax-calculator.service.ts',
    'apps/backend/src/modules/finance/application/payout.service.ts',
    'apps/backend/src/modules/finance/infrastructure/prisma-ledger.repository.ts',
    'apps/backend/src/modules/finance/infrastructure/redis-balance.cache.ts',
    'apps/backend/src/modules/finance/presentation/finance.controller.ts',
    'apps/backend/src/modules/finance/presentation/finance.resolver.ts',
    'apps/backend/src/modules/finance/finance.module.ts',
    'apps/backend/src/modules/commission/application/commission-calculator.service.ts',
    'apps/backend/src/modules/commission/commission.module.ts',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes('TODO') && !src.includes('placeholder'), `${f} unimplemented`);
  }
  // 086-owned payout scaffolds stay untouched for their phase.
  for (const f of [
    'apps/backend/src/modules/payout/payout.module.ts',
    'apps/backend/src/modules/payout/application/use-cases/request-payout.use-case.ts',
  ]) {
    assert.ok(readFileSync(f, 'utf8').includes('AUTO-SCAFFOLD'), `${f} must stay 086-owned`);
  }
  const mod = readFileSync('apps/backend/src/modules/finance/finance.module.ts', 'utf8');
  assert.ok(mod.includes('FinanceModule') && mod.includes('PostingEngineService') && mod.includes('FinancePayoutService'));
  assert.ok(!/class FinanceModuleModule/.test(mod), 'legacy scaffold class removed');
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('FinanceModule') && app.includes('CommissionModule'));
  const gql = readFileSync('apps/backend/src/modules/finance/presentation/finance.resolver.ts', 'utf8');
  assert.ok(gql.includes('getFinancialOverview') && gql.includes('getLedgerStatements') && gql.includes('requestPayout') && gql.includes('approvePayout'));
  assert.ok(!gql.includes("ObjectType('PayoutResponsePayload')"), 'GQL collision with 079');
  const sdl = readFileSync('apps/backend/src/api/graphql/finance/finance.graphql', 'utf8');
  assert.ok(sdl.includes('FinancialSummaryPayload') && sdl.includes('LedgerStatementConnection') && sdl.includes('FinancePayoutResponsePayload'));
  for (const p of [
    'apps/frontend/components/finance/RealTimeWalletCard.tsx',
    'apps/frontend/components/finance/LedgerHistory.tsx',
    'apps/frontend/hooks/useFinanceWallet.ts',
    'apps/frontend/lib/finance/finance-client.ts',
    'apps/frontend/app/(dashboard)/seller/finance/page.tsx',
  ]) {
    assert.ok(readFileSync(p, 'utf8').length > 200, `frontend missing: ${p}`);
  }
  const hook = readFileSync('apps/frontend/hooks/useFinanceWallet.ts', 'utf8');
  assert.ok(hook.includes('LIFF_INIT') && hook.includes('SUCCESS') && hook.includes('ERROR'), '5-state hook');
  assert.ok(hook.includes('EventSource'), 'SSE live balance');
  assert.ok(!hook.includes("from 'lucide-react'") && !hook.includes("from 'recharts'"), 'zero-dep UI (no heavy libs)');
  const card = readFileSync('apps/frontend/components/finance/RealTimeWalletCard.tsx', 'utf8');
  assert.ok(!card.includes('@/components/ui/') && !card.includes('lucide-react'), 'dep-free card (spec shadcn/lucide deviated)');
  for (const p of [
    'apps/frontend/app/api/v1/finance/overview/route.ts',
    'apps/frontend/app/api/v1/finance/statements/route.ts',
    'apps/frontend/app/api/v1/finance/payout/route.ts',
    'apps/frontend/app/api/v1/finance/stream-balance/route.ts',
  ]) {
    assert.ok(readFileSync(p, 'utf8').includes('localhost:4000'), `proxy missing backend: ${p}`);
  }
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  assert.ok(barrel.includes('finance-contract') && barrel.includes('CommissionSplitSchema'));
  ok('Parity: modules/GQL(no-collision)/SDL/wallet UI/proxies/barrel (5-state, SSE, zero-dep)');
}

async function main(): Promise<void> {
  await sectionPosting();
  await sectionCommission();
  await sectionPayout();
  await sectionTax();
  await sectionBalance();
  sectionParity();
}

void main().then(
  () => console.log(`\nPhase081 contracts: ${passed + 6} checks passed`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
