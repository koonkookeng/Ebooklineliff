// SSOT Phase 014 §10/Task 14.6 — instant auto-slip verification contracts (loop 3x)
// Run: npx tsx scripts/test-phase014-contracts.ts
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  SlipVerificationInputSchema,
  EasySlipDataSchema,
  EasySlipResponseSchema,
  SlipVerificationResponseSchema,
  SLIP_TRANSREF_LOCK_SEC,
  SLIP_CLIENT_MAX_KB,
} from '../packages/shared/src/schemas/slip-verification.schema';
import { EasySlipProvider } from '../apps/backend/src/modules/payment/providers/easyslip.provider';
import {
  EasySlipVerifyAdapter,
  SlipUnverifiableError,
  EASYSLIP_TIMEOUT_MS,
} from '../apps/backend/src/modules/payment/services/easyslip-verify.adapter';
import { SlipVerifyService } from '../apps/backend/src/modules/order/services/slip-verify.service';
import { SlipUploadService } from '../apps/backend/src/modules/order/services/slip-upload.service';
import { SlipVerificationService } from '../apps/backend/src/modules/payment/slip-verification.service';
import { EntitlementGrantService } from '../apps/backend/src/modules/entitlement/services/entitlement-grant.service';
import type { PrismaService } from '../apps/backend/src/infra/database/prisma.service';
import type { RedisClusterService } from '../apps/backend/src/infra/redis/redis-cluster.service';

const UID = '123e4567-e89b-12d3-a456-426614174000';
const OID = '423e4567-e89b-12d3-a456-426614174003';
const OID2 = '423e4567-e89b-12d3-a456-426614174013';
const PID = '223e4567-e89b-12d3-a456-426614174001';
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

interface FakeSlipRow {
  orderId: string; transRef: string | null; slipSha256: string | null; amount: number;
}

function fakePrisma(orderOver?: Record<string, unknown>) {
  const orders = new Map<string, Record<string, unknown>>([
    [OID, { id: OID, orderNumber: 'ORD-1', userId: UID, netAmount: 450, orderStatus: 'PENDING_PAYMENT', paymentStatus: 'UNPAID', orderItems: [{ productId: PID }], ...orderOver }],
    [OID2, { id: OID2, orderNumber: 'ORD-2', userId: UID, netAmount: 450, orderStatus: 'PENDING_PAYMENT', paymentStatus: 'UNPAID', orderItems: [{ productId: PID }] }],
  ]);
  const slips: FakeSlipRow[] = [];
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
        const row = { orderId: args.where.orderId, ...(args.create as object) } as FakeSlipRow;
        const ix = slips.findIndex((s) => s.orderId === args.where.orderId);
        if (ix >= 0) slips[ix] = { ...slips[ix], ...(args.update as object) } as FakeSlipRow;
        else slips.push(row);
        return {};
      },
    },
    promptPayTransaction: {
      findFirst: async (): Promise<null> => null,
      updateMany: async (): Promise<{ count: number }> => ({ count: 0 }),
    },
    entitlement: {
      upsert: async (args: { create: { productId: string } }): Promise<{ productId: string }> => ({ productId: args.create.productId }),
      findUnique: async (): Promise<null> => null,
    },
    $transaction: (fn: (t: unknown) => Promise<unknown>): Promise<unknown> => fn(api),
  };
  return { api, orders, slips };
}

const castP = (v: unknown): PrismaService => v as PrismaService;
const castR = (v: unknown): RedisClusterService => v as RedisClusterService;
const grants = (redis: unknown): EntitlementGrantService => new EntitlementGrantService(castR(redis));

const specSlipBody = (over?: Record<string, unknown>): Record<string, unknown> => ({
  status: 200,
  data: {
    transRef: '20260929123456789',
    sendingBank: 'KBANK',
    receivingBank: 'SCB',
    receivingAccount: '1234567890',
    amount: { value: 450 },
    date: '2026-10-06T12:00:00Z',
    ...over,
  },
});

function mockFetch(handler: (url: string, init: Record<string, unknown>) => unknown): () => void {
  const prev = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init: unknown) => handler(String(url), (init ?? {}) as Record<string, unknown>)) as typeof fetch;
  return () => {
    globalThis.fetch = prev;
  };
}

