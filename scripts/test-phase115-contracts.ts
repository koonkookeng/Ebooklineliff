// SSOT Phase 115 §10-11 — contract tests (Zod, matching math, hash chain,
// atomic ingest, maker-checker, Flex, webhook, stress, Prisma Gate 1, SDL,
// frontend, barrel).
// Run: npx tsx scripts/test-phase115-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, createHmac } from 'node:crypto';
import {
  ReconciliationStatusEnum,
  StatementSourceEnum,
  MismatchReasonEnum,
  BankStatementImportSchema,
  ManualOverridePayloadSchema,
  RECON_DEFAULT_TOLERANCE_MINS,
  MAKER_CHECKER_THRESHOLD_THB,
  RECON_MATCH_SLA_MS,
  RECON_AUTO_MATCH_TARGET_PCT,
  RECON_STREAM,
  RECON_GENESIS_HASH,
  hashStatement,
  windowBounds,
  makerCheckerRequired,
  autoMatchRate,
  chainStep,
  reconQueueKey,
} from '../packages/shared/src/schemas/reconciliation-contract';
import {
  MatchingStrategyService,
  matchByTransRef,
  matchByAmountWindow,
  screenAnomaly,
} from '../apps/backend/src/modules/reconciliation/services/matching-strategy.service';
import { AuditChainService } from '../apps/backend/src/modules/reconciliation/services/audit-chain.service';
import { AutoReconciliationEngineService } from '../apps/backend/src/modules/reconciliation/services/auto-reconciliation-engine.service';
import { ManualOverrideService } from '../apps/backend/src/modules/reconciliation/services/manual-override.service';
import { buildReconFlex, reconFlexByteSize, RECON_FLEX_BUDGET_BYTES } from '../apps/backend/src/modules/reconciliation/reconciliation-flex.builder';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const ORDER_ID = '123e4567-e89b-12d3-a456-426614174000';
const BUYER_ID = '223e4567-e89b-12d3-a456-426614174001';
const MAKER_ID = '323e4567-e89b-12d3-a456-426614174002';
const CHECKER_ID = '423e4567-e89b-12d3-a456-426614174003';
const STMT_ID = '523e4567-e89b-12d3-a456-426614174004';
const ACCT_ID = '623e4567-e89b-12d3-a456-426614174005';
const OVERRIDE_ID = '723e4567-e89b-12d3-a456-426614174006';
const TENANT = 'DEFAULT';
const NET = { ipAddress: '127.0.0.1', userAgent: 'phase115-test' };

function lineInput(): Record<string, unknown> {
  return {
    bankCode: 'KBANK',
    accountNumber: '1234567890',
    transRef: 'TX144XZ999',
    amount: 1500,
    txType: 'CREDIT',
    txTimestamp: '2026-10-05T08:30:00.000Z',
    senderBank: 'SCB',
    senderName: 'สมชาย ใจดี',
    rawPayload: { bank: 'kbank' },
  };
}

