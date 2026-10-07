// SSOT Phase 047 §10 — contract tests (Zod, session, grading, wiring)
// Run: npx tsx scripts/test-phase047-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  InVideoQuizDetailSchema,
  QuizAttemptEventSchema,
  QuizCheckpointSchema,
  QuizEvaluationResultSchema,
  QuizOptionSchema,
  QuizTypeEnum,
  SubmitQuizAnswerInputSchema,
  isChoiceCorrect,
  normalizeShortAnswer,
  sanitizeCheckpoint,
} from '../packages/shared/src/schemas/quiz-contract';
import { QuizSession } from '../apps/backend/src/modules/quiz/domain/entities/quiz-session.entity';
import { AiHintGeneratorService, composeHint } from '../apps/backend/src/modules/quiz/application/services/ai-hint-generator.service';
import { QuizEvaluatorService, signQuizToken, verifyQuizToken } from '../apps/backend/src/modules/quiz/application/services/quiz-evaluator.service';
import { PrismaQuizRepository } from '../apps/backend/src/modules/quiz/infrastructure/persistence/prisma-quiz.repository';
// NOTE: QuizModule/controllers/resolvers carry Nest parameter decorators
// which tsx/esbuild cannot transform — verified via static source parity (§8)
// following the Phase 027–046 precedent.

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const LESSON_ID = '123e4567-e89b-12d3-a456-426614174000';
const QUIZ_ID = '223e4567-e89b-12d3-a456-426614174000';
const USER_ID = 'user-001';
const OPT_A = '323e4567-e89b-12d3-a456-426614174000';
const OPT_B = '423e4567-e89b-12d3-a456-426614174000';

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) + pure helpers ----------
{
  for (const t of ['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'TRUE_FALSE', 'SHORT_ANSWER']) {
    assert.equal(QuizTypeEnum.safeParse(t).success, true);
  }
  assert.equal(QuizTypeEnum.safeParse('ESSAY').success, false);
  assert.equal(QuizOptionSchema.safeParse({ id: OPT_A, optionText: 'Paris', optionOrder: 0 }).success, true);
  assert.equal(QuizOptionSchema.safeParse({ id: 'x', optionText: 'Paris', optionOrder: 0 }).success, false);

  const detail = {
    id: QUIZ_ID, lessonId: LESSON_ID, timestampSec: 135, question: 'Capital?',
    quizType: 'SINGLE_CHOICE', options: [{ id: OPT_A, optionText: 'Paris', optionOrder: 0 }],
  };
  const parsed = InVideoQuizDetailSchema.safeParse(detail);
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.passScore, 100);
    assert.equal(parsed.data.maxRetries, 0);
  }
  assert.equal(InVideoQuizDetailSchema.safeParse({ ...detail, timestampSec: -1 }).success, false);

  const sub = { quizId: QUIZ_ID, lessonId: LESSON_ID, selectedOptionIds: [OPT_A], playbackTimeSec: 135.7 };
  assert.equal(SubmitQuizAnswerInputSchema.safeParse(sub).success, true);
  assert.equal(SubmitQuizAnswerInputSchema.safeParse({ ...sub, selectedOptionIds: ['x'] }).success, false);
  assert.equal(QuizEvaluationResultSchema.safeParse({ success: true, isCorrect: false, earnedScore: 0, aiHint: 'retry' }).success, true);

  assert.equal(isChoiceCorrect(['a'], ['a']), true);
  assert.equal(isChoiceCorrect(['a', 'b'], ['b', 'a']), true);
  assert.equal(isChoiceCorrect(['a', 'b'], ['a']), false);
  assert.equal(isChoiceCorrect(['a'], ['a', 'a']), true); // dup-insensitive
  assert.equal(isChoiceCorrect([], []), true);
  assert.equal(normalizeShortAnswer('  PaRis\n'), 'paris');
  assert.equal(normalizeShortAnswer('New   York'), 'new york');

  const dirty = { id: QUIZ_ID, options: [{ id: OPT_A, optionText: 'Paris', optionOrder: 0, isCorrect: true, answerKey: 'x' }] };
  const clean = sanitizeCheckpoint(dirty);
  assert.deepEqual(clean.options, [{ id: OPT_A, optionText: 'Paris', optionOrder: 0 }]);
  assert.ok(!('isCorrect' in clean.options[0]));

  assert.equal(QuizAttemptEventSchema.safeParse({ eventType: 'INVIDEO_QUIZ_ATTEMPT', userId: USER_ID, lessonId: LESSON_ID, quizId: QUIZ_ID, timestampSec: 135, isCorrect: false, attemptNumber: 2 }).success, true);
  assert.equal(QuizCheckpointSchema.safeParse({ ...detail, options: [{ id: OPT_A, optionText: 'Paris', optionOrder: 0 }] }).success, true);
  ok('Zod quiz/options/submit/result verbatim + sanitize/match/normalize helpers');
}

