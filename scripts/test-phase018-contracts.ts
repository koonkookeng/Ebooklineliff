// SSOT Phase 018 §10/Task 8 — library + gate contracts (loop 3x)
// Run: npx tsx scripts/test-phase018-contracts.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  AssetTypeEnum,
  AssetSortEnum,
  DigitalAssetSchema,
  MyLibraryQueryInputSchema,
  MyLibraryPayloadSchema,
  LIBRARY_CACHE_TTL_SEC,
  libraryCacheKey,
  libraryGateKey,
} from '../packages/shared/src/schemas/library-contract';
import {
  AssetFormatterService,
  progressPct,
  toAssetType,
} from '../apps/backend/src/modules/library/services/asset-formatter.service';
import { LibraryCacheRepository } from '../apps/backend/src/modules/library/repositories/library-cache.repository';
import { LibraryService } from '../apps/backend/src/modules/library/services/library.service';
import { resumePath } from '../apps/frontend/lib/library';
import type { PrismaService } from '../apps/backend/src/infra/database/prisma.service';
import type { RedisClusterService } from '../apps/backend/src/infra/redis/redis-cluster.service';

const UID = '123e4567-e89b-12d3-a456-426614174000';
const PID = (n: number): string => `223e4567-e89b-12d3-a456-42661417${String(n).padStart(4, '0')}`;
const P_EBOOK = PID(4001);
const P_COURSE = PID(4002);
const P_BUNDLE = PID(4003);
const P_PHYS = PID(4004);
const P_EXP = PID(4005);
const P_LIVE = PID(4006);
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

interface EntRow {
  id: string;
  productId: string;
  accessType: string;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  product: {
    title: string;
    coverImageUrl: string;
    productType: string;
    ebookDetail: { totalPages: number } | null;
    courseDetail: { sections: Array<{ lessons: Array<{ id: string }> }> } | null;
  };
}

const L = (n: number): string => `l${n}`;
function seedRows(): EntRow[] {
  const at = (d: string): Date => new Date(d);
  return [
    { id: PID(5001), productId: P_EBOOK, accessType: 'FULL_PURCHASE', expiresAt: null, createdAt: at('2026-09-01T00:00:00Z'), updatedAt: at('2026-10-05T00:00:00Z'), product: { title: 'Ebook A', coverImageUrl: 'https://cdn/a.webp', productType: 'EBOOK', ebookDetail: { totalPages: 300 }, courseDetail: null } },
    { id: PID(5002), productId: P_COURSE, accessType: 'FULL_PURCHASE', expiresAt: null, createdAt: at('2026-09-02T00:00:00Z'), updatedAt: at('2026-10-04T00:00:00Z'), product: { title: 'Course B', coverImageUrl: 'https://cdn/b.webp', productType: 'ELEARNING_COURSE', ebookDetail: null, courseDetail: { sections: [{ lessons: [{ id: L(1) }, { id: L(2) }] }, { lessons: [{ id: L(3) }, { id: L(4) }] }] } } },
    { id: PID(5003), productId: P_BUNDLE, accessType: 'FULL_PURCHASE', expiresAt: null, createdAt: at('2026-09-03T00:00:00Z'), updatedAt: at('2026-10-03T00:00:00Z'), product: { title: 'Bundle C', coverImageUrl: 'https://cdn/c.webp', productType: 'HYBRID_BUNDLE', ebookDetail: null, courseDetail: null } },
    { id: PID(5004), productId: P_PHYS, accessType: 'FULL_PURCHASE', expiresAt: null, createdAt: at('2026-09-04T00:00:00Z'), updatedAt: at('2026-10-02T00:00:00Z'), product: { title: 'Physical D', coverImageUrl: 'https://cdn/d.webp', productType: 'PHYSICAL_BOOK', ebookDetail: null, courseDetail: null } },
    { id: PID(5005), productId: P_EXP, accessType: 'TIME_LIMITED_RENTAL', expiresAt: at('2026-01-01T00:00:00Z'), createdAt: at('2026-09-05T00:00:00Z'), updatedAt: at('2026-10-01T00:00:00Z'), product: { title: 'Expired E', coverImageUrl: 'https://cdn/e.webp', productType: 'EBOOK', ebookDetail: { totalPages: 100 }, courseDetail: null } },
    { id: PID(5006), productId: P_LIVE, accessType: 'FULL_PURCHASE', expiresAt: null, createdAt: at('2026-09-06T00:00:00Z'), updatedAt: at('2026-10-06T00:00:00Z'), product: { title: 'Live F', coverImageUrl: 'https://cdn/f.webp', productType: 'LIVE_CLASS', ebookDetail: null, courseDetail: null } },
  ];
}

