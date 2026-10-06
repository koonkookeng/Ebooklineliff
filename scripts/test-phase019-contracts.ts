// SSOT Phase 019 §10/Task 7 — receipt pipeline contracts (loop 3x)
// Run: npx tsx scripts/test-phase019-contracts.ts
import assert from 'node:assert/strict';
import {
  ReceiptDeliveryStatusEnum,
  ReceiptLineItemSchema,
  LineReceiptPayloadSchema,
  ReceiptLogSchema,
  ReceiptDownloadTicketSchema,
  FLEX_MAX_BYTES,
  RECEIPT_MAX_RETRIES,
  RECEIPT_URL_TTL_SEC,
  vatIncluded,
  receiptR2Key,
} from '../packages/shared/src/schemas/line-receipt.schema';
import { buildReceiptFlexMessage } from '../apps/backend/src/modules/notification/templates/receipt-flex.template';
import { buildReceiptPdf, sanitizePdfText, buyerRef } from '../apps/backend/src/modules/notification/pdf/receipt-pdf.generator';
import {
  ReceiptQueueProcessor,
  RetryableError,
  PermanentError,
  signDownloadTicket,
  verifyDownloadTicket,
  downloadUrlFor,
  r2PublicUrlFor,
} from '../apps/backend/src/modules/notification/processors/receipt-queue.processor';
import { LineMessagingService, toDeliveryStatus } from '../apps/backend/src/modules/notification/line-messaging.service';
import type { PrismaService } from '../apps/backend/src/infra/database/prisma.service';
import type { RedisClusterService } from '../apps/backend/src/infra/redis/redis-cluster.service';

const UID = '123e4567-e89b-12d3-a456-426614174000';
const OID = '423e4567-e89b-12d3-a456-426614174003';
const PID = '223e4567-e89b-12d3-a456-426614174001';
const LID = '523e4567-e89b-12d3-a456-426614174010';
let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

// ---------- env + fetch sandbox ----------
const ENV_KEEP: Record<string, string | undefined> = {};
for (const k of ['LIFF_BASE_URL', 'LINE_CHANNEL_ACCESS_TOKEN', 'RECEIPT_HMAC_SECRET', 'R2_ENDPOINT', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_PUBLIC_DOMAIN']) {
  ENV_KEEP[k] = process.env[k];
  delete process.env[k];
}
process.env.LIFF_BASE_URL = 'https://liff.test';
process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token';
process.env.RECEIPT_HMAC_SECRET = 'test-secret';

const FETCH_KEEP = globalThis.fetch;
let fetchCalls = 0;
function mockFetch(status: number, body: unknown, opts?: { hang?: boolean }): void {
  fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls++;
    if (opts?.hang) {
      await new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })), 5));
      throw new Error('unreachable');
    }
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
  }) as typeof fetch;
}
function restoreFetch(): void {
  globalThis.fetch = FETCH_KEEP;
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
      subscribe: async (): Promise<() => void> => () => undefined,
    },
  };
}

interface Row { [k: string]: unknown }

