// SSOT Phase 011 §10/Task 8 — hybrid cart contract + integration tests (TDD loop 3x)
// Run: npx tsx scripts/test-phase011-contracts.ts
import assert from 'node:assert/strict';
import {
  CartItemTypeEnum,
  CarrierEnum,
  SmartCartItemSchema,
  HybridCartSplitSummarySchema,
  CalculateShippingInputSchema,
  AddToCartInputSchema,
  UpdateCartItemQuantityInputSchema,
  isPhysicalProduct,
  effectiveUnitPrice,
} from '../packages/shared/src/schemas/cart.schema';
import { ProductTypeEnum as SdidTypes } from '../packages/shared/src/schemas/sdid-contract';
import {
  assertCartQuantity,
  assertAddable,
  deriveItemCategory,
} from '../apps/backend/src/modules/cart/domain/entities/cart-item.entity';
import { assertCartOwner, isAbandoned } from '../apps/backend/src/modules/cart/domain/entities/cart.entity';
import {
  tieredShippingFee,
  splitCart,
  emptyCartSummary,
} from '../apps/backend/src/modules/cart/domain/value-objects/cart-split.vo';
import {
  ShippingAdapterService,
  resolveZone,
} from '../apps/backend/src/modules/cart/infrastructure/shipping-adapter.service';
import { CartRepository } from '../apps/backend/src/modules/cart/infrastructure/cart.repository';
import { CartService } from '../apps/backend/src/modules/cart/application/cart.service';

const UID = '123e4567-e89b-12d3-a456-426614174000';
const PID = '223e4567-e89b-12d3-a456-426614174001';
const CID = '323e4567-e89b-12d3-a456-426614174002';
const AID = '423e4567-e89b-12d3-a456-426614174003';
let passed = 0;
function ok(name: string) {
  passed++;
  console.log(`  ✓ ${name}`);
}

const digi = {
  cartItemId: CID, productId: PID, title: 'E-book', coverImageUrl: 'https://c.test/e.png',
  productType: 'EBOOK', itemCategory: 'DIGITAL', unitPrice: 199, quantity: 1, weightGrams: 0,
} as const;
const phys = {
  cartItemId: '523e4567-e89b-12d3-a456-426614174004', productId: '623e4567-e89b-12d3-a456-426614174005',
  title: 'Hardcover', coverImageUrl: 'https://c.test/b.png', productType: 'PHYSICAL_BOOK',
  itemCategory: 'PHYSICAL', unitPrice: 350, quantity: 2, weightGrams: 600, sku: 'HC-001',
} as const;

// ---------- 1. Zod SSOT ----------
{
  assert.deepEqual(CartItemTypeEnum.options, ['DIGITAL', 'PHYSICAL']);
  assert.deepEqual(CarrierEnum.options, ['FLASH', 'KERRY', 'THAIPOST']);
  assert.deepEqual(
    SmartCartItemSchema.shape.productType.options,
    (SdidTypes as unknown as { options: string[] }).options,
    'single ProductType source',
  );
  assert.equal(SmartCartItemSchema.safeParse(digi).success, true);
  assert.equal(SmartCartItemSchema.safeParse(phys).success, true);
  assert.equal(SmartCartItemSchema.safeParse({ ...digi, quantity: 0 }).success, false);
  assert.equal(SmartCartItemSchema.safeParse({ ...digi, quantity: 100 }).success, false);
  assert.equal(SmartCartItemSchema.safeParse({ ...digi, unitPrice: -1 }).success, false);
  assert.equal(SmartCartItemSchema.safeParse({ ...digi, cartItemId: 'bad' }).success, false);
  const summary = {
    digitalItems: [], physicalItems: [], digitalSubtotal: 0, physicalSubtotal: 0,
    totalPhysicalWeightGrams: 0, estimatedShippingFee: 0, appliedDiscountAmount: 0,
    grandTotalAmount: 0, requiresShippingAddress: false,
  };
  assert.equal(HybridCartSplitSummarySchema.safeParse(summary).success, true);
  assert.equal(CalculateShippingInputSchema.safeParse({ cartId: CID, shippingAddressId: AID }).success, true);
  assert.equal(CalculateShippingInputSchema.safeParse({ cartId: 'bad', shippingAddressId: AID }).success, false);
  assert.equal(AddToCartInputSchema.safeParse({ productId: PID }).success, true);
  assert.equal(AddToCartInputSchema.safeParse({ productId: PID, quantity: 0 }).success, false);
  assert.equal(UpdateCartItemQuantityInputSchema.safeParse({ cartItemId: CID, quantity: 3 }).success, true);
  assert.equal(UpdateCartItemQuantityInputSchema.safeParse({ cartItemId: CID, quantity: 100 }).success, false);
  assert.equal(isPhysicalProduct('PHYSICAL_BOOK', false), true);
  assert.equal(isPhysicalProduct('EBOOK', true), true);
  assert.equal(isPhysicalProduct('EBOOK', false), false);
  assert.equal(isPhysicalProduct('ELEARNING_COURSE', false), false);
  assert.equal(effectiveUnitPrice(590, 390), 390);
  assert.equal(effectiveUnitPrice(590, null), 590);
  assert.equal(effectiveUnitPrice(590, 900), 590, 'invalid discount ignored');
  ok('Zod SSOT (items/summary/shipping/add/update + helpers)');
}

