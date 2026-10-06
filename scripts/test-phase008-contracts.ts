// SSOT Phase 008 §10/Task 008.5 — catalog contract + integration tests (TDD loop 3x per skill.md)
// Run: npx tsx scripts/test-phase008-contracts.ts
import assert from 'node:assert/strict';
import {
  ProductTypeEnum,
  ProductStatusEnum,
  CreateProductSchema,
  UpdateStockSchema,
  ListCatalogQuerySchema,
  CreatePhysicalDetailSchema,
  CreateEbookDetailSchema,
} from '../packages/shared/src/schemas/catalog.zod';
import { ProductTypeEnum as SdidTypes } from '../packages/shared/src/schemas/sdid-contract';
import { toSatang, effectivePriceSatang } from '../apps/backend/src/modules/catalog/domain/value-objects/money.vo';
import { normalizeSku } from '../apps/backend/src/modules/catalog/domain/value-objects/sku.vo';
import { assertCreatable, assertPublishable } from '../apps/backend/src/modules/catalog/domain/entities/product.entity';
import { assertReservable, availableQty } from '../apps/backend/src/modules/catalog/domain/entities/physical-detail.entity';
import { assertEbookCoherent } from '../apps/backend/src/modules/catalog/domain/entities/ebook-detail.entity';
import { assertGaplessOrder } from '../apps/backend/src/modules/catalog/domain/entities/course-detail.entity';
import { PrismaCatalogRepository } from '../apps/backend/src/modules/catalog/infrastructure/repositories/prisma-catalog.repository';

const TID = '123e4567-e89b-12d3-a456-426614174000';
const SID = '123e4567-e89b-12d3-a456-426614174001';
let passed = 0;
function ok(name: string) {
  passed++;
  console.log(`  ✓ ${name}`);
}

// ---------- 1. Zod catalog SSOT ----------
{
  assert.deepEqual(ProductTypeEnum.options, SdidTypes.options, 'single ProductType source (sdid-contract)');
  assert.deepEqual(ProductStatusEnum.options, ['DRAFT', 'PUBLISHED', 'ARCHIVED', 'SUSPENDED']);
  const base = {
    sellerId: SID, title: 'E-book 101', slug: 'e-book-101', description: 'd',
    coverImageUrl: 'https://cdn.test/c.png', productType: 'EBOOK', price: 199,
  } as const;
  assert.equal(CreateProductSchema.safeParse({ ...base, ebookDetail: { totalPages: 120, storagePathR2: 'r2://x', fileHash: 'a'.repeat(64) } }).success, true);
  assert.equal(CreateProductSchema.safeParse({ ...base, productType: 'PHYSICAL_BOOK', physicalDetail: { weightGrams: 300, sku: 'bk-001' } }).success, true);
  assert.equal(
    CreateProductSchema.safeParse({ ...base, productType: 'HYBRID_BUNDLE', bundleItemIds: [TID, SID] }).success,
    true,
  );
  // failures
  assert.equal(CreateProductSchema.safeParse({ ...base, slug: 'Bad_Slug!' }).success, false);
  assert.equal(CreateProductSchema.safeParse({ ...base, productType: 'HYBRID_BUNDLE', bundleItemIds: [TID] }).success, false);
  // Note: bundleItemIds coherence is a domain invariant (assertCreatable), not a Zod shape rule.
  assert.equal(CreateProductSchema.safeParse({ ...base, productType: 'EBOOK', bundleItemIds: [TID, SID] }).success, true);
  // Note: discountPrice < price is a domain invariant (assertCreatable), not a Zod shape rule.
  assert.equal(CreateProductSchema.safeParse({ ...base, price: 100, discountPrice: 100 }).success, true);
  assert.equal(CreateProductSchema.safeParse({ ...base, ebookDetail: { totalPages: 10, storagePathR2: 'x', fileHash: 'short' } }).success, false);
  assert.equal(CreatePhysicalDetailSchema.safeParse({ weightGrams: 0, sku: 'ab' }).success, false);
  assert.equal(CreateEbookDetailSchema.safeParse({ totalPages: -1, storagePathR2: '', fileHash: 'a'.repeat(64) }).success, false);
  assert.equal(UpdateStockSchema.safeParse({ productId: TID, deltaQty: 2.5 }).success, false);
  const listParsed = ListCatalogQuerySchema.safeParse({});
  assert.ok(listParsed.success && listParsed.data.page === 1 && listParsed.data.pageSize === 20);
  ok('catalog Zod (create/stock/list/status) happy + edge + failure');
}

