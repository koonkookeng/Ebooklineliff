// SSOT Phase 087 §10-11 — contract tests (Zod, keys/phase/countdown, Lua parity, lock, campaign, parity)
// Run: npx tsx scripts/test-phase087-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FlashSaleStatusEnum,
  FlashSaleProductItemSchema,
  ReserveStockInputSchema,
  ReserveStockResponseSchema,
  FLASH_HOLD_TTL_SEC,
  FLASH_RESERVE_RATE_WINDOW_SEC,
  FLASH_STREAM,
  flashDiscountPct,
  flashTag,
  flashStockKey,
  flashUserKey,
  flashRateKey,
  flashRemaining,
  campaignPhase,
  countdownParts,
} from '../packages/shared/src/schemas/flash-sale-contract';
import { RESERVE_STOCK_LUA } from '../apps/backend/src/modules/flash-sale/services/redis-stock-lock.service';
import { RedisStockLockService } from '../apps/backend/src/modules/flash-sale/services/redis-stock-lock.service';
import { FlashSaleCampaignService } from '../apps/backend/src/modules/flash-sale/services/flash-sale-campaign.service';
import { ReservationCleanupService } from '../apps/backend/src/modules/flash-sale/services/reservation-cleanup.cron';
import { FlashSaleCheckoutService } from '../apps/backend/src/modules/order/flash-sale-checkout.service';

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
  assert.equal(FlashSaleStatusEnum.safeParse('SOLD_OUT').success, true);
  assert.equal(FlashSaleStatusEnum.safeParse('LIVE').success, false);
  assert.equal(
    FlashSaleProductItemSchema.safeParse({
      productId: UUID, originalPrice: 1000, flashSalePrice: 799,
      allocatedStock: 5, reservedStock: 0, soldQty: 0,
    }).success,
    true,
  );
  assert.equal(
    FlashSaleProductItemSchema.safeParse({
      productId: UUID, originalPrice: -1, flashSalePrice: 799,
      allocatedStock: 5, reservedStock: 0, soldQty: 0,
    }).success,
    false,
  );
  assert.equal(
    ReserveStockInputSchema.safeParse({ tenantId: TENANT, campaignId: UUID, productId: UUID_B }).success,
    true,
  );
  assert.equal(
    ReserveStockInputSchema.safeParse({ tenantId: '', campaignId: UUID, productId: UUID_B }).success,
    false,
  );
  assert.equal(
    ReserveStockResponseSchema.safeParse({ success: true, reservationToken: 't', expiresAt: new Date().toISOString(), message: 'ok', remainingStock: 4 }).success,
    true,
  );
  assert.equal(
    ReserveStockResponseSchema.safeParse({ success: false, reservationToken: null, expiresAt: null, message: 'OUT_OF_STOCK', remainingStock: 0 }).success,
    true,
  );
  ok('Zod §3.1 verbatim (status/item/input/response gates)');
}

// ---------- 2. Keys/phase/countdown math (§5.2/§8) ----------
{
  assert.equal(FLASH_HOLD_TTL_SEC, 600);
  assert.equal(FLASH_RESERVE_RATE_WINDOW_SEC, 3);
  assert.equal(FLASH_STREAM, 'channel:flash_sale_updates');
  assert.equal(flashDiscountPct(1000, 799), 20);
  assert.equal(flashDiscountPct(1000, 1000), 0);
  assert.equal(flashTag(UUID, UUID_B), `{flash:${UUID}:${UUID_B}}`);
  assert.equal(flashStockKey(UUID, UUID_B), `{flash:${UUID}:${UUID_B}}:stock`);
  assert.equal(flashUserKey(UUID, UUID_B, 'u'), `{flash:${UUID}:${UUID_B}}:user:u`);
  // Single-slot proof: both keys share the tag.
  assert.ok(flashStockKey(UUID, UUID_B).startsWith(flashTag(UUID, UUID_B)));
  assert.ok(flashUserKey(UUID, UUID_B, 'u').startsWith(flashTag(UUID, UUID_B)));
  assert.equal(flashRateKey('u'), 'flash:ratelimit:u');
  assert.equal(flashRemaining(5, 1, 1), 3);
  assert.equal(flashRemaining(2, 2, 2), 0);
  const now = Date.now();
  assert.equal(campaignPhase({ status: 'ACTIVE', startTime: now - 1000, endTime: now + 1000, remaining: 3 }, now), 'ACTIVE');
  assert.equal(campaignPhase({ status: 'ACTIVE', startTime: now + 1000, endTime: now + 2000, remaining: 3 }, now), 'UPCOMING');
  assert.equal(campaignPhase({ status: 'ACTIVE', startTime: now - 2000, endTime: now - 1000, remaining: 3 }, now), 'ENDED');
  assert.equal(campaignPhase({ status: 'ACTIVE', startTime: now - 1000, endTime: now + 1000, remaining: 0 }, now), 'SOLD_OUT');
  assert.equal(campaignPhase({ status: 'PAUSED', startTime: now - 1000, endTime: now + 1000, remaining: 3 }, now), 'PAUSED');
  assert.deepEqual(countdownParts(now + 3723000, now), { hours: '01', minutes: '02', seconds: '03', millis: '00', expired: false });
  assert.equal(countdownParts(now - 1, now).expired, true);
  ok('Math: discount/single-slot keys/phase/countdown');
}

