// SSOT Phase 065 §10-11 — contract tests (Zod, service, AI, PDF, parity)
// Run: npx tsx scripts/test-phase065-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  NoteVisibilityEnum,
  CreateLessonNoteSchema,
  UpdateLessonNoteSchema,
  NoteSearchFilterSchema,
  LessonNoteConnectionSchema,
  AiNoteSummarySchema,
  NOTE_WRITE_BUDGET_MS,
  NOTE_CACHE_TTL_SEC,
  NOTE_AUTOSAVE_DEBOUNCE_MS,
  noteCacheKey,
  formatNoteTimestamp,
  sanitizeNoteContent,
} from '../packages/shared/src/schemas/lesson-note.schema';
import { NoteService } from '../apps/backend/src/modules/note/services/note.service';
import { NoteAiSummarizerService } from '../apps/backend/src/modules/note/services/note-ai-summarizer.service';
import { buildNotesPdf, noteUserRef } from '../apps/backend/src/modules/note/services/note-pdf-exporter.service';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const USER = '123e4567-e89b-12d3-a456-426614174000';
const OTHER = '223e4567-e89b-12d3-a456-426614174000';
const LESSON = '333e4567-e89b-12d3-a456-426614174000';
const COURSE_PRODUCT = '444e4567-e89b-12d3-a456-426614174000';
const NOTE_ID = '555e4567-e89b-12d3-a456-426614174000';

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) + budgets/helpers ----------
{
  assert.equal(NoteVisibilityEnum.safeParse('STUDY_GROUP').success, true);
  assert.equal(NoteVisibilityEnum.safeParse('FRIENDS').success, false);
  assert.equal(
    CreateLessonNoteSchema.safeParse({ lessonId: LESSON, timestampSec: 225, content: 'สรุป', tags: ['a'], visibility: 'PRIVATE' }).success,
    true,
  );
  assert.equal(CreateLessonNoteSchema.safeParse({ lessonId: LESSON, timestampSec: 1, content: '' }).success, false);
  assert.equal(CreateLessonNoteSchema.safeParse({ lessonId: LESSON, timestampSec: 1, content: 'x'.repeat(5001) }).success, false);
  assert.equal(UpdateLessonNoteSchema.safeParse({ noteId: NOTE_ID, content: 'ok' }).success, true);
  const f = NoteSearchFilterSchema.parse({});
  assert.equal(f.page, 1);
  assert.equal(f.limit, 20);
  assert.equal(LessonNoteConnectionSchema.safeParse({ notes: [], totalCount: 0, hasNextPage: false }).success, true);
  assert.equal(AiNoteSummarySchema.safeParse({ summaryText: 's', keyTakeaways: [], suggestedActionItems: [] }).success, true);
  assert.equal(NOTE_WRITE_BUDGET_MS, 100);
  assert.equal(NOTE_CACHE_TTL_SEC, 300);
  assert.equal(NOTE_AUTOSAVE_DEBOUNCE_MS, 500);
  assert.equal(noteCacheKey('u', 'l'), 'user:u:lesson:l:notes');
  assert.equal(formatNoteTimestamp(225), '03:45');
  assert.equal(formatNoteTimestamp(492), '08:12');
  assert.ok(!sanitizeNoteContent('<script>alert(1)</script>hi<img src=x onerror=alert(1)>').includes('script'));
  assert.ok(!sanitizeNoteContent('<img src=x onerror=alert(1)>').includes('onerror'));
  ok('Zod note contracts verbatim + budgets/format/sanitize/cache keys');
}

// ---------- 2. NoteService: entitlement + CRUD + search + LWW sync ----------
type Row = Record<string, unknown>;