// ---------- 1. Zod SSOT ----------
async function sectionContracts(): Promise<void> {
  {
    assert.equal(SlipVerificationInputSchema.safeParse({ orderId: OID, slipImageUrl: 'https://cdn/s.png', tenantId: TID }).success, true);
    assert.equal(SlipVerificationInputSchema.safeParse({ orderId: OID, slipBase64: 'aGVsbG8=', tenantId: TID }).success, true);
    assert.equal(SlipVerificationInputSchema.safeParse({ orderId: OID, tenantId: TID }).success, false, 'needs an image source');
    assert.equal(SlipVerificationInputSchema.safeParse({ orderId: 'bad', slipImageUrl: 'https://cdn/s.png', tenantId: TID }).success, false);
    assert.equal(SlipVerificationInputSchema.safeParse({ orderId: OID, slipImageUrl: 'https://cdn/s.png', tenantId: '' }).success, false);
    assert.equal(EasySlipDataSchema.safeParse({ transRef: 'T', sendingBank: 'K', receivingBank: 'S', receivingAccount: '1', amount: { value: 10 }, date: 'd' }).success, true);
    assert.equal(EasySlipDataSchema.safeParse({ transRef: 'T', amount: { value: -1 } }).success, false);
    assert.equal(EasySlipResponseSchema.safeParse({ status: 200, data: { transRef: 'T', sendingBank: 'K', receivingBank: 'S', receivingAccount: '1', amount: { value: 10 }, date: 'd' } }).success, true);
    assert.equal(EasySlipResponseSchema.safeParse({ status: 400, message: 'bad qr' }).success, true);
    assert.equal(SlipVerificationResponseSchema.safeParse({ success: true, message: 'ok', orderId: OID, orderStatus: 'COMPLETED', paymentStatus: 'VERIFIED', transRef: 'T', entitlementGranted: true, processedInMs: 320 }).success, true);
    assert.equal(SlipVerificationResponseSchema.safeParse({ success: true, message: 'ok', orderId: OID, orderStatus: 'NOPE', paymentStatus: 'VERIFIED', transRef: null, entitlementGranted: false, processedInMs: 1 }).success, false);
    assert.equal(SLIP_TRANSREF_LOCK_SEC, 2592000);
    assert.equal(SLIP_CLIENT_MAX_KB, 300);
    assert.equal(EASYSLIP_TIMEOUT_MS, 800);
    ok('Zod SSOT (v1 input refine + provider shapes + response + constants)');
  }
}

// ---------- 2. Provider: primary / fallback / timeout / shapes ----------
async function sectionProvider(): Promise<void> {
  {
    const restore = mockFetch(() => ({ ok: true, json: async () => specSlipBody() }));
    try {
      const provider = new EasySlipProvider();
      const res = await provider.verifySlipBase64('a'.repeat(200));
      assert.equal(res.status, 200);
      assert.equal(res.data?.transRef, '20260929123456789');
      let fallbackFired = false;
      const res2 = await provider.verifySlipUrl('https://cdn/s.png', () => { fallbackFired = true; });
      assert.equal(res2.data?.amount.value, 450);
      assert.equal(fallbackFired, false, 'no fallback on primary success');
    } finally {
      restore();
    }
    ok('provider primary (base64 + URL, spec-shape validated)');
  }
  {
    // legacy nested production shape maps onto the spec contract
    const restore = mockFetch(() => ({
      ok: true,
      json: async () => ({
        status: 200,
        data: {
          transRef: 'LEGACY99', date: '2026-10-06',
          amount: { value: 450 },
          sender: { bank: { name: 'KBANK' } },
          receiver: { account: { bank: { account: '123-456-7890' } } },
        },
      }),
    }));
    try {
      const provider = new EasySlipProvider();
      const res = await provider.verifySlipUrl('https://cdn/s.png');
      assert.equal(res.data?.transRef, 'LEGACY99');
      assert.equal(res.data?.receivingAccount, '1234567890', 'account canonicalized to digits');
    } finally {
      restore();
    }
    ok('provider legacy-shape tolerance (nested → spec contract)');
  }
  {
    // primary rejects + SlipOK configured → fallback wins
    process.env.SLIPOK_API_URL = 'https://slipok.test/verify';
    process.env.SLIPOK_API_KEY = 'test-key';
    const seen: string[] = [];
    const restore = mockFetch((url) => {
      seen.push(url);
      if (url.includes('easyslip')) return { ok: false, status: 500, json: async () => ({ status: 500, message: 'boom' }) };
      return { ok: true, json: async () => specSlipBody({ transRef: 'FALLBACK1' }) };
    });
    try {
      const provider = new EasySlipProvider();
      let fired = false;
      const res = await provider.verifySlipUrl('https://cdn/s.png', () => { fired = true; });
      assert.equal(res.data?.transRef, 'FALLBACK1');
      assert.equal(fired, true);
      assert.ok(seen.some((u) => u.includes('easyslip')) && seen.some((u) => u.includes('slipok')));
    } finally {
      restore();
      delete process.env.SLIPOK_API_URL;
      delete process.env.SLIPOK_API_KEY;
    }
    ok('provider SlipOK fallback (primary 500 → fallback success + hook)');
  }
  {
    // primary rejects + no fallback → typed error; short base64 → typed error
    const restore = mockFetch(() => ({ ok: false, status: 400, json: async () => ({ status: 400, message: 'unreadable' }) }));
    try {
      const provider = new EasySlipProvider();
      await assert.rejects(provider.verifySlipUrl('https://cdn/s.png'), /unreadable/);
      await assert.rejects(provider.verifySlipBase64('short'), SlipUnverifiableError);
      await assert.rejects(provider.verifySlipUrl('not-a-url'), SlipUnverifiableError);
    } finally {
      restore();
    }
    ok('provider errors (typed, message-preserving, input-guarded)');
  }
}