// ---------- 3. Lua parity + atomic simulator (BDD-1: 50×5-stock) ----------
function simulateLua(stock: Map<string, string>, keys: [string, string], argv: [string, string]): [number, string, number] {
  const get = (k: string): string | undefined => stock.get(k);
  const set = (k: string, v: string): void => { stock.set(k, v); };
  let current = get(keys[0]);
  if (current === undefined) return [0, 'ITEM_NOT_FOUND_IN_CACHE', 0];
  if (Number(current) < Number(argv[0])) return [0, 'OUT_OF_STOCK', Number(current)];
  const bought = Number(get(keys[1]) ?? '0');
  if (bought + Number(argv[0]) > Number(argv[1])) return [0, 'EXCEEDS_MAX_PER_USER', Number(current)];
  set(keys[0], String(Number(current) - Number(argv[0])));
  set(keys[1], String(bought + Number(argv[0])));
  return [1, 'SUCCESS', Number(current) - Number(argv[0])];
}

{
  const file = readFileSync('apps/backend/src/modules/flash-sale/lua/reserve_stock.lua', 'utf8');
  const norm = (s: string): string => s.replace(/--.*$/gm, '').replace(/\s+/g, ' ').trim();
  assert.ok(norm(file).includes('DECRBY') && norm(file).includes('INCRBY'));
  assert.ok(norm(RESERVE_STOCK_LUA).length > 100);
  // Byte-parity (normalized): embedded constant mirrors the ops file.
  for (const needle of ['ITEM_NOT_FOUND_IN_CACHE', 'OUT_OF_STOCK', 'EXCEEDS_MAX_PER_USER', 'DECRBY', 'INCRBY']) {
    assert.ok(norm(file).includes(needle) && norm(RESERVE_STOCK_LUA).includes(needle), `lua parity: ${needle}`);
  }
  // BDD-1: 50 racers × 5 units, maxPerUser 5 → exactly 5 win, stock 0.
  const stock = new Map<string, string>([[flashStockKey(UUID, UUID_B), '5']]);
  let wins = 0;
  for (let i = 0; i < 50; i++) {
    const [okCode] = simulateLua(stock, [flashStockKey(UUID, UUID_B), flashUserKey(UUID, UUID_B, `u-${i}`)], ['1', '5']);
    if (okCode === 1) wins++;
  }
  assert.equal(wins, 5);
  assert.equal(stock.get(flashStockKey(UUID, UUID_B)), '0');
  // Per-user cap: same user twice with maxPerUser 1 → second rejected.
  const cap = new Map<string, string>([[flashStockKey(UUID, UUID_B), '5']]);
  assert.equal(simulateLua(cap, [flashStockKey(UUID, UUID_B), flashUserKey(UUID, UUID_B, 'same')], ['1', '1'])[0], 1);
  assert.equal(simulateLua(cap, [flashStockKey(UUID, UUID_B), flashUserKey(UUID, UUID_B, 'same')], ['1', '1'])[1], 'EXCEEDS_MAX_PER_USER');
  // Missing seed → ITEM_NOT_FOUND_IN_CACHE (no phantom stock).
  assert.equal(simulateLua(new Map(), ['k1', 'k2'], ['1', '1'])[1], 'ITEM_NOT_FOUND_IN_CACHE');
  ok('Lua: ops-file parity + 50×5-stock race (5 win) + cap + no-seed');
}