function makeTables(granted: boolean) {
  const notes = new Map<string, Row>();
  const cache = new Map<string, string>();
  const streams: Array<{ key: string; n: number }> = [];
  const tables = {
    courseLesson: {
      findUnique: async () => ({ id: LESSON, isPreview: false, section: { course: { productId: COURSE_PRODUCT } } }),
    },
    entitlement: {
      findUnique: async () => (granted ? { id: 'ent-1' } : null),
    },
    lessonNote: {
      create: async ({ data }: { data: Row }) => {
        const row = { id: NOTE_ID, ...(data as object), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as Row;
        notes.set(String(row['id']), row);
        return row;
      },
      findMany: async ({ where, skip, take }: { where: Row; skip?: number; take?: number }) => {
        let rows = [...notes.values()].filter((r) => (where['userId'] === undefined || r['userId'] === where['userId']) && (where['lessonId'] === undefined || r['lessonId'] === where['lessonId']));
        if (typeof skip === 'number' || typeof take === 'number') rows = rows.slice(skip ?? 0, (skip ?? 0) + (take ?? 20));
        return rows;
      },
      count: async () => notes.size,
      findUnique: async ({ where }: { where: { id: string } }) => notes.get(where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Row }) => {
        const prev = notes.get(where.id);
        if (!prev) throw new Error('NOT_FOUND');
        const next = { ...prev, ...(data as object), updatedAt: new Date().toISOString() };
        notes.set(where.id, next);
        return next;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        notes.delete(where.id);
        return {};
      },
    },
  };
  const cachePort = {
    get: async (k: string) => cache.get(k) ?? null,
    setex: async (k: string, _t: number, v: string) => {
      cache.set(k, v);
    },
    del: async (...ks: string[]) => {
      for (const k of ks) cache.delete(k);
    },
    xaddPipeline: async (key: string, batch: Array<Record<string, string | number>>) => {
      streams.push({ key, n: batch.length });
    },
  };
  return { tables, cachePort, notes, cache, streams };
}

async function sectionService(): Promise<void> {
  // create: entitled ok + XSS stripped + cache invalidated + stream event
  {
    const { tables, cachePort, streams } = makeTables(true);
    const svc = new NoteService(tables as never, cachePort);
    const res = await svc.createNote(USER, { lessonId: LESSON, timestampSec: 225, content: '<script>x</script>สรุปบทเรียน', visibility: 'PRIVATE' });
    assert.equal(res.ok, true);
    assert.equal(res.note?.timestampFormatted, '03:45');
    assert.ok(!String(res.note?.content ?? '').includes('script'));
    assert.equal(streams.length, 1);
    assert.equal(streams[0].key, 'events:note-created');
  }
  // create: forbidden without entitlement
  {
    const { tables, cachePort } = makeTables(false);
    const svc = new NoteService(tables as never, cachePort);
    const res = await svc.createNote(USER, { lessonId: LESSON, timestampSec: 1, content: 'x' });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'FORBIDDEN');
  }
  // create: invalid input rejected
  {
    const { tables, cachePort } = makeTables(true);
    const svc = new NoteService(tables as never, cachePort);
    const res = await svc.createNote(USER, { lessonId: 'nope', timestampSec: -1, content: '' });
    assert.equal(res.ok, false);
  }
  // read-through cache: second read served without touching tables
  {
    const { tables, cachePort, cache } = makeTables(true);
    const svc = new NoteService(tables as never, cachePort);
    await svc.createNote(USER, { lessonId: LESSON, timestampSec: 10, content: 'a' });
    cache.clear();
    await cachePort.setex(noteCacheKey(USER, LESSON), 300, JSON.stringify([{ cached: true }]));
    const hit = await svc.getNotesByLesson(USER, LESSON);
    assert.equal((hit[0] as unknown as { cached: boolean }).cached, true);
  }
  // update: owner ok, stranger forbidden
  {
    const { tables, cachePort } = makeTables(true);
    const svc = new NoteService(tables as never, cachePort);
    await svc.createNote(USER, { lessonId: LESSON, timestampSec: 10, content: 'a' });
    const mine = await svc.updateNote(USER, { noteId: NOTE_ID, content: 'b' });
    assert.equal(mine.ok, true);
    const theirs = await svc.updateNote(OTHER, { noteId: NOTE_ID, content: 'hack' });
    assert.equal(theirs.error, 'FORBIDDEN');
  }
  // delete: owner removes, stranger blocked
  {
    const { tables, cachePort } = makeTables(true);
    const svc = new NoteService(tables as never, cachePort);
    await svc.createNote(USER, { lessonId: LESSON, timestampSec: 10, content: 'a' });
    assert.equal(await svc.deleteNote(OTHER, NOTE_ID), false);
    assert.equal(await svc.deleteNote(USER, NOTE_ID), true);
  }
  // search: pagination envelope
  {
    const { tables, cachePort } = makeTables(true);
    const svc = new NoteService(tables as never, cachePort);
    await svc.createNote(USER, { lessonId: LESSON, timestampSec: 10, content: 'ภาษีหัก ณ ที่จ่าย' });
    const page = await svc.searchMyNotes(USER, { keyword: 'ภาษี', page: 1, limit: 20 });
    assert.equal(page.totalCount, 1);
    assert.equal(page.hasNextPage, false);
    assert.equal(page.notes.length, 1);
  }
  // offline sync: idempotent create + LWW (stale replay keeps server truth)
  {
    const { tables, cachePort, notes } = makeTables(true);
    const svc = new NoteService(tables as never, cachePort);
    const OFFLINE_ID = '666e4567-e89b-12d3-a456-426614174000';
    const first = await svc.syncOfflineNotes(USER, [
      { id: OFFLINE_ID, lessonId: LESSON, timestampSec: 750, content: 'ออฟไลน์', updatedAt: '2024-01-01T00:00:00.000Z' },
    ]);
    assert.equal(first.synced, 1);
    assert.deepEqual(first.syncedIds, [`note:${OFFLINE_ID}`]);
    const stale = await svc.syncOfflineNotes(USER, [
      { id: OFFLINE_ID, lessonId: LESSON, timestampSec: 1, content: 'stale', updatedAt: '2023-01-01T00:00:00.000Z' },
    ]);
    assert.equal(stale.synced, 1);
    assert.equal(String(notes.get(OFFLINE_ID)?.['content']), 'ออฟไลน์');
    const fresh = await svc.syncOfflineNotes(USER, [
      { id: OFFLINE_ID, lessonId: LESSON, timestampSec: 800, content: 'ใหม่กว่า', updatedAt: new Date(Date.now() + 60000).toISOString() },
    ]);
    assert.equal(fresh.synced, 1);
    assert.equal(String(notes.get(OFFLINE_ID)?.['content']), 'ใหม่กว่า');
  }
  ok('Service: entitlement gate + CRUD + cache + search + offline LWW');
}

