// SSOT Phase 037 §10 — contract tests (Zod, repos, services, UI, wiring)
// Run: npx tsx scripts/test-phase037-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EbookChapterSchema,
  EbookDetailSchema,
  LessonQuizSchema,
  CourseLessonSchema,
  CourseSectionSchema,
  CourseDetailSchema,
  CreateEbookChapterSchema,
  CreateCourseLessonSchema,
  CurriculumQuerySchema,
  totalHoursOf,
  byLessonOrder,
  byOrderIndex,
} from '../packages/shared/src/schemas/ebook-course-contract';
import { EbookDetailRepository } from '../apps/backend/src/modules/catalog/repositories/ebook-detail.repository';
import { CourseDetailRepository } from '../apps/backend/src/modules/catalog/repositories/course-detail.repository';
import { EbookStructureService } from '../apps/backend/src/modules/catalog/services/ebook-structure.service';
import { CourseStructureService } from '../apps/backend/src/modules/catalog/services/course-structure.service';
import type { PrismaService } from '../apps/backend/src/infra/database/prisma.service';
// NOTE: CatalogStructureController uses Nest parameter decorators (@Query/@Body)
// which tsx/esbuild cannot transform — verified via static source parity (§6)
// following the Phase 027–036 precedent.

let passed = 0;
function ok(name: string) {
  passed++;
  console.log(`  ✓ ${name}`);
}

// ---------- 1. Zod hierarchy + ordering helpers (§3.1 Gate 1) ----------
{
  const chapter = { id: 'c1', ebookId: 'e1', chapterIndex: 2, title: 'บทที่ 2', chunkCount: 12, chunkR2Prefix: 'vault/ebooks/p/chunks/ch-2' };
  assert.equal(EbookChapterSchema.safeParse(chapter).success, true);
  assert.equal(EbookChapterSchema.safeParse({ ...chapter, chapterIndex: 0 }).success, false);
  assert.equal(EbookDetailSchema.safeParse({ id: 'e1', productId: 'p', totalPages: 300, storagePathR2: 'vault/ebooks/p', fileHash: 'h', chapters: [chapter] }).success, true);
  assert.equal(EbookDetailSchema.safeParse({ id: 'e1', productId: 'p', totalPages: 0, storagePathR2: 'x', fileHash: 'h' }).success, false);
  const quiz = { id: 'q1', lessonId: 'l1', question: 'Q?', optionsJson: { A: '1', B: '2' }, answerKey: 'A' };
  assert.equal(LessonQuizSchema.safeParse(quiz).success, true);
  assert.equal(LessonQuizSchema.safeParse({ ...quiz, answerKey: '' }).success, false);
  const lesson = { id: 'l1', sectionId: 's1', lessonOrder: 1, title: 'L1', videoHlsUrl: 'https://cdn.example.com/m.m3u8', durationSec: 600, quizzes: [quiz] };
  assert.equal(CourseLessonSchema.safeParse(lesson).success, true);
  assert.equal(CourseLessonSchema.safeParse({ ...lesson, videoHlsUrl: 'not-url' }).success, false);
  assert.equal(CourseSectionSchema.safeParse({ id: 's1', courseId: 'c1', sectionOrder: 1, title: 'S1', lessons: [lesson] }).success, true);
  assert.equal(CourseDetailSchema.safeParse({ id: 'c1', productId: 'p', totalHours: 2.5 }).success, true);
  assert.equal(CreateEbookChapterSchema.safeParse({ ebookId: 'e', title: 'T', chunkR2Prefix: 'k' }).success, true);
  assert.equal(CreateCourseLessonSchema.safeParse({ sectionId: 's', title: 'T', videoHlsUrl: 'https://cdn.example.com/m.m3u8' }).success, true);
  assert.equal(CurriculumQuerySchema.safeParse({ productId: 'p' }).success, true);
  assert.equal(CurriculumQuerySchema.safeParse({ productId: '' }).success, false);

  assert.equal(totalHoursOf([3600, 1800, 900]), 1.75);
  assert.equal(totalHoursOf([]), 0);
  assert.equal(totalHoursOf([600, -5, NaN]), 0.17);
  assert.deepEqual([{ lessonOrder: 3 }, { lessonOrder: 1 }, { lessonOrder: 2 }].sort(byLessonOrder).map((l) => l.lessonOrder), [1, 2, 3]);
  assert.deepEqual([{ order: 2 }, { order: 1 }].sort(byOrderIndex).map((l) => l.order), [1, 2]);
  ok('Zod 6 schemas + create/query intents + hours/order helpers');
}

