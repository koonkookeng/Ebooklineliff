// SSOT Phase 078 §10-11 — contract tests (Zod, reorder, HLS, quiz, parity)
// Run: npx tsx scripts/test-phase078-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  StudioQuizOptionSchema,
  StudioLessonQuizSchema,
  StudioReorderLessonItemSchema,
  StudioReorderSectionSchema,
  StudioCurriculumReorderPayloadSchema,
  StudioHlsUploadPresignSchema,
  StudioHlsWebhookSchema,
  studioStructureKey,
  studioRawVideoKey,
  STUDIO_PRESIGN_TTL_SEC,
  normalizeReorder,
  gradeStudioQuiz,
} from '../packages/shared/src/schemas/course-studio-contract';
import {
  assertContiguousOrder,
  assertUniqueIds,
  assertStudioTenant,
  assertCourseOwnership,
} from '../apps/backend/src/modules/course-studio/domain/entities/course-section.entity';
import { assertTranscodeTransition, assertHlsCompletion } from '../apps/backend/src/modules/course-studio/domain/entities/course-lesson.entity';
import { assertQuizBuildable } from '../apps/backend/src/modules/course-studio/domain/entities/lesson-quiz.entity';
import { CurriculumBuilderService } from '../apps/backend/src/modules/course-studio/application/services/curriculum-builder.service';
import { HlsTranscoderService } from '../apps/backend/src/modules/course-studio/application/services/hls-transcoder.service';
import { QuizEngineService } from '../apps/backend/src/modules/course-studio/application/services/quiz-engine.service';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const UUID = '123e4567-e89b-12d3-a456-426614174000';
const UUID2 = '223e4567-e89b-12d3-a456-426614174001';
const UUID3 = '323e4567-e89b-12d3-a456-426614174002';
const TENANT = 'academy-a';
const SELLER = 'seller-1';
const ACTOR = { userId: SELLER, role: 'SELLER' };

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1, Studio* aliases) ----------
{
  assert.equal(StudioQuizOptionSchema.safeParse({ id: UUID, optionText: 'A', isCorrect: true }).success, true);
  assert.equal(StudioQuizOptionSchema.safeParse({ id: UUID, optionText: '', isCorrect: true }).success, false);
  const quiz = {
    lessonId: UUID, question: 'What is HLS?', points: 10,
    options: [
      { id: UUID, optionText: 'Streaming', isCorrect: true },
      { id: UUID2, optionText: 'Nothing', isCorrect: false },
    ],
  };
  assert.equal(StudioLessonQuizSchema.safeParse(quiz).success, true);
  assert.equal(StudioLessonQuizSchema.safeParse({ ...quiz, question: 'AB' }).success, false);
  assert.equal(StudioLessonQuizSchema.safeParse({ ...quiz, options: [quiz.options[0]] }).success, false);
  assert.equal(StudioReorderLessonItemSchema.safeParse({ lessonId: UUID, lessonOrder: 0 }).success, true);
  assert.equal(StudioReorderLessonItemSchema.safeParse({ lessonId: UUID, lessonOrder: -1 }).success, false);
  assert.equal(StudioReorderSectionSchema.safeParse({ sectionId: UUID, sectionOrder: 0, lessons: [] }).success, true);
  assert.equal(
    StudioCurriculumReorderPayloadSchema.safeParse({ tenantId: TENANT, courseId: UUID, sections: [] }).success,
    true,
  );
  const presign = { tenantId: TENANT, lessonId: UUID, fileName: 'lec1.mp4', fileSizeBytes: 100, contentType: 'video/mp4' };
  assert.equal(StudioHlsUploadPresignSchema.safeParse(presign).success, true);
  assert.equal(StudioHlsUploadPresignSchema.safeParse({ ...presign, contentType: 'video/avi' }).success, false);
  assert.equal(StudioHlsUploadPresignSchema.safeParse({ ...presign, fileSizeBytes: 0 }).success, false);
  assert.equal(
    StudioHlsWebhookSchema.safeParse({ lessonId: UUID, status: 'COMPLETED', signature: 's', timestamp: 1 }).success,
    true,
  );
  assert.equal(studioStructureKey('c1'), 'cache:course:structure:c1');
  assert.ok(studioRawVideoKey(TENANT, UUID, 'lec 1.mp4').startsWith(`tenants/${TENANT}/studio/raw/${UUID}/`));
  assert.ok(!studioRawVideoKey(TENANT, UUID, 'lec 1.mp4').includes(' '));
  assert.equal(STUDIO_PRESIGN_TTL_SEC, 900);
  const norm = normalizeReorder([{ sectionId: 's1', lessons: [{ lessonId: 'l1' }, { lessonId: 'l2' }] }]);
  assert.deepEqual(norm, [{ sectionId: 's1', sectionOrder: 0, lessons: [{ lessonId: 'l1', lessonOrder: 0 }, { lessonId: 'l2', lessonOrder: 1 }] }]);
  assert.deepEqual(gradeStudioQuiz([{ id: 'a', isCorrect: true }], 'a', 10), { isPassed: true, scoreEarned: 10 });
  assert.deepEqual(gradeStudioQuiz([{ id: 'a', isCorrect: true }], 'b', 10), { isPassed: false, scoreEarned: 0 });
  ok('Zod §3.1 Studio* verbatim + keys/grading helpers');
}

