// SSOT Phase 010 §10/Task 7-8 — storefront & PDP contract + integration tests (TDD loop 3x)
// Run: npx tsx scripts/test-phase010-contracts.ts
import assert from 'node:assert/strict';
import {
  StorefrontBannerSchema,
  CategoryQuickLinkSchema,
  ProductCardSchema,
  ProductDetailSchema,
  StorefrontFeedSchema,
  effectivePrice,
  discountPercent,
} from '../packages/shared/src/schemas/storefront.schema';
import { ProductTypeEnum as SdidTypes } from '../packages/shared/src/schemas/sdid-contract';
import {
  StorefrontService,
  toProductCard,
  BESTSELLER_THRESHOLD,
} from '../apps/backend/src/modules/catalog/services/storefront.service';

const TID = '123e4567-e89b-12d3-a456-426614174000';
const SID = '123e4567-e89b-12d3-a456-426614174001';
const PID = '223e4567-e89b-12d3-a456-426614174001';
let passed = 0;
function ok(name: string) {
  passed++;
  console.log(`  ✓ ${name}`);
}

const cardBase = {
  id: PID,
  title: 'Mastering AI Prompt Engineering',
  slug: 'mastering-ai-prompt',
  coverImageUrl: 'https://cdn.test/covers/prompt.webp',
  productType: 'EBOOK',
  price: 590,
  discountPrice: 390,
  rating: 5.0,
  soldCount: 120,
  isBestseller: true,
} as const;

// ---------- 1. Zod SSOT ----------
{
  assert.deepEqual(
    ProductCardSchema.shape.productType.options,
    (SdidTypes as unknown as { options: string[] }).options,
    'single ProductType source (sdid-contract)',
  );
  assert.equal(ProductCardSchema.safeParse(cardBase).success, true);
  assert.equal(ProductCardSchema.safeParse({ ...cardBase, price: -1 }).success, false);
  assert.equal(ProductCardSchema.safeParse({ ...cardBase, rating: 6 }).success, false);
  assert.equal(ProductCardSchema.safeParse({ ...cardBase, discountPrice: -5 }).success, false);
  assert.equal(StorefrontBannerSchema.safeParse({ id: PID, title: 'Sale', imageUrl: 'https://c.test/b.webp', targetUrl: '/sale', displayOrder: 1 }).success, true);
  assert.equal(StorefrontBannerSchema.safeParse({ id: 'bad', title: 'x', imageUrl: 'not-url', targetUrl: '/', displayOrder: 0 }).success, false);
  assert.equal(CategoryQuickLinkSchema.safeParse({ id: PID, name: 'E-Book', slug: 'ebook' }).success, true);
  const detail = {
    ...cardBase,
    description: 'Comprehensive guide',
    sellerId: SID,
    sellerName: 'Zene Academy',
    sellerAvatarUrl: null,
    physicalDetail: null,
    ebookDetail: { totalPages: 250, previewPages: 10 },
    courseDetail: null,
  };
  assert.equal(ProductDetailSchema.safeParse(detail).success, true);
  assert.equal(ProductDetailSchema.safeParse({ ...detail, sellerId: 'bad' }).success, false);
  assert.equal(
    ProductDetailSchema.safeParse({ ...detail, courseDetail: { totalHours: 5, totalLessons: 1, sections: [] } }).success,
    true,
  );
  const feed = { banners: [], categories: [], featuredProducts: [cardBase], bestsellerProducts: [], newReleases: [] };
  assert.equal(StorefrontFeedSchema.safeParse(feed).success, true);
  assert.equal(effectivePrice({ price: 590, discountPrice: 390 }), 390);
  assert.equal(effectivePrice({ price: 590, discountPrice: null }), 590);
  assert.equal(effectivePrice({ price: 590, discountPrice: 900 }), 590, 'invalid discount ignored');
  assert.equal(discountPercent({ price: 590, discountPrice: 390 }), 34);
  assert.equal(discountPercent({ price: 590, discountPrice: null }), 0);
  assert.equal(discountPercent({ price: 0, discountPrice: null }), 0);
  ok('Zod SSOT (banner/card/detail/feed + price helpers)');
}

// ---------- 2. Card mapper ----------
{
  const card = toProductCard({ id: PID, title: 'T', slug: 't', coverImageUrl: 'https://c.test/x.png', productType: 'EBOOK', price: { toNumber: () => 199 } as never, discountPrice: null, ratingAverage: { toNumber: () => 4.5 } as never, soldCount: BESTSELLER_THRESHOLD });
  assert.equal(card.price, 199);
  assert.equal(card.isBestseller, true, 'threshold inclusive');
  const normal = toProductCard({ id: PID, title: 'T', slug: 't', coverImageUrl: 'https://c.test/x.png', productType: 'EBOOK', price: 199, discountPrice: null, ratingAverage: 4, soldCount: BESTSELLER_THRESHOLD - 1 });
  assert.equal(normal.isBestseller, false);
  assert.throws(() => toProductCard({ id: 'bad', title: 'T', slug: 't', coverImageUrl: 'https://c/x.png', productType: 'EBOOK', price: 1, discountPrice: null, ratingAverage: 5, soldCount: 0 }), /contract drift/);
  ok('card mapper (Decimal→number, bestseller threshold, drift guard)');
}