// ---------- 2. VOs: money + sku ----------
{
  assert.equal(toSatang(199), 19900);
  assert.equal(toSatang('19.99'), 1999);
  assert.equal(toSatang({ toNumber: () => 10.5 }), 1050);
  assert.equal(toSatang(0.1 + 0.2), 30, 'no float drift');
  assert.throws(() => toSatang(-1), /Invalid money/);
  assert.equal(effectivePriceSatang(199, 149), 14900);
  assert.equal(effectivePriceSatang(199, 250), 19900, 'discount above price ignored');
  assert.equal(normalizeSku('bk-001'), 'BK-001');
  assert.equal(normalizeSku('  mi x 12 '), 'MI-X-12');
  assert.throws(() => normalizeSku('ab'), /Invalid SKU/);
  assert.throws(() => normalizeSku('bad sku!'), /Invalid SKU/);
  ok('money (satang/discount) + sku (normalize/validate)');
}

// ---------- 3. Entity invariants ----------
{
  const phys = { sellerId: SID, title: 'T', slug: 't-1', description: 'd', coverImageUrl: 'https://c.test/x.png', productType: 'PHYSICAL_BOOK', price: 100, physicalDetail: { weightGrams: 10, sku: 'SKU-1' } } as never;
  assertCreatable(phys);
  assert.throws(() => assertCreatable({ ...phys, physicalDetail: undefined }), /Missing physicalDetail/);
  assert.throws(
    () => assertCreatable({ ...phys, productType: 'HYBRID_BUNDLE', physicalDetail: undefined, bundleItemIds: [TID] }),
    /at least 2/,
  );
  assert.throws(
    () => assertCreatable({ ...phys, productType: 'HYBRID_BUNDLE', physicalDetail: undefined, bundleItemIds: [TID, TID] }),
    /Duplicate/,
  );
  assert.throws(() => assertCreatable({ ...phys, bundleItemIds: [TID, SID] as never }), /Only HYBRID_BUNDLE/);
  assert.throws(() => assertCreatable({ ...phys, price: 100, discountPrice: 100 }), /discountPrice must be below price/);
  assertPublishable({ productType: 'EBOOK', physicalDetail: null, ebookDetail: {}, courseDetail: null, deletedAt: null });
  assert.throws(
    () => assertPublishable({ productType: 'EBOOK', physicalDetail: null, ebookDetail: null, courseDetail: null, deletedAt: null }),
    /Missing ebookDetail/,
  );
  assert.throws(
    () => assertPublishable({ productType: 'EBOOK', physicalDetail: null, ebookDetail: {}, courseDetail: null, deletedAt: new Date() }),
    /deleted/,
  );
  assertReservable(10, 4, 6);
  assert.throws(() => assertReservable(10, 4, 7), /Insufficient stock/);
  assert.throws(() => assertReservable(10, 4, 0), /Invalid reserve/);
  assert.equal(availableQty(10, 4), 6);
  assertEbookCoherent(100, 10);
  assert.throws(() => assertEbookCoherent(0, 0), /at least 1 page/);
  assert.throws(() => assertEbookCoherent(10, 11), /previewPages/);
  assertGaplessOrder('lesson', [1, 2, 3]);
  assert.throws(() => assertGaplessOrder('lesson', [1, 3]), /gapless/);
  ok('entity invariants (bundle/publish/reserve/ebook/order)');
}