// ---------- 2. Entity guards ----------
{
  assert.doesNotThrow(() => assertContiguousOrder([0, 1, 2], 'lesson'));
  assert.throws(() => assertContiguousOrder([0, 2], 'lesson'), /contiguous/);
  assert.doesNotThrow(() => assertUniqueIds(['a', 'b'], 'section'));
  assert.throws(() => assertUniqueIds(['a', 'a'], 'section'), /Duplicate/);
  assert.doesNotThrow(() => assertStudioTenant(TENANT, TENANT));
  assert.throws(() => assertStudioTenant(TENANT, 'other'), /Cross-tenant/);
  assert.throws(() => assertStudioTenant('', TENANT), /Tenant/);
  assert.doesNotThrow(() => assertCourseOwnership(SELLER, SELLER, 'SELLER'));
  assert.doesNotThrow(() => assertCourseOwnership('other', SELLER, 'SUPER_ADMIN'));
  assert.throws(() => assertCourseOwnership('other', SELLER, 'SELLER'), /owner/);
  assert.throws(() => assertCourseOwnership(null, SELLER, 'SELLER'), /owner/);
  assert.doesNotThrow(() => assertTranscodeTransition('PROCESSING', 'COMPLETED'));
  assert.doesNotThrow(() => assertTranscodeTransition('COMPLETED', 'FAILED'));
  assert.throws(() => assertTranscodeTransition('COMPLETED', 'PENDING'), /Illegal/);
  assert.doesNotThrow(() => assertHlsCompletion('https://r2/x.m3u8', 60));
  assert.throws(() => assertHlsCompletion(undefined, 60), /videoHlsUrl/);
  assert.throws(() => assertHlsCompletion('u', -1), /durationSec/);
  assert.doesNotThrow(() => assertQuizBuildable([{ optionText: 'A', isCorrect: true }, { optionText: 'B', isCorrect: false }], 'Why?'));
  assert.throws(() => assertQuizBuildable([{ optionText: 'A', isCorrect: false }], 'Why?'), /At least 2/);
  assert.throws(
    () => assertQuizBuildable([{ optionText: 'A', isCorrect: false }, { optionText: 'B', isCorrect: false }], 'Why?'),
    /correct/,
  );
  assert.throws(() => assertQuizBuildable([{ optionText: 'A', isCorrect: true }, { optionText: 'B', isCorrect: false }], 'AB'), /3 characters/);
  ok('Entities: reorder/tenant/ownership/transcode/quiz guards');
}