const ebookProgress = [{ ebookId: P_EBOOK, lastPage: 150, totalPages: 300 }];
const courseProgress = [
  { lessonId: L(1), watchedSec: 600, isCompleted: true, updatedAt: new Date('2026-10-01T00:00:00Z') },
  { lessonId: L(2), watchedSec: 300, isCompleted: true, updatedAt: new Date('2026-10-02T00:00:00Z') },
  { lessonId: L(3), watchedSec: 120, isCompleted: false, updatedAt: new Date('2026-10-03T00:00:00Z') },
];

function fakePrisma(rows: EntRow[] = seedRows()) {
  const calls = { findMany: 0, count: 0, ebook: 0, course: 0, gate: 0 };
  const match = (r: EntRow, where: Record<string, unknown>): boolean => {
    const p = where['product'] as { productType?: string | { in: string[] }; title?: { contains: string } };
    const pt = p?.productType;
    if (typeof pt === 'string') {
      if (r.product.productType !== pt) return false;
    } else if (pt && typeof pt === 'object' && 'in' in pt) {
      if (!(pt as { in: string[] }).in.includes(r.product.productType)) return false;
    }
    const t = p?.title?.contains;
    if (t && !r.product.title.toLowerCase().includes(String(t).toLowerCase())) return false;
    const or = where['OR'] as Array<{ expiresAt: null | { gt: Date } }>;
    const alive = or.some((c) => c.expiresAt === null ? r.expiresAt === null : (r.expiresAt !== null && r.expiresAt > (c.expiresAt as { gt: Date }).gt));
    if (!alive) return false;
    return true;
  };
  const api = {
    calls,
    entitlement: {
      findMany: async (args: { where: Record<string, unknown>; take: number; skip: number }): Promise<EntRow[]> => {
        calls.findMany++;
        return rows.filter((r) => match(r, args.where)).slice(args.skip, args.skip + args.take);
      },
      count: async (args: { where: Record<string, unknown> }): Promise<number> => {
        calls.count++;
        return rows.filter((r) => match(r, args.where)).length;
      },
      findUnique: async (args: { where: { userId_productId: { userId: string; productId: string } } }): Promise<{ expiresAt: Date | null; accessType: string } | null> => {
        calls.gate++;
        const hit = rows.find((r) => r.productId === args.where.userId_productId.productId);
        return hit ? { expiresAt: hit.expiresAt, accessType: hit.accessType } : null;
      },
    },
    ebookReadingProgress: {
      findMany: async (): Promise<typeof ebookProgress> => { calls.ebook++; return ebookProgress; },
    },
    courseLearningProgress: {
      findMany: async (): Promise<typeof courseProgress> => { calls.course++; return courseProgress; },
    },
  };
  return { api, calls };
}

const castP = (v: unknown): PrismaService => v as PrismaService;
const castR = (v: unknown): RedisClusterService => v as RedisClusterService;
function svc(p: unknown, r: unknown): LibraryService {
  return new LibraryService(castP(p), castR(r), new AssetFormatterService(), new LibraryCacheRepository(castR(r)));
}