async function main(): Promise<void> {
// ---------- 2. Repositories: ordered reads + server-assigned indexes ----------
{
  const prisma = {
    ebookDetail: { findFirst: async () => ({ id: 'ebook-1' }) },
    ebookChapter: {
      findMany: async () => [
        { id: 'c2', ebookId: 'ebook-1', chapterIndex: 2, title: 'B', chunkCount: 1, chunkR2Prefix: 'k2' },
        { id: 'c1', ebookId: 'ebook-1', chapterIndex: 1, title: 'A', chunkCount: 1, chunkR2Prefix: 'k1' },
      ],
      create: async (a: unknown) => ({ id: 'c9', ...((a as { data: object }).data as object) }),
      aggregate: async () => ({ _max: { chapterIndex: 2 } }),
    },
  } as unknown as PrismaService;
  const erepo = new EbookDetailRepository(prisma);
  const chapters = await erepo.listChaptersByProduct('PROD-1');
  assert.deepEqual(chapters.map((c) => c.chapterIndex), [2, 1]);
  assert.equal(await erepo.nextChapterIndex('ebook-1'), 3);
  const createdRow = (await erepo.createChapter({ ebookId: 'e', chapterIndex: 1, title: 'T', chunkCount: 0, chunkR2Prefix: 'k' })) as { title: string; chapterIndex: number };
  assert.equal(createdRow.title, 'T');
  assert.equal(createdRow.chapterIndex, 1);
  const empty = new EbookDetailRepository({
    ebookDetail: { findFirst: async () => null },
    ebookChapter: { findMany: async () => [], aggregate: async () => ({ _max: { chapterIndex: null } }) },
  } as unknown as PrismaService);
  assert.deepEqual(await empty.listChaptersByProduct('GHOST'), []);
  assert.equal(await empty.nextChapterIndex('e'), 1);

  const cprisma = {
    courseDetail: { findFirst: async () => ({ id: 'course-1' }) },
    courseSection: {
      findMany: async () => [{ id: 's1', sectionOrder: 1, title: 'S1' }],
      create: async (a: unknown) => ({ id: 's9', ...(a as object) }),
      aggregate: async () => ({ _max: { sectionOrder: 1 } }),
    },
    courseLesson: {
      findMany: async () => [{ id: 'l1', sectionId: 's1', lessonOrder: 1, title: 'L1', videoHlsUrl: 'u', durationSec: 600, isPreview: true }],
      create: async (a: unknown) => ({ id: 'l9', ...(a as { data: object }).data }),
      update: async () => ({}),
      aggregate: async () => ({ _max: { lessonOrder: 1 } }),
    },
  } as unknown as PrismaService;
  const crepo = new CourseDetailRepository(cprisma);
  const tree = await crepo.curriculumByProduct('PROD-9');
  assert.equal(tree.length, 1);
  assert.equal(tree[0].lessons[0].title, 'L1');
  assert.equal(await crepo.nextSectionOrder('course-1'), 2);
  assert.equal(await crepo.nextLessonOrder('s1'), 2);
  const created = (await crepo.createLesson({ sectionId: 's1', lessonOrder: 2, title: 'L2', videoHlsUrl: 'u', durationSec: 0, isPreview: false })) as { lessonOrder: number };
  assert.equal(created.lessonOrder, 2);
  await crepo.moveLesson('l1', 5);
  const ghost = new CourseDetailRepository({ courseDetail: { findFirst: async () => null } } as unknown as PrismaService);
  assert.deepEqual(await ghost.curriculumByProduct('GHOST'), []);
  ok('Repos ordered TOC/curriculum + next-index + create/move; unknown→empty');
}

// ---------- 3. Services: server-assigned order + 409 races + atomic reorder ----------
{
  const p2002 = () => {
    const e = new Error('Unique') as Error & { code?: string };
    e.code = 'P2002';
    return e;
  };
  const ebookPrisma = {
    ebookDetail: { findFirst: async () => ({ id: 'ebook-1' }) },
    ebookChapter: {
      findMany: async () => [],
      create: async (a: unknown) => ({ id: 'c9', ...((a as { data: object }).data as object) }),
      aggregate: async () => ({ _max: { chapterIndex: 2 } }),
    },
  } as unknown as PrismaService;
  const esvc = new EbookStructureService(new EbookDetailRepository(ebookPrisma));
  const created = (await esvc.createChapter({ ebookId: 'ebook-1', title: 'T', chunkCount: 0, chunkR2Prefix: 'k' })) as { chapterIndex: number };
  assert.equal(created.chapterIndex, 3);
  const racePrisma = {
    ebookDetail: { findFirst: async () => ({ id: 'ebook-1' }) },
    ebookChapter: {
      findMany: async () => [],
      create: async () => { throw p2002(); },
      aggregate: async () => ({ _max: { chapterIndex: 8 } }),
    },
  } as unknown as PrismaService;
  const raceSvc = new EbookStructureService(new EbookDetailRepository(racePrisma));
  await assert.rejects(() => raceSvc.createChapter({ ebookId: 'ebook-1', title: 'T', chunkCount: 0, chunkR2Prefix: 'k' }), /retry append/);
  await assert.rejects(() => esvc.createChapter({ ebookId: '', title: 'T', chunkR2Prefix: 'k' }), /Invalid chapter/);
  await assert.rejects(() => esvc.tocByProduct(''), /Missing product/);

  const p2003 = () => {
    const e = new Error('FK') as Error & { code?: string };
    e.code = 'P2003';
    return e;
  };
  const txOps: unknown[] = [];
  const coursePrisma = {
    courseDetail: { findFirst: async () => ({ id: 'course-1' }) },
    courseSection: { findMany: async () => [], create: async () => ({ id: 's' }), aggregate: async () => ({ _max: { sectionOrder: 0 } }) },
    courseLesson: {
      findMany: async (a: unknown) => {
        const where = (a as { where?: { sectionId?: string } }).where;
        if (where?.sectionId === 's1') return [{ id: 'l1' }, { id: 'l2' }];
        return [];
      },
      create: async (a: unknown) => ({ id: 'l9', ...((a as { data: object }).data as object) }),
      update: async () => ({}),
      aggregate: async () => ({ _max: { lessonOrder: 0 } }),
    },
    $transaction: async (ops: unknown[]) => { txOps.push(...ops); return ops; },
  } as unknown as PrismaService;
  const csvc = new CourseStructureService(new CourseDetailRepository(coursePrisma), coursePrisma);
  const lesson = (await csvc.createLesson({ sectionId: 's1', title: 'L', videoHlsUrl: 'https://cdn.example.com/m.m3u8' })) as { lessonOrder: number };
  assert.equal(lesson.lessonOrder, 1);
  const fkSvc = new CourseStructureService(
    new CourseDetailRepository({
      courseLesson: { aggregate: async () => ({ _max: { lessonOrder: 0 } }), create: async () => { throw p2003(); } },
    } as unknown as PrismaService),
    coursePrisma,
  );
  await assert.rejects(() => fkSvc.createLesson({ sectionId: 'ghost', title: 'L', videoHlsUrl: 'https://cdn.example.com/m.m3u8' }), /Section not found/);
  const dupSvc = new CourseStructureService(
    new CourseDetailRepository({
      courseLesson: { aggregate: async () => ({ _max: { lessonOrder: 4 } }), create: async () => { throw p2002(); } },
    } as unknown as PrismaService),
    coursePrisma,
  );
  await assert.rejects(() => dupSvc.createLesson({ sectionId: 's1', title: 'L', videoHlsUrl: 'https://cdn.example.com/m.m3u8' }), /retry append/);
  await assert.rejects(() => csvc.createLesson({ sectionId: '', title: 'L', videoHlsUrl: 'https://cdn.example.com/m.m3u8' }), /Invalid lesson/);

  txOps.length = 0;
  await csvc.reorderLessons('s1', [{ id: 'l1', newOrder: 2 }, { id: 'l2', newOrder: 1 }]);
  assert.equal(txOps.length, 2);
  await assert.rejects(() => csvc.reorderLessons('s1', [{ id: 'l1', newOrder: 1 }, { id: 'foreign', newOrder: 2 }]), /does not belong/);
  await assert.rejects(() => csvc.reorderLessons('s1', [{ id: 'l1', newOrder: 1 }, { id: 'l1', newOrder: 1 }]), /Duplicate/);
  await assert.rejects(() => csvc.reorderLessons('s1', [{ id: 'l1', newOrder: 0 }]), /Invalid reorder entry/);
  await assert.rejects(() => csvc.reorderLessons('', [{ id: 'l1', newOrder: 1 }]), /Missing section/);
  await assert.rejects(() => csvc.reorderLessons('s1', []), /Invalid reorder payload/);

  const tree = await csvc.curriculumByProduct('PROD-1');
  assert.equal(tree.productId, 'PROD-1');
  assert.equal(typeof tree.totalHours, 'number');
  await assert.rejects(() => csvc.curriculumByProduct(''), /Missing product/);
  ok('Services assign order server-side; 409/404 races; atomic reorder guards; hours rollup');
}

// ---------- 4. Hook + proxies + middleware source parity (5 states, sorting) ----------
{
  const hook = readFileSync('apps/frontend/hooks/use-course-curriculum.ts', 'utf8');
  for (const t of ['LIFF_INIT', 'IDLE', 'LOADING', 'SUCCESS', 'ERROR', 'sortCurriculum', 'useEbookToc', '/api/v1/catalog/structure/course', '/api/v1/catalog/structure/ebook']) {
    assert.ok(hook.includes(t), `hook missing ${t}`);
  }
  for (const [f, marker] of [
    ['apps/frontend/app/api/v1/catalog/structure/course/route.ts', '/api/v1/catalog/structure/course'],
    ['apps/frontend/app/api/v1/catalog/structure/ebook/route.ts', 'Missing product id'],
  ] as Array<[string, string]>) {
    assert.ok(readFileSync(f, 'utf8').includes(marker), `${f} missing ${marker}`);
  }
  const mw = readFileSync('apps/frontend/middleware.ts', 'utf8');
  assert.ok(mw.includes("'/api/v1/catalog/structure/'"));
  ok('Hook 5-state + TOC/curriculum sorts; proxies route; middleware bypass');
}

// ---------- 5. Prisma + SDL + module wiring + controller/DTO parity ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of ['model LessonQuiz', 'quizzes', 'optionsJson', 'answerKey', '@@index([lessonId])', '@@unique([ebookId, chapterIndex])', '@@unique([courseId, sectionOrder])', '@@unique([sectionId, lessonOrder])']) {
    assert.ok(prisma.includes(t), `prisma missing ${t}`);
  }
  const sdl = readFileSync('apps/backend/src/api/graphql/schemas/catalog-structure.graphql/schema.graphql', 'utf8');
  for (const t of ['EbookDetail', 'EbookChapter', 'CourseDetail', 'CourseSection', 'CourseLesson', 'LessonQuiz', 'ebookToc', 'courseCurriculum']) {
    assert.ok(sdl.includes(t), `SDL missing ${t}`);
  }
  const mod = readFileSync('apps/backend/src/modules/catalog/catalog.module.ts', 'utf8');
  for (const t of ['EbookStructureService', 'CourseStructureService', 'CatalogStructureController', 'EbookDetailRepository', 'CourseDetailRepository']) {
    assert.ok(mod.includes(t), `module missing ${t}`);
  }
  const ctlSrc = readFileSync('apps/backend/src/modules/catalog/controllers/catalog-structure.controller.ts', 'utf8');
  for (const t of ['api/v1/catalog/structure', "'ebook'", "'course'", "'lessons/reorder'", 'JwtAuthGuard']) {
    assert.ok(ctlSrc.includes(t), `controller missing ${t}`);
  }
  for (const [f, marker] of [
    ['apps/backend/src/modules/catalog/dto/ebook-course.dto.ts', "from '@repo/shared'"],
    ['apps/backend/src/modules/catalog/dto/create-ebook-chapter.dto.ts', 'CreateEbookChapterSchema'],
    ['apps/backend/src/modules/catalog/dto/create-course-lesson.dto.ts', 'CreateCourseLessonSchema'],
  ] as Array<[string, string]>) {
    assert.ok(readFileSync(f, 'utf8').includes(marker), `${f} missing ${marker}`);
  }
  ok('Prisma hierarchy uniques; SDL intent; module wired; controller/DTO parity');
}

console.log(`\nPhase 037 contracts: ${passed} checks passed`);
}

void main();