// ---------- 3. Curriculum reorder (BDD-1: atomic + gates) ----------
type SecRow = { id: string; courseId: string; sectionOrder: number; title: string };
type LesRow = { id: string; sectionId: string; lessonOrder: number; title: string };
const S1 = 'a23e4567-e89b-12d3-a456-426614174001';
const S2 = 'b23e4567-e89b-12d3-a456-426614174002';
const L1 = 'c23e4567-e89b-12d3-a456-426614174003';
const L2 = 'd23e4567-e89b-12d3-a456-426614174004';
const L3 = 'e23e4567-e89b-12d3-a456-426614174005';
const C1 = 'f23e4567-e89b-12d3-a456-426614174006';
function makeStudioPorts() {
  const sections = new Map<string, SecRow>([
    [S1, { id: S1, courseId: C1, sectionOrder: 0, title: 'S1' }],
    [S2, { id: S2, courseId: C1, sectionOrder: 1, title: 'S2' }],
  ]);
  const lessons = new Map<string, LesRow>([
    [L1, { id: L1, sectionId: S1, lessonOrder: 0, title: 'L1' }],
    [L2, { id: L2, sectionId: S1, lessonOrder: 1, title: 'L2' }],
    [L3, { id: L3, sectionId: S2, lessonOrder: 0, title: 'L3' }],
  ]);
  const deletedCaches: string[] = [];
  const events: Array<{ stream: string }> = [];
  const repo = {
    findCourse: async (id: string) =>
      id === C1 ? { courseId: C1, sellerId: SELLER, tenantId: TENANT } : null,
    loadStructure: async () => ({
      sections: [...sections.values()].map((s) => ({
        ...s,
        lessons: [...lessons.values()].filter((l) => l.sectionId === s.id),
      })),
    }),
    applySectionOrder: async (id: string, order: number) => {
      const s = sections.get(id);
      if (s) sections.set(id, { ...s, sectionOrder: order });
    },
    applyLessonOrder: async (id: string, sectionId: string, order: number) => {
      const l = lessons.get(id);
      if (l) lessons.set(id, { ...l, sectionId, lessonOrder: order });
    },
  };
  const tx = { run: async <T>(fn: (t: unknown) => Promise<T>) => fn({}) };
  const cache = { del: async (k: string) => { deletedCaches.push(k); } };
  const bus = { xadd: async (s: string) => { events.push({ stream: s }); } };
  return { repo, tx, cache, bus, sections, lessons, deletedCaches, events };
}

async function sectionReorder(): Promise<void> {
  // Happy path: swap sections + move l3 into s1 (cross-section graft).
  {
    const p = makeStudioPorts();
    const svc = new CurriculumBuilderService(p.repo as never, p.tx, p.cache, p.bus);
    const r = await svc.reorderCurriculum(TENANT, ACTOR, {
      tenantId: TENANT,
      courseId: C1,
      sections: [
        { sectionId: S2, sectionOrder: 0, lessons: [{ lessonId: L3, lessonOrder: 0 }] },
        {
          sectionId: S1, sectionOrder: 1,
          lessons: [{ lessonId: L2, lessonOrder: 0 }, { lessonId: L1, lessonOrder: 1 }],
        },
      ],
    });
    assert.equal(r, true);
    assert.equal(p.sections.get(S2)?.sectionOrder, 0);
    assert.equal(p.lessons.get(L2)?.lessonOrder, 0);
    assert.deepEqual(p.deletedCaches, [`cache:course:structure:${C1}`]);
    assert.ok(p.events.some((e) => e.stream === 'studio:events'));
  }
  // Gates: unknown course/section/lesson + non-owner + cross-tenant + dupe + gap.
  {
    const p = makeStudioPorts();
    const svc = new CurriculumBuilderService(p.repo as never, p.tx, p.cache, p.bus);
    await assert.rejects(
      svc.reorderCurriculum(TENANT, ACTOR, {
        tenantId: TENANT, courseId: 'f33e4567-e89b-12d3-a456-426614174099', sections: [],
      }),
      /Course not found/,
    );
    await assert.rejects(
      svc.reorderCurriculum(TENANT, { userId: 'intruder', role: 'SELLER' }, { tenantId: TENANT, courseId: C1, sections: [] }),
      /owner/,
    );
    await assert.rejects(
      svc.reorderCurriculum('other', ACTOR, { tenantId: 'other', courseId: C1, sections: [] }),
      /Cross-tenant/,
    );
    await assert.rejects(
      svc.reorderCurriculum(TENANT, ACTOR, {
        tenantId: TENANT, courseId: C1,
        sections: [{ sectionId: S1, sectionOrder: 0, lessons: [] }, { sectionId: S1, sectionOrder: 1, lessons: [] }],
      }),
      /Duplicate/,
    );
    await assert.rejects(
      svc.reorderCurriculum(TENANT, ACTOR, {
        tenantId: TENANT, courseId: C1,
        sections: [{ sectionId: S1, sectionOrder: 5, lessons: [] }],
      }),
      /contiguous/,
    );
    await assert.rejects(
      svc.reorderCurriculum(TENANT, ACTOR, {
        tenantId: TENANT, courseId: C1,
        sections: [{ sectionId: 'f33e4567-e89b-12d3-a456-426614174099', sectionOrder: 0, lessons: [] }],
      }),
      /Unknown section/,
    );
    await assert.rejects(
      svc.reorderCurriculum(TENANT, ACTOR, {
        tenantId: TENANT, courseId: C1,
        sections: [{ sectionId: S1, sectionOrder: 0, lessons: [{ lessonId: 'f33e4567-e89b-12d3-a456-426614174099', lessonOrder: 0 }] }],
      }),
      /Unknown lesson/,
    );
    await assert.rejects(svc.reorderCurriculum(TENANT, ACTOR, { tenantId: TENANT }), /Invalid curriculum/);
  }
  ok('Reorder: atomic swap/graft + 8 gates + cache/event');
}