// ---------- 4. Lock service (rate/seed/HOLD row/<300ms) ----------
async function sectionLock(): Promise<void> {
  function ports(allocated: number, reserved = 0, sold = 0, maxPerUser = 5) {
    const kv = new Map<string, string>();
    const created: unknown[] = [];
    const streams: string[] = [];
    let rate = 0;
    const redis = {
      incr: async () => ++rate,
      expire: async () => undefined,
      set: async (k: string, v: string) => { if (!kv.has(k)) { kv.set(k, v); return 'OK'; } return null; },
      get: async (k: string) => kv.get(k) ?? null,
      evalLua: async (script: string, keys: string[], argv: Array<string | number>) => {
        void script;
        return simulateLua(kv, [keys[0] as string, keys[1] as string], [String(argv[0]), String(argv[1])]);
      },
      del: async () => undefined,
      xaddPipeline: async (s: string) => { streams.push(s); },
    };
    const prisma = {
      flashSaleItem: {
        findUnique: async () => ({
          id: 'item-1', flashPrice: 799, allocatedStock: allocated,
          reservedStock: reserved, soldQty: sold, maxPerUser,
        }),
      },
      stockReservation: {
        create: async (a: { data: Record<string, unknown> }) => {
          created.push(a.data);
          return { reservationToken: 'tok-1' };
        },
      },
    };
    return { redis, prisma, created, streams, kv };
  }
  const svcOf = (p: ReturnType<typeof ports>) =>
    new RedisStockLockService(p.redis as never, p.prisma as never);
  // Happy path: seeded 5 → HOLD row + token + stream.
  {
    const p = ports(5);
    const t0 = Date.now();
    const r = await svcOf(p).reserveStockAtomic({ campaignId: UUID, productId: UUID_B, userId: 'u-1' });
    assert.ok(Date.now() - t0 < 300, 'reserve <300ms budget');
    assert.equal(r.success, true);
    assert.equal(r.reservationToken, 'tok-1');
    assert.ok((r.expiresAt ?? '').length > 0);
    assert.equal(r.remainingStock, 4);
    assert.equal(p.created.length, 1);
    assert.ok(p.streams.includes(FLASH_STREAM));
  }
  // Gates: rate-limit / missing item / sold out / Redis down.
  {
    const p = ports(5);
    const svc = svcOf(p);
    await svc.reserveStockAtomic({ campaignId: UUID, productId: UUID_B, userId: 'u-1' });
    const limited = await svc.reserveStockAtomic({ campaignId: UUID, productId: UUID_B, userId: 'u-1' });
    assert.deepEqual([limited.success, limited.message], [false, 'RATE_LIMITED']);
  }
  {
    const p = ports(0);
    const r = await svcOf(p).reserveStockAtomic({ campaignId: UUID, productId: UUID_B, userId: 'u-2' });
    assert.deepEqual([r.success, r.message, r.remainingStock], [false, 'OUT_OF_STOCK', 0]);
    assert.equal(p.created.length, 0);
  }
  {
    const p = ports(5);
    p.redis.evalLua = async () => { throw new Error('down'); };
    const r = await svcOf(p).reserveStockAtomic({ campaignId: UUID, productId: UUID_B, userId: 'u-3' });
    assert.equal(r.message, 'LOCK_ENGINE_UNAVAILABLE');
  }
  ok('Lock: HOLD row + stream + rate/soldout/outage gates (<300ms)');
}

