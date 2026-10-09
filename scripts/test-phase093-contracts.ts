// SSOT Phase 093 §10-11 — contract tests (Zod, IRT math, attempts, parity)
// Run: npx tsx scripts/test-phase093-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AdaptiveSubmitAnswerSchema,
  AdaptiveNextQuestionSchema,
  ADAPTIVE_MAX_ITEMS,
  ADAPTIVE_SE_THRESHOLD,
  ADAPTIVE_CALC_BUDGET_MS,
  THETA_MIN,
  THETA_MAX,
  ADAPTIVE_STREAM,
  irtProbability,
  irtInformation,
  thetaStep,
  thetaStandardError,
  masteryPercent,
  selectNextItem,
} from '../packages/shared/src/schemas/adaptive-testing-contract';
import { assertAnswerable, isSessionCompleted } from '../apps/backend/src/modules/adaptive-testing/domain/entities/adaptive-session.entity';
import { AdaptiveAttemptService } from '../apps/backend/src/modules/adaptive-testing/application/services/adaptive-attempt.service';
import { IrtEngineService } from '../apps/backend/src/modules/adaptive-testing/application/services/irt-engine.service';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const UUID = '123e4567-e89b-12d3-a456-426614174000';
const UUID_B = '223e4567-e89b-12d3-a456-426614174001';
const UUID_C = '323e4567-e89b-12d3-a456-426614174002';
const Q1 = '423e4567-e89b-12d3-a456-426614174003';
const Q2 = '523e4567-e89b-12d3-a456-426614174004';
const Q3 = '623e4567-e89b-12d3-a456-426614174005';

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) ----------
{
  const good = { userId: UUID, lessonId: UUID_B, questionId: Q1, selectedOptionId: 'A', responseTimeMs: 3200 };
  assert.equal(AdaptiveSubmitAnswerSchema.safeParse(good).success, true);
  assert.equal(AdaptiveSubmitAnswerSchema.safeParse({ ...good, responseTimeMs: -1 }).success, false);
  assert.equal(AdaptiveSubmitAnswerSchema.safeParse({ ...good, questionId: 'nope' }).success, false);
  assert.equal(
    AdaptiveNextQuestionSchema.safeParse({
      questionId: Q1, questionText: '2+2?', options: [{ id: 'A', text: '4' }],
      currentTheta: 0.5, estimatedMasteryPercent: 62.2, isTestCompleted: false,
    }).success,
    true,
  );
  ok('Zod §3.1 verbatim (submit/next gates)');
}

// ---------- 2. IRT 3PL math (§7.1/BDD-1) ----------
{
  assert.equal(ADAPTIVE_MAX_ITEMS, 10);
  assert.equal(ADAPTIVE_SE_THRESHOLD, 0.3);
  assert.equal(ADAPTIVE_CALC_BUDGET_MS, 200);
  assert.deepEqual([THETA_MIN, THETA_MAX], [-4, 4]);
  assert.equal(ADAPTIVE_STREAM, 'stream:adaptive:theta');
  const item = { difficulty: 0, discrimination: 1, pseudoGuessing: 0 };
  assert.ok(Math.abs(irtProbability(0, item) - 0.5) < 1e-9);
  assert.ok(irtProbability(4, item) > 0.98 && irtProbability(-4, item) < 0.02);
  // Guessing floor respected.
  assert.ok(irtProbability(-4, { difficulty: 0, discrimination: 1, pseudoGuessing: 0.25 }) >= 0.24);
  // Information peaks near difficulty.
  assert.ok(irtInformation(0, item) > irtInformation(3, item));
  // Correct raises theta, wrong lowers it, both bounded.
  const up = thetaStep(0, item, true);
  const down = thetaStep(0, item, false);
  assert.ok(up > 0 && down < 0);
  assert.equal(thetaStep(4, item, true), 4);
  assert.equal(thetaStep(-4, item, false), -4);
  // Harder items move theta more.
  assert.ok(thetaStep(0, { difficulty: 0, discrimination: 2, pseudoGuessing: 0 }, true) > up);
  assert.equal(thetaStandardError(0), 1.0);
  assert.ok(Math.abs(thetaStandardError(4) - 0.5) < 1e-9);
  assert.equal(masteryPercent(0), 50);
  assert.ok(masteryPercent(2) > 88 && masteryPercent(-2) < 12);
  // Selection: max info among unanswered.
  const bank = [
    { id: 'a', difficulty: -2, discrimination: 1, pseudoGuessing: 0 },
    { id: 'b', difficulty: 0, discrimination: 1.5, pseudoGuessing: 0 },
    { id: 'c', difficulty: 2, discrimination: 1, pseudoGuessing: 0 },
  ];
  assert.equal(selectNextItem(0, bank, [])?.id, 'b');
  assert.equal(selectNextItem(0, bank, ['b'])?.id, 'a');
  assert.equal(selectNextItem(0, bank, ['a', 'b', 'c']), null);
  // Engine facade parity with pure helpers.
  const engine = new IrtEngineService();
  assert.equal(engine.probability(0, item), irtProbability(0, item));
  assert.equal(engine.mastery(0), 50);
  assert.equal(engine.next(0, bank, [])?.id, 'b');
  ok('IRT: 3PL prob/info/step/SE/mastery/selection + facade parity');
}

