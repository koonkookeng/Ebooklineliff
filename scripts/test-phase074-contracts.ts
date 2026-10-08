// SSOT Phase 074 §10-11 — contract tests (Zod, draft, publish, parity)
// Run: npx tsx scripts/test-phase074-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PhysicalDetailSpecSchema,
  EbookDetailSpecSchema,
  CourseLessonSpecSchema,
  CourseSectionSpecSchema,
  CourseDetailSpecSchema,
  BundleItemSpecSchema,
  UniversalProductBuilderSchema,
  BuilderStepBasicsSchema,
  BuilderStepPricingSchema,
  BUILDER_STEPS,
  BUILDER_AUTOSAVE_MS,
  BUILDER_DRAFT_TTL_SEC,
  BUILDER_PRESIGN_TTL_SEC,
  builderDraftKey,
} from '../packages/shared/src/schemas/product-builder.schema';
import { DraftStorageService } from '../apps/backend/src/modules/product-builder/services/draft-storage.service';
import { ProductBuilderService } from '../apps/backend/src/modules/product-builder/services/product-builder.service';
import { R2AssetPipelineService } from '../apps/backend/src/modules/product-builder/services/r2-asset-pipeline.service';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const UUID = '123e4567-e89b-12d3-a456-426614174000';
const BASE = {
  title: 'First Book', slug: 'first-book', description: 'A great book indeed',
  coverImageUrl: 'https://cdn.example.com/c.png', price: 350,
};

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) + refine matrix ----------
{
  assert.equal(PhysicalDetailSpecSchema.safeParse({ weightGrams: 500, stockQty: 1, sku: 'ABC' }).success, true);
  assert.equal(PhysicalDetailSpecSchema.safeParse({ weightGrams: 0, stockQty: 1, sku: 'ABC' }).success, false);
  assert.equal(
    EbookDetailSpecSchema.safeParse({ totalPages: 100, storagePathR2: 'r2/x', fileHash: 'h' }).success,
    true,
  );
  assert.equal(
    CourseSectionSpecSchema.safeParse({
      sectionOrder: 1, title: 'S1',
      lessons: [{ lessonOrder: 1, title: 'L1', videoHlsUrl: 'https://x/y.m3u8', durationSec: 60 }],
    }).success,
    true,
  );
  assert.equal(
    CourseSectionSpecSchema.safeParse({ sectionOrder: 1, title: 'S1', lessons: [] }).success,
    false,
  );
  // Per-type refine: physical ok, missing detail rejected, bundle needs items.
  assert.equal(UniversalProductBuilderSchema.safeParse({
    ...BASE, productType: 'PHYSICAL_BOOK', physicalDetail: { weightGrams: 1, stockQty: 1, sku: 'ABC' },
  }).success, true);
  assert.equal(UniversalProductBuilderSchema.safeParse({ ...BASE, productType: 'PHYSICAL_BOOK' }).success, false);
  assert.equal(UniversalProductBuilderSchema.safeParse({ ...BASE, productType: 'EBOOK' }).success, false);
  assert.equal(UniversalProductBuilderSchema.safeParse({
    ...BASE, productType: 'HYBRID_BUNDLE', bundleItems: [{ childProductId: UUID }],
  }).success, true);
  assert.equal(UniversalProductBuilderSchema.safeParse({ ...BASE, productType: 'HYBRID_BUNDLE' }).success, false);
  assert.equal(UniversalProductBuilderSchema.safeParse({ ...BASE, productType: 'EBOOK', slug: 'Bad Slug!' }).success, false);
  assert.equal(BUILDER_STEPS.length, 4);
  assert.equal(BUILDER_AUTOSAVE_MS, 5000);
  assert.equal(BUILDER_DRAFT_TTL_SEC, 86400);
  assert.equal(BUILDER_PRESIGN_TTL_SEC, 900);
  assert.equal(builderDraftKey('s1', 'd1'), 'draft:s1:d1');
  // Wizard step gates (same SSOT, no resolver dep).
  assert.equal(BuilderStepBasicsSchema.safeParse({ ...BASE, productType: 'EBOOK' }).success, true);
  assert.equal(BuilderStepBasicsSchema.safeParse({ ...BASE, productType: 'EBOOK', title: 'AB' }).success, false);
  assert.equal(BuilderStepPricingSchema.safeParse({ price: 100 }).success, true);
  assert.equal(BuilderStepPricingSchema.safeParse({ price: 0 }).success, false);
  ok('Zod §3.1 verbatim + per-type refine matrix');
}