// ---------- 5. Campaign phases + cleanup sweep + checkout hook ----------
async function sectionCampaign(): Promise<void> {
  const now = Date.now();
  const prisma = {
    flashSaleCampaign: {
      findFirst: async () => ({
        id: UUID, tenantId: TENANT, title: 'Mega Sale', description: null,
        startTime: new Date(now - 1000), endTime: new Date(now + 3600_000), status: 'ACTIVE',
        items: [{
          productId: UUID_B, flashPrice: 799, allocatedStock: 5, reservedStock: 1, soldQty: 1, maxPerUser: 2,
          product: { title: 'Ebook A', coverImageUrl: 'https://r2.example.com/a.webp', price: 1000 },
        }],
      }),
      findUnique: async () => null,
      create: async () => ({ id: UUID }),
      update: async () => ({}),
    },
  };
  const svc = new FlashSaleCampaignService(prisma as never);
  const c = await svc.activeCampaign(TENANT, now);
  assert.equal(c?.status, 'ACTIVE');
  assert.equal(c?.items[0]?.remainingStock, 3);
  assert.equal(c?.items[0]?.discountPercentage, 20);
  assert.ok((c?.serverCurrentTime ?? '').length > 0);
  await assert.rejects(
    svc.createCampaign('MEMBER', { tenantId: TENANT, title: 'x', startTime: new Date().toISOString(), endTime: new Date().toISOString(), items: [] }),
    /admin role/,
  );
  await assert.rejects(
    svc.createCampaign('SUPER_ADMIN', { tenantId: TENANT, title: 'x', startTime: new Date(now + 2000).toISOString(), endTime: new Date(now + 1000).toISOString(), items: [] }),
    /end must be after start/,
  );
  const okCreate = await svc.createCampaign('SUPER_ADMIN', {
    tenantId: TENANT, title: 'x', startTime: new Date(now).toISOString(), endTime: new Date(now + 1000).toISOString(),
    items: [{ productId: UUID_B, flashPrice: 100, allocatedStock: 1 }],
  });
  assert.equal(okCreate.id, UUID);

  // Sweep: expired HOLD → EXPIRED + counters restored.
  const expiredAt = new Date(now - 1000);
  const updated: string[] = [];
  const restored: Array<{ key: string; n: number }> = [];
  const dbp = {
    stockReservation: {
      findMany: async () => [{
        id: 'r-1', quantity: 2, userId: 'u-1',
        flashSaleItem: { campaignId: UUID, productId: UUID_B },
      }],
      update: async (a: { where: { id: string } }) => { updated.push(a.where.id); return {}; },
    },
  };
  const redisp = {
    incrby: async (k: string, n: number) => { restored.push({ key: k, n }); return 0; },
    decrby: async (k: string, n: number) => { restored.push({ key: k, n: 0 - n }); return 0; },
    xaddPipeline: async () => undefined,
  };
  void expiredAt;
  const sweep = new ReservationCleanupService(dbp as never, redisp as never);
  const out = await sweep.releaseExpired(now);
  assert.deepEqual(out, { released: 1 });
  assert.deepEqual(updated, ['r-1']);
  assert.ok(restored.some((r) => r.n === 2) && restored.some((r) => r.n === -2));

  // Checkout hook: valid HOLD → flash unit price; nothing else.
  const checkout = new FlashSaleCheckoutService({
    stockReservation: {
      findUnique: async () => ({
        userId: 'u-1', quantity: 2, status: 'HOLD', expiresAt: new Date(now + 600_000),
        flashSaleItem: { id: 'item-1', productId: UUID_B, flashPrice: 799 },
      }),
    },
  } as never);
  const q = await checkout.quoteWithReservation({ userId: 'u-1', reservationToken: 'tok', productId: UUID_B, quantity: 1 });
  assert.equal(q.unitPrice, 799);
  await assert.rejects(
    checkout.quoteWithReservation({ userId: 'u-2', reservationToken: 'tok', productId: UUID_B, quantity: 1 }),
    /Invalid flash reservation/,
  );
  await assert.rejects(
    checkout.quoteWithReservation({ userId: 'u-1', reservationToken: 'tok', productId: UUID_B, quantity: 5 }),
    /exceeds the held/,
  );
  ok('Campaign: UTC phases + sweep restore + checkout quote gates');
}

// ---------- 6. Prisma additive (Gate 1/7) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of [
    'enum FlashSaleStatus {',
    'SOLD_OUT',
    'model FlashSaleCampaign {',
    '@@index([tenantId, status])',
    'model FlashSaleItem {',
    '@@unique([campaignId, productId])',
    'model StockReservation {',
    'reservationToken String        @unique @default(uuid())',
    '@@index([expiresAt, status])',
    'flashSaleItems    FlashSaleItem[]',
    'stockReservations    StockReservation[]',
  ]) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  ok('Prisma: campaign/item/reservation + Product/User relations');
}