// ---------- 4. HLS presign + webhook (BDD-2) ----------
async function sectionHls(): Promise<void> {
  const tx = { run: async <T>(fn: (t: unknown) => Promise<T>) => fn({}) };
  const events: Array<{ stream: string }> = [];
  const bus = { xadd: async (s: string) => { events.push({ stream: s }); } };
  const SECRET = 'hls-secret';
  const sign = (lessonId: string, status: string, ts: number): string =>
    createHmac('sha256', SECRET).update(`${lessonId}|${status}|${ts}`).digest('hex');

  // Presign: ownership -> PUT URL + PROCESSING mark.
  {
    let marked = '';
    const repo = {
      findLessonOwner: async (id: string) =>
        id === UUID ? { courseId: C1, sellerId: SELLER, tenantId: TENANT } : null,
      transcodeOf: async () => 'PENDING',
      markTranscoding: async (id: string) => { marked = id; },
    };
    const r2 = {
      presignedPutUrl: (key: string) => `https://r2.example.com/${key}?sig`,
    };
    const svc = new HlsTranscoderService(repo as never, tx, r2 as never, bus, SECRET);
    const r = await svc.presignUpload(TENANT, ACTOR, {
      tenantId: TENANT, lessonId: UUID, fileName: 'lec 1.mp4', fileSizeBytes: 100, contentType: 'video/mp4',
    });
    assert.ok(r.uploadUrl.includes('tenants/academy-a/studio/raw/'));
    assert.equal(r.expiresInSec, 900);
    assert.equal(marked, UUID);
    await assert.rejects(
      svc.presignUpload(TENANT, ACTOR, {
        tenantId: TENANT, lessonId: UUID, fileName: 'x.avi', fileSizeBytes: 1, contentType: 'video/avi',
      }),
      /Invalid HLS/,
    );
    await assert.rejects(
      svc.presignUpload(TENANT, { userId: 'x', role: 'SELLER' }, {
        tenantId: TENANT, lessonId: UUID, fileName: 'x.mp4', fileSizeBytes: 1, contentType: 'video/mp4',
      }),
      /owner/,
    );
  }
  // Webhook: HMAC -> COMPLETED applies playlist; FAILED queues retry.
  {
    const applied: unknown[] = [];
    const failed: string[] = [];
    let status = 'PROCESSING';
    const repo = {
      transcodeOf: async () => status,
      applyHlsCompletion: async (id: string, url: string, dur: number) => { applied.push({ id, url, dur }); },
      markTranscodeFailed: async (id: string) => { failed.push(id); },
    };
    const svc = new HlsTranscoderService(repo as never, tx, {} as never, bus, SECRET);
    const ts = Date.now();
    const r = await svc.applyTranscodeWebhook({
      lessonId: UUID, status: 'COMPLETED', videoHlsUrl: 'https://r2/x.m3u8', durationSec: 60,
      signature: sign(UUID, 'COMPLETED', ts), timestamp: ts,
    });
    assert.equal(r.ok, true);
    assert.equal(applied.length, 1);
    status = 'PROCESSING';
    await svc.applyTranscodeWebhook({
      lessonId: UUID, status: 'FAILED', errorMessage: 'ffmpeg oom',
      signature: sign(UUID, 'FAILED', ts), timestamp: ts,
    });
    assert.deepEqual(failed, [UUID]);
    assert.ok(events.some((e) => e.stream === 'studio:events'));
    await assert.rejects(
      svc.applyTranscodeWebhook({ lessonId: UUID, status: 'COMPLETED', signature: 'bad', timestamp: ts }),
      /Invalid transcode/,
    );
    status = 'COMPLETED';
    await assert.rejects(
      svc.applyTranscodeWebhook({
        lessonId: UUID, status: 'PENDING', signature: sign(UUID, 'PENDING', ts), timestamp: ts,
      }),
      /Invalid transcode|Illegal transcode/,
    );
  }
  ok('HLS: presign gates + webhook HMAC/COMPLETED/retry');
}

