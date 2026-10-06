// SSOT Phase 023 §10 — contract tests (dynamic header: Zod, edge cache, SDL, layout)
// Run: npx tsx scripts/test-phase023-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  HeaderDisplayModeEnum,
  DynamicHeaderPayloadSchema,
  DynamicHeaderInputSchema,
} from '../packages/shared/src/schemas/header-contract';
import { HeaderService } from '../apps/backend/src/modules/header/header.service';
import type { PrismaService } from '../apps/backend/src/infra/database/prisma.service';
import type { RedisClusterService } from '../apps/backend/src/infra/redis/redis-cluster.service';

let passed = 0;
function ok(name: string) {
  passed++;
  console.log(`  ✓ ${name}`);
}

// ---------- 1. DisplayMode enum (5 values, §3.1) ----------
{
  const modes = ['DEFAULT_STORE', 'EBOOK_READER', 'ELEARNING_LESSON', 'LIVE_STREAM', 'CHECKOUT_FLOW'];
  for (const mode of modes) assert.equal(HeaderDisplayModeEnum.safeParse(mode).success, true);
  assert.equal(HeaderDisplayModeEnum.safeParse('READER').success, false);
  assert.equal(HeaderDisplayModeEnum.options.length, 5);
  ok('HeaderDisplayModeEnum accepts 5 modes, rejects unknown');
}

// ---------- 2. Payload defaults (§3.1) ----------
{
  const parsed = DynamicHeaderPayloadSchema.safeParse({
    tenantId: 'default', displayMode: 'EBOOK_READER', mainTitle: 'ศาสตร์การเล่าเรื่อง',
  });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.brandColor, '#000000');
    assert.equal(parsed.data.showBackButton, true);
    assert.deepEqual(parsed.data.actionIcons, []);
    assert.equal(parsed.data.subtitle, undefined);
  }
  const full = DynamicHeaderPayloadSchema.safeParse({
    tenantId: 'default', displayMode: 'EBOOK_READER', mainTitle: 'ศาสตร์การเล่าเรื่อง',
    subtitle: 'บทที่ 2: กลยุทธ์การสะกดใจ', progressPercentage: 45,
    brandColor: '#8B5CF6', showBackButton: true, backToUrl: '/library',
    actionIcons: [{ id: 'share', iconName: 'Share2', actionIntent: 'TRIGGER_LINE_FLEX_SHARE' }],
  });
  assert.equal(full.success, true);
  ok('Payload applies brand/back/icons defaults, accepts full BDD shape');
}

// ---------- 3. Payload boundaries (§3.1 + XSS-adjacent length guards) ----------
{
  const base = { tenantId: 'default', displayMode: 'EBOOK_READER' as const, mainTitle: 'T' };
  assert.equal(DynamicHeaderPayloadSchema.safeParse({ ...base, mainTitle: '' }).success, false);
  assert.equal(DynamicHeaderPayloadSchema.safeParse({ ...base, mainTitle: 'x'.repeat(121) }).success, false);
  assert.equal(DynamicHeaderPayloadSchema.safeParse({ ...base, brandColor: 'red' }).success, false);
  assert.equal(DynamicHeaderPayloadSchema.safeParse({ ...base, brandColor: '#GGGGGG' }).success, false);
  assert.equal(DynamicHeaderPayloadSchema.safeParse({ ...base, progressPercentage: 101 }).success, false);
  assert.equal(DynamicHeaderPayloadSchema.safeParse({ ...base, progressPercentage: -1 }).success, false);
  assert.equal(DynamicHeaderPayloadSchema.safeParse({ ...base, tenantId: '' }).success, false);
  ok('Payload rejects empty/oversize title, bad color, out-of-range progress');
}

// ---------- 4. Input schema (§3.2 mutation/query args) ----------
{
  assert.equal(DynamicHeaderInputSchema.safeParse({ productId: 'p1' }).success, true);
  assert.equal(
    DynamicHeaderInputSchema.safeParse({ productId: 'p1', chapterOrLessonId: 'c1', customTitle: 'T' }).success,
    true,
  );
  assert.equal(DynamicHeaderInputSchema.safeParse({ productId: '' }).success, false);
  assert.equal(DynamicHeaderInputSchema.safeParse({}).success, false);
  ok('Input requires productId, optional chapter/customTitle');
}