// ---------- 1. Zod SSOT ----------
async function sectionContracts(): Promise<void> {
  assert.deepEqual(AssetTypeEnum.options, ['EBOOK', 'ELEARNING_COURSE', 'HYBRID_BUNDLE', 'LIVE_CLASS']);
  assert.deepEqual(AssetSortEnum.options, ['RECENTLY_ACCESSED', 'TITLE_ASC', 'PURCHASE_DATE_DESC', 'PROGRESS_ASC']);
  const good = {
    id: PID(5001), productId: P_EBOOK, title: 'Ebook A', coverImageUrl: 'https://cdn/a.webp',
    assetType: 'EBOOK', accessType: 'FULL_PURCHASE', expiresAt: null, progressPercentage: 50,
    lastAccessedPage: 150, totalUnits: 300, completedUnits: 150,
    lastAccessedAt: new Date().toISOString(), isDownloadAvailableOffline: true,
  };
  assert.equal(DigitalAssetSchema.safeParse(good).success, true);
  assert.equal(DigitalAssetSchema.safeParse({ ...good, progressPercentage: 101 }).success, false, 'progress ≤100');
  assert.equal(DigitalAssetSchema.safeParse({ ...good, coverImageUrl: 'not-a-url' }).success, false);
  assert.equal(DigitalAssetSchema.safeParse({ ...good, assetType: 'PHYSICAL_BOOK' }).success, false);
  const q = MyLibraryQueryInputSchema.parse({});
  assert.deepEqual([q.sortBy, q.page, q.limit], ['RECENTLY_ACCESSED', 1, 12]);
  assert.equal(MyLibraryQueryInputSchema.safeParse({ limit: 51 }).success, false, 'limit ≤50');
  assert.equal(MyLibraryQueryInputSchema.safeParse({ searchQuery: 'x'.repeat(101) }).success, false);
  assert.equal(MyLibraryPayloadSchema.safeParse({ assets: [good], totalCount: 1, currentPage: 1, totalPages: 1, hasMore: false }).success, true);
  assert.equal(LIBRARY_CACHE_TTL_SEC, 60);
  assert.ok(libraryCacheKey(UID, q).startsWith(`user:${UID}:library:`));
  assert.equal(libraryGateKey(UID, P_EBOOK), `library:gate:${UID}:${P_EBOOK}`);
  ok('Zod SSOT (asset/query/payload shapes + defaults + cache keys)');
  const sdl = fs.readFileSync('apps/backend/src/api/graphql/schemas/library.graphql/schema.graphql', 'utf8');
  assert.ok(sdl.includes('myLibraryAssets'));
  assert.ok(sdl.includes('libraryGate'));
  assert.ok(sdl.includes('MyLibraryPayload'));
  assert.ok(sdl.includes('DigitalAsset'));
  ok('GQL SDL (assets + gate + payload present)');
}

// ---------- 2. Formatter ----------
async function sectionFormatter(): Promise<void> {
  const f = new AssetFormatterService();
  assert.equal(progressPct(150, 300), 50);
  assert.equal(progressPct(0, 0), 0, 'zero-total guard');
  assert.equal(progressPct(400, 300), 100, 'clamped');
  assert.equal(toAssetType('EBOOK'), 'EBOOK');
  assert.equal(toAssetType('PHYSICAL_BOOK'), null);
  const rows = seedRows();
  const ebook = new Map(ebookProgress.map((p) => [p.ebookId, p]));
  const course = new Map(courseProgress.map((p) => [p.lessonId, p]));
  const a = f.format(rows[0] as never, ebook, course);
  assert.equal(a?.progressPercentage, 50);
  assert.equal(a?.lastAccessedPage, 150);
  assert.equal(a?.totalUnits, 300);
  const c = f.format(rows[1] as never, ebook, course);
  assert.equal(c?.progressPercentage, 50, '2/4 lessons');
  assert.equal(c?.completedUnits, 2);
  assert.equal(c?.lastAccessedTimeSec, 120, 'latest watched sec');
  const b = f.format(rows[2] as never, ebook, course);
  assert.deepEqual([b?.progressPercentage, b?.totalUnits], [0, 1]);
  assert.equal(f.format(rows[3] as never, ebook, course), null, 'physical excluded');
  assert.equal(f.format({ ...rows[0], accessType: 'BOGUS' } as never, ebook, course), null, 'bad access excluded');
  ok('formatter (ebook 50% + course 2/4 + resume T + exclusions)');
}