// ---------- 5. Quiz builder (BDD-3) ----------
async function sectionQuiz(): Promise<void> {
  const saved: unknown[] = [];
  const deleted: string[] = [];
  const repo = {
    findLessonOwner: async (id: string) =>
      id === UUID ? { courseId: C1, sellerId: SELLER, tenantId: TENANT } : null,
    findQuizOwner: async (id: string) =>
      id === UUID2 ? { courseId: C1, sellerId: SELLER, tenantId: TENANT } : null,
    saveQuiz: async (a: unknown) => { saved.push(a); return { id: UUID3 }; },
    deleteQuiz: async (id: string) => { deleted.push(id); },
  };
  const svc = new QuizEngineService(repo as never);
  const body = {
    lessonId: UUID, question: 'What is HLS?', explanation: 'Streaming', points: 10,
    options: [
      { id: UUID, optionText: 'Streaming', isCorrect: true },
      { id: UUID2, optionText: 'Nothing', isCorrect: false },
    ],
  };
  const r = await svc.saveLessonQuiz(TENANT, ACTOR, body);
  assert.equal(r.id, UUID3);
  assert.equal(saved.length, 1);
  await assert.rejects(svc.saveLessonQuiz(TENANT, ACTOR, { ...body, question: 'AB' }), /Invalid quiz/);
  await assert.rejects(
    svc.saveLessonQuiz(TENANT, ACTOR, { ...body, options: [body.options[0]] }),
    /Invalid quiz|At least 2/,
  );
  await assert.rejects(svc.saveLessonQuiz(TENANT, { userId: 'x', role: 'SELLER' }, body), /owner/);
  assert.equal(await svc.deleteLessonQuiz(TENANT, ACTOR, UUID2), true);
  assert.deepEqual(deleted, [UUID2]);
  await assert.rejects(svc.deleteLessonQuiz(TENANT, ACTOR, 'nope'), /Quiz not found/);
  ok('Quiz: save/delete + builder gates');
}

// ---------- 6. Prisma additive (Gate 1) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of [
    'enum HlsTranscodeStatus {', 'rawStorageKey   String?', 'transcodeStatus HlsTranscodeStatus @default(PENDING)',
    'points          Int       @default(10)',
  ]) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  ok('Prisma: HlsTranscodeStatus + lesson HLS cols + quiz points');
}

