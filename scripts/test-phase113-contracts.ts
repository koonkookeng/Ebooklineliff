// SSOT Phase 113 §10-11 — contract tests (Zod, escrow math, atomic file/
// refund/reject, fraud screen, cron sweep, Flex budget, webhook HMAC,
// Prisma Gate 1, SDL, frontend, barrel).
// Run: npx tsx scripts/test-phase113-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import {
  DisputeReasonEnum,
  DisputeStatusEnum,
  EscrowStatusEnum,
  CreateDisputeInputSchema,
  ResolveDisputeInputSchema,
  DISPUTE_OPEN_STATES,
  DISPUTE_TERMINAL_STATES,
  ESCROW_HOLD_DAYS,
  DISPUTE_FRAUD_MONTHLY_LIMIT,
  DISPUTE_MTTR_SLA_MS,
  DISPUTE_QUEUE_PAGE_SIZE,
  DISPUTE_EVENT_STREAM,
  buildDisputeNo,
  escrowHoldingUntil,
  escrowExpired,
  refundCap,
  claimFrequencyRisk,
  escrowKey,
  disputeQueueKey,
} from '../packages/shared/src/schemas/dispute-escrow.schema';
import { EscrowService } from '../apps/backend/src/modules/escrow/escrow.service';
import { EscrowReleaseCron } from '../apps/backend/src/modules/escrow/escrow.cron';
import { DisputeService, evidenceFileType } from '../apps/backend/src/modules/dispute/dispute.service';
import { buildDisputeFlex, disputeFlexByteSize, DISPUTE_FLEX_BUDGET_BYTES } from '../apps/backend/src/modules/dispute/dispute-flex.builder';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const ORDER_ID = '123e4567-e89b-12d3-a456-426614174000';
const BUYER_ID = '223e4567-e89b-12d3-a456-426614174001';
const SELLER_ID = '323e4567-e89b-12d3-a456-426614174002';
const ADMIN_ID = '423e4567-e89b-12d3-a456-426614174003';
const DISPUTE_ID = '523e4567-e89b-12d3-a456-426614174004';
const ESCROW_ID = '623e4567-e89b-12d3-a456-426614174005';
const GROSS = 1000;
const NET_TENANT = 'acme';

function fileInput(): Record<string, unknown> {
  return {
    orderId: ORDER_ID,
    reason: 'PHYSICAL_ITEM_DAMAGED',
    description: 'หนังสือเปียกน้ำขาดครึ่งเล่ม ขอคืนเงินเต็มจำนวน',
    evidenceImageUrls: ['https://vault.test/ev1.jpg'],
    requestedRefundAmount: 1000,
  };
}