// ---------- 3. Adapter routing ----------
async function sectionAdapter(): Promise<void> {
  {
    const bodies: unknown[] = [];
    const restore = mockFetch((_url, init) => {
      bodies.push(JSON.parse(String(init.body)));
      return { ok: true, json: async () => specSlipBody() };
    });
    try {
      const adapter = new EasySlipVerifyAdapter();
      const viaUrl = await adapter.verify('https://cdn/s.png');
      assert.equal(viaUrl.amount, 450);
      assert.equal(viaUrl.receiverAccount, '1234567890');
      const viaB64 = await adapter.verify('a'.repeat(200));
      assert.equal(viaB64.transRef, '20260929123456789');
      assert.deepEqual(bodies, [{ image_url: 'https://cdn/s.png' }, { image: 'a'.repeat(200) }]);
      await assert.rejects(adapter.verify('short'), SlipUnverifiableError);
    } finally {
      restore();
    }
    ok('adapter routing (URL→image_url, base64→image, input guard)');
  }
}

// ---------- 4. Anti-replay + FAILED semantics + timing + sha ----------
async function sectionVerify(): Promise<void> {
  const mockEasyslip = (transRef: string, amount: number): EasySlipVerifyAdapter => ({
    verify: async (): Promise<{ transRef: string; amount: number; receiverAccount: string; senderBank: string; raw: Record<string, never> }> => ({
      transRef, amount, receiverAccount: '', senderBank: 'BANK', raw: {},
    }),
  }) as unknown as EasySlipVerifyAdapter;

  {
    // first claim succeeds with timing + analytics + sha stored
    const f = fakeRedis();
    const p = fakePrisma();
    const verify = new SlipVerifyService(castP(p.api), castR(f.redis), mockEasyslip('20260929123456789', 450), grants(f.redis));
    const t0 = performance.now();
    const res = await verify.verify(OID, 'https://cdn/s.png', UID, { slipSha256: 'a'.repeat(64) });
    const wall = performance.now() - t0;
    assert.equal(res.success, true);
    assert.ok(typeof res.processedInMs === 'number' && res.processedInMs <= wall + 1, 'processedInMs present');
    assert.equal(p.slips[0]?.slipSha256, 'a'.repeat(64), 'forensic hash stored');
    assert.ok(f.events.some((e) => e.ch === 'stream:analytics:payments' && e.msg.includes('payment_slip_verified_success')));
    assert.equal(f.store.get('slip:transRef:20260929123456789'), OID, '30-day replay lock claimed');
    ok('verify success (timing + sha + analytics + replay lock)');
  }
  {
    // replay same transRef on a NEW order → SLIP_ALREADY_USED, zero DB change
    const f = fakeRedis();
    const p = fakePrisma();
    f.store.set('slip:transRef:20260929123456789', OID);
    const verify = new SlipVerifyService(castP(p.api), castR(f.redis), mockEasyslip('20260929123456789', 450), grants(f.redis));
    await assert.rejects(verify.verify(OID2, 'https://cdn/other.png', UID), /SLIP_ALREADY_USED/);
    assert.equal(p.slips.length, 0, 'no payment slip written');
    assert.equal(p.orders.get(OID2)?.paymentStatus, 'PENDING_SLIP', 'no failure marking without provider fault');
    assert.ok(f.events.some((e) => e.ch === 'stream:security:fraud-alert' && e.msg.includes('payment_slip_fraud_alert')));
    ok('anti-replay (SLIP_ALREADY_USED + zero DB change + fraud alert)');
  }
  {
    // amount mismatch → FAILED (user-actionable); provider outage → PENDING_SLIP
    const f = fakeRedis();
    const p = fakePrisma();
    const short = new SlipVerifyService(castP(p.api), castR(f.redis), mockEasyslip('SHORT1', 400), grants(f.redis));
    await assert.rejects(short.verify(OID, 'https://cdn/s.png', UID), /does not match/);
    assert.equal(p.orders.get(OID)?.paymentStatus, 'FAILED');
    const down = new SlipVerifyService(
      castP(p.api), castR(f.redis),
      { verify: async (): Promise<never> => { throw new SlipUnverifiableError('EasySlip timeout'); } } as unknown as EasySlipVerifyAdapter,
      grants(f.redis),
    );
    await assert.rejects(down.verify(OID2, 'https://cdn/s.png', UID), /timeout/);
    assert.equal(p.orders.get(OID2)?.paymentStatus, 'PENDING_SLIP');
    ok('failure semantics (mismatch→FAILED, outage→PENDING_SLIP)');
  }
}

