// SSOT Phase 117 §10-11 — contract tests (Zod, entity gates, stack math,
// atomic validate/claim, Lua guards, Prisma Gate 1, SDL, frontend, barrel).
// Run: npx tsx scripts/test-phase117-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CouponTypeEnum,
  CouponTargetTypeEnum,
  ValidateCouponInputSchema,
  CampaignDiscountBreakdownSchema,
  CouponValidationResponseSchema,
  ClaimCouponInputSchema,
  COUPON_VALIDATE_BUDGET_MS,
  COUPON_RESERVATION_TTL_SEC,
  COUPON_META_CACHE_TTL_SEC,
  COUPON_VALIDATE_RATE_LIMIT,
  COUPON_VALIDATE_RATE_WINDOW_SEC,
  CAMPAIGN_EVENT_STREAM,
  eligibleAmount,
  percentDiscount,
  fixedDiscount,
  couponLane,
  stackingCompatible,
  couponMetaKey,
  couponQuotaKey,
  couponUserKey,
  couponReservationKey,
  couponValidateTryKey,
} from '../packages/shared/src/schemas/coupon-contract';
import {
  isCouponLive,
  quotaLeft,
  quotaOf,
  minPurchaseOf,
  lineEligible,
  couponWindow,
} from '../apps/backend/src/modules/campaign/domain/entities/coupon.entity';
import { combineDiscounts } from '../apps/backend/src/modules/campaign/domain/value-objects/discount-result.vo';
import { DiscountCalculatorService } from '../apps/backend/src/modules/campaign/application/services/discount-calculator.service';
import { ValidateCouponUseCase } from '../apps/backend/src/modules/campaign/application/use-cases/validate-coupon.use-case';
import { ClaimCouponUseCase } from '../apps/backend/src/modules/campaign/application/use-cases/claim-coupon.use-case';
import { ExecuteFlashSaleLockUseCase } from '../apps/backend/src/modules/campaign/application/use-cases/execute-flash-sale-lock.use-case';
import { CouponStackService } from '../apps/backend/src/modules/campaign/application/services/coupon-stack.service';
import { PrismaCouponRepository } from '../apps/backend/src/modules/campaign/infrastructure/persistence/prisma-coupon.repository';
import {
  CouponCacheRepository,
  QUOTA_DECREMENT_LUA,
  RESERVATION_RELEASE_LUA,
  withCouponLock,
} from '../apps/backend/src/modules/coupon/infra/redis/coupon-cache.repository';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const USER_ID = '123e4567-e89b-12d3-a456-426614174000';
const COUPON_ID = '223e4567-e89b-12d3-a456-426614174001';
const SELLER_A = '323e4567-e89b-12d3-a456-426614174002';
const SELLER_B = '423e4567-e89b-12d3-a456-426614174003';
// Live-window fixtures anchor to the real clock (services gate on Date.now()).
const NOW = Date.now();

// BDD-2 cart: physical 500 + ebook 300 + course 2000.
function bddCart() {
  return [
    { productId: 'p-phys', sellerId: SELLER_A, productType: 'PHYSICAL_BOOK', price: 500, quantity: 1 },
    { productId: 'p-ebook', sellerId: SELLER_A, productType: 'EBOOK', price: 300, quantity: 1 },
    { productId: 'p-course', sellerId: SELLER_B, productType: 'ELEARNING_COURSE', price: 2000, quantity: 1 },
  ] as const;
}

function liveRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: COUPON_ID,
    code: 'MEGA117',
    isActive: true,
    startAt: new Date(NOW - 86400000),
    expireAt: new Date(NOW + 86400000),
    startDate: null,
    endDate: null,
    minOrderAmount: 0,
    minPurchaseAmount: 0,
    totalQuota: 1000,
    usedQuota: 0,
    globalUsageLimit: 1000,
    currentUsageCount: 0,
    perUserLimit: 1,
    perUserUsageLimit: 1,
    targetProductType: null,
    sellerId: null,
    scope: 'GLOBAL_PLATFORM',
    couponType: 'PLATFORM_PERCENTAGE',
    discountValue: 10,
    maxDiscountAmount: null,
    canStackWithPlatform: true,
    canStackWithStore: false,
    canStackWithShipping: true,
    ...over,
  };
}