async function main(): Promise<void> {
// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) ----------
{
  for (const v of ['PHYSICAL_ITEM_DAMAGED', 'PHYSICAL_ITEM_NOT_RECEIVED', 'WRONG_ITEM_SENT', 'EBOOK_FILE_CORRUPTED', 'COURSE_CONTENT_MISMATCH', 'DUPLICATE_PAYMENT', 'OTHER']) {
    assert.equal(DisputeReasonEnum.safeParse(v).success, true, v);
  }
  assert.equal(DisputeReasonEnum.safeParse('ITEM_LOST').success, false);
  for (const v of ['SUBMITTED', 'AWAITING_SELLER_RESPONSE', 'UNDER_ADMIN_ARBITRATION', 'APPROVED_REFUND_BUYER', 'REJECTED_RELEASE_SELLER', 'CANCELLED_BY_BUYER']) {
    assert.equal(DisputeStatusEnum.safeParse(v).success, true, v);
  }
  assert.equal(DisputeStatusEnum.safeParse('PENDING').success, false);
  for (const v of ['HELD', 'DISPUTED_HOLD', 'RELEASED_TO_SELLER', 'REFUNDED_TO_BUYER', 'PARTIALLY_REFUNDED']) {
    assert.equal(EscrowStatusEnum.safeParse(v).success, true, v);
  }
  assert.equal(EscrowStatusEnum.safeParse('LOCKED').success, false);
  assert.equal(CreateDisputeInputSchema.safeParse(fileInput()).success, true);
  assert.equal(CreateDisputeInputSchema.safeParse({ ...fileInput(), description: 'สั้น' }).success, false);
  assert.equal(CreateDisputeInputSchema.safeParse({ ...fileInput(), evidenceImageUrls: [] }).success, false);
  assert.equal(CreateDisputeInputSchema.safeParse({ ...fileInput(), evidenceImageUrls: ['nope'] }).success, false);
  assert.equal(CreateDisputeInputSchema.safeParse({ ...fileInput(), requestedRefundAmount: -5 }).success, false);
  assert.equal(CreateDisputeInputSchema.safeParse({ ...fileInput(), requestedRefundAmount: 0 }).success, false);
  const r = ResolveDisputeInputSchema.parse({ disputeId: DISPUTE_ID, resolutionStatus: 'APPROVED_REFUND_BUYER', adminComment: 'หลักฐานชัด', approvedRefundAmount: 1000 });
  assert.equal(r.refundToWallet, true);
  assert.equal(ResolveDisputeInputSchema.safeParse({ disputeId: DISPUTE_ID, resolutionStatus: 'SUBMITTED', adminComment: 'x'.repeat(5), approvedRefundAmount: 0 }).success, true);
  assert.equal(ResolveDisputeInputSchema.safeParse({ disputeId: DISPUTE_ID, resolutionStatus: 'APPROVED_REFUND_BUYER', adminComment: 'abc', approvedRefundAmount: 0 }).success, false);
  assert.deepEqual([...DISPUTE_OPEN_STATES], ['SUBMITTED', 'AWAITING_SELLER_RESPONSE', 'UNDER_ADMIN_ARBITRATION']);
  assert.deepEqual([...DISPUTE_TERMINAL_STATES], ['APPROVED_REFUND_BUYER', 'REJECTED_RELEASE_SELLER', 'CANCELLED_BY_BUYER']);
  ok('1. Zod SSOT verbatim (§3.1 reason/status/escrow/file/resolve)');
}

// ---------- 2. Money/time/fraud math + keys (§4.1/§7) ----------
{
  assert.equal(ESCROW_HOLD_DAYS, 7);
  assert.equal(DISPUTE_FRAUD_MONTHLY_LIMIT, 3);
  assert.equal(DISPUTE_MTTR_SLA_MS, 86_400_000);
  assert.equal(DISPUTE_QUEUE_PAGE_SIZE, 20);
  assert.equal(DISPUTE_EVENT_STREAM, 'stream:dispute:events');
  const no = buildDisputeNo(1_700_000_000_000, 4821);
  assert.match(no, /^DSP-[0-9A-Z]+-4821$/);
  assert.notEqual(buildDisputeNo(1_700_000_000_000, 1), buildDisputeNo(1_700_000_000_000, 2));
  const until = escrowHoldingUntil(1_700_000_000_000);
  assert.equal(until.getTime() - 1_700_000_000_000, 7 * 86_400_000);
  assert.equal(escrowExpired(until, 1_700_000_000_000), false);
  assert.equal(escrowExpired(until, until.getTime()), true);
  assert.equal(escrowExpired(until, until.getTime() + 1), true);
  assert.equal(refundCap(1000, 1000, 1000), 1000);
  assert.equal(refundCap(1000, 1000, 1500), 1000);
  assert.equal(refundCap(1000, 800, 900), 800);
  assert.equal(refundCap(1000, 1000, -5), 0);
  assert.equal(claimFrequencyRisk(2), 'NORMAL');
  assert.equal(claimFrequencyRisk(3), 'HIGH_RISK_FRAUD');
  assert.equal(claimFrequencyRisk(9), 'HIGH_RISK_FRAUD');
  assert.equal(escrowKey(ORDER_ID), `escrow:order:${ORDER_ID}`);
  assert.equal(disputeQueueKey('SUBMITTED', 1), 'dispute:queue:SUBMITTED:1');
  assert.equal(evidenceFileType('https://x/ev.jpg'), 'IMAGE');
  assert.equal(evidenceFileType('https://x/clip.mp4?sig=1'), 'VIDEO');
  assert.equal(evidenceFileType('https://x/doc.pdf'), 'DOCUMENT');
  ok('2. disputeNo/hold-window/expiry/cap/fraud/keys/fileType');
}

// ---------- 3. Escrow hold/release/status (BDD-1, 7-day cron) ----------
{
  const events: unknown[][] = [];
  const redis = { xaddPipeline: async (...a: unknown[]) => { events.push(a); } };
  const newDb = (order: unknown, existing: unknown, due: unknown[] = []) => ({
    order: { findUnique: async () => order },
    escrowAccount: {
      findFirst: async () => existing,
      findMany: async () => due,
      create: async (a: unknown) => ({ id: ESCROW_ID, ...(a as { data: Record<string, unknown> }).data }),
      update: async () => ({}),
    },
  });
  const svc = (db: unknown) => new EscrowService(db as never, redis as never);

  // 3a. fresh hold
  const db1 = newDb({ id: ORDER_ID }, null);
  const h1 = await svc(db1).holdForOrder(ORDER_ID, { sellerId: SELLER_ID, grossAmount: GROSS, platformFee: 50 });
  assert.deepEqual({ status: h1.status, existed: h1.existed, id: h1.id }, { status: 'HELD', existed: false, id: ESCROW_ID });
  assert.ok(Date.now() < new Date(h1.holdingUntil).getTime(), '7-day future window');
  assert.ok(events.some((e) => JSON.stringify(e).includes('escrow.held')), 'held stream');

  // 3b. idempotent re-hold
  const db2 = newDb({ id: ORDER_ID }, { id: ESCROW_ID, orderId: ORDER_ID, status: 'HELD', holdingUntil: new Date(Date.now() + 1000) });
  const h2 = await svc(db2).holdForOrder(ORDER_ID, { sellerId: SELLER_ID, grossAmount: GROSS });
  assert.equal(h2.existed, true);

  // 3c. guards
  await assert.rejects(() => svc(db1).holdForOrder('', { sellerId: SELLER_ID, grossAmount: 1 }), /Missing orderId/);
  await assert.rejects(() => svc(db1).holdForOrder(ORDER_ID, { sellerId: SELLER_ID, grossAmount: 0 }), /Invalid gross/);
  await assert.rejects(() => svc(newDb(null, null)).holdForOrder(ORDER_ID, { sellerId: SELLER_ID, grossAmount: 1 }), /Order not found/);

  // 3d. cron sweep releases matured only
  const realSvc = svc(newDb({ id: ORDER_ID }, null, [
    { id: 'e1', orderId: 'o1', sellerId: 's1' },
    { id: 'e2', orderId: 'o2', sellerId: 's1' },
  ]));
  const updates: unknown[] = [];
  (realSvc as unknown as { prisma: unknown }).prisma = {
    order: { findUnique: async () => ({ id: ORDER_ID }) },
    escrowAccount: {
      findFirst: async () => null,
      findMany: async () => [
        { id: 'e1', orderId: 'o1', sellerId: 's1' },
        { id: 'e2', orderId: 'o2', sellerId: 's1' },
      ],
      create: async () => ({}),
      update: async (a: unknown) => { updates.push(a); return {}; },
    },
  };
  const cron = new EscrowReleaseCron(realSvc);
  const swept = await cron.runOnce(Date.now());
  assert.deepEqual(swept, { released: 2, failed: 0 });
  assert.ok((updates[0] as { data: Record<string, unknown> }).data['status'] === 'RELEASED_TO_SELLER', 'released in sweep');

  // 3e. status guards
  const db3 = newDb({ id: ORDER_ID, userId: BUYER_ID }, { id: ESCROW_ID, orderId: ORDER_ID, sellerId: SELLER_ID, grossAmount: GROSS, holdingUntil: new Date(Date.now() + 1000), status: 'HELD' });
  const st = await svc(db3).getStatus(ORDER_ID, { id: BUYER_ID, role: 'MEMBER' });
  assert.equal(st['status'], 'HELD');
  assert.equal(st['expired'], false);
  await assert.rejects(() => svc(db3).getStatus(ORDER_ID, { id: 'stranger', role: 'MEMBER' }), /Not your escrow/);
  await assert.rejects(() => svc(newDb({ id: ORDER_ID, userId: BUYER_ID }, null)).getStatus(ORDER_ID, { id: BUYER_ID, role: 'MEMBER' }), /No escrow/);
  ok('3. Escrow hold idempotent + sweep + ownership guards');
}

// ---------- 4. File claim: atomic DISPUTED_HOLD + evidences + freeze (BDD-2) ----------
{
  const events: unknown[][] = [];
  const notified: unknown[][] = [];
  const redis = { xaddPipeline: async (...a: unknown[]) => { events.push(a); } };
  const notify = { notify: async (...a: unknown[]) => { notified.push(a); return { messageId: 'm1' }; } };
  function mockDb(opts?: { escrowStatus?: string; expired?: boolean; dupe?: boolean; orderUser?: string; claims30d?: number; gross?: number }) {
    const txLog: string[] = [];
    const o = {
      order: { findUnique: async () => ({ id: ORDER_ID, userId: opts?.orderUser ?? BUYER_ID, netAmount: 1000 }) },
      orderItem: { findMany: async () => [] },
      user: { findUnique: async (a: unknown) => ({ id: (a as { where: { id: string } }).where.id, lineUserId: 'U1' }), update: async () => ({}) },
      escrowAccount: {
        findFirst: async () => ({
          id: ESCROW_ID, sellerId: SELLER_ID, grossAmount: opts?.gross ?? GROSS,
          holdingUntil: new Date(Date.now() + (opts?.expired ? -1000 : 86_400_000)),
          status: opts?.escrowStatus ?? 'HELD',
        }),
      },
      disputeClaim: {
        findFirst: async () => (opts?.dupe ? { id: DISPUTE_ID } : null),
        findUnique: async () => null,
        findMany: async () => [],
        count: async () => opts?.claims30d ?? 0,
      },
    };
    const tx = {
      escrowAccount: { update: async (a: unknown) => { txLog.push(`escrow:${JSON.stringify((a as { data: unknown }).data)}`); return {}; } },
      disputeClaim: { create: async () => ({ id: DISPUTE_ID }), update: async () => ({}) },
      disputeEvidence: { createMany: async (a: unknown) => { txLog.push(`ev:${JSON.stringify((a as { data: { data: unknown[] } }).data)}`); return {}; } },
      disputeTimeline: { create: async (a: unknown) => { txLog.push(`tl:${JSON.stringify((a as { data: unknown }).data)}`); return {}; } },
      user: { update: async () => ({}) },
      entitlement: { deleteMany: async () => ({}) },
      physicalDetail: { updateMany: async () => ({}) },
    };
    return { db: { ...o, $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(tx) }, txLog };
  }
  const svc = (m: ReturnType<typeof mockDb>) => new DisputeService(m.db as never, redis as never, notify as never);

  // 4a. happy path
  events.length = 0; notified.length = 0;
  const m1 = mockDb();
  const filed = await svc(m1).createDisputeClaim(BUYER_ID, fileInput(), NET_TENANT) as Record<string, unknown>;
  assert.match(filed['disputeNo'] as string, /^DSP-/);
  assert.equal(filed['buyerRisk'], 'NORMAL');
  assert.ok(m1.txLog.some((t) => t.includes('DISPUTED_HOLD')), 'escrow locked in tx');
  assert.ok(m1.txLog.some((t) => t.includes('DISPUTE_CREATED')), 'created timeline in tx');
  assert.ok(m1.txLog.some((t) => t.includes('ENTITLEMENT_FREEZE_REQUESTED')), 'freeze intent in tx');
  assert.ok(m1.txLog.some((t) => t.startsWith('ev:') && t.includes('ev1.jpg')), 'evidence row in tx');
  assert.equal(notified.length, 2);
  assert.ok(events.some((e) => JSON.stringify(e).includes('dispute.created')), 'created stream');
  assert.ok(events.some((e) => JSON.stringify(e).includes('entitlement.freeze.requested')), 'freeze stream');

  // 4b. fraud trip on 3rd claim
  events.length = 0;
  const m2 = mockDb({ claims30d: 3 });
  const filed2 = await svc(m2).createDisputeClaim(BUYER_ID, fileInput(), NET_TENANT) as Record<string, unknown>;
  assert.equal(filed2['buyerRisk'], 'HIGH_RISK_FRAUD');
  assert.ok(events.some((e) => JSON.stringify(e).includes('dispute.fraud.alert')), 'fraud alert stream');

  // 4c. guards
  const g = (o?: Parameters<typeof mockDb>[0]) => svc(mockDb(o));
  await assert.rejects(() => g().createDisputeClaim(BUYER_ID, { ...fileInput(), description: 'สั้น' }), /Invalid dispute/);
  await assert.rejects(() => g({ orderUser: 'someone-else' }).createDisputeClaim(BUYER_ID, fileInput()), /unauthorized/);
  await assert.rejects(() => g({ escrowStatus: 'DISPUTED_HOLD' }).createDisputeClaim(BUYER_ID, fileInput()), /not eligible/);
  await assert.rejects(() => g({ expired: true }).createDisputeClaim(BUYER_ID, fileInput()), /7 วัน/);
  await assert.rejects(() => g().createDisputeClaim(BUYER_ID, { ...fileInput(), requestedRefundAmount: 5000 }), /exceeds escrow/);
  await assert.rejects(() => g({ dupe: true }).createDisputeClaim(BUYER_ID, fileInput()), /already has a dispute/);
  ok('4. Atomic file (lock+evidence+freeze) + fraud trip + 6 guards');
}

// ---------- 5. Approve refund: BDD-3 atomic table (wallet/escrow/revoke/stock) ----------
{
  const events: unknown[][] = [];
  const notified: unknown[][] = [];
  const redis = { xaddPipeline: async (...a: unknown[]) => { events.push(a); } };
  const notify = { notify: async (...a: unknown[]) => { notified.push(a); return { messageId: 'm1' }; } };
  function mockDb() {
    const txLog: string[] = [];
    const o = {
      order: { findUnique: async () => ({ id: ORDER_ID, userId: BUYER_ID, netAmount: 1000 }) },
      orderItem: { findMany: async () => [{ productId: 'p1', quantity: 1 }, { productId: 'p2', quantity: 2 }] },
      user: { findUnique: async () => ({ id: BUYER_ID, lineUserId: 'U1' }), update: async (a: unknown) => { txLog.push(`wallet:${JSON.stringify((a as { data: unknown }).data)}`); return {}; } },
      escrowAccount: { findFirst: async () => ({ id: ESCROW_ID, sellerId: SELLER_ID, grossAmount: GROSS, status: 'DISPUTED_HOLD' }) },
      disputeClaim: {
        findFirst: async () => null,
        findUnique: async () => ({ id: DISPUTE_ID, disputeNo: 'DSP-X-0001', orderId: ORDER_ID, escrowId: ESCROW_ID, buyerId: BUYER_ID, requestedRefundAmount: 1000, status: 'SUBMITTED' }),
        findMany: async () => [],
        count: async () => 0,
      },
    };
    const tx = {
      escrowAccount: { update: async (a: unknown) => { txLog.push(`escrow:${JSON.stringify((a as { data: unknown }).data)}`); return {}; } },
      disputeClaim: {
        create: async () => ({ id: DISPUTE_ID }),
        update: async (a: unknown) => { txLog.push(`dispute:${JSON.stringify((a as { data: unknown }).data)}`); return { id: DISPUTE_ID }; },
      },
      disputeEvidence: { createMany: async () => ({}) },
      disputeTimeline: { create: async (a: unknown) => { txLog.push(`tl:${JSON.stringify((a as { data: unknown }).data)}`); return {}; } },
      user: { update: async (a: unknown) => { txLog.push(`wallet:${JSON.stringify((a as { data: unknown }).data)}`); return {}; } },
      entitlement: { deleteMany: async (a: unknown) => { txLog.push(`revoke:${JSON.stringify((a as { where: unknown }).where)}`); return {}; } },
      physicalDetail: { updateMany: async (a: unknown) => { txLog.push(`stock:${JSON.stringify((a as { data: unknown }).data)}`); return {}; } },
    };
    return { db: { ...o, $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(tx) }, txLog };
  }
  const input = { disputeId: DISPUTE_ID, resolutionStatus: 'APPROVED_REFUND_BUYER', adminComment: 'สินค้าชำรุดจริง', approvedRefundAmount: 1000, refundToWallet: true };

  // 5a. full wallet refund
  events.length = 0; notified.length = 0;
  const m1 = mockDb();
  const out = await new DisputeService(m1.db as never, redis as never, notify as never).resolveArbitration({ id: ADMIN_ID, role: 'SUPER_ADMIN' }, input, NET_TENANT) as Record<string, unknown>;
  assert.ok(m1.txLog.some((t) => t.startsWith('wallet:') && t.includes('increment')), 'Action 1 wallet increment in tx');
  assert.ok(m1.txLog.some((t) => t.includes('REFUNDED_TO_BUYER')), 'Action 2 escrow refunded in tx');
  assert.equal(m1.txLog.filter((t) => t.startsWith('revoke:')).length, 2, 'Action 3 revoke per item in tx');
  assert.ok(m1.txLog.filter((t) => t.startsWith('stock:')).length >= 1, 'Action 4 stock restore in tx');
  assert.ok(m1.txLog.some((t) => t.includes('APPROVED_REFUND_BUYER')), 'verdict timeline in tx');
  assert.equal(notified.length, 1);
  assert.ok(events.some((e) => JSON.stringify(e).includes('dispute.refunded')), 'refunded stream');
  assert.ok(typeof out['elapsedMs'] === 'number', 'elapsed telemetry');

  // 5b. partial refund → PARTIALLY_REFUNDED
  const m2 = mockDb();
  await new DisputeService(m2.db as never, redis as never, notify as never).resolveArbitration(
    { id: ADMIN_ID, role: 'FINANCE_ADMIN' }, { ...input, approvedRefundAmount: 400 }, NET_TENANT,
  );
  assert.ok(m2.txLog.some((t) => t.includes('PARTIALLY_REFUNDED')), 'partial escrow state');

  // 5c. bank lane → timeline + bankRefund stream, no wallet increment
  events.length = 0;
  const m3 = mockDb();
  await new DisputeService(m3.db as never, redis as never, notify as never).resolveArbitration(
    { id: ADMIN_ID, role: 'SUPER_ADMIN' }, { ...input, refundToWallet: false }, NET_TENANT,
  );
  assert.ok(!m3.txLog.some((t) => t.startsWith('wallet:')), 'no wallet touch on bank lane');
  assert.ok(m3.txLog.some((t) => t.includes('BANK_TRANSFER_PENDING')), 'bank pending timeline');
  assert.ok(events.some((e) => JSON.stringify(e).includes('dispute.bankRefund.requested')), 'bank refund stream');
  ok('5. BDD-3 atomic refund (full/partial/bank) + revoke + stock');
}

// ---------- 6. Reject release + cancel + seller/admin lanes + guards ----------
{
  const events: unknown[][] = [];
  const notified: unknown[][] = [];
  const redis = { xaddPipeline: async (...a: unknown[]) => { events.push(a); } };
  const notify = { notify: async (...a: unknown[]) => { notified.push(a); return { messageId: 'm1' }; } };
  function mockDb(disputeStatus: string | null) {
    const txLog: string[] = [];
    const o = {
      order: { findUnique: async () => ({ id: ORDER_ID, userId: BUYER_ID, netAmount: 1000 }) },
      orderItem: { findMany: async () => [] },
      user: { findUnique: async () => ({ id: BUYER_ID, lineUserId: 'U1' }), update: async () => ({}) },
      escrowAccount: { findFirst: async () => ({ id: ESCROW_ID, sellerId: SELLER_ID, grossAmount: GROSS, status: 'DISPUTED_HOLD' }) },
      disputeClaim: {
        findFirst: async () => null,
        findUnique: async () => (disputeStatus ? { id: DISPUTE_ID, disputeNo: 'DSP-X-0002', orderId: ORDER_ID, escrowId: ESCROW_ID, buyerId: BUYER_ID, requestedRefundAmount: 500, status: disputeStatus } : null),
        findMany: async () => [],
        count: async () => 0,
      },
    };
    const tx = {
      escrowAccount: { update: async (a: unknown) => { txLog.push(`escrow:${JSON.stringify((a as { data: unknown }).data)}`); return {}; } },
      disputeClaim: {
        create: async () => ({ id: DISPUTE_ID }),
        update: async (a: unknown) => { txLog.push(`dispute:${JSON.stringify((a as { data: unknown }).data)}`); return { id: DISPUTE_ID }; },
      },
      disputeEvidence: { createMany: async () => ({}) },
      disputeTimeline: { create: async (a: unknown) => { txLog.push(`tl:${JSON.stringify((a as { data: unknown }).data)}`); return {}; } },
      user: { update: async () => ({}) },
      entitlement: { deleteMany: async () => ({}) },
      physicalDetail: { updateMany: async () => ({}) },
    };
    return { db: { ...o, $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(tx) }, txLog };
  }
  const svc = (m: ReturnType<typeof mockDb>) => new DisputeService(m.db as never, redis as never, notify as never);

  // 6a. reject → RELEASED_TO_SELLER, entitlements stand
  events.length = 0; notified.length = 0;
  const m1 = mockDb('UNDER_ADMIN_ARBITRATION');
  await svc(m1).resolveArbitration({ id: ADMIN_ID, role: 'CONTENT_MODERATOR' }, {
    disputeId: DISPUTE_ID, resolutionStatus: 'REJECTED_RELEASE_SELLER', adminComment: 'ขนส่งยืนยันส่งถึงแล้ว', approvedRefundAmount: 0,
  }, NET_TENANT);
  assert.ok(m1.txLog.some((t) => t.includes('RELEASED_TO_SELLER')), 'funds released in tx');
  assert.ok(!m1.txLog.some((t) => t.startsWith('revoke:')), 'entitlements stand on reject');
  assert.equal(notified.length, 2);
  assert.ok(events.some((e) => JSON.stringify(e).includes('dispute.released')), 'released stream');

  // 6b. seller respond → begin → resolvable chain
  const m2 = mockDb('SUBMITTED');
  assert.equal(await svc(m2).sellerRespond(SELLER_ID, DISPUTE_ID, 'ส่งของใหม่ให้แล้วครับ'), true);
  assert.ok(m2.txLog.some((t) => t.includes('AWAITING_SELLER_RESPONSE')), 'seller lane in tx');
  const m3 = mockDb('AWAITING_SELLER_RESPONSE');
  assert.equal(await svc(m3).beginArbitration(ADMIN_ID, 'SUPER_ADMIN', DISPUTE_ID), true);
  assert.ok(m3.txLog.some((t) => t.includes('UNDER_ADMIN_ARBITRATION')), 'arbitration lane in tx');

  // 6c. buyer cancel → CANCELLED + escrow back to HELD
  events.length = 0;
  const m4 = mockDb('SUBMITTED');
  assert.equal(await svc(m4).cancelDispute(BUYER_ID, DISPUTE_ID), true);
  assert.ok(m4.txLog.some((t) => t.includes('CANCELLED_BY_BUYER')), 'cancelled in tx');
  assert.ok(m4.txLog.some((t) => t.includes('"status":"HELD"')), 'escrow resumed in tx');
  assert.ok(events.some((e) => JSON.stringify(e).includes('dispute.cancelled')), 'cancelled stream');

  // 6d. guards
  const g = (s: string | null) => svc(mockDb(s));
  await assert.rejects(() => g('SUBMITTED').resolveArbitration({ id: ADMIN_ID, role: 'MEMBER' }, { disputeId: DISPUTE_ID, resolutionStatus: 'APPROVED_REFUND_BUYER', adminComment: 'ok-123', approvedRefundAmount: 1 }), /admin role/);
  await assert.rejects(() => g('SUBMITTED').resolveArbitration({ id: ADMIN_ID, role: 'SUPER_ADMIN' }, { disputeId: '', resolutionStatus: 'APPROVED_REFUND_BUYER', adminComment: 'ok-123', approvedRefundAmount: 1 }), /Invalid resolution/);
  await assert.rejects(() => g('SUBMITTED').resolveArbitration({ id: ADMIN_ID, role: 'SUPER_ADMIN' }, { disputeId: DISPUTE_ID, resolutionStatus: 'SUBMITTED', adminComment: 'ok-123', approvedRefundAmount: 0 }), /not arbitrable/);
  await assert.rejects(() => g('APPROVED_REFUND_BUYER').resolveArbitration({ id: ADMIN_ID, role: 'SUPER_ADMIN' }, { disputeId: DISPUTE_ID, resolutionStatus: 'APPROVED_REFUND_BUYER', adminComment: 'ok-123', approvedRefundAmount: 1 }), /actionable/);
  await assert.rejects(() => g(null).resolveArbitration({ id: ADMIN_ID, role: 'SUPER_ADMIN' }, { disputeId: DISPUTE_ID, resolutionStatus: 'APPROVED_REFUND_BUYER', adminComment: 'ok-123', approvedRefundAmount: 1 }), /not found/);
  await assert.rejects(() => g('SUBMITTED').sellerRespond('stranger', DISPUTE_ID, 'x'), /Only the seller/);
  await assert.rejects(() => g('APPROVED_REFUND_BUYER').sellerRespond(SELLER_ID, DISPUTE_ID, 'x'), /cannot take seller response/);
  await assert.rejects(() => g('SUBMITTED').beginArbitration(ADMIN_ID, 'MEMBER', DISPUTE_ID), /admin role/);
  await assert.rejects(() => g('REJECTED_RELEASE_SELLER').beginArbitration(ADMIN_ID, 'SUPER_ADMIN', DISPUTE_ID), /cannot enter arbitration/);
  await assert.rejects(() => g('SUBMITTED').cancelDispute('stranger', DISPUTE_ID), /Only the buyer/);
  await assert.rejects(() => g('CANCELLED_BY_BUYER').cancelDispute(BUYER_ID, DISPUTE_ID), /actionable/);
  await assert.rejects(() => g('SUBMITTED').cancelDispute(BUYER_ID, ''), /Missing disputeId/);
  ok('6. Reject/cancel/seller/begin lanes + 12 guards');
}

// ---------- 7. assessBuyerRisk + queue + by-order reads ----------
{
  const redis = { xaddPipeline: async () => undefined };
  const notify = { notify: async () => null };
  const db = {
    order: { findUnique: async () => ({ id: ORDER_ID, userId: BUYER_ID, netAmount: 100 }) },
    orderItem: { findMany: async () => [] },
    user: { findUnique: async () => null, update: async () => ({}) },
    escrowAccount: { findFirst: async () => ({ id: ESCROW_ID, sellerId: SELLER_ID, status: 'HELD' }) },
    disputeClaim: {
      findFirst: async () => ({ id: DISPUTE_ID, buyerId: BUYER_ID, orderId: ORDER_ID, status: 'SUBMITTED' }),
      findUnique: async () => null,
      findMany: async () => [{ id: DISPUTE_ID }],
      count: async (a: unknown) => ((a as { where: Record<string, unknown> }).where['buyerId'] ? 2 : 5),
    },
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn({}),
  };
  const svc = new DisputeService(db as never, redis as never, notify as never);
  assert.deepEqual(await svc.assessBuyerRisk(BUYER_ID), { claims30d: 2, risk: 'NORMAL' });
  const q = await svc.getQueue('SUPER_ADMIN', { page: 1, limit: 20 });
  assert.deepEqual([q.totalCount, q.openCount, q.refundedCount], [5, 5, 5]);
  await assert.rejects(() => svc.getQueue('MEMBER', {}), /admin role/);
  const mine = await svc.getByOrder(ORDER_ID, { id: BUYER_ID, role: 'MEMBER' });
  assert.equal((mine as Record<string, unknown>)['id'], DISPUTE_ID);
  await assert.rejects(() => svc.getByOrder(ORDER_ID, { id: 'stranger', role: 'MEMBER' }), /Not your dispute/);
  ok('7. Risk assess + queue counters + scoped reads');
}

// ---------- 8. Cron sweep paths (released/failed/empty) ----------
{
  const mk = (releaseDue: (now: number, limit?: number) => Promise<{ released: number; failed: number }>) =>
    new EscrowReleaseCron({ releaseDue } as never);
  assert.deepEqual(await mk(async () => ({ released: 3, failed: 1 })).runOnce(Date.now()), { released: 3, failed: 1 });
  assert.deepEqual(await mk(async () => ({ released: 0, failed: 0 })).runOnce(Date.now()), { released: 0, failed: 0 });
  ok('8. Cron runOnce passthrough (released/failed/empty)');
}

// ---------- 9. Flex builder (6 outcomes, CTA, <10KB) ----------
{
  const filed = buildDisputeFlex({ outcome: 'FILED', disputeNo: 'DSP-X-0001', tenantName: 'acme', amountThb: 1000, disputeDeepLink: 'line://app/d' });
  const approved = buildDisputeFlex({ outcome: 'REFUND_APPROVED', disputeNo: 'DSP-X-0001', tenantName: 'acme', amountThb: 1000, disputeDeepLink: 'line://app/d' });
  const released = buildDisputeFlex({ outcome: 'RELEASED_SELLER', disputeNo: 'DSP-X-0001', tenantName: 'acme' });
  const cancelled = buildDisputeFlex({ outcome: 'CANCELLED', disputeNo: 'DSP-X-0001', tenantName: 'acme' });
  const held = buildDisputeFlex({ outcome: 'ESCROW_RELEASED', disputeNo: 'DSP-X-0001', tenantName: 'acme' });
  const seller = buildDisputeFlex({ outcome: 'SELLER_RESPONSE', disputeNo: 'DSP-X-0001', tenantName: 'acme', disputeDeepLink: 'line://app/d' });
  assert.ok(filed.altText.includes('ข้อพิพาท') && approved.altText.includes('คืนเงิน'));
  assert.ok(filed.contents.footer && approved.contents.footer && seller.contents.footer, 'CTA on filed/approved/seller');
  assert.equal(released.contents.footer, undefined);
  assert.equal(cancelled.contents.footer, undefined);
  assert.equal(held.contents.footer, undefined);
  assert.ok(approved.contents.body.contents.some((l) => l.text.includes('1,000.00')), 'THB amount line');
  for (const b of [filed, approved, released, cancelled, held, seller]) {
    assert.ok(disputeFlexByteSize(b) < DISPUTE_FLEX_BUDGET_BYTES, 'flex < 10KB');
  }
  assert.equal(DISPUTE_FLEX_BUDGET_BYTES, 10_000);
  ok('9. Flex 6 outcomes + CTA discipline + THB line + <10KB');
}

// ---------- 10. Webhook HMAC taxonomy (fail-closed 401) ----------
{
  const secret = 'phase113-webhook-secret';
  const body = JSON.stringify({ orderId: ORDER_ID, carrierStatus: 'DELIVERED' });
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
  ok('10. Webhook HMAC mint/verify/forgery/secret-mismatch taxonomy');
}

// ---------- 11. Prisma Gate 1 + SDL + aliases + module wiring ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const e of ['enum EscrowStatus', 'enum DisputeReason', 'enum DisputeStatus']) {
    assert.ok(prisma.includes(e), e);
  }
  for (const m of ['model EscrowAccount', 'model DisputeClaim', 'model DisputeEvidence', 'model DisputeTimeline']) {
    assert.ok(prisma.includes(m), m);
  }
  assert.ok(prisma.includes('holdingUntil  DateTime'), 'holding window column');
  assert.ok(prisma.includes('@@index([holdingUntil])'), 'sweep index');
  assert.ok(prisma.includes('disputeNo             String         @unique'), 'claim number unique');
  assert.ok(prisma.includes('escrowAccount        EscrowAccount?'), 'Order back-relation');
  assert.ok(prisma.includes('buyerDisputes      DisputeClaim[] @relation("BuyerDisputes")'), 'User back-relation');
  const sdl = readFileSync('apps/backend/src/api/graphql/dispute/dispute.graphql', 'utf8');
  for (const t of ['type DisputeClaimPayload', 'type EscrowStatusPayload', 'type DisputeEvidence', 'getDisputeByOrder', 'getEscrowStatus', 'createDisputeClaim', 'resolveDisputeArbitration', 'input CreateDisputeInput', 'input ResolveDisputeInput']) {
    assert.ok(sdl.includes(t), `SDL ${t}`);
  }
  const alias = readFileSync('apps/backend/src/api/graphql/resolvers/dispute.resolver.ts', 'utf8');
  assert.ok(alias.includes('DisputeResolver') && !alias.includes('DisputeResolverResolver'), 'api alias re-exports module resolver');
  const dmod = readFileSync('apps/backend/src/modules/dispute/dispute.module.ts', 'utf8');
  for (const p of ['DisputeService', 'DisputeResolver', 'DisputeController', 'DisputeAdminController', 'DisputeNotificationService', 'EscrowModule']) {
    assert.ok(dmod.includes(p), `dispute module wires ${p}`);
  }
  assert.ok(!/ServiceService|ModuleModule|ControllerController|ResolverResolver/.test(dmod), 'scaffold doubled names retired');
  const emod = readFileSync('apps/backend/src/modules/escrow/escrow.module.ts', 'utf8');
  assert.ok(emod.includes('EscrowService') && emod.includes('EscrowReleaseCron') && emod.includes('EscrowController'), 'escrow module wiring');
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('DisputeModule') && app.includes('EscrowModule'), 'AppModule imports');
  const webhooks = readFileSync('apps/backend/src/api/webhooks/webhooks.module.ts', 'utf8');
  assert.ok(webhooks.includes('DisputeLogisticsController'), 'webhooks module mounts bridge');
  const bridge = readFileSync('apps/backend/src/api/webhooks/dispute-logistics.controller.ts', 'utf8');
  assert.ok(bridge.includes('x-dispute-signature') && bridge.includes('timingSafeEqual') && bridge.includes('CARRIER_'), 'HMAC bridge + carrier taxonomy');
  ok('11. Prisma Gate 1 + SDL §3.2 + aliases + module/webhook wiring');
}