function fakePrisma(opts?: { lineUserId?: string | null; orderUserId?: string }) {
  const lineUserId = opts?.lineUserId === undefined ? 'U123LINE' : opts.lineUserId;
  const logs = new Map<string, Row>();
  const api = {
    logs,
    receiptNotificationLog: {
      findFirst: async (): Promise<Row | null> => [...logs.values()].sort((a, b) => Number(a['seq']) - Number(b['seq'])).at(-1) ?? null,
      findUnique: async (args: { where: { id: string } }): Promise<Row | null> => logs.get(args.where.id) ?? null,
      create: async (args: { data: Row }): Promise<Row> => {
        const row: Row = { id: LID, lineMessageId: null, pdfR2Path: null, errorMessage: null, retryCount: 0, sentAt: null, seq: logs.size, ...args.data };
        logs.set(String(row['id']), row);
        return row;
      },
      update: async (args: { where: { id: string }; data: Row }): Promise<Row> => {
        const row = logs.get(args.where.id);
        if (row) Object.assign(row, args.data);
        return row ?? {};
      },
      findMany: async (args?: { where?: { OR?: Array<{ status?: string }> }; take?: number }): Promise<Row[]> => {
        let rows = [...logs.values()];
        const wanted = args?.where?.OR?.map((c) => c.status).filter((s): s is string => typeof s === 'string');
        if (wanted && wanted.length > 0) rows = rows.filter((r) => wanted.includes(String(r['status'])));
        rows.sort((a, b) => Number(a['seq']) - Number(b['seq']));
        return typeof args?.take === 'number' ? rows.slice(0, args.take) : rows;
      },
    },
    order: {
      findUnique: async (): Promise<Row> => ({ id: OID, orderNumber: 'ORD-998811', tenantId: 'default', userId: opts?.orderUserId ?? UID, netAmount: 500, updatedAt: new Date('2026-10-06T12:00:00Z') }),
    },
    orderItem: {
      findMany: async (): Promise<Row[]> => [{ productId: PID, price: 500, quantity: 1 }],
    },
    product: {
      findMany: async (): Promise<Row[]> => [{ id: PID, title: 'Ebook A', productType: 'EBOOK' }],
    },
    user: {
      findUnique: async (): Promise<Row> => ({ lineUserId, displayName: 'Test Buyer' }),
    },
    tenantSetting: { findUnique: async (): Promise<null> => null },
    tenant: { findUnique: async (): Promise<null> => null },
  };
  return { api };
}

const castP = (v: unknown): PrismaService => v as PrismaService;
const castR = (v: unknown): RedisClusterService => v as RedisClusterService;

const basePayload = {
  orderId: OID,
  orderNumber: 'ORD-998811',
  lineUserId: 'U123LINE',
  tenantId: 'default',
  tenantName: 'Acme Store',
  tenantLogoUrl: 'https://cdn.test/logo.png',
  buyerDisplayName: 'Test Buyer',
  netAmount: 500,
  vatAmount: vatIncluded(500),
  paymentMethod: 'PromptPay',
  paidAt: new Date('2026-10-06T12:00:00Z').toISOString(),
  items: [{ title: 'Ebook A', productType: 'EBOOK', quantity: 1, unitPrice: 500, totalPrice: 500 }],
  pdfDownloadUrl: 'https://liff.test/api/receipts/download?logId=x&exp=1&sig=y',
  liffRedirectUrl: 'https://liff.test/library',
};

// ---------- 1. Zod SSOT ----------
async function sectionContracts(): Promise<void> {
  assert.deepEqual(ReceiptDeliveryStatusEnum.options, ['PENDING', 'COMPOSING', 'SENT', 'DELIVERED', 'FAILED_RETRYING', 'FAILED_PERMANENT']);
  assert.equal(ReceiptLineItemSchema.safeParse({ title: 'T', productType: 'EBOOK', quantity: 1, unitPrice: 100, totalPrice: 100 }).success, true);
  assert.equal(ReceiptLineItemSchema.safeParse({ title: 'T', productType: 'NOPE', quantity: 1, unitPrice: 1, totalPrice: 1 }).success, false);
  assert.equal(LineReceiptPayloadSchema.safeParse(basePayload).success, true);
  assert.equal(LineReceiptPayloadSchema.safeParse({ ...basePayload, netAmount: -5 }).success, false);
  assert.equal(LineReceiptPayloadSchema.safeParse({ ...basePayload, pdfDownloadUrl: 'nope' }).success, false);
  assert.equal(ReceiptLogSchema.safeParse({ id: LID, orderId: OID, orderNumber: 'ORD-1', lineUserId: 'U1', status: 'DELIVERED', lineMessageId: 'm1', pdfR2Path: 'k', pdfDownloadUrl: 'https://liff.test/x', errorMessage: null, retryCount: 0, sentAt: new Date().toISOString() }).success, true);
  assert.equal(ReceiptDownloadTicketSchema.safeParse({ logId: LID, exp: 999, sig: 's' }).success, true);
  assert.equal(FLEX_MAX_BYTES, 10 * 1024);
  assert.equal(RECEIPT_MAX_RETRIES, 3);
  assert.equal(RECEIPT_URL_TTL_SEC, 86400);
  assert.equal(vatIncluded(107), 7, '7% included-VAT back-calc');
  assert.equal(vatIncluded(0), 0);
  assert.equal(receiptR2Key('default', 'ORD-998811', new Date('2026-05-01T00:00:00Z')), 'receipts/default/2026/ORD-998811.pdf');
  assert.equal(receiptR2Key('a/b', 'O:R:D', new Date('2026-05-01T00:00:00Z')), 'receipts/a_b/2026/O_R_D.pdf', 'key sanitized');
  assert.deepEqual([toDeliveryStatus('PENDING', 0), toDeliveryStatus('GENERATED', 0), toDeliveryStatus('DELIVERED', 0), toDeliveryStatus('FAILED', 1), toDeliveryStatus('FAILED', 3)], ['PENDING', 'SENT', 'DELIVERED', 'FAILED_RETRYING', 'FAILED_PERMANENT']);
  ok('Zod SSOT (payload/log/ticket + VAT/R2-key/status-map)');
}