// ---------- 2. Entities ----------
{
  assertCartQuantity(1);
  assertCartQuantity(99);
  assert.throws(() => assertCartQuantity(0), /between 1 and 99/);
  assert.throws(() => assertCartQuantity(100), /between 1 and 99/);
  assert.throws(() => assertCartQuantity(1.5), /integer/);
  const pub = { productType: 'EBOOK', isPublished: true, deletedAt: null, physicalDetail: null };
  assertAddable(pub, 2);
  assert.throws(() => assertAddable({ ...pub, isPublished: false }, 1), /not available/);
  assert.throws(() => assertAddable({ ...pub, deletedAt: new Date() }, 1), /not available/);
  assert.throws(
    () => assertAddable({ ...pub, productType: 'PHYSICAL_BOOK', physicalDetail: { stockQty: 2, reservedQty: 1 } }, 2),
    /Insufficient stock/,
  );
  assertAddable({ ...pub, productType: 'PHYSICAL_BOOK', physicalDetail: { stockQty: 5, reservedQty: 1 } }, 4);
  assert.equal(deriveItemCategory('PHYSICAL_BOOK', false), 'PHYSICAL');
  assert.equal(deriveItemCategory('EBOOK', true), 'PHYSICAL');
  assert.equal(deriveItemCategory('HYBRID_BUNDLE', false), 'DIGITAL');
  assertCartOwner(UID, UID);
  assert.throws(() => assertCartOwner(UID, 'other'), /denied/);
  assert.equal(isAbandoned(new Date(Date.now() - 31 * 60_000)), true);
  assert.equal(isAbandoned(new Date()), false);
  ok('entities (quantity/stock/owner/abandoned guards + category rule)');
}

// ---------- 3. Split VO incl. spec edge cases ----------
{
  assert.equal(tieredShippingFee(0), 35, 'Edge 2: 0g fallback to minimum fee');
  assert.equal(tieredShippingFee(500), 35);
  assert.equal(tieredShippingFee(1200), 55);
  assert.equal(tieredShippingFee(2500), 85);
  // Edge 1: digital-only → no address, fee 0
  const d = splitCart([{ ...digi }], 999);
  assert.equal(d.requiresShippingAddress, false);
  assert.equal(d.estimatedShippingFee, 0, 'digital ignores shipping input');
  assert.equal(d.grandTotalAmount, 199);
  // Edge 3: digital discount never touches shipping
  const mixed = splitCart([{ ...digi }, { ...phys }], 55, 50);
  assert.equal(mixed.digitalSubtotal, 199);
  assert.equal(mixed.physicalSubtotal, 700);
  assert.equal(mixed.totalPhysicalWeightGrams, 1200);
  assert.equal(mixed.appliedDiscountAmount, 50);
  assert.equal(mixed.estimatedShippingFee, 55);
  assert.equal(mixed.grandTotalAmount, 199 - 50 + 700 + 55);
  // discount clamped to digital subtotal
  const clamped = splitCart([{ ...digi }], 0, 9999);
  assert.equal(clamped.appliedDiscountAmount, 199);
  assert.equal(clamped.grandTotalAmount, 0);
  const empty = emptyCartSummary();
  assert.equal(HybridCartSplitSummarySchema.safeParse(empty).success, true);
  assert.equal(HybridCartSplitSummarySchema.safeParse(mixed).success, true);
  ok('split VO (tiers + digital-only + discount isolation + clamp)');
}