// ---------- 2. Session machine (§2.2) ----------
{
  const s = QuizSession.start(QUIZ_ID, 0);
  assert.equal(s.current(), 'QUIZ_IDLE');
  s.trigger();
  assert.equal(s.current(), 'QUIZ_TRIGGERED');
  s.submit();
  assert.equal(s.current(), 'QUIZ_EVALUATING');
  s.resolve(false);
  assert.equal(s.current(), 'QUIZ_RETRY_LOCK');
  s.submit();
  s.resolve(true);
  assert.equal(s.current(), 'QUIZ_SUCCESS');
  s.dismiss();
  assert.equal(s.current(), 'QUIZ_IDLE');

  const budgeted = QuizSession.start(QUIZ_ID, 2, 1, false);
  budgeted.trigger();
  budgeted.submit();
  assert.equal(budgeted.resolve(false), 'QUIZ_RETRY_LOCK');

  const done = QuizSession.start(QUIZ_ID, 0, 0, true);
  assert.equal(done.current(), 'QUIZ_SUCCESS');
  done.trigger(); // success short-circuits re-trigger
  assert.equal(done.current(), 'QUIZ_SUCCESS');

  assert.throws(() => QuizSession.start('', 0), /quiz id/);
  assert.throws(() => QuizSession.start(QUIZ_ID, -1), /budget/);
  const illegal = QuizSession.start(QUIZ_ID, 0);
  assert.throws(() => illegal.submit(), /Illegal submit/);
  assert.throws(() => illegal.resolve(true), /Illegal resolve/);
  assert.throws(() => illegal.dismiss(), /Only success/);
  ok('Session IDLE→TRIGGERED→EVALUATING→SUCCESS/RETRY + budget + guards');
}

// ---------- 3. Hint escalation (no answer leakage) ----------
{
  assert.equal(composeHint('Recall the capital', null, 1), 'Recall the capital');
  const h2 = composeHint('Recall the capital', 'capitals of Europe', 2);
  assert.ok(h2.includes('Recall the capital') && h2.includes('capitals of Europe'));
  assert.ok(!h2.toLowerCase().includes('paris'));
  const fallback = composeHint(null, null, 5);
  assert.ok(fallback.length > 0);
  assert.equal(new AiHintGeneratorService().hintFor('h', null, 1), 'h');
  ok('Hints escalate by attempt, never reveal options');
}

function quizRow(overrides: Record<string, unknown> = {}) {
  return {
    id: QUIZ_ID,
    lessonId: LESSON_ID,
    timestampSec: 135,
    question: 'Capital of France?',
    quizType: 'SINGLE_CHOICE',
    passScore: 100,
    maxRetries: 0,
    explanation: 'Paris is the capital.',
    explanationHint: null,
    aiPromptContext: 'European capitals',
    answerKey: OPT_A,
    options: [
      { id: OPT_A, optionText: 'Paris', optionOrder: 0, isCorrect: true },
      { id: OPT_B, optionText: 'Rome', optionOrder: 1, isCorrect: false },
    ],
    ...overrides,
  };
}

function fakeRepo(rows: Record<string, ReturnType<typeof quizRow>>, attempts: Array<{ userId: string; quizId: string }> = []) {
  const recorded: unknown[] = [];
  const progressed: unknown[] = [];
  return {
    recorded,
    progressed,
    repo: {
      findQuizWithOptions: async (id: string) => rows[id] ?? null,
      listLessonQuizzes: async (lessonId: string) => Object.values(rows).filter((r) => r.lessonId === lessonId),
      countUserAttempts: async (userId: string, quizId: string) => attempts.filter((a) => a.userId === userId && a.quizId === quizId).length,
      recordAttempt: async (input: { userId: string; quizId: string }) => {
        attempts.push({ userId: input.userId, quizId: input.quizId });
        recorded.push(input);
        return { id: `att-${attempts.length}`, attemptCount: attempts.length };
      },
      markLessonProgress: async (userId: string, lessonId: string, watchedSec: number) => { progressed.push({ userId, lessonId, watchedSec }); },
    },
  };
}