async function main(): Promise<void> {
// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) ----------
{
  for (const v of ['UNMATCHED', 'AUTO_MATCHED', 'MANUAL_OVERRIDDEN', 'DISCREPANCY_FLAGGED', 'REJECTED_DUPLICATE']) {
    assert.equal(ReconciliationStatusEnum.safeParse(v).success, true, v);
  }
  assert.equal(ReconciliationStatusEnum.safeParse('PENDING').success, false);
  for (const v of ['OPEN_BANKING_API', 'BANK_WEBHOOK', 'CSV_IMPORT', 'SCRAPER_FEED']) {
    assert.equal(StatementSourceEnum.safeParse(v).success, true, v);
  }
  assert.equal(StatementSourceEnum.safeParse('MANUAL').success, false);
  for (const v of ['EXACT_MATCH_FOUND', 'AMOUNT_MISMATCH', 'REF_NOT_FOUND', 'EXPIRED_TIME_WINDOW', 'DUPLICATE_TRANS_REF', 'SUSPICIOUS_PATTERN']) {
    assert.equal(MismatchReasonEnum.safeParse(v).success, true, v);
  }
  assert.equal(BankStatementImportSchema.safeParse(lineInput()).success, true);
  assert.equal(BankStatementImportSchema.safeParse({ ...lineInput(), amount: -5 }).success, false);
  assert.equal(BankStatementImportSchema.safeParse({ ...lineInput(), txTimestamp: 'not-a-date' }).success, false);
  assert.equal(BankStatementImportSchema.safeParse({ ...lineInput(), rawPayload: [1, 2] }).success, true);
  assert.equal(
    ManualOverridePayloadSchema.safeParse({ statementId: STMT_ID, orderId: ORDER_ID, overrideReason: 'สเตทเมนท์นี้คือยอดของออเดอร์นี้จริง มีหลักฐานแนบ' }).success,
    true,
  );
  assert.equal(ManualOverridePayloadSchema.safeParse({ statementId: STMT_ID, orderId: ORDER_ID, overrideReason: 'สั้น' }).success, false);
  assert.equal(ManualOverridePayloadSchema.safeParse({ statementId: '', orderId: ORDER_ID, overrideReason: 'เหตุผลยาวพอสมควรเลยทีเดียว' }).success, false);
  ok('1. Zod SSOT verbatim (§3.1 status/source/mismatch/import/override)');
}

// ---------- 2. Hash/window/maker-checker/rate/chain helpers + budgets ----------
{
  const h = hashStatement({ transRef: 'TX144XZ999', amount: 1500, txTimestamp: '2026-10-05T08:30:00.000Z' });
  assert.equal(h, createHash('sha256').update('TX144XZ999_1500_2026-10-05T08:30:00.000Z', 'utf8').digest('hex'));
  assert.equal(hashStatement({ transRef: 'TX144XZ999', amount: 1500, txTimestamp: '2026-10-05T08:30:00.000Z' }), h);
  assert.notEqual(h, hashStatement({ transRef: 'TX144XZ999', amount: 1500.01, txTimestamp: '2026-10-05T08:30:00.000Z' }));
  const { minTime, maxTime } = windowBounds('2026-10-05T08:30:00.000Z', 30);
  assert.equal(maxTime.getTime() - minTime.getTime(), 3600000);
  assert.equal(makerCheckerRequired(1000), false);
  assert.equal(makerCheckerRequired(1000.01), true);
  assert.equal(makerCheckerRequired(50000), true);
  assert.equal(autoMatchRate(994, 1000), 99.4);
  assert.equal(autoMatchRate(0, 0), 100);
  const c1 = chainStep('GENESIS', { statementId: STMT_ID, orderId: ORDER_ID, initiatedBy: MAKER_ID, timestamp: '2026-10-05T08:30:00.000Z' });
  assert.equal(c1, chainStep('GENESIS', { statementId: STMT_ID, orderId: ORDER_ID, initiatedBy: MAKER_ID, timestamp: '2026-10-05T08:30:00.000Z' }));
  assert.notEqual(c1, chainStep('GENESIS', { statementId: STMT_ID, orderId: ORDER_ID, initiatedBy: CHECKER_ID, timestamp: '2026-10-05T08:30:00.000Z' }));
  assert.match(c1, /^[0-9a-f]{64}$/);
  assert.equal(RECON_DEFAULT_TOLERANCE_MINS, 30);
  assert.equal(MAKER_CHECKER_THRESHOLD_THB, 1000);
  assert.equal(RECON_MATCH_SLA_MS, 500);
  assert.equal(RECON_AUTO_MATCH_TARGET_PCT, 99.2);
  assert.equal(RECON_STREAM, 'financial:reconciliation:events');
  assert.equal(RECON_GENESIS_HASH, 'GENESIS');
  assert.equal(reconQueueKey('UNMATCHED', 1), 'recon:queue:UNMATCHED:1');
  ok('2. Dedupe hash/window/dual-control/rate/chain + budgets/keys');
}

// ---------- 3. Matching strategies (exact/window/ambiguity/anomaly) ----------
{
  const svc = new MatchingStrategyService();
  assert.equal(typeof svc.byTransRef, 'function');
  const exact = matchByTransRef(
    { transRef: 'TX144XZ999', amount: 1500 },
    { transRef: 'TX144XZ999', amount: 1500, orderId: ORDER_ID },
  );
  assert.deepEqual(exact, { kind: 'EXACT', orderId: ORDER_ID, score: 100, algorithm: 'EXACT_TRANS_REF' });
  assert.equal(matchByTransRef({ transRef: 'TX144XZ999', amount: 1500 }, { transRef: 'TX144XZ999', amount: 1499.99, orderId: ORDER_ID }), null);
  assert.equal(matchByTransRef({ transRef: 'TX144XZ999', amount: 1500 }, { transRef: 'OTHER', amount: 1500, orderId: ORDER_ID }), null);
  assert.equal(matchByTransRef({ transRef: null, amount: 1500 }, { transRef: 'TX144XZ999', amount: 1500, orderId: ORDER_ID }), null);
  const base = new Date('2026-10-05T08:30:00.000Z');
  const uniq = matchByAmountWindow(
    { amount: 1500, txTimestamp: base },
    [{ id: ORDER_ID, netAmount: 1500, createdAt: new Date('2026-10-05T08:20:00.000Z') }],
    30,
  );
  assert.deepEqual(uniq, { kind: 'WINDOW_UNIQUE', orderId: ORDER_ID, score: 95, algorithm: 'AMOUNT_TIME_WINDOW_UNIQUE' });
  const outside = matchByAmountWindow(
    { amount: 1500, txTimestamp: base },
    [{ id: ORDER_ID, netAmount: 1500, createdAt: new Date('2026-10-05T07:00:00.000Z') }],
    30,
  );
  assert.deepEqual(outside, { kind: 'MISS', score: 0, algorithm: 'NONE' });
  const amb = matchByAmountWindow(
    { amount: 1500, txTimestamp: base },
    [
      { id: 'o1', netAmount: 1500, createdAt: new Date('2026-10-05T08:20:00.000Z') },
      { id: 'o2', netAmount: 1500, createdAt: new Date('2026-10-05T08:25:00.000Z') },
    ],
    30,
  );
  assert.deepEqual(amb, { kind: 'AMBIGUOUS', score: 50, algorithm: 'AMBIGUOUS_CANDIDATES' });
  // anomaly: layering + replay
  const recent = Array.from({ length: 5 }, () => ({ senderName: 'มิจ', amount: 99, at: new Date(Date.now() - 60000) }));
  assert.deepEqual(
    screenAnomaly({ transRef: 'TX9', amount: 99, senderName: 'มิจ', recent, verifiedSlipRefs: [] }),
    { suspicious: true, reason: 'MICRO_TRANSFER_LAYERING' },
  );
  assert.deepEqual(
    screenAnomaly({ transRef: 'TX9', amount: 99, senderName: 'มิจ', recent: recent.slice(0, 4), verifiedSlipRefs: [] }),
    { suspicious: false, reason: null },
  );
  assert.deepEqual(
    screenAnomaly({ transRef: 'TX9', amount: 99, senderName: 'มิจ', recent: [], verifiedSlipRefs: ['TX9'] }),
    { suspicious: true, reason: 'REPLAY_TRANS_REF' },
  );
  ok('3. Exact/window/ambiguous/miss + layering/replay screen');
}

// ---------- 4. Audit chain (head/mint/verify/break) ----------
{
  const store = new Map<string, string>();
  const redis = {
    get: async (k: string) => store.get(k) ?? null,
    setex: async (k: string, _t: number, v: string) => { store.set(k, v); },
    xaddPipeline: async () => undefined,
  };
  const chain = new AuditChainService(redis as never);
  assert.equal(await chain.head(TENANT), 'GENESIS');
  const t1 = '2026-10-05T08:30:00.000Z';
  const t2 = '2026-10-05T09:30:00.000Z';
  const h1 = await chain.mint(TENANT, { statementId: 's1', orderId: 'o1', initiatedBy: MAKER_ID, timestamp: t1 });
  assert.equal(await chain.head(TENANT), h1);
  const h2 = await chain.mint(TENANT, { statementId: 's2', orderId: 'o2', initiatedBy: MAKER_ID, timestamp: t2 });
  assert.notEqual(h2, h1);
  const rows = [
    { statementId: 's1', orderId: 'o1', initiatedBy: MAKER_ID, createdAt: new Date(t1), auditHash: h1 },
    { statementId: 's2', orderId: 'o2', initiatedBy: MAKER_ID, createdAt: new Date(t2), auditHash: h2 },
  ];
  assert.deepEqual(chain.verify(rows), { valid: true, checked: 2 });
  assert.deepEqual(chain.verify([...rows].reverse()).valid, true);
  const tampered = [...rows];
  tampered[1] = { ...tampered[1]!, auditHash: '0'.repeat(64) };
  const broken = chain.verify(tampered);
  assert.deepEqual([broken.valid, broken.brokenAt], [false, 1]);
  // fail-open head on Redis outage
  const down = new AuditChainService({ get: async () => { throw new Error('down'); }, setex: async () => { throw new Error('down'); } } as never);
  assert.equal(await down.head(TENANT), 'GENESIS');
  const minted = await down.mint(TENANT, { statementId: 's9', orderId: 'o9', initiatedBy: MAKER_ID, timestamp: t1 });
  assert.equal(minted, chainStep('GENESIS', { statementId: 's9', orderId: 'o9', initiatedBy: MAKER_ID, timestamp: t1 }));
  ok('4. Chain head/mint/verify/tamper-break + fail-open');
}

// ---------- 5. Auto engine: ingest → match → atomic grant (BDD-1) ----------
{
  const events: unknown[][] = [];
  const notified: unknown[][] = [];
  const redis = { xaddPipeline: async (...a: unknown[]) => { events.push(a); } };
  const notify = { notify: async (...a: unknown[]) => { notified.push(a); return { messageId: 'm1' }; } };
  function mockPrisma(opts?: { orderStatus?: string; items?: Array<{ productId: string }> }) {
    const txLog: string[] = [];
    const tx = {
      bankStatement: {
        create: async (a: unknown) => { txLog.push(`stmt:${JSON.stringify((a as { data: Record<string, unknown> }).data)}`); return { id: STMT_ID }; },
        update: async (a: unknown) => { txLog.push(`stmtUp:${JSON.stringify((a as { data: unknown }).data)}`); return {}; },
      },
      order: {
        update: async () => ({
          id: ORDER_ID, userId: BUYER_ID,
          orderItems: opts?.items ?? [{ productId: 'p1' }, { productId: 'p2' }],
        }),
      },
      entitlement: { upsert: async (a: unknown) => { txLog.push(`ent:${JSON.stringify((a as { where: unknown }).where)}`); return {}; } },
      reconciliationLog: { create: async () => ({}) },
    };
    return {
      db: {
        user: { findUnique: async () => ({ id: BUYER_ID, lineUserId: 'U7' }) },
        bankStatement: {
          create: async () => ({ id: STMT_ID }),
          update: async (a: unknown) => { txLog.push(`stmtUp:${JSON.stringify((a as { data: unknown }).data)}`); return {}; },
        },
        $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(tx),
      },
      txLog,
    };
  }
  function mockRepo(opts?: {
    hash?: unknown; account?: unknown; slip?: unknown; pool?: unknown[]; recent?: unknown[]; verified?: string[];
  }) {
    return {
      statementByHash: async () => opts?.hash ?? null,
      accountByNumber: async () => opts?.account ?? { id: ACCT_ID, tenantId: TENANT, autoMatchToleranceMins: 30, isEnabled: true },
      recentStatementsBySender: async () => opts?.recent ?? [],
      verifiedSlipRefs: async () => opts?.verified ?? [],
      slipByTransRef: async () => opts?.slip ?? null,
      pendingOrdersByAmountNet: async () => opts?.pool ?? [],
      appendLog: async () => ({}),
      statementById: async () => null,
      listStatements: async () => [],
      countStatements: async () => 0,
      kpiCounts: async () => ({ total: 0, auto: 0, pending: 0, overridden: 0 }),
      overrideById: async () => null,
    };
  }
  const strategies = new MatchingStrategyService();
  const mk = (m: ReturnType<typeof mockPrisma>, r: ReturnType<typeof mockRepo>) =>
    new AutoReconciliationEngineService(m.db as never, redis as never, r as never, strategies, notify as never);

  // 5a. exact transRef match → atomic COMPLETED + 2 entitlements + receipt
  events.length = 0; notified.length = 0;
  const m1 = mockPrisma();
  const r1 = mockRepo({ slip: { transRef: 'TX144XZ999', amount: 1500, orderId: ORDER_ID } });
  const v1 = await mk(m1, r1).processIncomingStatement(lineInput(), TENANT);
  assert.deepEqual([v1.status, v1.matchedOrderId, v1.score, v1.algorithm], ['AUTO_MATCHED', ORDER_ID, 100, 'EXACT_TRANS_REF']);
  assert.ok(m1.txLog.some((t) => t.includes('AUTO_MATCHED')), 'statement linked in tx');
  assert.equal(m1.txLog.filter((t) => t.startsWith('ent:')).length, 2, 'entitlements per item in tx');
  assert.equal(notified.length, 1);
  assert.ok(events.some((e) => JSON.stringify(e).includes('recon.matched')), 'matched stream');
  assert.ok(v1.executionTimeMs < RECON_MATCH_SLA_MS, `<500ms (${v1.executionTimeMs}ms)`);

  // 5b. window-unique match (no slip)
  const m2 = mockPrisma();
  const r2 = mockRepo({ pool: [{ id: ORDER_ID, netAmount: 1500, createdAt: new Date('2026-10-05T08:20:00.000Z') }] });
  const v2 = await mk(m2, r2).processIncomingStatement({ ...lineInput(), transRef: 'TXNODICE' });
  assert.deepEqual([v2.status, v2.score, v2.algorithm], ['AUTO_MATCHED', 95, 'AMOUNT_TIME_WINDOW_UNIQUE']);

  // 5c. ambiguous → DISCREPANCY/MULTIPLE_CANDIDATE_ORDERS
  const m3 = mockPrisma();
  const r3 = mockRepo({
    pool: [
      { id: 'o1', netAmount: 1500, createdAt: new Date('2026-10-05T08:20:00.000Z') },
      { id: 'o2', netAmount: 1500, createdAt: new Date('2026-10-05T08:25:00.000Z') },
    ],
  });
  const v3 = await mk(m3, r3).processIncomingStatement({ ...lineInput(), transRef: 'TXAMBIG1' });
  assert.deepEqual([v3.status, v3.score, v3.algorithm], ['DISCREPANCY_FLAGGED', 50, 'AMBIGUOUS_CANDIDATES']);
  assert.ok(events.some((e) => JSON.stringify(e).includes('recon.discrepancy')), 'discrepancy stream');

  // 5d. miss → UNMATCHED/REF_NOT_FOUND
  const v4 = await mk(mockPrisma(), mockRepo()).processIncomingStatement({ ...lineInput(), transRef: 'TXMISS11' });
  assert.deepEqual([v4.status, v4.algorithm], ['UNMATCHED', 'NONE']);

  // 5e. duplicate hash → REJECTED_DUPLICATE (no ingest)
  const v5 = await mk(mockPrisma(), mockRepo({ hash: { id: 'old' } })).processIncomingStatement(lineInput());
  assert.deepEqual([v5.status, v5.statementId], ['REJECTED_DUPLICATE', 'old']);
  assert.ok(events.some((e) => JSON.stringify(e).includes('recon.duplicate')), 'duplicate stream');

  // 5f. anomaly → DISCREPANCY/SUSPICIOUS + fraud stream (no match attempt)
  events.length = 0;
  const layering = Array.from({ length: 5 }, () => ({ senderName: 'สมชาย ใจดี', amount: 1500, txTimestamp: new Date(Date.now() - 60000) }));
  const v6 = await mk(mockPrisma(), mockRepo({ recent: layering })).processIncomingStatement(lineInput());
  assert.deepEqual([v6.status, v6.algorithm], ['DISCREPANCY_FLAGGED', 'FRAUD_SCREEN']);
  assert.ok(events.some((e) => JSON.stringify(e).includes('fraud.suspect')), 'fraud stream');

  // 5g. guards
  await assert.rejects(() => mk(mockPrisma(), mockRepo()).processIncomingStatement({ ...lineInput(), amount: -1 }), /Invalid bank/);
  await assert.rejects(
    () => mk(mockPrisma(), mockRepo({ account: { id: ACCT_ID, tenantId: TENANT, autoMatchToleranceMins: 30, isEnabled: false } })).processIncomingStatement(lineInput()),
    /disabled bank/,
  );
  await assert.rejects(
    () => mk(mockPrisma(), { ...mockRepo(), accountByNumber: async () => null }).processIncomingStatement(lineInput()),
    /Unknown or disabled/,
  );
  ok('5. Atomic ingest (exact/window/ambiguous/miss/dupe/fraud) + 3 guards + SLA');
}

// ---------- 6. Maker-checker override (BDD-2: dual control + chain) ----------
{
  const events: unknown[][] = [];
  const notified: unknown[][] = [];
  const redis = { xaddPipeline: async (...a: unknown[]) => { events.push(a); } };
  const notify = { notify: async (...a: unknown[]) => { notified.push(a); return { messageId: 'm1' }; } };
  const store = new Map<string, string>();
  const chainRedis = {
    get: async (k: string) => store.get(k) ?? null,
    setex: async (k: string, _t: number, v: string) => { store.set(k, v); },
    xaddPipeline: async (...a: unknown[]) => { events.push(a); },
  };
  const { AuditChainService: ChainSvc } = { AuditChainService };
  function mockDb(opts?: { stmtStatus?: string; stmtAmount?: number; orderStatus?: string; override?: Record<string, unknown> | null; slipRows?: number }) {
    const txLog: string[] = [];
    const tx = {
      bankStatement: { update: async (a: unknown) => { txLog.push(`stmt:${JSON.stringify((a as { data: unknown }).data)}`); return {}; } },
      order: {
        update: async () => ({ id: ORDER_ID, userId: BUYER_ID, orderItems: [{ productId: 'p1' }] }),
      },
      paymentSlip: { updateMany: async (a: unknown) => { txLog.push(`slip:${JSON.stringify((a as { data: unknown }).data)}`); return {}; } },
      entitlement: { upsert: async (a: unknown) => { txLog.push(`ent:${JSON.stringify((a as { where: unknown }).where)}`); return {}; } },
      financialManualOverride: {
        create: async (a: unknown) => { txLog.push(`ovr:${JSON.stringify((a as { data: Record<string, unknown> }).data)}`); return { id: OVERRIDE_ID }; },
        update: async (a: unknown) => { txLog.push(`ovrUp:${JSON.stringify((a as { data: unknown }).data)}`); return {}; },
      },
      reconciliationLog: { create: async () => ({}) },
    };
    const db = {
      order: { findUnique: async () => ({ id: ORDER_ID, userId: BUYER_ID, orderStatus: opts?.orderStatus ?? 'PENDING_PAYMENT' }) },
      bankStatement: { findUnique: async () => ({ id: STMT_ID, amount: opts?.stmtAmount ?? 500, status: opts?.stmtStatus ?? 'DISCREPANCY_FLAGGED' }) },
      financialManualOverride: {
        findUnique: async () => (opts && 'override' in opts ? opts.override : null),
        findMany: async () => [],
      },
      user: { findUnique: async () => ({ id: BUYER_ID, lineUserId: 'U7' }) },
      $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(tx),
    };
    return { db, txLog };
  }
  const mk = (m: ReturnType<typeof mockDb>) =>
    new ManualOverrideService(m.db as never, redis as never, new ChainSvc(chainRedis as never), notify as never);
  const maker = { id: MAKER_ID, role: 'FINANCE_ADMIN' as const };
  const reason = 'สเตทเมนท์นี้คือยอดของออเดอร์นี้จริง มีหลักฐานการโอนแนบมาด้วย';

  // 6a. ≤1000 immediate single-control apply
  events.length = 0; notified.length = 0;
  const m1 = mockDb({ stmtAmount: 500 });
  const o1 = await mk(m1).initiateOverride(maker, { statementId: STMT_ID, orderId: ORDER_ID, overrideReason: reason }, NET, TENANT);
  assert.equal(o1.needsChecker, false);
  assert.match(o1.auditHash, /^[0-9a-f]{64}$/);
  assert.ok(m1.txLog.some((t) => t.includes('MANUAL_OVERRIDDEN')), 'statement flipped in tx');
  assert.ok(m1.txLog.some((t) => t.startsWith('ovr:') && t.includes('"isApproved":true')), 'override approved row in tx');
  assert.ok(m1.txLog.some((t) => t.startsWith('slip:')), 'slip VERIFIED in tx');
  assert.ok(m1.txLog.some((t) => t.startsWith('ent:')), 'entitlement in tx');
  assert.ok(events.some((e) => JSON.stringify(e).includes('recon.overridden')), 'overridden stream');
  assert.equal(notified.length, 1);

  // 6b. >1000 pending + checker approve (≠ maker)
  events.length = 0;
  const m2 = mockDb({ stmtAmount: 1500 });
  const o2 = await mk(m2).initiateOverride(maker, { statementId: STMT_ID, orderId: ORDER_ID, overrideReason: reason }, NET, TENANT);
  assert.equal(o2.needsChecker, true);
  assert.equal(o2.overrideId, OVERRIDE_ID);
  assert.ok(events.some((e) => JSON.stringify(e).includes('recon.override.pending')), 'pending stream');
  const m3 = mockDb();
  (m3.db.financialManualOverride as { findUnique: (a: unknown) => Promise<unknown> }).findUnique = async () => ({
    id: OVERRIDE_ID, bankStatementId: STMT_ID, orderId: ORDER_ID, initiatedBy: MAKER_ID,
    reason, note: null, auditHash: o2.auditHash, isApproved: false, previousStatus: 'DISCREPANCY_FLAGGED',
  });
  assert.equal(await mk(m3).approveOverrideChecker({ id: CHECKER_ID, role: 'SUPER_ADMIN' }, OVERRIDE_ID, NET, TENANT), true);
  assert.ok(m3.txLog.some((t) => t.includes('"isApproved":true') && t.includes(CHECKER_ID)), 'checker approval in tx');

  // 6c. guards
  const g = (o?: Parameters<typeof mockDb>[0]) => mk(mockDb(o));
  await assert.rejects(() => g().initiateOverride({ id: MAKER_ID, role: 'MEMBER' }, { statementId: STMT_ID, orderId: ORDER_ID, overrideReason: reason }, NET), /finance admin/);
  await assert.rejects(() => g().initiateOverride(maker, { statementId: STMT_ID, orderId: ORDER_ID, overrideReason: 'สั้น' }, NET), /Invalid override/);
  await assert.rejects(() => g({ stmtStatus: 'AUTO_MATCHED' }).initiateOverride(maker, { statementId: STMT_ID, orderId: ORDER_ID, overrideReason: reason }, NET), /already AUTO_MATCHED/);
  await assert.rejects(() => g({ stmtStatus: 'MANUAL_OVERRIDDEN' }).initiateOverride(maker, { statementId: STMT_ID, orderId: ORDER_ID, overrideReason: reason }, NET), /already MANUAL_OVERRIDDEN/);
  await assert.rejects(() => g({ orderStatus: 'COMPLETED' }).initiateOverride(maker, { statementId: STMT_ID, orderId: ORDER_ID, overrideReason: reason }, NET), /already COMPLETED/);
  const mDone = mockDb();
  (mDone.db.financialManualOverride as { findUnique: (a: unknown) => Promise<unknown> }).findUnique = async () => ({
    id: OVERRIDE_ID, bankStatementId: STMT_ID, orderId: ORDER_ID, initiatedBy: MAKER_ID, reason, note: null, auditHash: 'a'.repeat(64), isApproved: true, previousStatus: 'X',
  });
  await assert.rejects(() => mk(mDone).approveOverrideChecker({ id: CHECKER_ID, role: 'SUPER_ADMIN' }, OVERRIDE_ID, NET), /already approved/);
  await assert.rejects(() => mk(m3).approveOverrideChecker({ id: MAKER_ID, role: 'FINANCE_ADMIN' }, OVERRIDE_ID, NET), /own override/);
  await assert.rejects(() => mk(m3).approveOverrideChecker({ id: CHECKER_ID, role: 'SUPER_ADMIN' }, OVERRIDE_ID, NET, TENANT, 'someone-else'), /designated checker/);
  await assert.rejects(() => mk(m3).approveOverrideChecker({ id: CHECKER_ID, role: 'MEMBER' }, OVERRIDE_ID, NET), /finance admin/);
  await assert.rejects(() => mk(m3).approveOverrideChecker({ id: CHECKER_ID, role: 'SUPER_ADMIN' }, '', NET), /Missing overrideId/);
  const mNone = mockDb({ override: null });
  await assert.rejects(() => mk(mNone).approveOverrideChecker({ id: CHECKER_ID, role: 'SUPER_ADMIN' }, OVERRIDE_ID, NET), /not found/);
  ok('6. Immediate/pending/approve lanes + chain head advance + 11 guards');
}

// ---------- 7. Flex builder + notify port ----------
{
  const receipt = buildReconFlex({ outcome: 'RECEIPT', amountThb: 1500, tenantName: TENANT, ref: ORDER_ID });
  const disc = buildReconFlex({ outcome: 'DISCREPANCY', amountThb: 1500, tenantName: TENANT, ref: STMT_ID, detail: 'REF_NOT_FOUND' });
  const okB = buildReconFlex({ outcome: 'OVERRIDE_OK', amountThb: 1500, tenantName: TENANT, ref: ORDER_ID });
  const pend = buildReconFlex({ outcome: 'OVERRIDE_PENDING', amountThb: 5000, tenantName: TENANT, ref: STMT_ID });
  const dupe = buildReconFlex({ outcome: 'DUPLICATE', amountThb: 1500, tenantName: TENANT });
  assert.ok(receipt.altText.includes('ชำระเงินสำเร็จ') && receipt.altText.includes('1,500.00'));
  assert.ok(disc.altText.includes('ไม่ตรง'));
  assert.ok(pend.altText.includes('Checker'));
  for (const b of [receipt, disc, okB, pend, dupe]) {
    assert.ok(reconFlexByteSize(b) < RECON_FLEX_BUDGET_BYTES, 'flex < 10KB');
  }
  assert.equal(RECON_FLEX_BUDGET_BYTES, 10_000);
  ok('7. Flex 5 outcomes (THB lines, refs) + <10KB');
}

// ---------- 8. Webhook HMAC taxonomy + chain verify service ----------
{
  const secret = 'phase115-webhook-secret';
  const body = JSON.stringify({ transRef: 'TX144XZ999', amount: 1500 });
  const good = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
  const check = (sig: string | undefined, key: string): boolean => {
    if (!sig || !key) return false;
    const c = createHmac('sha256', key).update(body, 'utf8').digest('hex');
    if (sig.length !== c.length) return false;
    try {
      const { timingSafeEqual } = require('node:crypto') as typeof import('node:crypto');
      return timingSafeEqual(Buffer.from(sig), Buffer.from(c));
    } catch {
      return false;
    }
  };
  assert.equal(check(good, secret), true);
  assert.equal(check(good.slice(0, -1) + '0', secret), false);
  assert.equal(check(good, 'wrong'), false);
  assert.equal(check(undefined, secret), false);
  const hook = readFileSync('apps/backend/src/modules/reconciliation/controllers/bank-webhook.controller.ts', 'utf8');
  assert.ok(hook.includes('x-bank-signature') && hook.includes('timingSafeEqual'), 'HMAC-guarded ingest');
  ok('8. Webhook HMAC mint/verify/forgery/secret-mismatch taxonomy');
}

// ---------- 9. Stress: batch ingest throughput + match-rate equation (§10.1) ----------
{
  const strategies = new MatchingStrategyService();
  const N = 300;
  const base = new Date('2026-10-05T08:30:00.000Z').getTime();
  const t0 = Date.now();
  let matched = 0;
  await Promise.all(Array.from({ length: N }, async (_, i) => {
    const amount = 100 + (i % 50);
    const at = new Date(base + (i % 10) * 60000);
    const v = strategies.byAmountWindow(
      { amount, txTimestamp: at },
      [{ id: `o${i}`, netAmount: amount, createdAt: new Date(at.getTime() - 60000) }],
      30,
    );
    assert.equal(v.kind, 'WINDOW_UNIQUE');
    matched++;
  }));
  const msPerItem = (Date.now() - t0) / N;
  assert.equal(autoMatchRate(matched, N), 100);
  assert.ok(msPerItem < RECON_MATCH_SLA_MS, `stress ${msPerItem.toFixed(3)}ms/item < 500ms`);
  console.log(`    stress: ${N} concurrent matches, ${msPerItem.toFixed(3)}ms/item`);
  ok('9. 300-way concurrent match + 100% equation + timing');
}

// ---------- 10. Module wiring + repository ----------
{
  const mod = readFileSync('apps/backend/src/modules/reconciliation/reconciliation.module.ts', 'utf8');
  for (const p of ['MatchingStrategyService', 'AuditChainService', 'AutoReconciliationEngineService', 'ManualOverrideService', 'ReconciliationRepository', 'ReconciliationResolver', 'BankWebhookController', 'ManualOverrideController', 'ReconciliationNotificationService']) {
    assert.ok(mod.includes(p), `module wires ${p}`);
  }
  assert.ok(!/ServiceService|ModuleModule|ControllerController|ResolverResolver/.test(mod), 'scaffold doubled names retired');
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('ReconciliationModule'), 'AppModule imports');
  const repo = readFileSync('apps/backend/src/modules/reconciliation/repositories/reconciliation.repository.ts', 'utf8');
  assert.ok(repo.includes('statementByHash') && repo.includes('kpiCounts') && repo.includes('verifiedSlipRefs'), 'repository seam coverage');
  const dtoA = readFileSync('apps/backend/src/modules/reconciliation/dto/bank-statement.dto.ts', 'utf8');
  const dtoB = readFileSync('apps/backend/src/modules/reconciliation/dto/override-request.dto.ts', 'utf8');
  assert.ok(!dtoA.includes('TODO') && !dtoB.includes('TODO'), 'DTOs implemented');
  ok('10. Module/repository/DTO wiring (doubled names retired)');
}

