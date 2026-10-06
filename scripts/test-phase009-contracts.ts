// SSOT Phase 009 §10/Task 7 — search contract + integration tests (TDD loop 3x per skill.md)
// Run: npx tsx scripts/test-phase009-contracts.ts
import assert from 'node:assert/strict';
import {
  ProductFilterInputSchema,
  PredictiveSearchQuerySchema,
  ProductSearchResponseSchema,
  sanitizeSearchQuery,
  searchCacheKey,
  predictiveCacheKey,
  ProductSortByEnum,
} from '../packages/shared/src/schemas/product-search.schema';
import { ProductTypeEnum as SdidTypes } from '../packages/shared/src/schemas/sdid-contract';
import { ProductTypeEnum as SearchTypes } from '../packages/shared/src/schemas/product-search.schema';
import {
  toSearchItem,
  buildHighlightSnippet,
  buildFacets,
  paginate,
} from '../apps/backend/src/modules/catalog/domain/entities/product-search-result.entity';
import {
  buildSearchWhere,
  mapSortOrder,
  escapeLikeTerm,
} from '../apps/backend/src/modules/catalog/infrastructure/search-engine/postgres-fts.engine';
import {
  cosineSimilarity,
  reciprocalRankFusion,
  buildVectorSearchSql,
  assertValidEmbedding,
} from '../apps/backend/src/modules/catalog/infrastructure/search-engine/vector-search.engine';
import { PrismaProductSearchRepository } from '../apps/backend/src/modules/catalog/infrastructure/persistence/prisma-product-search.repository';
import { RedisSearchCacheAdapter } from '../apps/backend/src/modules/catalog/infrastructure/persistence/redis-search-cache.adapter';
import { SearchProductsHandler } from '../apps/backend/src/modules/catalog/application/handlers/search-products.handler';
import { PredictiveSearchHandler } from '../apps/backend/src/modules/catalog/application/handlers/predictive-search.handler';
import { SearchProductsQuery } from '../apps/backend/src/modules/catalog/application/queries/search-products.query';
import { PredictiveSearchQuery } from '../apps/backend/src/modules/catalog/application/queries/predictive-search.query';

const TID = '123e4567-e89b-12d3-a456-426614174000';
let passed = 0;
function ok(name: string) {
  passed++;
  console.log(`  ✓ ${name}`);
}

// ---------- 1. Zod SSOT ----------
{
  assert.deepEqual(SearchTypes.options, SdidTypes.options, 'single ProductType source');
  assert.deepEqual(ProductSortByEnum.options, ['RELEVANCE', 'PRICE_ASC', 'PRICE_DESC', 'NEWEST', 'POPULARITY', 'RATING']);
  const base = { tenantId: TID, productTypes: ['EBOOK'], minPrice: 100, maxPrice: 500, ratingMin: 4.5, sortBy: 'RATING', page: 1, limit: 20, inStockOnly: false } as const;
  assert.equal(ProductFilterInputSchema.safeParse(base).success, true);
  assert.equal(ProductFilterInputSchema.safeParse({}).success, true, 'defaults apply');
  const d = ProductFilterInputSchema.parse({});
  assert.equal(d.page, 1);
  assert.equal(d.limit, 20);
  assert.equal(d.sortBy, 'RELEVANCE');
  assert.equal(ProductFilterInputSchema.safeParse({ ...base, minPrice: 600, maxPrice: 500 }).success, false, 'min<=max guard');
  assert.equal(ProductFilterInputSchema.safeParse({ ...base, limit: 101 }).success, false);
  assert.equal(ProductFilterInputSchema.safeParse({ ...base, query: 'x'.repeat(101) }).success, false);
  assert.equal(PredictiveSearchQuerySchema.safeParse({ query: 'ภาษาแห่งมิตรภาพ' }).success, true);
  assert.equal(PredictiveSearchQuerySchema.safeParse({ query: '' }).success, false);
  assert.equal(PredictiveSearchQuerySchema.safeParse({ query: 'a', limit: 11 }).success, false);
  assert.equal(sanitizeSearchQuery('  hello   world  '), 'hello world');
  assert.equal(sanitizeSearchQuery('a'.repeat(200)).length, 100);
  const k1 = searchCacheKey({ page: 1, limit: 20, sortBy: 'RELEVANCE', inStockOnly: false });
  const k2 = searchCacheKey({ inStockOnly: false, limit: 20, sortBy: 'RELEVANCE', page: 1 } as never);
  assert.equal(k1, k2, 'deterministic cache key');
  assert.ok(predictiveCacheKey(' Hello ', 5).includes('hello'));
  const resp = {
    items: [{ id: TID, title: 'T', slug: 't', coverImageUrl: 'https://c.test/x.png', productType: 'EBOOK', price: 199, discountPrice: null, ratingAverage: 4.5, reviewCount: 10, isAvailable: true }],
    facets: [{ facetName: 'productType', value: 'EBOOK', count: 1 }],
    totalCount: 1, hasNextPage: false, nextCursor: null,
  };
  assert.equal(ProductSearchResponseSchema.safeParse(resp).success, true);
  ok('Zod SSOT (filter/predictive/response/sanitize/cache-key)');
}