async function main(): Promise<void> {
// ---------- 5. Service cache-hit path: zero DB touch (<5ms target, §5.2) ----------
{
  const payload = {
    tenantId: 'default', displayMode: 'EBOOK_READER', mainTitle: 'Cached Book',
    brandColor: '#0284C7', showBackButton: true, actionIcons: [],
  };
  let prismaCalls = 0;
  const redis = {
    get: async () => JSON.stringify(payload),
    setex: async () => undefined,
    del: async () => undefined,
  } as unknown as RedisClusterService;
  const prisma = {
    product: { findUnique: async () => { prismaCalls++; return null; } },
  } as unknown as PrismaService;
  const svc = new HeaderService(prisma, redis);
  const out = await svc.getHeaderContext('p1', 'c1');
  assert.equal(out.mainTitle, 'Cached Book');
  assert.equal(prismaCalls, 0);
  ok('Cache hit returns without DB (edge <5ms path)');
}

// ---------- 6. Service cache-miss: EBOOK chapter subtitle + 1h persist (§5.2/BDD) ----------
{
  const writes: Array<{ key: string; ttl: number }> = [];
  const redis = {
    get: async () => null,
    setex: async (key: string, ttl: number) => { writes.push({ key, ttl }); },
    del: async () => undefined,
  } as unknown as RedisClusterService;
  const prisma = {
    product: {
      findUnique: async () => ({
        id: 'p1', tenantId: 'default', sellerId: 'seller-1', title: 'ศาสตร์การเล่าเรื่อง',
        productType: 'EBOOK', headerConfig: null,
        ebookDetail: { chapters: [{ id: 'c2', chapterIndex: 2, title: 'กลยุทธ์การสะกดใจ' }] },
        courseDetail: null,
      }),
    },
  } as unknown as PrismaService;
  const svc = new HeaderService(prisma, redis);
  const out = await svc.getHeaderContext('p1', 'c2');
  assert.equal(out.displayMode, 'EBOOK_READER');
  assert.equal(out.mainTitle, 'ศาสตร์การเล่าเรื่อง');
  assert.equal(out.subtitle, 'บทที่ 2: กลยุทธ์การสะกดใจ');
  assert.equal(out.actionIcons.length, 2);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].ttl, 3600);
  assert.equal(writes[0].key, 'header:ctx:p1:c2');
  ok('Cache miss computes chapter subtitle + persists 1h edge entry');
}

// ---------- 7. Service variants: lesson search, LIVE, override, 404 (§5.2) ----------
{
  const redis = {
    get: async () => null, setex: async () => undefined, del: async () => undefined,
  } as unknown as RedisClusterService;
  const courseProduct = {
    id: 'p2', tenantId: 'acme', sellerId: 'seller-2', title: 'AI Prompt Engineering',
    productType: 'ELEARNING_COURSE', headerConfig: null, ebookDetail: null,
    courseDetail: {
      sections: [{ title: 'Advanced', lessons: [{ id: 'l3', title: 'Lesson 3: Advanced System Prompts' }] }],
    },
  };
  const prisma = {
    product: { findUnique: async () => courseProduct },
    headerConfig: { upsert: async () => ({}) },
  } as unknown as PrismaService;
  const svc = new HeaderService(prisma, redis);
  const lesson = await svc.getHeaderContext('p2', 'l3');
  assert.equal(lesson.displayMode, 'ELEARNING_LESSON');
  assert.equal(lesson.subtitle, 'Advanced - Lesson 3: Advanced System Prompts');
  assert.equal(lesson.tenantId, 'acme');

  const liveProduct = { ...courseProduct, productType: 'LIVE_CLASS', courseDetail: null };
  const prismaLive = {
    product: { findUnique: async () => liveProduct },
    headerConfig: { upsert: async () => ({}) },
  } as unknown as PrismaService;
  const live = await new HeaderService(prismaLive, redis).getHeaderContext('p9');
  assert.equal(live.displayMode, 'LIVE_STREAM');

  const overrideProduct = {
    ...courseProduct, headerConfig: { customHeaderTitle: 'Custom', overrideBrandColor: '#8B5CF6' },
  };
  const prismaOverride = {
    product: { findUnique: async () => overrideProduct },
    headerConfig: { upsert: async () => ({}) },
  } as unknown as PrismaService;
  const overridden = await new HeaderService(prismaOverride, redis).getHeaderContext('p2');
  assert.equal(overridden.mainTitle, 'Custom');
  assert.equal(overridden.brandColor, '#8B5CF6');

  const prismaEmpty = { product: { findUnique: async () => null } } as unknown as PrismaService;
  await assert.rejects(() => new HeaderService(prismaEmpty, redis).getHeaderContext('ghost'));
  await assert.rejects(() => new HeaderService(prismaEmpty, redis).getHeaderContext(''));
  ok('Lesson search + LIVE mode + config override + 404/invalid guards');
}

// ---------- 8. SDL parity + (liff) layout wiring (§3.2 + §9) ----------
{
  const sdl = readFileSync('apps/backend/src/api/graphql/schemas/header.graphql/schema.graphql', 'utf8');
  for (const mode of HeaderDisplayModeEnum.options) assert.ok(sdl.includes(mode), `SDL missing ${mode}`);
  assert.ok(sdl.includes('getHeaderContext(productId: ID!, chapterOrLessonId: String)'));
  assert.ok(sdl.includes('updateHeaderContext(input: DynamicHeaderInput!)'));
  const layout = readFileSync('apps/frontend/app/(liff)/layout.tsx', 'utf8');
  assert.ok(layout.includes('DynamicHeaderIntegrator'));
  ok('GraphQL SDL mirrors Zod enum + layout mounts integrator');
}

console.log(`\nPhase 023 contracts: ${passed}/8 groups passed`);
}

void main();