// ---------- 2. Flex template ----------
async function sectionFlex(): Promise<void> {
  const t0 = performance.now();
  const msg = buildReceiptFlexMessage(LineReceiptPayloadSchema.parse(basePayload), '#00C751');
  assert.ok(performance.now() - t0 < 100, 'compose <100ms');
  assert.equal(msg.type, 'flex');
  assert.ok(String(msg.altText).includes('ORD-998811'));
  const bubble = msg.contents as { size: string; footer: { contents: Array<{ action: { uri: string } }> } };
  assert.equal(bubble.size, 'mega');
  assert.equal(bubble.footer.contents.length, 2, 'library + PDF buttons');
  assert.ok(bubble.footer.contents[1]?.action.uri.includes('download'));
  const bytes = Buffer.byteLength(JSON.stringify(msg), 'utf8');
  assert.ok(bytes < FLEX_MAX_BYTES, `${bytes}B < 10KB`);
  const many = { ...basePayload, items: Array.from({ length: 60 }, (_, i) => ({ title: `Item ${i} with a fairly long title text here`, productType: 'EBOOK' as const, quantity: 1, unitPrice: 100, totalPrice: 100 })) };
  assert.throws(() => buildReceiptFlexMessage(LineReceiptPayloadSchema.parse(many)), /10KB/, 'budget enforced');
  ok('flex template (bubble + 2 CTAs + <10KB guard)');
}

// ---------- 3. PDF ----------
async function sectionPdf(): Promise<void> {
  const pdf = buildReceiptPdf({
    orderNumber: 'ORD-998811', tenantName: 'Acme', taxRegistrationNo: '1234567890123',
    buyerHash: buyerRef('U123LINE'), paidAt: '2026-10-06T12:00:00.000Z', paymentMethod: 'PromptPay',
    items: [{ title: 'Ebook A', quantity: 1, totalPrice: 500 }], netAmount: 500, vatAmount: vatIncluded(500),
  });
  const s = pdf.toString('utf8');
  assert.ok(s.startsWith('%PDF-1.4'));
  assert.ok(s.includes('ORD-998811'));
  assert.ok(s.includes('TOTAL'));
  assert.ok(s.includes(buyerRef('U123LINE')), 'forensic buyer hash embedded');
  assert.ok(s.includes('/Count 1'));
  assert.ok(s.trimEnd().endsWith('%%EOF'));
  assert.equal(sanitizePdfText('สวัสดี (test)\\'), '?????? \\(test\\)\\\\', 'thai folded, delimiters escaped');
  assert.equal(buyerRef('U123LINE'), buyerRef('U123LINE'));
  assert.equal(buyerRef('U123LINE').length, 16);
  ok('pdf (valid %PDF + forensic line + sanitizer)');
}