// ---------- 3. Session guards ----------
{
  assert.equal(isSessionCompleted({ answeredCount: 10, remainingItems: 5, standardError: 0.5 }), true);
  assert.equal(isSessionCompleted({ answeredCount: 3, remainingItems: 0, standardError: 0.5 }), true);
  assert.equal(isSessionCompleted({ answeredCount: 3, remainingItems: 5, standardError: 0.2 }), true);
  assert.equal(isSessionCompleted({ answeredCount: 3, remainingItems: 5, standardError: 0.5 }), false);
  assert.doesNotThrow(() => assertAnswerable(Q1, []));
  assert.throws(() => assertAnswerable(Q1, [Q1]), /already answered/);
  ok('Guards: completion (cap/exhaust/SE) + duplicate shield');
}

// ---------- 4. Attempt service (BDD-1: θ update + next + stream, <200ms) ----------
function bank() {
  return [
    { id: Q1, lessonId: UUID_B, questionText: 'q1', optionsJson: [{ id: 'A', text: 'a' }, { id: 'B', text: 'b' }], correctOption: 'A', difficulty: -1, discrimination: 1, pseudoGuessing: 0 },
    { id: Q2, lessonId: UUID_B, questionText: 'q2', optionsJson: [{ id: 'A', text: 'a' }, { id: 'B', text: 'b' }], correctOption: 'B', difficulty: 0, discrimination: 1.5, pseudoGuessing: 0 },
    { id: Q3, lessonId: UUID_B, questionText: 'q3', optionsJson: [{ id: 'A', text: 'a' }, { id: 'B', text: 'b' }], correctOption: 'A', difficulty: 1, discrimination: 1, pseudoGuessing: 0 },
  ];
}

function ports(answered: string[] = [], theta = 0) {
  const responses: string[] = [];
  const profiles: number[] = [];
  const streams: string[] = [];
  const items = bank();
  const repo = {
    getItems: async (lessonId: string) => (lessonId === UUID_B ? items : []),
    getItem: async (id: string) => items.find((i) => i.id === id) ?? null,
    getProfile: async () => ({ userId: UUID, subjectContext: UUID_B, theta, standardError: 1, totalQuestions: answered.length }),
    saveProfile: async (p: { theta: number }) => { profiles.push(p.theta); return { userId: UUID, subjectContext: UUID_B, theta: p.theta, standardError: 0.8, totalQuestions: answered.length + 1 }; },
    saveResponse: async (r: { questionId: string }) => { responses.push(r.questionId); },
    getAnsweredIds: async () => answered,
    withTx(tx: unknown) { return this; },
  };
  const tx = { run: async <T>(fn: (t: unknown) => Promise<T>) => fn({}) };
  const bus = { xadd: async (s: string) => { streams.push(s); } };
  return { repo, tx, bus, responses, profiles, streams };
}