// ---------- 4. Shipping adapter (fakes) ----------
function fakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    get: async (k: string) => store.get(k) ?? null,
    setex: async (k: string, _t: number, v: string) => { store.set(k, v); },
  };
}
async function sectionShipping(): Promise<void> {
  assert.equal(resolveZone('10100'), 'BANGKOK_METRO');
  assert.equal(resolveZone('10900'), 'BANGKOK_METRO');
  assert.equal(resolveZone('65000'), 'UPCOUNTRY');
  assert.equal(resolveZone('94000'), 'REMOTE');
  assert.equal(resolveZone(''), 'UPCOUNTRY');

  const castP = (v: unknown) => v as unknown as import('../apps/backend/src/infra/database/prisma.service').PrismaService;
  const castR = (v: unknown) => v as unknown as import('../apps/backend/src/infra/redis/redis-cluster.service').RedisClusterService;
  const table = [
    { carrierName: 'FLASH', provinceZone: 'UPCOUNTRY', minWeightGrams: 0, maxWeightGrams: 2000, baseFee: 45 },
  ];
  const prisma = { shippingRateTable: { findMany: async () => table } };
  const redis = fakeRedis();
  const svc = new ShippingAdapterService(castP(prisma), castR(redis));
  const t0 = performance.now();
  const q = await svc.quoteCarrier('FLASH', '65000', 1200);
  assert.equal(q.fee, 45, 'rate table wins');
  assert.equal(q.zone, 'UPCOUNTRY');
  assert.ok(redis.store.has('shipping:rate:FLASH:UPCOUNTRY:1200'), 'cached 1h');
  const cached = await svc.quoteCarrier('FLASH', '65000', 1200);
  assert.equal(cached.fee, 45, 'cache hit identical');
  const zero = await svc.quoteCarrier('KERRY', '65000', 0);
  assert.equal(zero.fee, 35, '0g minimum fallback');
  const noTable = new ShippingAdapterService(
    castP({ shippingRateTable: { findMany: async () => { throw new Error('db down'); } } }),
    castR(fakeRedis()),
  );
  assert.equal((await noTable.quoteCarrier('KERRY', '65000', 1200)).fee, 55, 'tiered fallback on table failure');
  const all = await svc.quoteAll('65000', 1200);
  assert.equal(all.length, 3, '3 carriers quoted');
  const cheap = await svc.cheapest('65000', 1200, 'THAIPOST');
  assert.equal(cheap.carrier, 'THAIPOST', 'preferred carrier honored');
  console.log(`  (shipping logic ${(performance.now() - t0).toFixed(1)}ms with fakes)`);
  ok('shipping adapter (zones + table/cache/fallback + multi-quote)');
}

