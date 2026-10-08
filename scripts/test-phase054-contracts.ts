// SSOT Phase 054 §10 — contract tests (Zod, resume policy, DTO, toast, wiring)
// Run: npx tsx scripts/test-phase054-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SyncLessonProgressInputSchema,
  RESUME_MIN_SEC,
  RESUME_MAX_COMPLETION_RATIO,
  RESUME_TOAST_AUTO_DISMISS_SEC,
  RESUME_TOAST_RENDER_BUDGET_MS,
  RESUME_SYNC_EVERY_SEC,
  shouldShowResumeToast,
  formatResumeMMSS,
} from '../packages/shared/src/schemas/zod-stream';
import { toSyncProgress } from '../apps/backend/src/modules/stream/dto/sync-progress.dto';
// NOTE: Resolvers/controllers carry Nest (parameter) decorators which
// tsx/esbuild cannot transform — verified via static source parity (§6)
// following the Phase 027–053 precedent.

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const LESSON_ID = '323e4567-e89b-12d3-a456-426614174000';

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) + resume policy ----------
{
  assert.equal(SyncLessonProgressInputSchema.safeParse({ lessonId: LESSON_ID, watchedSec: 145 }).success, true);
  assert.equal(
    SyncLessonProgressInputSchema.parse({ lessonId: LESSON_ID, watchedSec: 0 }).isCompleted,
    false,
  );
  assert.equal(SyncLessonProgressInputSchema.safeParse({ lessonId: 'x', watchedSec: 1 }).success, false);
  assert.equal(SyncLessonProgressInputSchema.safeParse({ lessonId: LESSON_ID, watchedSec: -1 }).success, false);
  assert.equal(SyncLessonProgressInputSchema.safeParse({ lessonId: LESSON_ID, watchedSec: 1.5 }).success, false);

  assert.equal(RESUME_MIN_SEC, 10);
  assert.equal(RESUME_MAX_COMPLETION_RATIO, 0.95);
  assert.equal(RESUME_TOAST_AUTO_DISMISS_SEC, 10);
  assert.equal(RESUME_TOAST_RENDER_BUDGET_MS, 300);
  assert.equal(RESUME_SYNC_EVERY_SEC, 5);

  // BDD Scenario 1: 145/600 → toast; boundaries fail closed.
  assert.equal(shouldShowResumeToast(145, 600), true);
  assert.equal(shouldShowResumeToast(10, 600), false);
  assert.equal(shouldShowResumeToast(11, 600), true);
  assert.equal(shouldShowResumeToast(570, 600), false); // ≥95% → restart, keep completed
  assert.equal(shouldShowResumeToast(0, 600), false);
  assert.equal(shouldShowResumeToast(5, 0), false);
  assert.equal(shouldShowResumeToast(NaN, 600), false);

  assert.equal(formatResumeMMSS(145), '02:25');
  assert.equal(formatResumeMMSS(0), '00:00');
  assert.equal(formatResumeMMSS(600), '10:00');
  assert.equal(formatResumeMMSS(-3), '00:00');
  ok('Zod input verbatim + resume window/policy + MM:SS format');
}

// ---------- 2. DTO adapter (LIFF input → write-behind transport) ----------
{
  const adapted = toSyncProgress({ lessonId: LESSON_ID, watchedSec: 145, isCompleted: false }, 600);
  assert.deepEqual(adapted, { lessonId: LESSON_ID, watchedSec: 145, durationSec: 600, isCompleted: false });
  assert.throws(() => toSyncProgress({ lessonId: LESSON_ID, watchedSec: 1, isCompleted: false }, 0));
  assert.throws(() => toSyncProgress({ lessonId: 'bad', watchedSec: 1, isCompleted: false }, 600));
  ok('DTO: input adapts to transport; bad duration/lesson rejected');
}

// ---------- 3. Prisma SSOT (§4.1 Gate 1: model untouched, unique intact) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of [
    'model CourseLearningProgress',
    'watchedSec  Int      @default(0)',
    'isCompleted Boolean  @default(false)',
    '@@unique([userId, lessonId])',
  ]) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  ok('Prisma: CourseLearningProgress persisted via existing unique (no migration)');
}

// ---------- 4. Static parity (alias + GQL/SDL + REST + toast + hook + player) ----------
function sectionStaticParity(): void {
  const alias = readFileSync('apps/backend/src/modules/stream/stream.service.ts', 'utf8');
  for (const t of ["from './services/stream.service'", 'export { StreamService }']) {
    assert.ok(alias.includes(t), `alias missing: ${t}`);
  }
  const gql = readFileSync('apps/backend/src/api/graphql/stream/stream.resolver.ts', 'utf8');
  for (const t of ['getLessonStreamState', 'syncLessonProgress']) {
    assert.ok(gql.includes(t), `GQL resolver missing: ${t}`);
  }
  const sdl = readFileSync('apps/backend/src/api/graphql/schemas/stream.graphql/schema.graphql', 'utf8');
  for (const t of ['getLessonStreamState', 'syncLessonProgress', 'LessonStreamPayload', 'ProgressSyncResponse']) {
    assert.ok(sdl.includes(t), `SDL missing: ${t}`);
  }
  const rest = readFileSync('apps/backend/src/modules/stream/controllers/stream.controller.ts', 'utf8');
  for (const t of ['lesson-state', 'lesson-progress']) {
    assert.ok(rest.includes(t), `REST gateway missing: ${t}`);
  }
  const toast = readFileSync('apps/frontend/components/video/VideoResumeToast.tsx', 'utf8');
  for (const t of ['role="dialog"', 'คุณเรียนค้างไว้ที่', 'เล่นต่อจากเดิม', 'เริ่มใหม่', 'min-h-[44px]', 'formatResumeMMSS', 'autoDismissSec', '<svg']) {
    assert.ok(toast.includes(t), `toast missing: ${t}`);
  }
  assert.ok(!toast.includes('lucide-react'), 'toast must stay zero-dep (no lucide)');
  const hook = readFileSync('apps/frontend/hooks/useVideoProgress.ts', 'utf8');
  for (const t of ['syncProgress', 'loadSavedState', 'reportLessonHeartbeat', 'isLessonCompleted', 'lastSyncedSec']) {
    assert.ok(hook.includes(t), `hook missing: ${t}`);
  }
  const player = readFileSync('apps/frontend/components/video/HlsVideoPlayer.tsx', 'utf8');
  for (const t of ['enableResumeToast', 'VideoResumeToast', 'shouldShowResumeToast', 'key={startAt}', 'handleResume', 'handleRestart']) {
    assert.ok(player.includes(t), `player missing: ${t}`);
  }
  ok('Static parity: alias + GQL/SDL + REST + toast + hook + resume-wired player');
}

async function main(): Promise<void> {
  sectionStaticParity();
}

void main();