// ---------- 4. Repository integration (fakes) ----------
interface FakeProduct { id: string; tenantId: string | null; sellerId: string; title: string; slug: string; description: string; coverImageUrl: string; productType: string; status: string; price: number; discountPrice: number | null; isPublished: boolean; deletedAt: Date | null; createdAt: Date }
function buildFakes008() {
  const uuid = (n: number) => `123e4567-e89b-12d3-a456-42661417${String(5000 + n).padStart(4, '0')}`;
  const products = new Map<string, FakeProduct>();
  const physical = new Map<string, { productId: string; stockQty: number; reservedQty: number; sku: string; isbn: string | null; weightGrams: number }>();
  const ebooks = new Map<string, { productId: string; totalPages: number; previewPages: number; storagePathR2: string; fileHash: string }>();
  const courses = new Map<string, { productId: string; totalHours: number }>();
  const bundles: Array<{ parentBundleId: string; childProductId: string }> = [];
  const cache = new Map<string, string>();
  const events: Array<Record<string, unknown>> = [];
  let seq = 0;
  const tx = {
    product: {
      findMany: async (args: { where: { id?: { in: string[] }; deletedAt?: null } }) =>
        [...products.values()].filter((p) => (args.where.id ? args.where.id.in.includes(p.id) : true)).map((p) => ({ id: p.id })),
      create: async (args: { data: Record<string, unknown> }) => {
        const d = args.data as Record<string, unknown> & { slug: string };
        for (const p of products.values()) {
          if (p.slug === d.slug) {
            const err = new Error('Unique constraint failed on the fields: (`slug`)') as Error & { code: string };
            err.code = 'P2002';
            throw err;
          }
        }
        seq++;
        const p: FakeProduct = {
          id: uuid(seq), tenantId: (d.tenantId as string | null) ?? null, sellerId: d.sellerId as string,
          title: d.title as string, slug: d.slug, description: d.description as string,
          coverImageUrl: d.coverImageUrl as string, productType: d.productType as string, status: 'DRAFT',
          price: d.price as number, discountPrice: (d.discountPrice as number | null) ?? null,
          isPublished: false, deletedAt: null, createdAt: new Date(),
        };
        products.set(p.id, p);
        const phys = (d.physicalDetail as { create: Record<string, unknown> } | undefined)?.create;
        if (phys) physical.set(p.id, { productId: p.id, stockQty: (phys.stockQty as number) ?? 0, reservedQty: 0, sku: phys.sku as string, isbn: (phys.isbn as string) ?? null, weightGrams: phys.weightGrams as number });
        const eb = (d.ebookDetail as { create: Record<string, unknown> } | undefined)?.create;
        if (eb) ebooks.set(p.id, { productId: p.id, totalPages: eb.totalPages as number, previewPages: (eb.previewPages as number) ?? 10, storagePathR2: eb.storagePathR2 as string, fileHash: eb.fileHash as string });
        const co = (d.courseDetail as { create: Record<string, unknown> } | undefined)?.create;
        if (co) courses.set(p.id, { productId: p.id, totalHours: (co.totalHours as number) ?? 0 });
        const items = (d.bundleChildren as { create: Array<{ childProductId: string }> } | undefined)?.create;
        if (items) for (const it of items) bundles.push({ parentBundleId: p.id, childProductId: it.childProductId });
        return assemble(p);
      },
      findUnique: async (args: { where: { id?: string; slug?: string } }) => {
        const p = args.where.id ? products.get(args.where.id) : [...products.values()].find((x) => x.slug === args.where.slug);
        return p ? assemble(p) : null;
      },
      findUniqueOrThrow: async (args: { where: { id: string } }) => {
        const p = products.get(args.where.id);
        if (!p) throw new Error('Not found');
        return assemble(p);
      },
      findManyList: async (args: { where: Record<string, unknown>; skip: number; take: number }) => {
        const w = args.where as Record<string, unknown>;
        return [...products.values()]
          .filter((p) => p.deletedAt === null && p.isPublished)
          .filter((p) => (w.tenantId !== undefined ? p.tenantId === w.tenantId : true))
          .filter((p) => (w.productType !== undefined ? p.productType === w.productType : true))
          .filter((p) => {
            const t = (w.title as { contains?: string } | undefined)?.contains;
            return t ? p.title.toLowerCase().includes(t.toLowerCase()) : true;
          })
          .slice(args.skip, args.skip + args.take)
          .map(assemble);
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown>; select?: unknown }) => {
        const p = products.get(args.where.id);
        if (!p) throw new Error('Not found');
        Object.assign(p, args.data);
        return assemble(p);
      },
    },
    physicalDetail: {
      findUnique: async (args: { where: { productId: string } }) => physical.get(args.where.productId) ?? null,
      update: async (args: { where: { productId: string }; data: Record<string, number> }) => {
        const d = physical.get(args.where.productId);
        if (!d) throw new Error('Not found');
        Object.assign(d, args.data);
        return { ...d };
      },
    },
  };
  function assemble(p: FakeProduct) {
    return {
      ...p,
      physicalDetail: physical.get(p.id) ?? null,
      ebookDetail: ebooks.get(p.id) ?? null,
      courseDetail: courses.get(p.id) ?? null,
      bundleChildren: bundles.filter((b) => b.parentBundleId === p.id).map((b) => ({ childProductId: b.childProductId })),
      categories: [],
      tags: [],
    };
  }
  const prisma = {
    $transaction: async <T>(fn: (t: typeof tx) => Promise<T>): Promise<T> => fn(tx),
    product: {
      ...tx.product,
      findMany: async (args: Record<string, unknown>) => {
        const a = args as { where?: { id?: { in: string[] }; deletedAt?: null; title?: { contains: string; mode: string }; tenantId?: string; productType?: string; isPublished?: boolean }; skip?: number; take?: number; select?: unknown; orderBy?: unknown };
        if (a.select) {
          return tx.product.findManyList({ where: (a.where ?? {}) as Record<string, unknown>, skip: a.skip ?? 0, take: a.take ?? 20 });
        }
        return tx.product.findMany({ where: { id: a.where?.id, deletedAt: null } });
      },
    },
    physicalDetail: tx.physicalDetail,
  };
  const redis = {
    get: async (k: string) => cache.get(k) ?? null,
    setex: async (k: string, _t: number, v: string) => { cache.set(k, v); },
    del: async (k: string) => { cache.delete(k); },
    publish: async (ch: string, msg: string) => { events.push({ ch, ...(JSON.parse(msg) as Record<string, unknown>) }); },
  };
  return { prisma, redis, products, physical, bundles, events, cache };
}