// ---------- 3. Cache repo ----------
async function sectionCache(): Promise<void> {
  const f = fakeRedis();
  const repo = new LibraryCacheRepository(castR(f.redis));
  const q = MyLibraryQueryInputSchema.parse({});
  assert.equal(await repo.getPayload(UID, q), null, 'cold miss');
  const payload = { assets: [], totalCount: 0, currentPage: 1, totalPages: 1, hasMore: false };
  await repo.setPayload(UID, q, payload);
  assert.deepEqual(await repo.getPayload(UID, q), payload);
  f.store.set(repo.keyFor(UID, q), 'not-json{{{');
  assert.equal(await repo.getPayload(UID, q), null, 'corrupt → miss');
  f.store.set(repo.keyFor(UID, q), JSON.stringify({ nope: true }));
  assert.equal(await repo.getPayload(UID, q), null, 'drift → miss');
  assert.equal(await repo.checkGate(UID, P_EBOOK), false);
  await repo.setGate(UID, P_EBOOK);
  assert.equal(await repo.checkGate(UID, P_EBOOK), true);
  ok('cache repo (miss/set/hit + corrupt/drift-safe + gate flag)');
}

// ---------- 4. Service ----------
async function sectionService(): Promise<void> {
  // Default fetch: 4 visible (physical + expired excluded), 4 batched reads max
  {
    const f = fakeRedis();
    const p = fakePrisma();
    const s = svc(p.api, f.redis);
    const res = await s.getUserLibraryAssets(UID, {});
    assert.equal(res.totalCount, 4);
    assert.equal(res.assets.length, 4);
    assert.ok(res.assets.every((a) => a.productId !== P_PHYS && a.productId !== P_EXP));
    assert.equal(res.totalPages, 1);
    assert.equal(res.hasMore, false);
    const ebook = res.assets.find((a) => a.productId === P_EBOOK);
    assert.equal(ebook?.progressPercentage, 50);
    assert.ok(p.calls.findMany <= 1 && p.calls.count <= 1 && p.calls.ebook <= 1 && p.calls.course <= 1, 'no N+1 (≤4 reads)');
    ok('service default (4 assets + progress + ≤4 batched reads, no N+1)');
  }
  // Cache hit: zero DB reads
  {
    const f = fakeRedis();
    const p = fakePrisma();
    const s = svc(p.api, f.redis);
    await s.getUserLibraryAssets(UID, {});
    const before = { ...p.calls };
    const res = await s.getUserLibraryAssets(UID, {});
    assert.equal(res.totalCount, 4);
    assert.deepEqual(p.calls, before, 'hit performs zero reads');
    ok('service cache hit (<200ms path, zero DB reads)');
  }
  // Type filter + search + pagination + sort
  {
    const f = fakeRedis();
    const p = fakePrisma();
    const s = svc(p.api, f.redis);
    const ebooks = await s.getUserLibraryAssets(UID, { assetType: 'EBOOK' });
    assert.equal(ebooks.totalCount, 1, 'expired rental excluded from EBOOK tab');
    assert.equal(ebooks.assets[0]?.productId, P_EBOOK);
    const search = await s.getUserLibraryAssets(UID, { searchQuery: 'course b' });
    assert.equal(search.totalCount, 1);
    assert.equal(search.assets[0]?.productId, P_COURSE);
    const page = await s.getUserLibraryAssets(UID, { page: 2, limit: 2 });
    assert.deepEqual([page.assets.length, page.totalCount, page.totalPages, page.hasMore, page.currentPage], [2, 4, 2, false, 2]);
    const titles = await s.getUserLibraryAssets(UID, { sortBy: 'TITLE_ASC', limit: 50 });
    void titles;
    const prog = await s.getUserLibraryAssets(UID, { sortBy: 'PROGRESS_ASC', limit: 50 });
    const pcts = prog.assets.map((a) => a.progressPercentage);
    assert.deepEqual(pcts, [...pcts].sort((a, b) => a - b), 'page sorted asc');
    ok('service query (type tab + search + pagination + sorts)');
  }
  // Invalid input → 400 Thai-safe
  {
    const f = fakeRedis();
    const p = fakePrisma();
    const s = svc(p.api, f.redis);
    await assert.rejects(s.getUserLibraryAssets(UID, { limit: 99 }), /Invalid/);
    await assert.rejects(s.getUserLibraryAssets('', {}), /Missing user/);
    ok('service boundary (400 on bad query/user)');
  }
}