// ---------- 5. Upload service: sha + analytics ----------
async function sectionUpload(): Promise<void> {
  {
    process.env.R2_ENDPOINT = 'https://r2.test';
    process.env.R2_BUCKET = 'slips';
    process.env.R2_ACCESS_KEY_ID = 'ak';
    process.env.R2_SECRET_ACCESS_KEY = 'sk';
    process.env.R2_PUBLIC_DOMAIN = 'https://cdn.test';
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 7)]);
    const restore = mockFetch(() => ({ ok: true }));
    try {
      const f = fakeRedis();
      const svc = new SlipUploadService(castR(f.redis));
      const res = await svc.uploadSlipImage(OID, 'slip.png', 'image/png', png.toString('base64'), { tenantId: TID });
      assert.equal(res.slipSha256, createHash('sha256').update(png).digest('hex'), 'forensic hash = bytes hash');
      assert.ok(res.slipImageUrl.startsWith('https://cdn.test/slips/'));
      assert.ok(res.fileSizeKb > 0);
      const evt = f.events.find((e) => e.ch === 'stream:analytics:payments');
      assert.ok(evt && evt.msg.includes('payment_slip_uploaded') && evt.msg.includes(TID));
      // no-redis construction still uploads (analytics best-effort)
      const bare = new SlipUploadService();
      const res2 = await bare.uploadSlipImage(OID, 'slip.png', 'image/png', png.toString('base64'));
      assert.ok(res2.slipImageUrl.startsWith('https://cdn.test/'));
    } finally {
      restore();
      delete process.env.R2_ENDPOINT;
      delete process.env.R2_BUCKET;
      delete process.env.R2_ACCESS_KEY_ID;
      delete process.env.R2_SECRET_ACCESS_KEY;
      delete process.env.R2_PUBLIC_DOMAIN;
    }
    ok('upload (sha256 + R2 URL + uploaded analytics + redis-optional)');
  }
}