async function main(): Promise<void> {
  await Promise.resolve();
  const castP = (v: unknown) => v as unknown as import('../apps/backend/src/infra/database/prisma.service').PrismaService;
  const castR = (v: unknown) => v as unknown as import('../apps/backend/src/infra/redis/redis-cluster.service').RedisClusterService;

  {
    // Atomic hybrid bundle: 1 physical + 1 ebook + bundle parent in one transaction
    const f = buildFakes008();
    const repo = new PrismaCatalogRepository(castP(f.prisma), castR(f.redis));
    const t0 = performance.now();
    const book = await repo.create({
      sellerId: SID, title: 'Hardcover', slug: 'hardcover', description: 'd',
      coverImageUrl: 'https://c.test/b.png', productType: 'PHYSICAL_BOOK', price: 350,
      physicalDetail: { weightGrams: 500, stockQty: 20, sku: 'hc-001' },
    });
    const ebook = await repo.create({
      sellerId: SID, title: 'E-reader', slug: 'e-reader', description: 'd',
      coverImageUrl: 'https://c.test/e.png', productType: 'EBOOK', price: 199,
      ebookDetail: { totalPages: 300, storagePathR2: 'r2://vault/e', fileHash: 'b'.repeat(64) },
    });
    assert.equal(book.stock?.available, 20);
    const bundle = await repo.create({
      sellerId: SID, title: 'Combo', slug: 'combo', description: 'd',
      coverImageUrl: 'https://c.test/c.png', productType: 'HYBRID_BUNDLE', price: 499,
      bundleItemIds: [book.id, ebook.id],
    });
    assert.deepEqual(bundle.bundleChildIds.sort(), [book.id, ebook.id].sort());
    assert.ok(f.events.some((e) => e['event'] === 'product.created'));
    await assert.rejects(() => repo.create({
      sellerId: SID, title: 'Dup', slug: 'hardcover', description: 'd',
      coverImageUrl: 'https://c.test/x.png', productType: 'EBOOK', price: 10,
      ebookDetail: { totalPages: 20, previewPages: 5, storagePathR2: 'r2://x', fileHash: 'c'.repeat(64) },
    }), /Unique constraint/);
    await assert.rejects(() => repo.create({
      sellerId: SID, title: 'Bad', slug: 'bad-bundle', description: 'd',
      coverImageUrl: 'https://c.test/x.png', productType: 'HYBRID_BUNDLE', price: 10,
      bundleItemIds: [book.id, '123e4567-e89b-12d3-a456-426614179999'],
    }), /Unknown or deleted bundle item/);
    console.log(`  (bundle create logic ${(performance.now() - t0).toFixed(1)}ms with fakes)`);
    ok('hybrid bundle atomic create (nested details + items + events + slug guard)');
  }

  {
    // Soft-delete preserves stock; publish guards; stock update/reserve guards
    const f = buildFakes008();
    const repo = new PrismaCatalogRepository(castP(f.prisma), castR(f.redis));
    const book = await repo.create({
      sellerId: SID, title: 'Stock', slug: 'stock-book', description: 'd',
      coverImageUrl: 'https://c.test/s.png', productType: 'PHYSICAL_BOOK', price: 100,
      physicalDetail: { weightGrams: 100, stockQty: 10, sku: 'st-001' },
    });
    const pub = await repo.publishProduct(book.id);
    assert.equal(pub.status, 'PUBLISHED');
    const afterStock = await repo.updateStock(book.id, -3);
    assert.equal(afterStock.stock?.stockQty, 7);
    await assert.rejects(() => repo.updateStock(book.id, -8), /negative/);
    assert.equal(await repo.reserveStock(book.id, 5), 2);
    await assert.rejects(() => repo.reserveStock(book.id, 3), /Insufficient stock/);
    await assert.rejects(() => repo.updateStock(book.id, -3), /reserved/);
    const deleted = await repo.softDelete(book.id);
    assert.equal(deleted.isPublished, false);
    assert.ok(deleted.deletedAt instanceof Date);
    assert.equal(deleted.stock?.stockQty, 7, 'stock preserved for fulfillment');
    await assert.rejects(() => repo.softDelete(book.id), /not found/i);
    await assert.rejects(() => repo.getBySlug('stock-book'), /not found/i);
    ok('soft-delete (unpublish+timestamp, stock intact) + publish/stock/reserve guards');
  }

  {
    // Tenant-isolated stripped list + PDP cache
    const f = buildFakes008();
    const repo = new PrismaCatalogRepository(castP(f.prisma), castR(f.redis));
    const a = await repo.create({
      tenantId: TID, sellerId: SID, title: 'Alpha Course', slug: 'alpha-course', description: 'long-body',
      coverImageUrl: 'https://c.test/a.png', productType: 'ELEARNING_COURSE', price: 999,
      courseDetail: { totalHours: 12 },
    });
    await repo.publishProduct(a.id);
    const b = await repo.create({
      tenantId: '223e4567-e89b-12d3-a456-426614174001', sellerId: SID, title: 'Beta Course', slug: 'beta-course', description: 'long-body',
      coverImageUrl: 'https://c.test/b.png', productType: 'ELEARNING_COURSE', price: 888,
      courseDetail: { totalHours: 8 },
    });
    await repo.publishProduct(b.id);
    const list = await repo.list({ tenantId: TID, page: 1, pageSize: 20 });
    assert.equal(list.items.length, 1);
    assert.equal(list.items[0].slug, 'alpha-course');
    assert.ok(!('description' in list.items[0]), 'list payload stripped (no description)');
    const search = await repo.list({ search: 'beta', page: 1, pageSize: 20 });
    assert.equal(search.items.length, 1);
    const pdp = await repo.getBySlug('alpha-course');
    assert.equal(pdp.description, 'long-body');
    assert.ok(f.cache.has('catalog:item:alpha-course'), 'PDP edge-cached');
    ok('tenant-isolated stripped list + search + PDP cache');
  }

  console.log(`\nphase008 contract tests: ${passed} groups passed`);
}

void main();