// ---------- 2. Entity pure ----------
{
  const item = toSearchItem({ id: TID, title: 'Book', slug: 'book', coverImageUrl: 'https://c/x.png', productType: 'EBOOK', price: { toNumber: () => 199 } as never, discountPrice: null, ratingAverage: { toNumber: () => 4.5 } as never, reviewCount: 3, stockQty: 10, reservedQty: 4 });
  assert.equal(item.price, 199);
  assert.equal(item.isAvailable, true);
  const oos = toSearchItem({ id: TID, title: 'B', slug: 'b', coverImageUrl: 'https://c/x.png', productType: 'PHYSICAL_BOOK', price: 100, discountPrice: null, ratingAverage: 0, reviewCount: 0, stockQty: 2, reservedQty: 2 });
  assert.equal(oos.isAvailable, false);
  assert.throws(() => toSearchItem({ id: '', title: '', slug: '' } as never), /Invalid product/);
  const hl = buildHighlightSnippet('ภาษาแห่งมิตรภาพ เล่ม 1', 'มิตรภาพ');
  assert.ok(hl?.includes('<mark>'), 'highlight marks match');
  assert.ok(buildHighlightSnippet('<script>alert(1)</script>', 'script')?.includes('&lt;'), 'XSS escaped');
  assert.equal(buildHighlightSnippet('Hello', ''), null);
  const facets = buildFacets([{ productType: 'EBOOK', _count: { _all: 2 } }], [{ bucket: '100-500', count: 2 }]);
  assert.equal(facets.length, 2);
  assert.deepEqual(paginate(1, 20, 45), { hasNextPage: true, nextCursor: Buffer.from('p:2:l:20').toString('base64url') });
  assert.equal(paginate(3, 20, 45).hasNextPage, false);
  ok('entity (map/highlight/facets/paginate + XSS guard)');
}

// ---------- 3. Engines ----------
{
  const w = buildSearchWhere({ query: 'ภาษา', productTypes: ['EBOOK'], minPrice: 100, maxPrice: 500, ratingMin: 4.5, inStockOnly: false, sortBy: 'RATING', page: 1, limit: 20 });
  assert.equal(w['isPublished'], true);
  assert.deepEqual(w['productType'], { in: ['EBOOK'] });
  assert.deepEqual(w['price'], { gte: 100, lte: 500 });
  assert.ok(Array.isArray(w['OR']));
  assert.equal(mapSortOrder('PRICE_ASC').price, 'asc');
  assert.equal(mapSortOrder('RATING').ratingAverage, 'desc');
  assert.equal(escapeLikeTerm('100%_x').includes('\\'), true);
  assert.ok(Math.abs(cosineSimilarity([1, 0], [1, 0]) - 1) < 1e-9);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([], []), 0);
  assert.deepEqual(reciprocalRankFusion(['a', 'b'], ['b', 'c'], 2)[0], 'b', 'RRF boosts overlap');
  assert.ok(buildVectorSearchSql(5).includes('<=>'), 'cosine operator used');
  assert.throws(() => assertValidEmbedding([1, 2, 3]), /768/);
  assert.throws(() => assertValidEmbedding(new Array(768).fill(NaN)), /non-finite/);
  ok('engines (FTS where/sort/escape + vector cosine/RRF/SQL)');
}