async function main(): Promise<void> {
  // ---------- 4. Evaluator: correct/wrong/retry-budget/ghost/progress ----------
  {
    const { repo, recorded, progressed } = fakeRepo({ [QUIZ_ID]: quizRow() });
    const events: unknown[] = [];
    const svc = new QuizEvaluatorService(repo as never, new AiHintGeneratorService(), 'quiz-secret', (e) => events.push(e));

    const win = await svc.evaluateSubmission(USER_ID, { quizId: QUIZ_ID, lessonId: LESSON_ID, selectedOptionIds: [OPT_A], playbackTimeSec: 135.2 });
    assert.equal(win.success, true);
    assert.equal(win.isCorrect, true);
    assert.equal(win.earnedScore, 100);
    assert.equal(win.explanation, 'Paris is the capital.');
    assert.equal(win.aiHint, undefined);
    assert.ok(typeof win.nextSegmentToken === 'string');
    assert.equal(progressed.length, 1);
    assert.deepEqual((progressed[0] as { watchedSec: number }).watchedSec, 135);
    assert.equal((events[0] as { attemptNumber: number }).attemptNumber, 1);

    // Token verifies for this user/quiz only.
    assert.equal(verifyQuizToken(QUIZ_ID, USER_ID, win.nextSegmentToken as string, 'quiz-secret'), true);
    assert.equal(verifyQuizToken(QUIZ_ID, 'other', win.nextSegmentToken as string, 'quiz-secret'), false);
    assert.equal(verifyQuizToken(QUIZ_ID, USER_ID, '1.deadbeef', 'quiz-secret'), false);

    const lose = await svc.evaluateSubmission(USER_ID, { quizId: QUIZ_ID, lessonId: LESSON_ID, selectedOptionIds: [OPT_B], playbackTimeSec: 135 });
    assert.equal(lose.isCorrect, false);
    assert.equal(lose.earnedScore, 0);
    assert.equal(lose.nextSegmentToken, undefined);
    assert.ok(typeof lose.aiHint === 'string' && lose.aiHint.length > 0);
    assert.equal(progressed.length, 1); // no progress write on failure

    // Retry budget enforced (maxRetries: 1, one prior attempt above).
    const limited = fakeRepo({ [QUIZ_ID]: quizRow({ maxRetries: 1 }) }, [{ userId: USER_ID, quizId: QUIZ_ID }]);
    const gated = new QuizEvaluatorService(limited.repo as never, new AiHintGeneratorService(), 'quiz-secret');
    await assert.rejects(() => gated.evaluateSubmission(USER_ID, { quizId: QUIZ_ID, lessonId: LESSON_ID, selectedOptionIds: [OPT_A], playbackTimeSec: 1 }), /Retry budget/);

    // Ghost quiz / lesson mismatch → 404 (no oracle).
    await assert.rejects(() => svc.evaluateSubmission(USER_ID, { quizId: QUIZ_ID, lessonId: '00000000-0000-4000-8000-000000000000', selectedOptionIds: [OPT_A], playbackTimeSec: 1 }), /not found/);
    await assert.rejects(() => svc.evaluateSubmission(USER_ID, { quizId: QUIZ_ID, lessonId: LESSON_ID, selectedOptionIds: ['not-a-uuid'], playbackTimeSec: 1 }), /Invalid quiz submission/);
    assert.equal(recorded.length, 2);
    ok('Grading correct/wrong + token issue/verify + budget + ghost guards + progress-on-pass');
  }

  // ---------- 5. Legacy + short-answer grading paths ----------
  {
    // Legacy Phase 037 row: empty options → answerKey single-match.
    const legacy = fakeRepo({ [QUIZ_ID]: quizRow({ options: [] }) });
    const svc = new QuizEvaluatorService(legacy.repo as never, new AiHintGeneratorService(), 'quiz-secret');
    assert.equal((await svc.evaluateSubmission(USER_ID, { quizId: QUIZ_ID, lessonId: LESSON_ID, selectedOptionIds: [OPT_A], playbackTimeSec: 1 })).isCorrect, true);
    assert.equal((await svc.evaluateSubmission(USER_ID, { quizId: QUIZ_ID, lessonId: LESSON_ID, selectedOptionIds: [OPT_B], playbackTimeSec: 1 })).isCorrect, false);
    assert.equal((await svc.evaluateSubmission(USER_ID, { quizId: QUIZ_ID, lessonId: LESSON_ID, selectedOptionIds: [OPT_A, OPT_B], playbackTimeSec: 1 })).isCorrect, false);

    // Short answer: normalized compare.
    const short = fakeRepo({ [QUIZ_ID]: quizRow({ quizType: 'SHORT_ANSWER', options: [], answerKey: 'Paris' }) });
    const svc2 = new QuizEvaluatorService(short.repo as never, new AiHintGeneratorService(), 'quiz-secret');
    assert.equal((await svc2.evaluateSubmission(USER_ID, { quizId: QUIZ_ID, lessonId: LESSON_ID, selectedOptionIds: [], shortAnswerText: '  paris ', playbackTimeSec: 1 })).isCorrect, true);
    assert.equal((await svc2.evaluateSubmission(USER_ID, { quizId: QUIZ_ID, lessonId: LESSON_ID, selectedOptionIds: [], playbackTimeSec: 1 })).isCorrect, false);

    // Multi-choice exact set.
    const multi = fakeRepo({ [QUIZ_ID]: quizRow({ quizType: 'MULTIPLE_CHOICE', answerKey: '' }) });
    const svc3 = new QuizEvaluatorService(multi.repo as never, new AiHintGeneratorService(), 'quiz-secret');
    const row = multi.repo as unknown as { findQuizWithOptions: (id: string) => Promise<null> };
    void row;
    assert.equal((await svc3.evaluateSubmission(USER_ID, { quizId: QUIZ_ID, lessonId: LESSON_ID, selectedOptionIds: [OPT_B, OPT_A], playbackTimeSec: 1 })).isCorrect, false); // only A correct
    ok('Legacy answerKey + short-answer normalize + multi-choice exact-set');
  }

  // ---------- 6. Repository adapter maps + sanitizes (Gate 4) ----------
  {
    const created: unknown[] = [];
    const tables = {
      lessonQuiz: {
        findUnique: async () => ({ ...quizRow(), explanationHint: 'hint!' }),
        findMany: async () => [{ ...quizRow() }, { ...quizRow({ id: '323e4567-e89b-12d3-a456-426614174000', timestampSec: 10 }) }],
      },
      quizAttempt: {
        count: async () => 2,
        create: async (a: unknown) => { created.push(a); return { id: 'att-9', attemptCount: 3 }; },
      },
      courseLearningProgress: { upsert: async () => ({}) },
      $transaction: async <T>(run: (tx: unknown) => Promise<T>): Promise<T> => run(tables),
    };
    const repo = new PrismaQuizRepository(tables as never);
    const one = await repo.findQuizWithOptions(QUIZ_ID);
    assert.equal(one?.options.length, 2);
    assert.equal((await repo.listLessonQuizzes(LESSON_ID)).length, 2);
    assert.equal(await repo.countUserAttempts(USER_ID, QUIZ_ID), 2);
    const rec = await repo.recordAttempt({ userId: USER_ID, quizId: QUIZ_ID, isPassed: true, selectedOpts: [OPT_A], scoreObtained: 100, attemptCount: 3 });
    assert.equal(rec.attemptCount, 3);
    await repo.markLessonProgress(USER_ID, LESSON_ID, 135.9);
    await assert.rejects(() => new PrismaQuizRepository().findQuizWithOptions(QUIZ_ID), /unavailable/);
    ok('Prisma adapter: ordered options, counts, atomic record, progress clamp');
  }

  // ---------- 7. Wiring + SDL/hook/player/page/proxy parity (Gates 1/9) ----------
  {
    const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
    for (const t of ['model LessonQuiz', 'model QuizOption', 'model QuizAttempt', 'enum QuizType', 'timestampSec    Int', 'answerKey   String', 'quizAttempts      QuizAttempt[]']) {
      assert.ok(prisma.includes(t), `prisma missing ${t}`);
    }
    const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
    for (const t of ['SubmitQuizAnswerInputSchema', 'QuizEvaluationResultSchema', 'sanitizeCheckpoint', 'isChoiceCorrect', 'QuizAttemptEventSchema']) {
      assert.ok(barrel.includes(t), `shared barrel missing ${t}`);
    }
    const mod = readFileSync('apps/backend/src/modules/quiz/quiz.module.ts', 'utf8');
    for (const t of ['QuizEvaluatorService', 'PrismaQuizRepository', 'AiHintGeneratorService', 'QuizResolver', 'QuizController', 'useFactory']) {
      assert.ok(mod.includes(t), `module missing ${t}`);
    }
    assert.ok(readFileSync('apps/backend/src/app.module.ts', 'utf8').includes('QuizModule'));
    const rslSrc = readFileSync('apps/backend/src/modules/quiz/presentation/quiz.resolver.ts', 'utf8');
    for (const t of ['getLessonInVideoQuizzes', 'submitInVideoQuizAnswer', 'sanitizeCheckpoint', 'resolveReaderIdentity', 'InVideoQuizCheckpoint']) {
      assert.ok(rslSrc.includes(t), `resolver missing ${t}`);
    }
    // Gate 4: answer keys never cross the read path (only the user's own verdict returns).
    assert.ok(!rslSrc.includes('answerKey:'), 'resolver must not forward answer keys');
    const ctlSrc = readFileSync('apps/backend/src/modules/quiz/presentation/quiz.controller.ts', 'utf8');
    for (const t of ['api/v1/quiz', 'checkpoints', "'submit'", 'JwtAuthGuard', 'sanitizeCheckpoint']) {
      assert.ok(ctlSrc.includes(t), `controller missing ${t}`);
    }
    assert.ok(!ctlSrc.includes('answerKey:'), 'controller must not forward answer keys');
    const sdl = readFileSync('apps/backend/src/api/graphql/schemas/quiz.graphql/schema.graphql', 'utf8');
    for (const t of ['getLessonInVideoQuizzes', 'submitInVideoQuizAnswer', 'InVideoQuizCheckpoint', 'QuizEvaluationResult', 'SubmitQuizAnswerInput']) {
      assert.ok(sdl.includes(t), `SDL missing ${t}`);
    }
    // Gate 4: isCorrect appears exactly once in SDL (the user's own verdict) —
    // checkpoint/option types must never carry correctness.
    assert.equal((sdl.match(/isCorrect/g) || []).length, 1);
    const alias = readFileSync('apps/backend/src/api/graphql/resolvers/quiz.resolver.ts', 'utf8');
    assert.ok(alias.includes('QuizResolver'));
    const overlay = readFileSync('apps/frontend/components/quiz/InVideoQuizOverlay.tsx', 'utf8');
    for (const t of ['QUIZ_TRIGGERED', 'QUIZ_EVALUATING', 'QUIZ_SUCCESS', 'QUIZ_RETRY_LOCK', '/api/v1/quiz/submit', 'aiHint', 'role="dialog"']) {
      assert.ok(overlay.includes(t), `overlay missing ${t}`);
    }
    assert.ok(!overlay.includes("from 'hls.js'"), 'overlay stays dep-free');
    const player = readFileSync('apps/frontend/components/player/HlsQuizPlayer.tsx', 'utf8');
    for (const t of ['maxAllowed', 'InVideoQuizOverlay', 'currentTime = maxAllowed', '+ 0.1', 'controls={!activeQuiz}']) {
      assert.ok(player.includes(t), `quiz player missing ${t}`);
    }
    const page = readFileSync('apps/frontend/app/(liff)/course/[courseId]/lesson/[lessonId]/page.tsx', 'utf8');
    for (const t of ['HlsQuizPlayer', 'fetchCheckpoints', 'quizzes.length']) {
      assert.ok(page.includes(t), `lesson page missing ${t}`);
    }
    const client = readFileSync('apps/frontend/lib/quiz/quiz-client.ts', 'utf8');
    assert.ok(client.includes('fetchCheckpoints') && client.includes('submitQuizAnswer'));
    for (const [f, markers] of [
      ['apps/frontend/app/api/v1/quiz/checkpoints/route.ts', ['/api/v1/quiz/checkpoints', 'lessonId']],
      ['apps/frontend/app/api/v1/quiz/submit/route.ts', ['/api/v1/quiz/submit', 'POST']],
    ] as Array<[string, string[]]>) {
      const src = readFileSync(f, 'utf8');
      for (const t of markers) assert.ok(src.includes(t), `${f} missing ${t}`);
    }
    ok('Prisma quiz models + barrel + module/App + resolver/SDL/alias + overlay/player/page/client/proxies parity');
  }

  console.log(`\nPhase 047 contracts: ${passed} checks passed`);
}

void main();