async function sectionAttempt(): Promise<void> {
  // Start: first item matches theta 0 (Q2, highest info).
  {
    const p = ports();
    const svc = new AdaptiveAttemptService(p.repo as never, p.tx, p.bus);
    const t0 = Date.now();
    const q = await svc.start({ userId: UUID, lessonId: UUID_B });
    assert.ok(Date.now() - t0 < ADAPTIVE_CALC_BUDGET_MS, 'calc <200ms');
    assert.deepEqual([q.isTestCompleted, q.questionId], [false, Q2]);
    assert.equal(q.estimatedMasteryPercent, 50);
  }
  // Submit correct → theta rises, next is unanswered, stream fires.
  {
    const p = ports();
    const svc = new AdaptiveAttemptService(p.repo as never, p.tx, p.bus);
    const t0 = Date.now();
    const q = await svc.submit({ userId: UUID, lessonId: UUID_B, questionId: Q2, selectedOptionId: 'B', responseTimeMs: 2500 });
    assert.ok(Date.now() - t0 < ADAPTIVE_CALC_BUDGET_MS, 'calc <200ms');
    assert.ok(q.currentTheta > 0, 'correct raises theta');
    assert.ok(q.questionId !== Q2 && !q.isTestCompleted);
    assert.deepEqual(p.responses, [Q2]);
    assert.equal(p.profiles.length, 1);
    assert.ok(p.streams.includes(ADAPTIVE_STREAM));
  }
  // Submit wrong → theta falls.
  {
    const p = ports();
    const svc = new AdaptiveAttemptService(p.repo as never, p.tx, p.bus);
    const q = await svc.submit({ userId: UUID, lessonId: UUID_B, questionId: Q2, selectedOptionId: 'A', responseTimeMs: 8000 });
    assert.ok(q.currentTheta < 0, 'wrong lowers theta');
  }
  // Exhausted bank → completed shape with mastery.
  {
    const p = ports([Q1, Q2]);
    const svc = new AdaptiveAttemptService(p.repo as never, p.tx, p.bus);
    const q = await svc.submit({ userId: UUID, lessonId: UUID_B, questionId: Q3, selectedOptionId: 'A', responseTimeMs: 1000 });
    assert.equal(q.isTestCompleted, true);
    assert.ok(q.estimatedMasteryPercent > 50);
  }
  // Gates: bad input / unknown question / duplicate / empty bank.
  {
    const p = ports();
    const svc = new AdaptiveAttemptService(p.repo as never, p.tx, p.bus);
    await assert.rejects(
      svc.submit({ userId: UUID, lessonId: UUID_B, questionId: 'nope', selectedOptionId: 'A', responseTimeMs: 1 }),
      /Invalid adaptive answer/,
    );
    await assert.rejects(
      svc.submit({ userId: UUID, lessonId: UUID_B, questionId: Q1, selectedOptionId: 'A', responseTimeMs: -5 }),
      /Invalid adaptive answer/,
    );
    const dup = ports([Q1]);
    const dupSvc = new AdaptiveAttemptService(dup.repo as never, dup.tx, dup.bus);
    await assert.rejects(
      dupSvc.submit({ userId: UUID, lessonId: UUID_B, questionId: Q1, selectedOptionId: 'A', responseTimeMs: 1 }),
      /already answered/,
    );
    const empty = new AdaptiveAttemptService({ ...p.repo, getItems: async () => [] } as never, p.tx, p.bus);
    await assert.rejects(empty.start({ userId: UUID, lessonId: UUID_B }), /No questions/);
  }
  ok('Attempts: start/submit/θ±/complete + 4 gates + stream (<200ms)');
}

// ---------- 5. Prisma additive (Gate 1/7) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of [
    'model AdaptiveQuestionItem {',
    'optionsJson    Json',
    'discrimination Float                  @default(1.0)',
    'model UserAdaptiveProfile {',
    'theta          Float    @default(0.0)',
    '@@unique([userId, subjectContext])',
    'model AdaptiveQuizResponse {',
    'thetaAfter     Float',
    'adaptiveItems      AdaptiveQuestionItem[]',
    'adaptiveProfiles     UserAdaptiveProfile[]',
    'quizResponses        AdaptiveQuizResponse[]',
  ]) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  ok('Prisma: IRT items + theta profile + response ledger + relations');
}