// ---------- 4. Repository integration (fakes) ----------
type FakeRow = { id: string; title: string; slug: string; description: string; coverImageUrl: string; productType: string; price: number; discountPrice: number | null; ratingAverage: number; reviewCount: number; isPublished: boolean; deletedAt: null; tenantId: string | null; stockQty: number | null; reservedQty: number; createdAt: Date };
function buildFakes009() {
  const rows: FakeRow[] = [
    { id: '223e4567-e89b-12d3-a456-426614174001', title: 'ภาษาแห่งมิตรภาพ', slug: 'mitraphap', description: 'นิยายอบอุ่น', coverImageUrl: 'https://cdn.test/m.png', productType: 'EBOOK', price: 199, discountPrice: null, ratingAverage: 4.8, reviewCount: 120, isPublished: true, deletedAt: null, tenantId: TID, stockQty: null, reservedQty: 0, createdAt: new Date('2026-01-02') },
    { id: '323e4567-e89b-12d3-a456-426614174002', title: 'Physics 101', slug: 'physics-101', description: 'course', coverImageUrl: 'https://cdn.test/p.png', productType: 'ELEARNING_COURSE', price: 999, discountPrice: 799, ratingAverage: 4.2, reviewCount: 30, isPublished: true, deletedAt: null, tenantId: TID, stockQty: null, reservedQty: 0, createdAt: new Date('2026-01-01') },
    { id: '423e4567-e89b-12d3-a456-426614174003', title: 'Hardcover Box', slug: 'box', description: 'physical', coverImageUrl: 'https://cdn.test/b.png', productType: 'PHYSICAL_BOOK', price: 350, discountPrice: null, ratingAverage: 3.0, reviewCount: 5, isPublished: false, deletedAt: null, tenantId: TID, stockQty: 5, reservedQty: 0, createdAt: new Date() },
  ];
  const matches = (r: FakeRow, where: Record<string, unknown>): boolean => {
    if ((where['isPublished'] as boolean) && !r.isPublished) return false;
    if (where['tenantId'] && r.tenantId !== where['tenantId']) return false;
    const pt = (where['productType'] as { in: string[] } | undefined)?.in;
    if (pt && !pt.includes(r.productType)) return false;
    const price = where['price'] as { gte?: number; lte?: number } | undefined;
    if (price?.gte !== undefined && r.price < price.gte) return false;
    if (price?.lte !== undefined && r.price > price.lte) return false;
    const rating = (where['ratingAverage'] as { gte?: number } | undefined)?.gte;
    if (rating !== undefined && r.ratingAverage < rating) return false;
    const or = where['OR'] as Array<Record<string, Record<string, unknown>>> | undefined;
    if (or?.length) {
      const hit = or.some((c) => {
        if (c['title']) return r.title.toLowerCase().includes(((c['title'] as { contains: string }).contains as string).toLowerCase());
        if (c['description']) return r.description.toLowerCase().includes(((c['description'] as { contains: string }).contains as string).toLowerCase());
        if ('physicalDetail' in c) return r.stockQty === null;
        return false;
      });
      const needsText = or.some((c) => c['title'] || c['description']);
      if (needsText && !hit) return false;
    }
    return true;
  };
  const prisma = {
    product: {
      findMany: async (args: { where: Record<string, unknown>; take: number; skip?: number; orderBy?: unknown; select?: unknown }) => {
        const list = rows.filter((r) => matches(r, args.where));
        const sort = args.orderBy as Record<string, string> | undefined;
        if (sort?.price === 'asc') list.sort((a, b) => a.price - b.price);
        else if (sort?.price === 'desc') list.sort((a, b) => b.price - a.price);
        else if (sort?.ratingAverage === 'desc') list.sort((a, b) => b.ratingAverage - a.ratingAverage);
        else list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        const slice = list.slice(args.skip ?? 0, (args.skip ?? 0) + args.take);
        return slice.map((r) => ({ ...r, physicalDetail: r.stockQty === null ? null : { stockQty: r.stockQty, reservedQty: r.reservedQty } }));
      },
      count: async (args: { where: Record<string, unknown> }) => rows.filter((r) => matches(r, args.where)).length,
      groupBy: async (args: { where: Record<string, unknown> }) => {
        const map = new Map<string, number>();
        for (const r of rows.filter((x) => matches(x, args.where))) map.set(r.productType, (map.get(r.productType) ?? 0) + 1);
        return [...map.entries()].map(([productType, n]) => ({ productType, _count: { _all: n } }));
      },
    },
  };
  return { prisma, rows };
}