// ---------- 5-6. CartService + Repository (fakes) ----------
interface FakeProduct {
  id: string; title: string; coverImageUrl: string; productType: string;
  price: number; discountPrice: number | null; isPublished: boolean; deletedAt: null;
  physical: { stockQty: number; reservedQty: number; weightGrams: number; sku: string } | null;
}
function buildFakes011() {
  const products = new Map<string, FakeProduct>([
    [PID, { id: PID, title: 'E-book', coverImageUrl: 'https://c.test/e.png', productType: 'EBOOK', price: 199, discountPrice: null, isPublished: true, deletedAt: null, physical: null }],
    ['623e4567-e89b-12d3-a456-426614174005', { id: '623e4567-e89b-12d3-a456-426614174005', title: 'Hardcover', coverImageUrl: 'https://c.test/b.png', productType: 'PHYSICAL_BOOK', price: 350, discountPrice: null, isPublished: true, deletedAt: null, physical: { stockQty: 10, reservedQty: 0, weightGrams: 600, sku: 'HC-001' } }],
  ]);
  const items = new Map<string, { id: string; productId: string; quantity: number; cartId: string }>();
  const addresses = new Map<string, { id: string; userId: string; postalCode: string }>([
    [AID, { id: AID, userId: UID, postalCode: '65000' }],
  ]);
  let seq = 0;
  const toRow = (it: { id: string; productId: string; quantity: number; cartId: string }) => {
    const p = products.get(it.productId);
    if (!p) throw new Error('missing product');
    return {
      id: it.id, productId: it.productId, quantity: it.quantity, cartId: it.cartId,
      product: {
        id: p.id, title: p.title, coverImageUrl: p.coverImageUrl, productType: p.productType,
        price: p.price, discountPrice: p.discountPrice, isPublished: p.isPublished, deletedAt: p.deletedAt,
        physicalDetail: p.physical ? { ...p.physical } : null,
      },
      cart: { userId: 'cart-user' },
    };
  };
  const cartApi = {
    findUnique: async (args: { where: { userId?: string; id?: string }; include?: unknown }) => {
      if (args.where.userId) {
        if (args.where.userId !== UID) return null;
        return { id: 'cart-1', userId: UID, tenantId: 'default', lastActivityAt: new Date(), items: [...items.values()].map(toRow) };
      }
      return { id: args.where.id, userId: UID, tenantId: 'default', lastActivityAt: new Date(), items: [...items.values()].map(toRow) };
    },
    create: async () => ({ id: 'cart-1' }),
    update: async () => ({}),
  };
  const cartItemApi = {
    findUnique: async (args: { where: { cartId_productId?: { cartId: string; productId: string }; id?: string }; include?: unknown }) => {
      if (args.where.cartId_productId) {
        const found = [...items.values()].find((i) => i.productId === args.where.cartId_productId!.productId);
        return found ? { quantity: found.quantity } : null;
      }
      const it = [...items.values()].find((i) => i.id === args.where.id);
      if (!it) return null;
      return { ...toRow(it), cart: { userId: UID } };
    },
    upsert: async (args: { where: { cartId_productId: { cartId: string; productId: string } }; create: { cartId: string; productId: string; quantity: number }; update: { quantity: number } }) => {
      const found = [...items.values()].find((i) => i.productId === args.where.cartId_productId.productId);
      if (found) found.quantity = args.update.quantity;
      else {
        seq++;
        const uuid = `723e4567-e89b-12d3-a456-42661417${String(1000 + seq).padStart(4, '0')}`;
        items.set(uuid, { id: uuid, productId: args.create.productId, quantity: args.create.quantity, cartId: args.create.cartId });
      }
      return {};
    },
    update: async (args: { where: { id: string }; data: { quantity: number } }) => {
      const it = [...items.values()].find((i) => i.id === args.where.id);
      if (!it) throw new Error('missing');
      it.quantity = args.data.quantity;
      return {};
    },
    delete: async (args: { where: { id: string } }) => {
      for (const [k, v] of items) if (v.id === args.where.id) items.delete(k);
      return {};
    },
  };
  const productApi = {
    findUnique: async (args: { where: { id: string }; select?: unknown }) => {
      const p = products.get(args.where.id);
      if (!p) return null;
      return {
        id: p.id, title: p.title, coverImageUrl: p.coverImageUrl, productType: p.productType,
        price: p.price, discountPrice: p.discountPrice, isPublished: p.isPublished, deletedAt: p.deletedAt,
        physicalDetail: p.physical ? { stockQty: p.physical.stockQty, reservedQty: p.physical.reservedQty } : null,
      };
    },
  };
  const prisma = {
    $transaction: async <T>(fn: (t: unknown) => Promise<T>): Promise<T> =>
      fn({ cart: cartApi, cartItem: cartItemApi, product: productApi }),
    cart: cartApi,
    cartItem: cartItemApi,
    product: productApi,
    userAddress: { findUnique: async (args: { where: { id: string } }) => addresses.get(args.where.id) ?? null },
    shippingRateTable: { findMany: async () => [] as Array<Record<string, unknown>> },
  };
  const store = new Map<string, string>();
  const events: Array<{ ch: string; msg: string }> = [];
  const redis = {
    get: async (k: string) => store.get(k) ?? null,
    setex: async (k: string, _t: number, v: string) => { store.set(k, v); },
    del: async (k: string) => { store.delete(k); },
    publish: async (ch: string, msg: string) => { events.push({ ch, msg }); },
  };
  return { prisma, redis, items, events, products };
}