async function main(): Promise<void> {
// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) ----------
{
  for (const v of ['PLATFORM_FIXED', 'PLATFORM_PERCENTAGE', 'STORE_FIXED', 'STORE_PERCENTAGE', 'CATEGORY_SPECIFIC', 'PRODUCT_SPECIFIC', 'FREE_SHIPPING', 'AFFILIATE_BOOST']) {
    assert.equal(CouponTypeEnum.safeParse(v).success, true, v);
  }
  assert.equal(CouponTypeEnum.safeParse('FIXED_AMOUNT').success, false);
  for (const v of ['ALL_PRODUCTS', 'PHYSICAL_BOOK_ONLY', 'EBOOK_ONLY', 'COURSE_ONLY', 'SPECIFIC_PRODUCTS', 'SPECIFIC_SELLERS']) {
    assert.equal(CouponTargetTypeEnum.safeParse(v).success, true, v);
  }
  const parsed = ValidateCouponInputSchema.parse({ couponCode: '  mega117 ', cartItems: [...bddCart()], shippingFee: 60 });
  assert.equal(parsed.couponCode, 'MEGA117');
  assert.equal(parsed.shippingFee, 60);
  assert.equal(ValidateCouponInputSchema.safeParse({ couponCode: 'X', cartItems: [], shippingFee: 0 }).success, false);
  assert.equal(
    CampaignDiscountBreakdownSchema.safeParse({
      couponCode: 'MEGA117', couponType: 'PLATFORM_PERCENTAGE',
      platformDiscount: 280, sellerDiscount: 0, shippingDiscount: 0, appliedItemIds: ['p-phys'],
    }).success,
    true,
  );
  assert.equal(
    CouponValidationResponseSchema.safeParse({ isValid: true, message: 'ok', totalDiscountAmount: 280, netAmount: 2580, breakdown: [] }).success,
    true,
  );
  assert.equal(ClaimCouponInputSchema.parse({ couponCode: ' mega117 ' }).couponCode, 'MEGA117');
  // 088 DiscountBreakdownSchema untouched (spot check, no barrel collision).
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  assert.ok(barrel.includes('CampaignDiscountBreakdownSchema'), '117 alias exported');
  ok('1. Zod SSOT verbatim (types/targets/validate/breakdown-alias/response/claim)');
}

// ---------- 2. Pure math: eligible/percent/fixed/lane/matrix/keys ----------
{
  const { amount, appliedItemIds } = eligibleAmount([...bddCart()], {});
  assert.deepEqual([amount, appliedItemIds.length], [2800, 3]);
  const ebookOnly = eligibleAmount([...bddCart()], { targetProductType: 'EBOOK' });
  assert.deepEqual([ebookOnly.amount, ebookOnly.appliedItemIds], [300, ['p-ebook']]);
  const sellerOnly = eligibleAmount([...bddCart()], { sellerId: SELLER_B });
  assert.deepEqual([sellerOnly.amount, sellerOnly.appliedItemIds], [2000, ['p-course']]);
  assert.equal(percentDiscount(2800, 10), 280);
  assert.equal(percentDiscount(2800, 10, 200), 200);
  assert.equal(percentDiscount(99.99, 10), 10);
  assert.equal(fixedDiscount(300, 100), 100);
  assert.equal(fixedDiscount(50, 100), 50);
  assert.equal(couponLane('PLATFORM_PERCENTAGE'), 'PLATFORM');
  assert.equal(couponLane('STORE_FIXED'), 'STORE');
  assert.equal(couponLane('PRODUCT_SPECIFIC'), 'STORE');
  assert.equal(couponLane('FREE_SHIPPING'), 'SHIPPING');
  assert.equal(couponLane('AFFILIATE_BOOST'), 'PLATFORM');
  assert.equal(stackingCompatible({ lane: 'STORE', canStackWithPlatform: true, canStackWithStore: false, canStackWithShipping: true }, ['PLATFORM']), true);
  assert.equal(stackingCompatible({ lane: 'STORE', canStackWithPlatform: true, canStackWithStore: false, canStackWithShipping: true }, ['STORE']), false);
  assert.equal(stackingCompatible({ lane: 'PLATFORM', canStackWithPlatform: true, canStackWithStore: false, canStackWithShipping: true }, []), true);
  assert.equal(COUPON_VALIDATE_BUDGET_MS, 50);
  assert.equal(COUPON_RESERVATION_TTL_SEC, 900);
  assert.equal(COUPON_META_CACHE_TTL_SEC, 300);
  assert.equal(COUPON_VALIDATE_RATE_LIMIT, 10);
  assert.equal(COUPON_VALIDATE_RATE_WINDOW_SEC, 60);
  assert.equal(CAMPAIGN_EVENT_STREAM, 'stream:campaign:events');
  assert.equal(couponMetaKey('MEGA117'), 'coupon:meta:MEGA117');
  assert.equal(couponQuotaKey(COUPON_ID), `coupon:quota:${COUPON_ID}`);
  assert.equal(couponUserKey(USER_ID, COUPON_ID), `coupon:user:${USER_ID}:${COUPON_ID}`);
  assert.equal(couponReservationKey(USER_ID, COUPON_ID), `coupon:reservation:${USER_ID}:${COUPON_ID}`);
  assert.equal(couponValidateTryKey(USER_ID), `coupon:validate:try:${USER_ID}`);
  ok('2. Eligible/percent-cap/fixed-clamp/lane/matrix + budgets/keys');
}

// ---------- 3. Entity gates (live/quota/min/targeting, 117→088 fallback) ----------
{
  assert.equal(isCouponLive(liveRow(), NOW), true);
  assert.equal(isCouponLive(liveRow({ isActive: false }), NOW), false);
  assert.equal(isCouponLive(liveRow({ startAt: new Date(NOW + 1000), startDate: null }), NOW), false);
  assert.equal(isCouponLive(liveRow({ expireAt: new Date(NOW - 1000), endDate: null }), NOW), false);
  // 117 window wins over 088 window.
  assert.equal(isCouponLive(liveRow({ startDate: new Date(NOW + 1000) }), NOW), false);
  assert.equal(isCouponLive(liveRow({ endDate: new Date(NOW - 1000) }), NOW), false);
  assert.deepEqual(quotaOf(liveRow()), { limit: 1000, used: 0, perUser: 1 });
  assert.deepEqual(quotaOf(liveRow({ globalUsageLimit: null, totalQuota: 50, currentUsageCount: null, usedQuota: 49, perUserUsageLimit: null, perUserLimit: 2 })), { limit: 50, used: 49, perUser: 2 });
  assert.equal(quotaLeft(liveRow({ currentUsageCount: 1000 })), 0);
  assert.equal(minPurchaseOf(liveRow({ minPurchaseAmount: 500 })), 500);
  assert.equal(minPurchaseOf(liveRow({ minPurchaseAmount: null, minOrderAmount: 250 })), 250);
  const line = { productId: 'p-ebook', sellerId: SELLER_A, productType: 'EBOOK' };
  assert.equal(lineEligible(liveRow(), line), true);
  assert.equal(lineEligible(liveRow({ targetProductType: 'EBOOK' }), line), true);
  assert.equal(lineEligible(liveRow({ targetProductType: 'COURSE' }), line), false);
  assert.equal(lineEligible(liveRow(), line, new Set(['p-ebook'])), true);
  assert.equal(lineEligible(liveRow(), line, new Set(['p-other'])), false);
  assert.equal(lineEligible(liveRow({ sellerId: SELLER_A }), line), true);
  assert.equal(lineEligible(liveRow({ sellerId: SELLER_B }), line), false);
  const w = couponWindow(liveRow());
  assert.ok(w.start !== null && w.end !== null, '088 fallback window resolves');
  ok('3. Live/quota/min/target gates with 117→088 fallback');
}

// ---------- 4. VO combine (stack totals, Net ≥ 0 floor) ----------
{
  const out = combineDiscounts(2800, 60, [
    { couponCode: 'P10', couponType: 'PLATFORM_PERCENTAGE', lane: 'PLATFORM', platformDiscount: 280, sellerDiscount: 0, shippingDiscount: 0, appliedItemIds: ['p-phys'] },
    { couponCode: 'S100', couponType: 'STORE_FIXED', lane: 'STORE', platformDiscount: 0, sellerDiscount: 100, shippingDiscount: 0, appliedItemIds: ['p-ebook'] },
    { couponCode: 'SHIP', couponType: 'FREE_SHIPPING', lane: 'SHIPPING', platformDiscount: 0, sellerDiscount: 0, shippingDiscount: 60, appliedItemIds: [] },
  ]);
  assert.deepEqual([out.totalDiscountAmount, out.platformDiscount, out.sellerDiscount, out.shippingDiscount, out.netAmount], [440, 280, 100, 60, 2420]);
  const over = combineDiscounts(100, 0, [
    { couponCode: 'BIG', couponType: 'PLATFORM_FIXED', lane: 'PLATFORM', platformDiscount: 500, sellerDiscount: 0, shippingDiscount: 0, appliedItemIds: [] },
  ]);
  assert.deepEqual([over.totalDiscountAmount, over.netAmount], [100, 0]);
  ok('4. Stack combine (BDD-2 totals + over-discount floor)');
}

// ---------- 5. Calculator: BDD-2 cart math + caps + lane splits ----------
{
  const calc = new DiscountCalculatorService();
  const cart = { items: [...bddCart()], shippingFee: 60 };
  const p10 = calc.calculate(
    { ...liveRow(), code: 'P10', couponType: 'PLATFORM_PERCENTAGE', discountValue: 10, maxDiscountAmount: null, scope: 'GLOBAL_PLATFORM' } as never,
    cart,
  );
  assert.deepEqual([p10.platformDiscount, p10.sellerDiscount, p10.shippingDiscount], [280, 0, 0]);
  assert.deepEqual(p10.appliedItemIds, ['p-phys', 'p-ebook', 'p-course']);
  const capped = calc.calculate(
    { ...liveRow(), code: 'P50', couponType: 'PLATFORM_PERCENTAGE', discountValue: 50, maxDiscountAmount: 200, scope: 'GLOBAL_PLATFORM' } as never,
    cart,
  );
  assert.equal(capped.platformDiscount, 200);
  const store = calc.calculate(
    { ...liveRow(), code: 'S100', couponType: 'STORE_FIXED', discountValue: 100, scope: 'TENANT_STORE', sellerId: SELLER_A, targetProductType: 'EBOOK' } as never,
    cart,
  );
  assert.deepEqual([store.platformDiscount, store.sellerDiscount], [0, 100]);
  assert.deepEqual(store.appliedItemIds, ['p-ebook']);
  const ship = calc.calculate(
    { ...liveRow(), code: 'SHIP', couponType: 'FREE_SHIPPING', discountValue: 60, scope: 'GLOBAL_PLATFORM' } as never,
    cart,
  );
  assert.equal(ship.shippingDiscount, 60);
  assert.throws(
    () => calc.calculate(
      { ...liveRow(), code: 'MIN500', couponType: 'PLATFORM_FIXED', discountValue: 50, minPurchaseAmount: 5000 } as never,
      cart,
    ),
    /ขั้นต่ำ/,
  );
  ok('5. BDD-2 calculator (proportional/cap/store-target/free-ship/min-gate)');
}

// ---------- 6. Validate use-case: cache/quota/reserve/stream/SLA + guards ----------
{
  const events: Array<{ event: string; fields: Record<string, string | number> }> = [];
  const kv = new Map<string, string>();
  const counters = new Map<string, number>();
  const holds = new Map<string, string>();
  const published: unknown[][] = [];
  const cache = {
    tryRateLimited: async (k: string) => {
      const n = (counters.get(k) ?? 0) + 1;
      counters.set(k, n);
      return n > COUPON_VALIDATE_RATE_LIMIT;
    },
    metaGet: async <T>(k: string) => (kv.has(k) ? (JSON.parse(kv.get(k)!) as T) : null),
    metaSet: async (k: string, v: unknown) => { kv.set(k, JSON.stringify(v)); },
    quotaDecrement: async (k: string, by: number) => {
      if (!kv.has(k)) return -1;
      const left = Math.max(-1, Number(kv.get(k)) - by);
      kv.set(k, String(left));
      return left;
    },
    quotaSeed: async (k: string, v: number) => { kv.set(k, String(Math.max(0, v))); },
    reserveHold: async (k: string, t: string) => {
      if (holds.has(k)) return false;
      holds.set(k, t);
      return true;
    },
    releaseHold: async () => undefined,
    claimGuard: async () => true,
    publish: async (event: string, fields: Record<string, string | number>) => { published.push([event, fields]); events.push({ event, fields }); },
  };
  function mockStore(row: Record<string, unknown> | null, claims = 0, targets: string[] = []) {
    return {
      findByCode: async () => row,
      targetProductIds: async () => new Set(targets),
      userClaimCount: async () => claims,
      claimCoupon: async () => ({ id: 'claim-1' }),
      listClaims: async () => [],
      commitQuota117: async () => true,
      recordRedemption: async () => ({}),
      activeCampaigns: async () => [],
    };
  }
  const calc = new DiscountCalculatorService();
  const mk = (row: Record<string, unknown> | null, claims = 0) =>
    new ValidateCouponUseCase(calc, mockStore(row, claims) as never, cache as never);
  const row = liveRow();

  // 6a. cache-hit path (meta pre-seeded, no DB row needed... DB still hit for targets only)
  kv.set(couponMetaKey('MEGA117'), JSON.stringify(row));
  const hit = await mk(null).execute({ couponCode: 'mega117', cartItems: [...bddCart()], shippingFee: 60 }, USER_ID);
  assert.equal(hit.isValid, true);
  assert.deepEqual([hit.totalDiscountAmount, hit.netAmount], [280, 2580]);
  assert.ok(hit.reservationToken.length >= 8, 'reservation token minted');
  assert.ok(hit.elapsedMs < COUPON_VALIDATE_BUDGET_MS, `<50ms (${hit.elapsedMs}ms)`);
  assert.ok(holds.has(couponReservationKey(USER_ID, COUPON_ID)), '15-min hold placed');
  assert.ok(published.some(([e]) => e === 'coupon.validated'), 'validated stream');

  // 6b. guards (fresh meta cache per case — Row fixtures differ)
  kv.clear();
  await assert.rejects(() => mk(null).execute({ couponCode: 'NOPE', cartItems: [...bddCart()], shippingFee: 0 }, USER_ID), /ไม่พบรหัส/);
  kv.clear();
  await assert.rejects(() => mk(liveRow({ isActive: false })).execute({ couponCode: 'MEGA117', cartItems: [...bddCart()], shippingFee: 0 }, USER_ID), /หมดอายุ/);
  kv.clear();
  await assert.rejects(() => mk(liveRow({ currentUsageCount: 1000 })).execute({ couponCode: 'MEGA117', cartItems: [...bddCart()], shippingFee: 0 }, USER_ID), /เต็มจำนวน/);
  kv.clear();
  await assert.rejects(() => mk(liveRow(), 1).execute({ couponCode: 'MEGA117', cartItems: [...bddCart()], shippingFee: 0 }, USER_ID), /ครบตามจำนวน/);
  kv.clear();
  await assert.rejects(() => mk(row).execute({ couponCode: 'MEGA117', cartItems: [...bddCart()], shippingFee: 0 }, ''), /authentication/);
  kv.clear();
  await assert.rejects(() => mk(row).execute({ couponCode: 'MEGA117', cartItems: [], shippingFee: 0 }, USER_ID), /Invalid coupon/);
  // rate shield trips on the 11th validate inside the window
  counters.clear();
  kv.set(couponMetaKey('MEGA117'), JSON.stringify(row));
  for (let i = 0; i < 10; i++) {
    await mk(row).execute({ couponCode: 'MEGA117', cartItems: [...bddCart()], shippingFee: 0 }, USER_ID).catch(() => undefined);
    holds.clear();
  }
  await assert.rejects(() => mk(row).execute({ couponCode: 'MEGA117', cartItems: [...bddCart()], shippingFee: 0 }, USER_ID), /ถี่เกินไป/);
  ok('6. Validate fast-path (cache/quota/15-min hold/stream/SLA) + 7 guards');
}

// ---------- 7. Claim + flash-sale lock ----------
{
  const claimed: Array<{ userId: string; couponId: string }> = [];
  const store = {
    findByCode: async (code: string) => (code === 'MEGA117' ? liveRow() : null),
    userClaimCount: async () => 0,
    claimCoupon: async (a: { userId: string; couponId: string }) => {
      if (claimed.some((c) => c.userId === a.userId && c.couponId === a.couponId)) return null;
      claimed.push(a);
      return { id: 'claim-1' };
    },
    listClaims: async () => claimed,
  };
  const cache = {
    claimGuard: async () => true,
    publish: async () => undefined,
    reserveHold: async (k: string, t: string) => true,
    releaseHold: async () => undefined,
    tryRateLimited: async () => false,
    metaGet: async () => null,
    metaSet: async () => undefined,
    quotaDecrement: async () => -1,
    quotaSeed: async () => undefined,
  };
  const claimer = new ClaimCouponUseCase(store as never, cache as never);
  const c1 = await claimer.execute({ couponCode: 'mega117' }, USER_ID);
  assert.deepEqual(c1, { claimId: 'claim-1', couponCode: 'MEGA117' });
  await assert.rejects(() => claimer.execute({ couponCode: 'mega117' }, USER_ID), /เก็บคูปองนี้ไปแล้ว/);
  await assert.rejects(() => claimer.execute({ couponCode: 'NOPE' }, USER_ID), /ไม่พบรหัส/);

  const locks = new Map<string, string>();
  const lockCache = {
    reserveHold: async (k: string, t: string, _ttl?: number) => {
      if (locks.has(k)) return false;
      locks.set(k, t);
      return true;
    },
    releaseHold: async (k: string, t: string) => {
      if (locks.get(k) === t) locks.delete(k);
    },
  };
  const flash = new ExecuteFlashSaleLockUseCase(lockCache as never);
  const got = await flash.acquire('sku-1', 'mega-day');
  assert.equal(got.locked, true);
  assert.ok(got.key.includes('mega-day') && got.token.length >= 8, 'scoped key + token');
  const busy = await flash.acquire('sku-1', 'mega-day');
  assert.equal(busy.locked, false);
  await flash.release(got.key, got.token);
  const ran = await flash.runLocked('sku-2', async () => 42);
  assert.equal(ran, 42);
  await assert.rejects(() => flash.acquire('', 'x'), /Missing productId/);
  ok('7. Claim wallet (dupe-safe) + flash lock (token release + contention)');
}

// ---------- 8. Stack service: BDD-2 multi-coupon + matrix ----------
{
  const calc = new DiscountCalculatorService();
  const rows: Record<string, Record<string, unknown>> = {
    P10: { ...liveRow(), id: 'c-p10', code: 'P10', couponType: 'PLATFORM_PERCENTAGE', discountValue: 10, scope: 'GLOBAL_PLATFORM', canStackWithPlatform: true, canStackWithStore: false, canStackWithShipping: true },
    S100: { ...liveRow(), id: 'c-s100', code: 'S100', couponType: 'STORE_FIXED', discountValue: 100, scope: 'TENANT_STORE', sellerId: SELLER_A, targetProductType: 'EBOOK', canStackWithPlatform: true, canStackWithStore: false, canStackWithShipping: true },
    SHIP: { ...liveRow(), id: 'c-ship', code: 'SHIP', couponType: 'FREE_SHIPPING', discountValue: 60, scope: 'GLOBAL_PLATFORM', canStackWithPlatform: true, canStackWithStore: true, canStackWithShipping: true },
    S50B: { ...liveRow(), id: 'c-s50b', code: 'S50B', couponType: 'STORE_FIXED', discountValue: 50, scope: 'TENANT_STORE', sellerId: SELLER_B, canStackWithPlatform: true, canStackWithStore: false, canStackWithShipping: true },
  };
  const kv = new Map<string, string>();
  const holds = new Map<string, string>();
  const cache = {
    tryRateLimited: async () => false,
    metaGet: async <T>(k: string) => (kv.has(k) ? (JSON.parse(kv.get(k)!) as T) : null),
    metaSet: async (k: string, v: unknown) => { kv.set(k, JSON.stringify(v)); },
    quotaDecrement: async () => -1,
    quotaSeed: async () => undefined,
    reserveHold: async (k: string, t: string) => {
      if (holds.has(k)) return false;
      holds.set(k, t);
      return true;
    },
    releaseHold: async () => undefined,
    claimGuard: async () => true,
    publish: async () => undefined,
  };
  const store = {
    findByCode: async (code: string) => rows[code] ?? null,
    targetProductIds: async () => new Set<string>(),
    userClaimCount: async () => 0,
    claimCoupon: async () => ({ id: 'x' }),
    listClaims: async () => [],
    commitQuota117: async () => true,
    recordRedemption: async () => ({}),
    activeCampaigns: async () => [],
  };
  const validate = new ValidateCouponUseCase(calc, store as never, cache as never);
  const stacker = new CouponStackService(validate, store as never);
  const out = await stacker.applyStack(USER_ID, { codes: ['P10', 'S100', 'SHIP'], cartItems: [...bddCart()], shippingFee: 60 });
  assert.deepEqual([out.totalDiscountAmount, out.netAmount], [440, 2420]);
  assert.equal(out.breakdown.length, 3);
  // second STORE lane must trip the matrix (S100 applied, S50B incompatible)
  await assert.rejects(
    () => stacker.applyStack(USER_ID, { codes: ['S100', 'S50B'], cartItems: [...bddCart()], shippingFee: 0 }),
    /cannot stack/,
  );
  await assert.rejects(() => stacker.applyStack(USER_ID, { codes: [], cartItems: [...bddCart()] }), /1-5/);
  await assert.rejects(
    () => stacker.applyStack(USER_ID, { codes: ['P10', 'P10', 'P10', 'P10', 'P10', 'P10'], cartItems: [...bddCart()] }),
    /1-5/,
  );
  ok('8. BDD-2 stack (440 off 2860 → 2420 + matrix fail-fast + bounds)');
}

// ---------- 9. Tree parity: no scaffold leftovers in the 117 lane ----------
{
  for (const f of [
    'apps/backend/src/modules/campaign/domain/entities/coupon.entity.ts',
    'apps/backend/src/modules/campaign/domain/value-objects/discount-result.vo.ts',
    'apps/backend/src/modules/campaign/application/services/discount-calculator.service.ts',
    'apps/backend/src/modules/campaign/application/services/coupon-stack.service.ts',
    'apps/backend/src/modules/campaign/application/use-cases/validate-coupon.use-case.ts',
    'apps/backend/src/modules/campaign/application/use-cases/claim-coupon.use-case.ts',
    'apps/backend/src/modules/campaign/application/use-cases/execute-flash-sale-lock.use-case.ts',
    'apps/backend/src/modules/campaign/infrastructure/persistence/prisma-coupon.repository.ts',
    'apps/backend/src/modules/campaign/infrastructure/redis/coupon-cache.repository.ts',
    'apps/backend/src/modules/campaign/presentation/graphql/coupon.resolver.ts',
    'apps/backend/src/modules/campaign/presentation/webhooks/campaign-event.controller.ts',
    'apps/backend/src/modules/campaign/campaign.module.ts',
    'apps/backend/src/modules/coupon/infra/redis/coupon-cache.repository.ts',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes('TODO') && !src.includes('placeholder'), `${f} unimplemented`);
  }
  const alias = readFileSync('apps/backend/src/modules/campaign/infrastructure/redis/coupon-cache.repository.ts', 'utf8');
  assert.ok(alias.includes('coupon/infra/redis/coupon-cache.repository'), 'zero-dup alias points at canonical Redis seam');
  ok('9. 117 tree parity (no TODO/placeholder, alias documented)');
}

// ---------- 10. Double-spend race + Lua + lock retry (Gate 7/§10) ----------
{
  const { PrismaCouponRepository } = await import('../apps/backend/src/modules/campaign/infrastructure/persistence/prisma-coupon.repository');
  const { CouponCacheRepository, withCouponLock } = await import('../apps/backend/src/modules/coupon/infra/redis/coupon-cache.repository');
  void CouponCacheRepository;
  let used = 999;
  const prisma = {
    coupon: {
      findUnique: async () => ({ id: COUPON_ID, globalUsageLimit: 1000, currentUsageCount: used, totalQuota: 1000, usedQuota: 999 }),
      findMany: async () => [],
      updateMany: async (a: unknown) => {
        const where = (a as { where: Record<string, Record<string, number>> }).where;
        const floor = (where['currentUsageCount']?.['lt'] ?? where['usedQuota']?.['lt'] ?? 0) as number;
        if (used >= floor) return { count: 0 };
        used++;
        return { count: 1 };
      },
    },
    couponTargetProduct: { findMany: async () => [] },
    userCouponClaim: {
      findFirst: async () => null,
      findMany: async () => [],
      count: async () => 0,
      create: async (a: unknown) => ({ id: 'c' }),
      updateMany: async () => ({ count: 1 }),
    },
    couponRedemption: { create: async () => ({}) },
    campaign: { findMany: async () => [], findUnique: async () => null },
  };
  const repo = new PrismaCouponRepository(prisma as never);
  const [first, second] = await Promise.all([repo.commitQuota117(COUPON_ID), repo.commitQuota117(COUPON_ID)]);
  assert.deepEqual([first, second].sort(), [false, true]);
  assert.deepEqual(await repo.targetProductIds(COUPON_ID), new Set<string>());
  assert.ok((await repo.claimCoupon(USER_ID, COUPON_ID))?.id, 'claim creates');
  await repo.markClaimUsed(USER_ID, COUPON_ID);
  assert.ok((await repo.recordRedemption({ couponId: COUPON_ID, userId: USER_ID, orderId: 'o1', discountAmount: 10 })) !== undefined, 'redemption records');

  // Lua shapes (floor-guarded decrement + token-checked release)
  assert.ok(QUOTA_DECREMENT_LUA.includes('DECRBY') && QUOTA_DECREMENT_LUA.includes('return -1'), 'quota Lua floor');
  assert.ok(RESERVATION_RELEASE_LUA.includes('DEL') && RESERVATION_RELEASE_LUA.includes('ARGV'), 'release Lua token check');

  // lock retry: fails twice, wins third; never-wins throws CONTENTION
  let attempts = 0;
  const flaky = {
    reserveHold: async () => (++attempts <= 2 ? false : true),
    releaseHold: async () => undefined,
  };
  assert.equal(await withCouponLock(flaky, 'k', 't', async () => 'won'), 'won');
  assert.equal(attempts, 3);
  const jammed = { reserveHold: async () => false, releaseHold: async () => undefined };
  await assert.rejects(() => withCouponLock(jammed, 'k', 't', async () => 1), /CONTENTION/);
  ok('10. Atomic quota race (1 win/1 loss) + Lua shapes + lock retry');
}

// ---------- 11. Prisma Gate 1 + GQL/SDL + module wiring ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const v of ['PLATFORM_FIXED', 'PLATFORM_PERCENTAGE', 'STORE_FIXED', 'STORE_PERCENTAGE', 'CATEGORY_SPECIFIC', 'PRODUCT_SPECIFIC', 'AFFILIATE_BOOST']) {
    assert.ok(prisma.includes(v), `CouponType union ${v}`);
  }
  for (const v of ['GLOBAL_PLATFORM', 'TENANT_STORE', 'CREATOR_SPECIFIC']) {
    assert.ok(prisma.includes(v), `CouponScope union ${v}`);
  }
  for (const m of ['model Campaign', 'model UserCouponClaim']) {
    assert.ok(prisma.includes(m), m);
  }
  assert.ok(prisma.includes('canStackWithPlatform'), 'stacking flags');
  assert.ok(prisma.includes('userClaims          UserCouponClaim[]'), 'Coupon claim ledger');
  assert.ok(prisma.includes('userCouponClaims     UserCouponClaim[]'), 'User claim wallet');
  assert.ok(prisma.includes('@@unique([userId, couponId])'), 'one-time claim key');
  const mod = readFileSync('apps/backend/src/modules/campaign/campaign.module.ts', 'utf8');
  for (const p of ['ValidateCouponUseCase', 'ClaimCouponUseCase', 'ExecuteFlashSaleLockUseCase', 'DiscountCalculatorService', 'CouponStackService', 'CouponCacheRepository', 'PrismaCouponRepository', 'CouponResolver', 'CampaignEventController']) {
    assert.ok(mod.includes(p), `module wires ${p}`);
  }
  assert.ok(!/ServiceService|ModuleModule|ControllerController|ResolverResolver/.test(mod), 'scaffold doubled names retired');
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('CampaignModule'), 'AppModule imports');
  const alias = readFileSync('apps/backend/src/api/graphql/resolvers/campaign/coupon.resolver.ts', 'utf8');
  assert.ok(alias.includes('CouponResolver') && !alias.includes('CouponResolverResolver'), 'api alias re-exports module resolver');
  const sdl = readFileSync('apps/backend/src/api/graphql/resolvers/campaign/campaign.graphql', 'utf8');
  for (const t of ['type CouponValidationResult', 'type UserCouponClaim', 'validateCoupon', 'claimCoupon', 'applyCouponStack', 'myCoupons']) {
    assert.ok(sdl.includes(t), `SDL ${t}`);
  }
  const ctl = readFileSync('apps/backend/src/modules/campaign/presentation/webhooks/campaign-event.controller.ts', 'utf8');
  assert.ok(ctl.includes('stackCoupons') && ctl.includes('validateCoupon') && ctl.includes('claimCoupon'), 'REST lanes (validate/claim/stack)');
  ok('11. Prisma Gate 1 + module/GQL/SDL/REST wiring');
}

