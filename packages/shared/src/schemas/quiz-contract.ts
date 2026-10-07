// SSOT Phase 047 Task 2 — In-video quiz Zod contract
// Canonical: packages/shared/src/schemas/quiz-contract.ts
// (legacy src/shared/schemas/quiz-contract.ts)
// - Spec-verbatim: QuizTypeEnum / QuizOptionSchema / InVideoQuizDetailSchema /
//   SubmitQuizAnswerInputSchema / QuizEvaluationResultSchema (§3.1 Gate 1).
// - Additive (zero-dep): checkpoint sanitizer (strips isCorrect for the
//   client, Gate 4), scoring helpers, attempt event envelope (§7.1).
import { z } from 'zod';

export const QuizTypeEnum = z.enum(['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'TRUE_FALSE', 'SHORT_ANSWER']);
export type QuizType = z.infer<typeof QuizTypeEnum>;

export const QuizOptionSchema = z.object({
  id: z.string().uuid(),
  optionText: z.string().min(1),
  optionOrder: z.number().int(),
});
export type QuizOption = z.infer<typeof QuizOptionSchema>;

export const InVideoQuizDetailSchema = z.object({
  id: z.string().uuid(),
  lessonId: z.string().uuid(),
  timestampSec: z.number().int().nonnegative(),
  question: z.string().min(1),
  quizType: QuizTypeEnum,
  options: z.array(QuizOptionSchema),
  passScore: z.number().default(100),
  maxRetries: z.number().int().default(0),
  explanationHint: z.string().optional(),
});
export type InVideoQuizDetail = z.infer<typeof InVideoQuizDetailSchema>;

export const SubmitQuizAnswerInputSchema = z.object({
  quizId: z.string().uuid(),
  lessonId: z.string().uuid(),
  selectedOptionIds: z.array(z.string().uuid()),
  shortAnswerText: z.string().optional(),
  playbackTimeSec: z.number(),
});
export type SubmitQuizAnswerInput = z.infer<typeof SubmitQuizAnswerInputSchema>;

export const QuizEvaluationResultSchema = z.object({
  success: z.boolean(),
  isCorrect: z.boolean(),
  earnedScore: z.number(),
  explanation: z.string().optional(),
  aiHint: z.string().optional(),
  nextSegmentToken: z.string().optional(),
});
export type QuizEvaluationResult = z.infer<typeof QuizEvaluationResultSchema>;

/** Checkpoint rows as the client may see them (Gate 4: never isCorrect). */
export const QuizCheckpointSchema = InVideoQuizDetailSchema.omit({ passScore: true, maxRetries: true }).extend({
  passScore: z.number().optional(),
  maxRetries: z.number().int().optional(),
});
export type QuizCheckpoint = z.infer<typeof QuizCheckpointSchema>;

/** Strip answer keys + internal tuning before serving checkpoints. */
export function sanitizeCheckpoint<T extends { options: Array<Record<string, unknown>> }>(quiz: T): Omit<T, 'options'> & { options: QuizOption[] } {
  return {
    ...quiz,
    options: quiz.options.map((o) => ({ id: o['id'], optionText: o['optionText'], optionOrder: o['optionOrder'] })) as QuizOption[],
  };
}

/** Exact-set match for choice quizzes (order-insensitive, dup-insensitive). */
export function isChoiceCorrect(correctIds: string[], selectedIds: string[]): boolean {
  const expected = new Set(correctIds);
  const actual = new Set(selectedIds);
  return expected.size === actual.size && [...expected].every((id) => actual.has(id));
}

/** Normalized comparison for short answers (trim + casefold + collapse). */
export function normalizeShortAnswer(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** §7.1 attempt analytics envelope (ids only — no PII beyond hashes). */
export const QuizAttemptEventSchema = z.object({
  eventType: z.literal('INVIDEO_QUIZ_ATTEMPT'),
  userId: z.string().min(1),
  lessonId: z.string().uuid(),
  quizId: z.string().uuid(),
  timestampSec: z.number().int().nonnegative(),
  isCorrect: z.boolean(),
  attemptNumber: z.number().int().positive(),
});
export type QuizAttemptEvent = z.infer<typeof QuizAttemptEventSchema>;