// ---------- 12. Frontend Gate 3/5 (5 states, compress, IDB, proxies) ----------
{
  const page = readFileSync('apps/frontend/app/(liff)/dispute/page.tsx', 'utf8');
  for (const s of ['LIFF_INIT', 'IDLE', 'LOADING', 'SUCCESS', 'ERROR']) {
    assert.ok(page.includes(s), `center state ${s}`);
  }
  assert.ok(page.includes('DISPUTE_WINDOW_EXPIRED') && page.includes('DISPUTE_') && page.includes('ลองใหม่'), 'error codes + retry');
  const form = readFileSync('apps/frontend/components/dispute/DisputeFilingForm.tsx', 'utf8');
  assert.ok(form.includes('minLength={10}') && form.includes('evidence-count') && form.includes('Escrow Protection'), 'form gates + evidence counter');
  const card = readFileSync('apps/frontend/components/dispute/EscrowStatusCard.tsx', 'utf8');
  assert.ok(card.includes('escrow-badge') && card.includes('dispute-timeline') && card.includes('HELD'), 'badge + timeline markers');
  const lib = readFileSync('apps/frontend/lib/dispute/dispute-client.ts', 'utf8');
  assert.ok(lib.includes('compressDisputeImage') && lib.includes('1600') && lib.includes('2 * 1024 * 1024'), 'Gate 5 compress guard');
  assert.ok(lib.includes('indexedDB') && lib.includes('saveDisputeDraft') && lib.includes('loadDisputeDraft'), 'IDB offline drafts');
  assert.ok(!lib.includes('lucide') && !lib.includes('framer'), 'no heavy LIFF deps');
  for (const p of [
    'apps/frontend/app/api/v1/disputes/claim/route.ts',
    'apps/frontend/app/api/v1/disputes/by-order/route.ts',
    'apps/frontend/app/api/v1/disputes/cancel/route.ts',
    'apps/frontend/app/api/v1/escrow/status/route.ts',
    'apps/frontend/app/api/v1/admin/disputes/queue/route.ts',
    'apps/frontend/app/api/v1/admin/disputes/resolve/route.ts',
    'apps/frontend/app/api/v1/admin/disputes/begin/route.ts',
  ]) {
    assert.ok(readFileSync(p, 'utf8').includes('localhost:4000'), `proxy backend: ${p}`);
  }
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  for (const e of ['CreateDisputeInputSchema', 'ResolveDisputeInputSchema', 'buildDisputeNo', 'refundCap', 'ESCROW_HOLD_DAYS', 'DISPUTE_FRAUD_MONTHLY_LIMIT']) {
    assert.ok(barrel.includes(e), `barrel ${e}`);
  }
  ok('12. Frontend 5-state + codes + compress + IDB + 7 proxies + barrel');
}
}

main()
  .then(() => console.log(`\nPhase 113 contracts: ${passed}/12 groups passed`))
  .catch((err) => {
    console.error('\nPhase 113 contracts FAILED:', err);
    process.exit(1);
  });