// ---------- 4. HMAC tickets ----------
async function sectionTickets(): Promise<void> {
  const { exp, sig } = signDownloadTicket(LID);
  assert.equal(verifyDownloadTicket(LID, exp, sig), true);
  assert.equal(verifyDownloadTicket(LID, exp, `${sig}x`), false, 'tampered');
  assert.equal(verifyDownloadTicket(PID, exp, sig), false, 'wrong log');
  assert.equal(verifyDownloadTicket(LID, Math.floor(Date.now() / 1000) - 10, sig), false, 'expired');
  assert.ok(downloadUrlFor(LID).includes('/api/receipts/download?logId='));
  process.env.R2_PUBLIC_DOMAIN = 'https://cdn.test';
  assert.equal(r2PublicUrlFor('receipts/default/2026/X.pdf'), 'https://cdn.test/receipts/default/2026/X.pdf');
  delete process.env.R2_PUBLIC_DOMAIN;
  assert.equal(r2PublicUrlFor('k'), null, 'unconfigured → null');
  ok('tickets (sign/verify/expiry + public URL)');
}

// ---------- 5. Push attempts ----------
async function sectionPush(): Promise<void> {
  const f = fakeRedis();
  const p = fakePrisma();
  const proc = new ReceiptQueueProcessor(castP(p.api), castR(f.redis));
  mockFetch(200, { sentMessages: [{ id: 'mid-1' }] });
  assert.equal(await proc.pushOnce('tok', 'U1', { type: 'flex' }), 'mid-1');
  mockFetch(200, {});
  assert.equal(await proc.pushOnce('tok', 'U1', { type: 'flex' }), 'ACK', 'missing id → ACK');
  mockFetch(429, { message: 'rate limited' });
  await assert.rejects(proc.pushOnce('tok', 'U1', {}), RetryableError);
  mockFetch(500, {});
  await assert.rejects(proc.pushOnce('tok', 'U1', {}), RetryableError);
  mockFetch(400, { message: 'blocked' });
  await assert.rejects(proc.pushOnce('tok', 'U1', {}), PermanentError);
  mockFetch(200, {}, { hang: true });
  await assert.rejects(proc.pushOnce('tok', 'U1', {}), RetryableError, 'timeout retryable');
  assert.equal(fetchCalls >= 1, true);
  ok('push (id/ACK + 429/5xx/timeout retryable + 4xx permanent)');
  restoreFetch();
}

// ---------- 6. E2E happy path ----------
async function sectionE2E(): Promise<void> {
  const f = fakeRedis();
  const p = fakePrisma();
  const proc = new ReceiptQueueProcessor(castP(p.api), castR(f.redis));
  const svc = new LineMessagingService(castP(p.api), castR(f.redis), proc);
  mockFetch(200, { sentMessages: [{ id: 'mid-9' }] });
  const first = await svc.requestReceipt(OID);
  assert.equal(first.status, 'DELIVERED');
  assert.equal(p.api.logs.get(LID)?.['lineMessageId'], 'mid-9');
  assert.equal(p.api.logs.get(LID)?.['retryCount'], 0);
  assert.ok(f.events.some((e) => e.ch === 'stream:analytics:receipt' && e.msg.includes('line.receipt.delivered')));
  const calls = fetchCalls;
  const second = await svc.requestReceipt(OID);
  assert.equal(second.status, 'DELIVERED');
  assert.equal(fetchCalls, calls, 'idempotent: no second push');
  const detail = await svc.getReceiptForOrder(OID, UID);
  assert.equal(detail.orderNumber, 'ORD-998811');
  assert.equal(detail.items.length, 1);
  assert.equal(detail.downloadUrl, null, 'no R2 → no download URL (honest degrade)');
  await assert.rejects(svc.getReceiptForOrder(OID, PID), /not found/i, 'ownership enforced');
  restoreFetch();
  ok('e2e (request → DELIVERED + idempotent + owned detail + sneak denied)');
}