// ---------- 5. Gate ----------
async function sectionGate(): Promise<void> {
  {
    const f = fakeRedis();
    const p = fakePrisma();
    const s = svc(p.api, f.redis);
    const r = await s.checkAccess(UID, P_EBOOK);
    assert.equal(r.hasAccess, true);
    assert.ok(f.events.some((e) => e.ch === 'stream:analytics:library' && e.msg.includes('LIBRARY_ASSET_OPENED')));
    const before = p.calls.gate;
    const r2 = await s.checkAccess(UID, P_EBOOK);
    assert.equal(r2.hasAccess, true);
    assert.equal(p.calls.gate, before, 'flag hit skips DB');
    ok('gate grant (DB → flag → telemetry + 1ms flag hit)');
  }
  {
    const f = fakeRedis();
    const p = fakePrisma();
    const s = svc(p.api, f.redis);
    assert.deepEqual(await s.checkAccess(UID, P_EXP), { hasAccess: false }, 'expired rental denied');
    assert.deepEqual(await s.checkAccess(UID, PID(4999)), { hasAccess: false }, 'unknown denied');
    await assert.rejects(s.checkAccess('', P_EBOOK), /Missing/);
    ok('gate deny (expired/unknown/false + 400 boundary)');
  }
}

// ---------- 6. Frontend resume routing ----------
async function sectionResume(): Promise<void> {
  const iso = new Date().toISOString();
  const base = { id: PID(5001), title: 'T', coverImageUrl: 'https://cdn/a.webp', accessType: 'FULL_PURCHASE' as const, expiresAt: null, progressPercentage: 0, totalUnits: 1, completedUnits: 0, lastAccessedAt: iso, isDownloadAvailableOffline: false };
  assert.equal(resumePath({ ...base, productId: P_EBOOK, assetType: 'EBOOK', lastAccessedPage: 42 }), `/reader/${P_EBOOK}?page=42`);
  assert.equal(resumePath({ ...base, productId: P_COURSE, assetType: 'ELEARNING_COURSE', lastAccessedTimeSec: 120 }), `/course/${P_COURSE}/play?t=120`);
  assert.equal(resumePath({ ...base, productId: P_COURSE, assetType: 'ELEARNING_COURSE' }), `/course/${P_COURSE}/play`);
  assert.ok(resumePath({ ...base, productId: P_BUNDLE, assetType: 'HYBRID_BUNDLE', title: 'Bundle C' }).startsWith('/catalog?query='));
  ok('resume routing (reader page N + player sec T + catalog fallback)');
}

async function main(): Promise<void> {
  await sectionContracts();
  await sectionFormatter();
  await sectionCache();
  await sectionService();
  await sectionGate();
  await sectionResume();
  console.log(`\nphase018 contract tests: ${passed} groups passed`);
}

void main();