// ---------- 3-5. Service integration (fakes) ----------
type PRow = { id: string; title: string; slug: string; description: string; coverImageUrl: string; productType: string; price: number; discountPrice: number | null; ratingAverage: number; soldCount: number; isPublished: boolean; deletedAt: null; tenantId: string | null; isFeatured: boolean; sellerId: string; createdAt: Date; physicalDetail: { isbn: string | null; weightGrams: number; stockQty: number } | null; ebookDetail: { totalPages: number; previewPages: number } | null; courseDetail: { totalHours: number; sections: Array<{ id: string; title: string; sectionOrder: number; lessons: Array<{ id: string; title: string; durationSec: number; isPreview: boolean }> }> } | null };
function buildFakes010() {
  const rows: PRow[] = [
    { id: PID, title: 'Mastering AI Prompt', slug: 'mastering-ai-prompt', description: 'Guide', coverImageUrl: 'https://cdn.test/p.webp', productType: 'EBOOK', price: 590, discountPrice: 390, ratingAverage: 5.0, soldCount: 120, isPublished: true, deletedAt: null, tenantId: TID, isFeatured: true, sellerId: SID, createdAt: new Date('2026-02-01'), physicalDetail: null, ebookDetail: { totalPages: 250, previewPages: 10 }, courseDetail: null },
    { id: '323e4567-e89b-12d3-a456-426614174002', title: 'Course 101', slug: 'course-101', description: 'Learn', coverImageUrl: 'https://cdn.test/c.webp', productType: 'ELEARNING_COURSE', price: 999, discountPrice: null, ratingAverage: 4.2, soldCount: 30, isPublished: true, deletedAt: null, tenantId: TID, isFeatured: false, sellerId: SID, createdAt: new Date('2026-03-01'), physicalDetail: null, ebookDetail: null, courseDetail: { totalHours: 5, sections: [{ id: 's1', title: 'Intro', sectionOrder: 1, lessons: [{ id: 'l1', title: 'Welcome', durationSec: 600, isPreview: true }, { id: 'l2', title: 'Setup', durationSec: 900, isPreview: false }] }] } },
    { id: '423e4567-e89b-12d3-a456-426614174003', title: 'Draft Only', slug: 'draft-only', description: 'hidden', coverImageUrl: 'https://cdn.test/d.webp', productType: 'EBOOK', price: 100, discountPrice: null, ratingAverage: 0, soldCount: 0, isPublished: false, deletedAt: null, tenantId: TID, isFeatured: true, sellerId: SID, createdAt: new Date(), physicalDetail: null, ebookDetail: { totalPages: 10, previewPages: 2 }, courseDetail: null },
  ];
  const strip = (r: PRow) => ({ id: r.id, title: r.title, slug: r.slug, coverImageUrl: r.coverImageUrl, productType: r.productType, price: r.price, discountPrice: r.discountPrice, ratingAverage: r.ratingAverage, soldCount: r.soldCount });
  const prisma = {
    product: {
      findMany: async (args: { where: Record<string, unknown>; orderBy?: unknown; take?: number }) => {
        const w = args.where as Record<string, unknown>;
        let list = rows.filter((r) => {
          if (w['isPublished'] === true && !r.isPublished) return false;
          if (w['isFeatured'] === true && !r.isFeatured) return false;
          if (w['deletedAt'] === null && r.deletedAt !== null) return false;
          const or = w['OR'] as Array<Record<string, { contains: string }>> | undefined;
          if (or?.length) {
            const hit = or.some((c) => c['title'] ? r.title.toLowerCase().includes(c['title'].contains.toLowerCase()) : r.description.toLowerCase().includes(c['description'].contains.toLowerCase()));
            if (!hit) return false;
          }
          return true;
        });
        const ob = args.orderBy as Record<string, string> | undefined;
        if (ob?.soldCount === 'desc') list = [...list].sort((a, b) => b.soldCount - a.soldCount);
        else list = [...list].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return list.slice(0, args.take ?? 10).map(strip);
      },
      findUnique: async (args: { where: { slug: string } }) => {
        const r = rows.find((x) => x.slug === args.where.slug);
        if (!r) return null;
        return { ...r };
      },
    },
    banner: {
      findMany: async () => [{ id: PID, title: 'Sale', imageUrl: 'https://cdn.test/b.webp', targetUrl: '/sale', displayOrder: 0 }],
    },
    category: {
      findMany: async () => [{ id: PID, name: 'E-Book', slug: 'ebook' }],
    },
    user: {
      findUnique: async () => ({ displayName: 'Zene Academy', avatarUrl: null }),
    },
  };
  const store = new Map<string, string>();
  const events: string[] = [];
  const redis = {
    get: async (k: string) => store.get(k) ?? null,
    setex: async (k: string, _t: number, v: string) => { store.set(k, v); },
    del: async (k: string) => { store.delete(k); },
    publish: async (ch: string) => { events.push(ch); },
  };
  return { prisma, redis, store, events };
}