async function main(): Promise<void> {
  await sectionShipping();
  await Promise.resolve();
  const castP = (v: unknown) => v as unknown as import('../apps/backend/src/infra/database/prisma.service').PrismaService;
  const castR = (v: unknown) => v as unknown as import('../apps/backend/src/infra/redis/redis-cluster.service').RedisClusterService;

  {
    // Repository atomicity: upsert increments, stock guard, owner guard
    const f = buildFakes011();
    const repo = new CartRepository(castP(f.prisma));
    const t0 = performance.now();
    await repo.addItem(UID, PID, 1);
    await repo.addItem(UID, PID, 2);
    const cart = await repo.read(UID);
    assert.equal(cart?.items.find((i) => i.productId === PID)?.quantity, 3, 'upsert increments');
    await assert.rejects(() => repo.addItem(UID, '623e4567-e89b-12d3-a456-426614174005', 99), /Insufficient stock/);
    await assert.rejects(() => repo.addItem(UID, '999e4567-e89b-12d3-a456-426614179999', 1), /not found/i);
    await assert.rejects(() => repo.updateQuantity('other-user', 'ci-1', 1), /not found/i, 'owner guard');
    console.log(`  (repo atomic logic ${(performance.now() - t0).toFixed(1)}ms with fakes)`);
    ok('repository (atomic upsert + stock/owner guards)');
  }

  {
    // Service: BDD split + live shipping + quotes + ownership
    const f = buildFakes011();
    const repo = new CartRepository(castP(f.prisma));
    const shipping = new ShippingAdapterService(castP(f.prisma), castR(f.redis));
    const svc = new CartService(repo, shipping, castP(f.prisma), castR(f.redis));
    const added = await svc.addToCart(UID, PID, 1);
    assert.equal(added.digitalItems.length, 1);
    assert.equal(added.requiresShippingAddress, false);
    assert.equal(added.estimatedShippingFee, 0);
    assert.ok(f.events.some((e) => e.ch === 'stream:cart:item-added'), 'item-added tracked');
    await svc.addToCart(UID, '623e4567-e89b-12d3-a456-426614174005', 2);
    const split = await svc.getCalculatedCart(UID);
    assert.equal(split.physicalItems.length, 1);
    assert.equal(split.totalPhysicalWeightGrams, 1200, 'BDD: 1200g total');
    assert.equal(split.requiresShippingAddress, true, 'BDD: address required for physical');
    const withShip = await svc.getCalculatedCart(UID, AID);
    assert.equal(withShip.estimatedShippingFee, 55, 'BDD: 1200g → 55 THB tier');
    assert.equal(withShip.grandTotalAmount, 199 + 700 + 55);
    assert.ok(f.events.some((e) => e.ch === 'stream:cart:split-calculated'), 'split tracked');
    const { quotes, summary } = await svc.calculateShipping(UID, AID, 'KERRY');
    assert.equal(quotes.length, 3);
    assert.equal(summary.estimatedShippingFee, 55);
    await assert.rejects(() => svc.getCalculatedCart(UID, '999e4567-e89b-12d3-a456-426614179999'), /not found/i);
    const foreign = '523e4567-e89b-12d3-a456-426614179998';
    (f.prisma as unknown as { userAddress: { findUnique: (a: unknown) => Promise<unknown> } }).userAddress = {
      findUnique: async () => ({ id: foreign, userId: 'someone-else', postalCode: '10100' }),
    };
    await assert.rejects(() => svc.calculateShipping(UID, foreign), /does not belong/);
    await assert.rejects(() => svc.addToCart('', PID, 1), /Missing user/);
    ok('service (BDD split + 1200g/55THB shipping + quotes + guards)');
  }

  console.log(`\nphase011 contract tests: ${passed} groups passed`);
}

void main();