// ---------- 12. Frontend Gate 3/5 (5 states, selector, proxies, IDB) ----------
{
  const page = readFileSync('apps/frontend/app/(liff)/campaigns/page.tsx', 'utf8');
  for (const s of ['LIFF_INIT', 'IDLE', 'LOADING', 'SUCCESS', 'ERROR']) {
    assert.ok(page.includes(s), `center state ${s}`);
  }
  assert.ok(page.includes('campaign-card') && page.includes('ลองใหม่'), 'campaign cards + retry');
  const selector = readFileSync('apps/frontend/components/checkout/coupon-selector.tsx', 'utf8');
  assert.ok(selector.includes('coupon-row') && selector.includes('coupon-applied') && selector.includes('toUpperCase'), 'selector rows + badge + uppercase');
  const lib = readFileSync('apps/frontend/lib/campaign/campaign-client.ts', 'utf8');
  assert.ok(lib.includes('indexedDB') && lib.includes('zene-campaign') && lib.includes('campaigns:active'), 'IDB offline wallet');
  assert.ok(!lib.includes('@tanstack') && !lib.includes('lucide') && !lib.includes('framer'), 'no heavy LIFF deps');
  for (const p of [
    'apps/frontend/app/api/v1/campaigns/active/route.ts',
    'apps/frontend/app/api/v1/campaigns/validate/route.ts',
    'apps/frontend/app/api/v1/campaigns/claim/route.ts',
    'apps/frontend/app/api/v1/campaigns/stack/route.ts',
  ]) {
    assert.ok(readFileSync(p, 'utf8').includes('localhost:4000'), `proxy backend: ${p}`);
  }
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  for (const e of ['ValidateCouponInputSchema', 'CampaignDiscountBreakdownSchema', 'CouponValidationResponseSchema', 'stackingCompatible', 'COUPON_VALIDATE_BUDGET_MS', 'COUPON_RESERVATION_TTL_SEC']) {
    assert.ok(barrel.includes(e), `barrel ${e}`);
  }
  ok('12. Frontend 5-state + selector + 4 proxies + IDB + barrel');
}
}

main()
  .then(() => console.log(`\nPhase 117 contracts: ${passed}/12 groups passed`))
  .catch((err) => {
    console.error('\nPhase 117 contracts FAILED:', err);
    process.exit(1);
  });