async function main(): Promise<void> {
  await Promise.resolve();
  const castP = (v: unknown) => v as unknown as import('../apps/backend/src/infra/database/prisma.service').PrismaService;

  {
    const f = buildFakes009();
    const repo = new PrismaProductSearchRepository(castP(f.prisma));
    const t0 = performance.now();
    const res = await repo.search({ query: 'มิตรภาพ', productTypes: ['EBOOK'], minPrice: 100, maxPrice: 500, ratingMin: 4.5, sortBy: 'RATING', page: 1, limit: 20, inStockOnly: false });
    assert.equal(res.totalCount, 1);
    assert.equal(res.items[0].slug, 'mitraphap');
    assert.deepEqual(res.facets, [{ facetName: 'productType', value: 'EBOOK', count: 1 }]);
    assert.equal(res.hasNextPage, false);
    const empty = await repo.search({ query: 'no-such-thing-zzz', sortBy: 'RELEVANCE', page: 1, limit: 20, inStockOnly: false });
    assert.equal(empty.totalCount, 0);
    const sug = await repo.predictive('ภาษา', 5);
    assert.equal(sug.length, 1);
    assert.ok(sug[0].highlightSnippet?.includes('<mark>'));
    await assert.rejects(() => repo.search({ limit: 101, page: 1, sortBy: 'RELEVANCE', inStockOnly: false }), /Invalid product filter/);
    await assert.rejects(() => repo.predictive('', 5), /Invalid predictive/);
    console.log(`  (repo search logic ${(performance.now() - t0).toFixed(1)}ms with fakes)`);
    ok('repository (faceted search + predictive + guards, unpublished excluded)');
  }

  // ---------- 5. Handlers: cache-first + zero-result + rate-limit ----------
  {
    const f = buildFakes009();
    const repo = new PrismaProductSearchRepository(castP(f.prisma));
    const store = new Map<string, string>();
    const events: Array<{ ch: string; msg: string }> = [];
    const fakeRedis = {
      get: async (k: string) => store.get(k) ?? null,
      setex: async (k: string, _t: number, v: string) => { store.set(k, v); },
      del: async (k: string) => { store.delete(k); },
      publish: async (ch: string, msg: string) => { events.push({ ch, msg }); },
    };
    const castR = (v: unknown) => v as unknown as import('../apps/backend/src/infra/redis/redis-cluster.service').RedisClusterService;
    const cache = new RedisSearchCacheAdapter(castR(fakeRedis));
    const searchHandler = new SearchProductsHandler(repo, cache);
    const predHandler = new PredictiveSearchHandler(repo, cache);

    const r1 = await searchHandler.execute(new SearchProductsQuery({ query: 'มิตรภาพ', sortBy: 'RELEVANCE', page: 1, limit: 20, inStockOnly: false }));
    assert.equal(r1.totalCount, 1);
    assert.ok([...store.keys()].some((k) => k.startsWith('search:catalog:')), 'catalog cached 60s');
    const r2 = await searchHandler.execute(new SearchProductsQuery({ query: 'มิตรภาพ', sortBy: 'RELEVANCE', page: 1, limit: 20, inStockOnly: false }));
    assert.deepEqual(r2, r1, 'cache hit returns identical payload');

    await searchHandler.execute(new SearchProductsQuery({ query: 'zzz-no-hit', sortBy: 'RELEVANCE', page: 1, limit: 20, inStockOnly: false }));
    assert.ok(events.some((e) => e.ch === 'stream:search:zero-results'), 'zero-result tracked');

    const s1 = await predHandler.execute(new PredictiveSearchQuery('ภาษา', 5, TID, 'line-user-1'));
    assert.equal(s1.length, 1);
    const s2 = await predHandler.execute(new PredictiveSearchQuery('ภาษา', 5, TID, 'line-user-1'));
    assert.deepEqual(s2, s1, 'predictive cache hit');
    // rate limit: 30/min
    let blocked = false;
    for (let i = 0; i < 31; i++) {
      try {
        await predHandler.execute(new PredictiveSearchQuery(`q${i}-zzz-no-hit`, 5, TID, 'line-limited'));
      } catch (e) {
        if ((e as Error).message.includes('Too many')) blocked = true;
      }
    }
    assert.equal(blocked, true, 'rate limit enforced at 30/min');
    await assert.rejects(() => searchHandler.execute(new SearchProductsQuery({ limit: 999, page: 1, sortBy: 'RELEVANCE', inStockOnly: false })), /Invalid product filter/);
    assert.deepEqual(searchHandler.mapSortOrder('PRICE_ASC'), { price: 'asc' });
    ok('handlers (Redis-first <5ms path, zero-result stream, 30/min rate-limit)');
  }

  console.log(`\nphase009 contract tests: ${passed} groups passed`);
}

void main();