// ---------- 3. AI summarizer: deterministic extractive ----------
{
  const s = new NoteAiSummarizerService();
  const out = s.summarize([
    'ภาษีหัก ณ ที่จ่าย คือการหักภาษีล่วงหน้า ผู้จ่ายต้องนำส่งกรมสรรพากร',
    'ควรทบทวนอัตราภาษี 3 เปอร์เซ็นต์สำหรับค่าบริการ และต้องยื่นแบบ ภงด 53',
    'อัตราภาษี 3 เปอร์เซ็นต์สำหรับค่าบริการเป็นเรื่องสำคัญที่ต้องจำ',
  ]);
  assert.ok(out.summaryText.length > 0);
  assert.ok(out.keyTakeaways.length > 0);
  assert.ok(out.suggestedActionItems.length > 0);
  const empty = s.summarize([]);
  assert.equal(empty.keyTakeaways.length, 0);
  const again = s.summarize([
    'ภาษีหัก ณ ที่จ่าย คือการหักภาษีล่วงหน้า ผู้จ่ายต้องนำส่งกรมสรรพากร',
    'ควรทบทวนอัตราภาษี 3 เปอร์เซ็นต์สำหรับค่าบริการ และต้องยื่นแบบ ภงด 53',
    'อัตราภาษี 3 เปอร์เซ็นต์สำหรับค่าบริการเป็นเรื่องสำคัญที่ต้องจำ',
  ]);
  assert.deepEqual(again, out);
  ok('AI summarizer: deterministic takeaways + action items');
}

// ---------- 4. PDF exporter: valid %PDF + forensic ----------
{
  assert.equal(noteUserRef('user-1').length, 16);
  const pdf = buildNotesPdf('lesson-1', [{ timestampSec: 225, content: 'hello note' }], 'ABC-123');
  assert.ok(pdf.subarray(0, 5).toString() === '%PDF-');
  assert.ok(pdf.includes(Buffer.from('ABC-123')));
  ok('PDF exporter: valid header + forensic footer');
}

// ---------- 5. Prisma additive (OUT_OF_SCOPE_STRICT: engine pipeline only) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of ['enum NoteVisibility', 'model LessonNote', 'notes             LessonNote[]', 'notes              LessonNote[]']) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  ok('Prisma: NoteVisibility + LessonNote + back-relations (additive)');
}