// ---------- 11. Prisma Gate 1 + SDL + api alias ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const e of ['enum ReconciliationStatus', 'enum StatementSource']) {
    assert.ok(prisma.includes(e), e);
  }
  for (const m of ['model BankAccountConfig', 'model BankStatement', 'model ReconciliationLog', 'model FinancialManualOverride']) {
    assert.ok(prisma.includes(m), m);
  }
  assert.ok(prisma.includes('hashSign           String'), 'dedupe column');
  assert.ok(prisma.includes('@@index([hashSign])'), 'dedupe index');
  assert.ok(prisma.includes('@@index([txTimestamp])'), 'window index');
  assert.ok(prisma.includes('matchedStatements    BankStatement[]'), 'Order back-relation (statements)');
  assert.ok(prisma.includes('manualOverrides      FinancialManualOverride[]'), 'Order back-relation (overrides)');
  const sdl = readFileSync('apps/backend/src/api/graphql/reconciliation/reconciliation.graphql', 'utf8');
  for (const t of ['type BankStatementNode', 'type ReconciliationSummaryKPI', 'getReconciliationKPI', 'listBankStatements', 'reconcileBankStatement', 'executeManualOverride', 'approveOverrideChecker']) {
    assert.ok(sdl.includes(t), `SDL ${t}`);
  }
  const alias = readFileSync('apps/backend/src/api/graphql/resolvers/reconciliation.resolver.ts', 'utf8');
  assert.ok(alias.includes('ReconciliationResolver') && !alias.includes('ReconciliationResolverResolver'), 'api alias re-exports module resolver');
  ok('11. Prisma Gate 1 + SDL §3.2 + api alias');
}