async function main(): Promise<void> {
  await Promise.resolve();
  const castP = (v: unknown) => v as unknown as import('../apps/backend/src/infra/database/prisma.service').PrismaService;
  const castR = (v: unknown) => v as unknown as import('../apps/backend/src/infra/redis/redis-cluster.service').RedisClusterService;

  {
    const f = buildFakes010();
    const svc = new StorefrontService(castP(f.prisma), castR(f.redis));
    const t0 = performance.now();
    const feed = await svc.getFeedByTenant(TID);
    assert.equal(feed.banners.length, 1);
    assert.equal(feed.categories.length, 1);
    assert.ok(feed.featuredProducts.every((p) => p.slug !== 'draft-only'), 'drafts excluded');
    assert.ok(feed.featuredProducts.length >= 1, 'featured present');
    assert.equal(feed.bestsellerProducts[0].slug, 'mastering-ai-prompt', 'soldCount desc');
    assert.ok(f.store.has(`storefront:feed:${TID}`), 'feed cached 5 min');
    assert.ok(f.events.includes('stream:storefront:impression'), 'impression tracked');
    const again = await svc.getFeedByTenant(TID);
    assert.deepEqual(again, feed, 'cache hit identical');
    await assert.rejects(() => svc.getFeedByTenant(''), /Missing tenant/);
    console.log(`  (feed logic ${(performance.now() - t0).toFixed(1)}ms with fakes)`);
    ok('feed (parallel banners/cats/featured/bestsellers/new + 5-min cache + impression)');
  }

  {
    const f = buildFakes010();
    const svc = new StorefrontService(castP(f.prisma), castR(f.redis));
    const pdp = await svc.getProductBySlug('mastering-ai-prompt', TID);
    assert.equal(pdp.slug, 'mastering-ai-prompt');
    assert.equal(pdp.sellerName, 'Zene Academy');
    assert.deepEqual(pdp.ebookDetail, { totalPages: 250, previewPages: 10 });
    assert.equal(pdp.courseDetail, null);
    assert.equal(pdp.physicalDetail, null);
    const course = await svc.getProductBySlug('course-101');
    assert.equal(course.courseDetail?.totalLessons, 2, 'lesson count aggregated');
    assert.equal(course.courseDetail?.sections[0].lessons[0].isPreview, true);
    await assert.rejects(() => svc.getProductBySlug('draft-only'), /not found/i, 'unpublished guarded');
    await assert.rejects(() => svc.getProductBySlug('nope'), /not found/i);
    await assert.rejects(() => svc.getProductBySlug(''), /Missing product slug/);
    // tenant isolation
    await assert.rejects(() => svc.getProductBySlug('mastering-ai-prompt', '999e4567-e89b-12d3-a456-426614174999'), /not found/i);
    // PDP cache + invalidate (tenant-scoped key)
    assert.ok(f.store.has(`storefront:pdp:${TID}:mastering-ai-prompt`), 'PDP cached');
    await svc.invalidate(TID, 'mastering-ai-prompt');
    assert.ok(!f.store.has(`storefront:pdp:${TID}:mastering-ai-prompt`), 'invalidate clears PDP');
    ok('PDP (multi-format details + seller + tenant guard + cache/invalidate)');
  }

  {
    const f = buildFakes010();
    const svc = new StorefrontService(castP(f.prisma), castR(f.redis));
    const res = await svc.getPredictiveSearch('prompt', TID);
    assert.ok(res.length >= 1 && res.length <= 5, 'top-5 cap');
    await assert.rejects(() => svc.getPredictiveSearch(''), /Missing search/);
    const longRes = await svc.getPredictiveSearch('x'.repeat(101), TID);
    assert.ok(Array.isArray(longRes), 'overlong query truncated safely (no throw, no injection)');
    ok('predictive (top-5 cards + validation)');
  }

  console.log(`\nphase010 contract tests: ${passed} groups passed`);
}

void main();