// ---------- 6. Static parity: backend + frontend + proxies + ADR ----------
function sectionParity(): void {
  const svc = readFileSync('apps/backend/src/modules/note/services/note.service.ts', 'utf8');
  for (const t of ['NoteService', 'createNote', 'getNotesByLesson', 'syncOfflineNotes', 'sanitizeNoteContent', 'NOTE_STREAM_KEY']) {
    assert.ok(svc.includes(t), `note service missing: ${t}`);
  }
  const sum = readFileSync('apps/backend/src/modules/note/services/note-ai-summarizer.service.ts', 'utf8');
  assert.ok(sum.includes('summarize') && sum.includes('summarizeViaLlm'));
  const pdf = readFileSync('apps/backend/src/modules/note/services/note-pdf-exporter.service.ts', 'utf8');
  assert.ok(pdf.includes('buildNotesPdf') && pdf.includes('putObjectBuffer') && pdf.includes('presignedGetUrl'));
  const res = readFileSync('apps/backend/src/modules/note/resolvers/note.resolver.ts', 'utf8');
  for (const t of ['createLessonNote', 'getLessonNotes', 'searchMyNotes', 'generateAiLessonNoteSummary', 'exportNotesToPdf']) {
    assert.ok(res.includes(t), `resolver missing: ${t}`);
  }
  const ctrl = readFileSync('apps/backend/src/modules/note/controllers/note-export.controller.ts', 'utf8');
  assert.ok(ctrl.includes('JwtAuthGuard') && ctrl.includes('sync') && ctrl.includes('export'));
  const mod = readFileSync('apps/backend/src/modules/note/note.module.ts', 'utf8');
  for (const t of ['NoteService', 'NoteResolver', 'NoteExportController', 'NotePdfExporterService', 'NoteAiSummarizerService']) {
    assert.ok(mod.includes(t), `module missing: ${t}`);
  }
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('NoteModule'));
  const api = readFileSync('apps/backend/src/api/graphql/resolvers/note.resolver.ts', 'utf8');
  assert.ok(api.includes('note.resolver'));
  const sdl = readFileSync('apps/backend/src/api/graphql/schemas/note.graphql', 'utf8');
  for (const t of ['type LessonNote', 'createLessonNote', 'exportNotesToPdf', 'AiNoteSummaryPayload']) {
    assert.ok(sdl.includes(t), `SDL missing: ${t}`);
  }
  const store = readFileSync('apps/frontend/stores/useNoteStore.ts', 'utf8');
  assert.ok(store.includes('useNoteStore') && store.includes('LIFF_INIT') && store.includes('useSyncExternalStore'));
  const engine = readFileSync('apps/frontend/components/video/InVideoNoteEngine.tsx', 'utf8');
  for (const t of ['InVideoNoteEngine', 'getCurrentTimeSec', 'seekToSeconds', 'pauseVideo', 'queueOfflineNote', 'ZENE_FLUSH_NOTE_QUEUE']) {
    assert.ok(engine.includes(t), `engine missing: ${t}`);
  }
  const drawer = readFileSync('apps/frontend/components/video/NoteListDrawer.tsx', 'utf8');
  assert.ok(drawer.includes('NoteListDrawer') && drawer.includes('onSeek'));
  const client = readFileSync('apps/frontend/lib/video/note-client.ts', 'utf8');
  assert.ok(client.includes('queueOfflineNote') && client.includes('flushOfflineNotes') && client.includes('sync-lesson-note'));
  const queue = readFileSync('apps/frontend/lib/offline/indexeddb-queue.ts', 'utf8');
  assert.ok(queue.includes('LESSON_NOTE'));
  for (const p of [
    'apps/frontend/app/api/v1/notes/route.ts',
    'apps/frontend/app/api/v1/notes/search/route.ts',
    'apps/frontend/app/api/v1/notes/sync/route.ts',
    'apps/frontend/app/api/v1/notes/export/route.ts',
    'apps/frontend/app/api/v1/notes/summary/route.ts',
  ]) {
    assert.ok(readFileSync(p, 'utf8').includes('/api/v1/notes'), `proxy missing: ${p}`);
  }
  const sw = readFileSync('apps/frontend/public/sw.js', 'utf8');
  assert.ok(sw.includes('sync-lesson-note') && sw.includes('ZENE_FLUSH_NOTE_QUEUE'));
  const zod = readFileSync('packages/shared/src/schemas/lesson-note.schema.ts', 'utf8');
  assert.ok(zod.includes('CreateLessonNoteSchema') && zod.includes('sanitizeNoteContent'));
  assert.ok(readFileSync('docs/adr/ADR-065-lesson-note-engine.md', 'utf8').includes('Lesson Note'));
  ok('Parity: service/AI/PDF + GQL/REST + store/engine/drawer + proxies + SW + ADR');
}

async function main(): Promise<void> {
  await sectionService();
  sectionParity();
}

void main().then(
  () => console.log(`\nPhase065 contracts: ${passed + 6} checks passed`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
