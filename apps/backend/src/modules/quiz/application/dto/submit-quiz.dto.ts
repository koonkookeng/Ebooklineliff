// SSOT Phase 047 — Quiz DTO (Zod SSOT re-export)
// Canonical: apps/backend/src/modules/quiz/application/dto/submit-quiz.dto.ts
// (legacy src/backend/modules/quiz/application/dto/submit-quiz.dto.ts)
// - Single source: packages/shared/src/schemas/quiz-contract.ts.
import { QuizEvaluationResultSchema, SubmitQuizAnswerInputSchema } from '@repo/shared';
import type { QuizEvaluationResult, SubmitQuizAnswerInput } from '@repo/shared';

export { QuizEvaluationResultSchema, SubmitQuizAnswerInputSchema };
export type SubmitQuizDto = SubmitQuizAnswerInput;
export type QuizEvaluationDto = QuizEvaluationResult;