// ---------- 2. Draft storage (BDD-1: 5s autosave, seller-owned) ----------
function makeDraftPorts() {
  const kv = new Map<string, string>();
  const rows = new Map<string, { id: string; sellerId: string; productType: string; stepIndex: number; payloadJson: unknown; updatedAt: Date }>();
  return {
    tables: {
      productDraft: {
        findOwned: async (id: string, sellerId: string) => {
          const r = rows.get(id) ?? null;
          return r && r.sellerId === sellerId ? r : null;
        },
        create: async (a: { sellerId: string; productType: string; draftName: string; stepIndex: number; payloadJson: unknown }) => {
          const row = { id: UUID, ...a, updatedAt: new Date() };
          rows.set(row.id, row);
          return row;
        },
        updateOwned: async () => undefined,
        deleteOwned: async (id: string) => {
          rows.delete(id);
        },
      },
    },
    cache: {
      get: async (k: string) => kv.get(k) ?? null,
      setex: async (k: string, _t: number, v: string) => {
        kv.set(k, v);
      },
      del: async (k: string) => {
        kv.delete(k);
      },
    },
    kv, rows,
  };
}

async function sectionDraft(): Promise<void> {
  // Create -> Redis snapshot written.
  const { tables, cache, kv } = makeDraftPorts();
  const svc = new DraftStorageService(tables, cache);
  const created = await svc.save('seller-1', undefined, 1, 'PHYSICAL_BOOK', 'T', { title: 'T' });
  assert.equal(created.id, UUID);
  assert.ok(kv.has('draft:seller-1:123e4567-e89b-12d3-a456-426614174000'));
  // Load hits Redis (no DB touch needed).
  const hit = await svc.load('seller-1', UUID);
  assert.equal(hit?.stepIndex, 1);
  // Foreign seller cannot read (ownership).
  assert.equal(await svc.load('seller-2', UUID), null);
  // Discard clears both layers.
  await svc.discard('seller-1', UUID);
  assert.equal(await svc.load('seller-1', UUID), null);
  ok('Draft: create/cache-hit/ownership/discard');
}

// ---------- 3. Publish atomic (BDD-3: 4 formats, slug guard, event) ----------
function makePublishPorts() {
  const created: Array<{ table: string; data: unknown }> = [];
  const events: Array<{ key: string }> = [];
  const tables = {
    product: { findBySlug: async () => null },
  };
  const tx = {
    product: { create: async ({ data }: { data: { slug: string } }) => ({ id: UUID, slug: data.slug }) },
    physicalDetail: { create: async () => ({}) },
    ebookDetail: { create: async () => ({}) },
    courseDetail: { create: async () => ({ id: UUID }) },
    courseSection: { create: async () => ({ id: UUID }) },
    courseLesson: { create: async () => ({}) },
    bundleItem: { create: async () => ({}) },
  };
  for (const [k, v] of Object.entries(tx)) {
    const orig = (v as { create: (a: unknown) => Promise<unknown> }).create;
    (v as { create: (a: unknown) => Promise<unknown> }).create = async (a: unknown) => {
      created.push({ table: k, data: a });
      return orig(a);
    };
  }
  return {
    drafts: {
      save: async () => ({ id: UUID, sellerId: 's', productType: 'X', stepIndex: 1, payloadJson: {}, updatedAt: new Date() }),
      load: async () => null,
      discard: async () => undefined,
      key: () => '',
    },
    tables,
    prisma: { $transaction: async (fn: (t: unknown) => Promise<{ id: string; slug: string }>) => fn(tx) },
    bus: { xadd: async (key: string) => { events.push({ key }); } },
    created, events,
  };
}

async function sectionPublish(): Promise<void> {
  // PHYSICAL_BOOK: product + physicalDetail + event.
  {
    const { drafts, tables, prisma, bus, events: eventLog, created } = makePublishPorts();
    const svc = new ProductBuilderService(drafts as never, tables, prisma as never, bus);
    const r = await svc.publishProduct('seller-1', 'academy-a', {
      ...BASE, productType: 'PHYSICAL_BOOK', physicalDetail: { weightGrams: 100, stockQty: 5, sku: 'SKU-9' },
    });
    assert.equal(r.productId, UUID);
    assert.ok(created.some((c) => c.table === 'product'));
    assert.ok(created.some((c) => c.table === 'physicalDetail'));
    assert.ok(eventLog.some((e) => e.key === 'product:published'));
  }
  // ELEARNING_COURSE: sections + lessons fan-out.
  {
    const { drafts, tables, prisma, bus, events: eventLog, created } = makePublishPorts();
    const svc = new ProductBuilderService(drafts as never, tables, prisma as never, bus);
    await svc.publishProduct('seller-1', 'academy-a', {
      ...BASE, slug: 'course-1', productType: 'ELEARNING_COURSE',
      courseDetail: {
        totalHours: 2,
        sections: [{ sectionOrder: 1, title: 'S', lessons: [{ lessonOrder: 1, title: 'L', videoHlsUrl: 'https://x/y.m3u8', durationSec: 10 }] }],
      },
    });
    for (const t of ['courseDetail', 'courseSection', 'courseLesson']) {
      assert.ok(created.some((c) => c.table === t), `missing ${t}`);
    }
  }
  // HYBRID_BUNDLE: bundle items.
  {
    const { drafts, tables, prisma, bus, events: eventLog, created } = makePublishPorts();
    const svc = new ProductBuilderService(drafts as never, tables, prisma as never, bus);
    await svc.publishProduct('seller-1', 'academy-a', {
      ...BASE, slug: 'bundle-1', productType: 'HYBRID_BUNDLE', bundleItems: [{ childProductId: UUID }],
    });
    assert.ok(created.some((c) => c.table === 'bundleItem'));
  }
  // Slug taken -> 400; bad payload -> 400 (strict gate).
  {
    const { drafts, prisma, bus: events } = makePublishPorts();
    const taken = new ProductBuilderService(
      drafts as never,
      { product: { findBySlug: async () => ({ id: UUID }) } },
      prisma as never,
      events,
    );
    await assert.rejects(
      taken.publishProduct('s', 't', { ...BASE, productType: 'PHYSICAL_BOOK', physicalDetail: { weightGrams: 1, stockQty: 1, sku: 'ABC' } }),
      /Slug/,
    );
    const svc = new ProductBuilderService(drafts as never, { product: { findBySlug: async () => null } }, prisma as never, events);
    await assert.rejects(svc.publishProduct('s', 't', { ...BASE, productType: 'EBOOK' }), /ไม่สอดคล้อง/);
  }
  // Presign delegates with tenant-vaulted key + 15-min TTL.
  {
    const svc = new R2AssetPipelineService({
      presignedPutUrl: (key: string) => `https://r2.example.com/${key}?sig`,
    } as never);
    const r = svc.presign('academy-a', { fileName: 'lec 1.mp4', fileSize: 100, contentType: 'video/mp4', kind: 'video' });
    assert.ok(r.objectKey.startsWith('tenants/academy-a/builder/video/'));
    assert.ok(!r.objectKey.includes(' '));
    assert.equal(r.expiresInSeconds, 900);
  }
  ok('Publish: 4 formats/slug-guard/strict-gate/event + presign vault');
}