// ---------- 7. Failure paths ----------
async function sectionFailures(): Promise<void> {
  // 429 storm → 3 attempts → FAILED_PERMANENT view + failed telemetry
  {
    const f = fakeRedis();
    const p = fakePrisma();
    const proc = new ReceiptQueueProcessor(castP(p.api), castR(f.redis));
    const svc = new LineMessagingService(castP(p.api), castR(f.redis), proc);
    mockFetch(429, { message: 'slow down' });
    const r = await svc.requestReceipt(OID);
    assert.equal(r.status, 'FAILED_PERMANENT');
    assert.equal(r.retryCount, 3, 'max 3 attempts');
    assert.equal(fetchCalls, 3);
    assert.ok(f.events.some((e) => e.msg.includes('line.receipt.failed')));
    restoreFetch();
    ok('retry storm (3x backoff → FAILED_PERMANENT + telemetry)');
  }
  // No LINE OA linked → permanent without any push attempt
  {
    const f = fakeRedis();
    const p = fakePrisma({ lineUserId: null });
    const proc = new ReceiptQueueProcessor(castP(p.api), castR(f.redis));
    const svc = new LineMessagingService(castP(p.api), castR(f.redis), proc);
    mockFetch(200, { sentMessages: [{ id: 'x' }] });
    const r = await svc.requestReceipt(OID);
    assert.equal(r.status, 'FAILED_PERMANENT');
    assert.equal(fetchCalls, 0, 'never pushes without lineUserId');
    restoreFetch();
    ok('unlinked user (permanent, zero pushes)');
  }
  // drain: due rows processed, exhausted skipped
  {
    const f = fakeRedis();
    const p = fakePrisma();
    const proc = new ReceiptQueueProcessor(castP(p.api), castR(f.redis));
    p.api.logs.set('due-1', { id: 'due-1', orderId: OID, lineUserId: 'U123LINE', status: 'PENDING', lineMessageId: null, pdfR2Path: null, errorMessage: null, retryCount: 0, sentAt: null, seq: 0 });
    p.api.logs.set('dead-1', { id: 'dead-1', orderId: OID, lineUserId: 'U1', status: 'FAILED', lineMessageId: null, pdfR2Path: null, errorMessage: 'x', retryCount: 3, sentAt: null, seq: 1 });
    p.api.logs.set('flight-1', { id: 'flight-1', orderId: OID, lineUserId: 'U1', status: 'GENERATED', lineMessageId: null, pdfR2Path: 'k', errorMessage: null, retryCount: 0, sentAt: null, seq: 2 });
    mockFetch(200, { sentMessages: [{ id: 'm' }] });
    const r = await proc.drainPending(10);
    assert.equal(r.processed, 2, 'GENERATED in-flight never swept');
    assert.equal(r.delivered, 1, 'exhausted row skipped');
    assert.equal(p.api.logs.get('flight-1')?.['status'], 'GENERATED', 'in-flight row untouched');
    restoreFetch();
    ok('drain (due processed + exhausted/in-flight skipped)');
  }
  // download tickets
  {
    const f = fakeRedis();
    const p = fakePrisma();
    const proc = new ReceiptQueueProcessor(castP(p.api), castR(f.redis));
    const svc = new LineMessagingService(castP(p.api), castR(f.redis), proc);
    process.env.R2_PUBLIC_DOMAIN = 'https://cdn.test';
    p.api.logs.set(LID, { id: LID, orderId: OID, lineUserId: 'U1', status: 'DELIVERED', lineMessageId: 'm', pdfR2Path: 'receipts/default/2026/ORD.pdf', errorMessage: null, retryCount: 0, sentAt: new Date(), seq: 0 });
    const { exp, sig } = signDownloadTicket(LID);
    assert.equal(await svc.resolveDownload(LID, exp, sig), 'https://cdn.test/receipts/default/2026/ORD.pdf');
    await assert.rejects(svc.resolveDownload(LID, exp, 'bad'), /not found/i);
    delete process.env.R2_PUBLIC_DOMAIN;
    ok('download (HMAC → 302 target; forged → 404)');
  }
}

async function main(): Promise<void> {
  await sectionContracts();
  await sectionFlex();
  await sectionPdf();
  await sectionTickets();
  await sectionPush();
  await sectionE2E();
  await sectionFailures();
  for (const [k, v] of Object.entries(ENV_KEEP)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  restoreFetch();
  console.log(`\nphase019 contract tests: ${passed} groups passed`);
}

void main();