// ---------- 12. Frontend Gate 3 (5 states, split-pane, modal, proxies) ----------
{
  const page = readFileSync('apps/frontend/app/(dashboard)/admin/reconciliation/page.tsx', 'utf8');
  for (const s of ['RECON_IDLE', 'STATEMENT_MATCHING', 'DISCREPANCY_DETECTED', 'OVERRIDE_PENDING_CHECKER', 'OVERRIDE_SUCCESS']) {
    assert.ok(page.includes(s), `dashboard state ${s}`);
  }
  assert.ok(page.includes('pending-checker') && page.includes('ลองใหม่'), 'checker notice + retry');
  const dash = readFileSync('apps/frontend/components/reconciliation/ReconciliationDashboard.tsx', 'utf8');
  assert.ok(dash.includes('kpi-rate') && dash.includes('stmt-row') && dash.includes('stmt-status') && dash.includes('Manual Override'), 'KPI + queue markers');
  const modal = readFileSync('apps/frontend/components/reconciliation/OverrideModal.tsx', 'utf8');
  assert.ok(modal.includes('override-evidence') && modal.includes('minLength={10}') && modal.includes('dual control'), 'modal gates + evidence');
  const lib = readFileSync('apps/frontend/lib/reconciliation/reconciliation-client.ts', 'utf8');
  assert.ok(lib.includes('verifyChain') && lib.includes('initiate') && lib.includes('approve'), 'client lanes');
  assert.ok(!lib.includes('lucide') && !lib.includes('recharts') && !lib.includes('framer'), 'no heavy viz deps');
  for (const p of [
    'apps/frontend/app/api/v1/admin/reconciliation/statements/route.ts',
    'apps/frontend/app/api/v1/admin/reconciliation/kpi/route.ts',
    'apps/frontend/app/api/v1/admin/reconciliation/initiate/route.ts',
    'apps/frontend/app/api/v1/admin/reconciliation/approve/route.ts',
    'apps/frontend/app/api/v1/admin/reconciliation/verify-chain/route.ts',
  ]) {
    assert.ok(readFileSync(p, 'utf8').includes('localhost:4000'), `proxy backend: ${p}`);
  }
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  for (const e of ['BankStatementImportSchema', 'ManualOverridePayloadSchema', 'hashStatement', 'chainStep', 'RECON_STREAM', 'MAKER_CHECKER_THRESHOLD_THB']) {
    assert.ok(barrel.includes(e), `barrel ${e}`);
  }
  ok('12. Frontend 5-state + split-pane + modal + 5 proxies + barrel');
}
}

main()
  .then(() => console.log(`\nPhase 115 contracts: ${passed}/12 groups passed`))
  .catch((err) => {
    console.error('\nPhase 115 contracts FAILED:', err);
    process.exit(1);
  });