// ---------- 6. v1 facade + controller ----------
async function sectionFacade(): Promise<void> {
  {
    // URL flow maps onto the spec response shape
    const f = fakeRedis();
    const p = fakePrisma();
    const mockAdapter = {
      verify: async (): Promise<{ transRef: string; amount: number; receiverAccount: string; senderBank: string; raw: Record<string, never> }> => ({
        transRef: 'V1URL1', amount: 450, receiverAccount: '', senderBank: 'B', raw: {},
      }),
    } as unknown as EasySlipVerifyAdapter;
    const orderVerify = new SlipVerifyService(castP(p.api), castR(f.redis), mockAdapter, grants(f.redis));
    const uploads = { uploadSlipImage: async (): Promise<never> => { throw new Error('should not upload'); } } as unknown as SlipUploadService;
    const facade = new SlipVerificationService(uploads, orderVerify);
    const res = await facade.processSlipVerification({ orderId: OID, slipImageUrl: 'https://cdn/s.png', tenantId: TID, actorUserId: UID });
    assert.equal(res.success, true);
    assert.equal(res.entitlementGranted, true);
    assert.equal(res.transRef, 'V1URL1');
    assert.ok(typeof res.processedInMs === 'number');
    await assert.rejects(facade.processSlipVerification({ orderId: OID, tenantId: TID, actorUserId: UID }), /Invalid slip verification payload/);
    ok('facade URL flow (spec-shape mapping + input validation)');
  }
  {
    // base64 flow materializes via R2 then verifies (sha carried through)
    process.env.R2_ENDPOINT = 'https://r2.test';
    process.env.R2_BUCKET = 'slips';
    process.env.R2_ACCESS_KEY_ID = 'ak';
    process.env.R2_SECRET_ACCESS_KEY = 'sk';
    process.env.R2_PUBLIC_DOMAIN = 'https://cdn.test';
    const png = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 9)]);
    const restore = mockFetch(() => ({ ok: true }));
    try {
      const f = fakeRedis();
      const p = fakePrisma();
      const mockAdapter = {
        verify: async (): Promise<{ transRef: string; amount: number; receiverAccount: string; senderBank: string; raw: Record<string, never> }> => ({
          transRef: 'V1B641', amount: 450, receiverAccount: '', senderBank: 'B', raw: {},
        }),
      } as unknown as EasySlipVerifyAdapter;
      const orderVerify = new SlipVerifyService(castP(p.api), castR(f.redis), mockAdapter, grants(f.redis));
      const uploads = new SlipUploadService(castR(f.redis));
      const facade = new SlipVerificationService(uploads, orderVerify);
      const res = await facade.processSlipVerification({ orderId: OID, slipBase64: png.toString('base64'), filename: 's.jpg', contentType: 'image/jpeg', tenantId: TID, actorUserId: UID });
      assert.equal(res.success, true);
      assert.equal(res.transRef, 'V1B641');
      assert.equal(p.slips[0]?.slipSha256, createHash('sha256').update(png).digest('hex'), 'sha carried base64→R2→slip row');
    } finally {
      restore();
      delete process.env.R2_ENDPOINT;
      delete process.env.R2_BUCKET;
      delete process.env.R2_ACCESS_KEY_ID;
      delete process.env.R2_SECRET_ACCESS_KEY;
      delete process.env.R2_PUBLIC_DOMAIN;
    }
    ok('facade base64 flow (R2 materialize + sha carry-through)');
  }
  {
    // boundary: 401 / 400 / passthrough (controller delegates to this method)
    const f = fakeRedis();
    const p = fakePrisma();
    const mockAdapter = {
      verify: async (): Promise<{ transRef: string; amount: number; receiverAccount: string; senderBank: string; raw: Record<string, never> }> => ({
        transRef: 'CTL1', amount: 450, receiverAccount: '', senderBank: 'B', raw: {},
      }),
    } as unknown as EasySlipVerifyAdapter;
    const facade = new SlipVerificationService(
      {} as SlipUploadService,
      new SlipVerifyService(castP(p.api), castR(f.redis), mockAdapter, grants(f.redis)),
    );
    await assert.rejects(facade.handleVerifyRequest({ orderId: OID, slipImageUrl: 'https://cdn/s.png', tenantId: TID }, undefined), /Unauthorized/);
    await assert.rejects(facade.handleVerifyRequest({ orderId: OID, tenantId: TID }, UID), /Invalid slip verification payload/);
    const res = await facade.handleVerifyRequest({ orderId: OID, slipImageUrl: 'https://cdn/s.png', tenantId: TID }, UID);
    assert.equal(res.success, true);
    assert.equal(res.orderStatus, 'COMPLETED');
    ok('v1 boundary (401/400 guards + verify delegation)');
  }
}

async function main(): Promise<void> {
  await sectionContracts();
  await sectionProvider();
  await sectionAdapter();
  await sectionVerify();
  await sectionUpload();
  await sectionFacade();
  console.log(`\nphase014 contract tests: ${passed} groups passed`);
}

void main();