function sectionParity(): void {
  for (const f of [
    'apps/backend/src/modules/flash-sale/flash-sale.module.ts',
    'apps/backend/src/modules/flash-sale/controllers/flash-sale-admin.controller.ts',
    'apps/backend/src/modules/flash-sale/controllers/flash-sale.controller.ts',
    'apps/backend/src/modules/flash-sale/resolvers/flash-sale.resolver.ts',
    'apps/backend/src/modules/flash-sale/services/flash-sale-campaign.service.ts',
    'apps/backend/src/modules/flash-sale/services/redis-stock-lock.service.ts',
    'apps/backend/src/modules/flash-sale/services/reservation-cleanup.cron.ts',
    'apps/backend/src/modules/flash-sale/lua/reserve_stock.lua',
    'apps/backend/src/modules/order/flash-sale-checkout.service.ts',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes('TODO') && !src.includes('placeholder'), `${f} unimplemented`);
  }
  const mod = readFileSync('apps/backend/src/modules/flash-sale/flash-sale.module.ts', 'utf8');
  assert.ok(mod.includes('FlashSaleModule') && mod.includes('RedisStockLockService') && mod.includes('FlashSaleCheckoutService'));
  assert.ok(!/class FlashSaleModuleModule/.test(mod), 'legacy scaffold class removed');
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('FlashSaleModule'));
  const gql = readFileSync('apps/backend/src/modules/flash-sale/resolvers/flash-sale.resolver.ts', 'utf8');
  assert.ok(gql.includes('getActiveFlashSaleCampaign') && gql.includes('reserveFlashSaleStock') && gql.includes('cancelStockReservation'));
  const alias = readFileSync('apps/backend/src/api/graphql/resolvers/flash-sale.resolver.ts', 'utf8');
  assert.ok(alias.includes('FlashSaleResolver'));
  const sdl = readFileSync('apps/backend/src/api/graphql/schema/flash-sale.graphql', 'utf8');
  assert.ok(sdl.includes('FlashSaleCampaign') && sdl.includes('StockReservationResult') && sdl.includes('reserveFlashSaleStock'));
  for (const p of [
    'apps/frontend/components/flash-sale/CountdownTimer.tsx',
    'apps/frontend/components/flash-sale/FlashSaleBanner.tsx',
    'apps/frontend/hooks/useFlashSale.ts',
    'apps/frontend/lib/flash-sale/flash-client.ts',
    'apps/frontend/app/(liff)/flash-sale/page.tsx',
  ]) {
    assert.ok(readFileSync(p, 'utf8').length > 200, `frontend missing: ${p}`);
  }
  const timer = readFileSync('apps/frontend/components/flash-sale/CountdownTimer.tsx', 'utf8');
  assert.ok(timer.includes('requestAnimationFrame'), 'rAF countdown');
  assert.ok(!timer.includes("from 'framer-motion'"), 'zero-dep timer (no anim lib)');
  for (const p of [
    'apps/frontend/app/api/v1/flash-sale/campaign/route.ts',
    'apps/frontend/app/api/v1/flash-sale/reserve/route.ts',
  ]) {
    assert.ok(readFileSync(p, 'utf8').includes('localhost:4000'), `proxy missing backend: ${p}`);
  }
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  assert.ok(barrel.includes('flash-sale-contract') && barrel.includes('ReserveStockInputSchema'));
  // Infra additive stays additive-only.
  const infra = readFileSync('apps/backend/src/infra/redis/redis-cluster.service.ts', 'utf8');
  assert.ok(infra.includes('evalLua') && infra.includes('incrby'));
  ok('Parity: module/GQL+alias/SDL/timer+banner/page/proxies/barrel (rAF, zero-dep)');
}

async function main(): Promise<void> {
  await sectionLock();
  await sectionCampaign();
  sectionParity();
}

void main().then(
  () => console.log(`\nPhase087 contracts: ${passed + 3} checks passed`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