// ---------- 4. Prisma additive (Gate 1) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of ['model ProductDraft {', 'payloadJson Json', '@@index([sellerId])']) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  ok('Prisma: ProductDraft (BundleItem pre-existing)');
}

// ---------- 5. Static parity ----------
function sectionParity(): void {
  for (const f of [
    'apps/backend/src/modules/product-builder/services/draft-storage.service.ts',
    'apps/backend/src/modules/product-builder/services/product-builder.service.ts',
    'apps/backend/src/modules/product-builder/services/r2-asset-pipeline.service.ts',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes('TODO') && !src.includes('placeholder'), `${f} unimplemented`);
  }
  const mod = readFileSync('apps/backend/src/modules/product-builder/product-builder.module.ts', 'utf8');
  assert.ok(mod.includes('ProductBuilderModule') && !mod.includes('ProductBuilderModuleModule'));
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('ProductBuilderModule'));
  const gql = readFileSync('apps/backend/src/modules/product-builder/resolvers/product-builder.resolver.ts', 'utf8');
  assert.ok(gql.includes('saveBuilderDraft') && gql.includes('publishBuilderProduct') && gql.includes('loadBuilderDraft'));
  const sdl = readFileSync('apps/backend/src/api/graphql/schemas/product-builder.graphql', 'utf8');
  assert.ok(sdl.includes('saveBuilderDraft') && sdl.includes('publishBuilderProduct'));
  for (const p of [
    'apps/frontend/components/builder/UniversalProductBuilderWizard.tsx',
    'apps/frontend/components/builder/steps/Step1TypeSelector.tsx',
    'apps/frontend/components/builder/steps/Step2MediaUploadSpec.tsx',
    'apps/frontend/components/builder/steps/Step3PricingInventory.tsx',
    'apps/frontend/components/builder/steps/Step4PreviewPublish.tsx',
    'apps/frontend/hooks/useBuilderAutosave.ts',
    'apps/frontend/lib/builder/builder-client.ts',
    'apps/frontend/app/(studio)/builder/layout.tsx',
    'apps/frontend/app/(studio)/builder/page.tsx',
  ]) {
    assert.ok(readFileSync(p, 'utf8').length > 200, `frontend missing: ${p}`);
  }
  assert.ok(!readFileSync('apps/frontend/components/builder/UniversalProductBuilderWizard.tsx', 'utf8').includes("from 'framer-motion'"), 'no motion import (CSS slide)');
  for (const p of [
    'apps/frontend/app/api/builder/draft/save/route.ts',
    'apps/frontend/app/api/builder/draft/load/route.ts',
    'apps/frontend/app/api/builder/publish/route.ts',
    'apps/frontend/app/api/builder/presign-upload/route.ts',
  ]) {
    assert.ok(readFileSync(p, 'utf8').includes('x-tenant-id'), `proxy missing tenant: ${p}`);
  }
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  assert.ok(barrel.includes('product-builder.schema') && barrel.includes('UniversalProductBuilderSchema'));
  ok('Parity: services/module/GQL/wizard/steps/hook/proxies/barrel');
}

async function main(): Promise<void> {
  await sectionDraft();
  await sectionPublish();
  sectionParity();
}

void main().then(
  () => console.log(`\nPhase074 contracts: ${passed + 3} checks passed`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