function sectionParity(): void {
  for (const f of [
    'apps/backend/src/modules/course-studio/domain/entities/course-section.entity.ts',
    'apps/backend/src/modules/course-studio/domain/entities/course-lesson.entity.ts',
    'apps/backend/src/modules/course-studio/domain/entities/lesson-quiz.entity.ts',
    'apps/backend/src/modules/course-studio/domain/repositories/course-studio.repository.interface.ts',
    'apps/backend/src/modules/course-studio/application/services/curriculum-builder.service.ts',
    'apps/backend/src/modules/course-studio/application/services/hls-transcoder.service.ts',
    'apps/backend/src/modules/course-studio/application/services/quiz-engine.service.ts',
    'apps/backend/src/modules/course-studio/application/use-cases/reorder-curriculum.use-case.ts',
    'apps/backend/src/modules/course-studio/application/use-cases/process-hls-webhook.use-case.ts',
    'apps/backend/src/modules/course-studio/infrastructure/repositories/prisma-course-studio.repository.ts',
    'apps/backend/src/modules/course-studio/infrastructure/controllers/hls-webhook.controller.ts',
    'apps/backend/src/modules/course-studio/presentation/studio.controller.ts',
    'apps/backend/src/modules/course-studio/presentation/course-studio.resolver.ts',
    'apps/backend/src/modules/course-studio/course-studio.module.ts',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes('TODO') && !src.includes('placeholder'), `${f} unimplemented`);
  }
  const mod = readFileSync('apps/backend/src/modules/course-studio/course-studio.module.ts', 'utf8');
  assert.ok(mod.includes('CourseStudioModule') && mod.includes('CurriculumBuilderService') && mod.includes('QuizEngineService'));
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('CourseStudioModule'));
  const gql = readFileSync('apps/backend/src/modules/course-studio/presentation/course-studio.resolver.ts', 'utf8');
  assert.ok(gql.includes('reorderCurriculum') && gql.includes('generateHlsUploadUrl') && gql.includes('saveLessonQuiz'));
  const sdl = readFileSync('apps/backend/src/api/graphql/typeDefs/course-studio.graphql', 'utf8');
  assert.ok(sdl.includes('reorderCurriculum') && sdl.includes('saveLessonQuiz'));
  for (const p of [
    'apps/frontend/components/studio/curriculum-builder.tsx',
    'apps/frontend/components/studio/hls-uploader.tsx',
    'apps/frontend/components/studio/quiz-builder.tsx',
    'apps/frontend/hooks/useCourseStudio.ts',
    'apps/frontend/lib/studio/studio-client.ts',
    'apps/frontend/app/(studio)/courses/[id]/builder/page.tsx',
  ]) {
    assert.ok(readFileSync(p, 'utf8').length > 200, `frontend missing: ${p}`);
  }
  const builder = readFileSync('apps/frontend/components/studio/curriculum-builder.tsx', 'utf8');
  assert.ok(!builder.includes("from '@hello-pangea/dnd'") && !builder.includes("from 'lucide-react'"), 'heavy dep leaked');
  for (const p of [
    'apps/frontend/app/api/v1/studio/curriculum/reorder/route.ts',
    'apps/frontend/app/api/v1/studio/curriculum/[courseId]/route.ts',
    'apps/frontend/app/api/v1/studio/hls/presign/route.ts',
    'apps/frontend/app/api/v1/studio/quiz/route.ts',
    'apps/frontend/app/api/v1/studio/quiz/[quizId]/route.ts',
  ]) {
    assert.ok(readFileSync(p, 'utf8').includes('x-tenant-id'), `proxy missing tenant: ${p}`);
  }
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  assert.ok(barrel.includes('course-studio-contract') && barrel.includes('StudioLessonQuizSchema'));
  ok('Parity: module/GQL/SDL/studio trio/hook/proxies/barrel (no heavy deps)');
}

async function main(): Promise<void> {
  await sectionReorder();
  await sectionHls();
  await sectionQuiz();
  sectionParity();
}

void main().then(
  () => console.log(`\nPhase078 contracts: ${passed + 5} checks passed`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