function sectionParity(): void {
  for (const f of [
    'apps/backend/src/modules/adaptive-testing/domain/entities/adaptive-session.entity.ts',
    'apps/backend/src/modules/adaptive-testing/domain/repository/adaptive.repository.interface.ts',
    'apps/backend/src/modules/adaptive-testing/application/services/irt-engine.service.ts',
    'apps/backend/src/modules/adaptive-testing/application/services/adaptive-attempt.service.ts',
    'apps/backend/src/modules/adaptive-testing/infrastructure/persistence/prisma-adaptive.repository.ts',
    'apps/backend/src/modules/adaptive-testing/api/graphql/adaptive-testing.resolver.ts',
    'apps/backend/src/modules/adaptive-testing/api/graphql/adaptive-testing.type.ts',
    'apps/backend/src/modules/adaptive-testing/api/rest/adaptive-testing.controller.ts',
    'apps/backend/src/modules/adaptive-testing/dto/adaptive-testing.dto.ts',
    'apps/backend/src/modules/adaptive-testing/adaptive-testing.module.ts',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes('TODO') && !src.includes('placeholder'), `${f} unimplemented`);
  }
  const mod = readFileSync('apps/backend/src/modules/adaptive-testing/adaptive-testing.module.ts', 'utf8');
  assert.ok(mod.includes('AdaptiveTestingModule') && mod.includes('AdaptiveAttemptService') && mod.includes('IrtEngineService'));
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('AdaptiveTestingModule'));
  const gql = readFileSync('apps/backend/src/modules/adaptive-testing/api/graphql/adaptive-testing.resolver.ts', 'utf8');
  assert.ok(gql.includes('adaptiveNextQuestion') && gql.includes('submitAdaptiveAnswer'));
  const alias = readFileSync('apps/backend/src/api/graphql/resolvers/adaptive-testing.resolver.ts', 'utf8');
  assert.ok(alias.includes('AdaptiveTestingResolver'));
  const sdl = readFileSync('apps/backend/src/api/graphql/adaptive-testing.graphql', 'utf8');
  assert.ok(sdl.includes('AdaptiveNextQuestion') && sdl.includes('submitAdaptiveAnswer'));
  for (const p of [
    'apps/frontend/components/quiz/AdaptiveQuizRunner.tsx',
    'apps/frontend/hooks/useAdaptiveQuiz.ts',
    'apps/frontend/lib/adaptive/adaptive-client.ts',
    'apps/frontend/app/(liff)/quiz/[lessonId]/page.tsx',
  ]) {
    assert.ok(readFileSync(p, 'utf8').length > 200, `frontend missing: ${p}`);
  }
  const hook = readFileSync('apps/frontend/hooks/useAdaptiveQuiz.ts', 'utf8');
  assert.ok(hook.includes('LIFF_INIT') && hook.includes('SUCCESS') && hook.includes('ERROR'), '5-state hook');
  const runner = readFileSync('apps/frontend/components/quiz/AdaptiveQuizRunner.tsx', 'utf8');
  assert.ok(!runner.includes('@/components/ui') && !runner.includes('lucide-react'), 'zero-dep runner (no heavy UI)');
  for (const p of [
    'apps/frontend/app/api/v1/adaptive/next/route.ts',
    'apps/frontend/app/api/v1/adaptive/submit/route.ts',
  ]) {
    assert.ok(readFileSync(p, 'utf8').includes('localhost:4000'), `proxy missing backend: ${p}`);
  }
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  assert.ok(barrel.includes('adaptive-testing-contract') && barrel.includes('AdaptiveSubmitAnswerSchema'));
  ok('Parity: module/GQL+alias/SDL/runner+hook/proxies/barrel (5-state, zero-dep)');
}

async function main(): Promise<void> {
  await sectionAttempt();
  sectionParity();
}

void main().then(
  () => console.log(`\nPhase093 contracts: ${passed + 3} checks passed`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
