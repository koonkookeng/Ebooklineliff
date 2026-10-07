# ADR-047: In-Video Interactive Quiz (Pause-Lock, Zero-Trust Grading)

- Status: Accepted (Atomic Phase 047, PHASE-047-INVIDEO-QUIZ)
- Date: 2026-10-07
- SSOT: `packages/shared/src/schemas/quiz-contract.ts`
  (`QuizTypeEnum`, `QuizOptionSchema`, `InVideoQuizDetailSchema`,
  `SubmitQuizAnswerInputSchema`, `QuizEvaluationResultSchema`)
  + `packages/db/prisma/schema.prisma` (LessonQuiz expanded with defaulted
  checkpoint columns, `QuizOption`/`QuizAttempt`/`QuizType` added,
  `User.quizAttempts` back-relation; client regenerated, zero destructive
  changes)

## Context

Checkpoints must freeze playback until passed, grade server-side without ever
exposing answers, and unlock the next segment — reusing the stream delivery
and progress layers, with no LLM, BullMQ, or media dependencies.

## Decision

1. **Expand, don't replace**: the Phase 037 `LessonQuiz` shape
   (optionsJson/answerKey) keeps working — new columns are defaulted and the
   evaluator prefers the normalized options table, falling back to answerKey
   single-match for legacy rows.
2. **Zero-trust grading**: exact-set choice match, normalized short-answer,
   retry budgets (0 = unlimited), attemptCount persisted, progress upsert on
   pass only; unlock tokens are HMAC (`quiz:{quizId}:{userId}:{exp}`, 10min)
   with an exported verifier for the future segment gate (no jsonwebtoken dep).
3. **Hints without leakage**: rule-based escalation (hint → hint + metaphor +
   focus) that never names options; correctness crosses to the client only as
   the user's own verdict (SDL carries a single `isCorrect`, asserted).
4. **One field, one owner**: `syncLessonProgress` collisions are avoided by
   naming (`syncLessonProgressBuffered`); the api-tree quiz resolver is a
   re-export alias (Phase 039 precedent). Sanitization is enforced at both
   REST and GQL read boundaries (asserted in tests).
5. **Client**: pause-lock + scrub clamp (<100ms snap-back), resume at T+0.1s,
   overlay machine mirroring the server session 1:1, lesson page renders the
   quiz player only when checkpoints exist (045 path untouched otherwise).
6. **Secrets/PII**: no keys/answers in logs; attempt events carry ids only.

## Consequences

- `scripts/test-phase047-contracts.ts`: 7 checks ×3 loops; regressions
  044/045/046 green; frontend clean, backend 0 new type errors (1 pre-existing
  legacy alias), Prisma valid + generated.
- Follow-ups (out of scope): segment-gate token enforcement in the worker,
  AI-generated explanations via the Phase 092 companion, educator quiz
  authoring console.
