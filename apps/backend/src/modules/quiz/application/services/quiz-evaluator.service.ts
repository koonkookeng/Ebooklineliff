// SSOT Phase 047 Task 3/4 — QuizEvaluatorService (zero-trust grading + unlock token)
// Canonical: apps/backend/src/modules/quiz/application/services/quiz-evaluator.service.ts
// (legacy src/backend/modules/quiz/application/services/quiz-evaluator.service.ts)
// - Grading: choice quizzes exact-set match; TRUE_FALSE single-option;
//   SHORT_ANSWER normalized compare against the stored answerKey; legacy
//   Phase 037 rows (empty options table) fall back to answerKey matching.
// - Attempt budget enforced (maxRetries 0 = unlimited); attempts recorded
//   with attemptCount; passes upsert lesson progress (Gate 7 atomic via repo).
// - Unlock token: HMAC(`quiz:{quizId}:{userId}:{exp}`) 10-minute window
//   (spec §5.2 nextSegmentToken; no jsonwebtoken dep — verifyQuizToken is
//   exported for the future segment gate, Phase 053 seam).
// - Correct answers NEVER leave the server (Gate 4); hints escalate without
//   revealing options.
// - tsx-safe (no param decorators). Zero new deps.
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  isChoiceCorrect,
  normalizeShortAnswer,
  SubmitQuizAnswerInputSchema,
  type QuizEvaluationResult,
  type SubmitQuizAnswerInput,
} from '@repo/shared';
import type { LessonQuizRow, QuizRepository } from '../../domain/repositories/quiz.repository';
import { AiHintGeneratorService } from './ai-hint-generator.service';

export const QUIZ_UNLOCK_WINDOW_SEC = 600;

function hmacEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length || ba.length === 0) return false;
  try {
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

export function signQuizToken(quizId: string, userId: string, expiresAtMs: number, secret: string): string {
  const sig = createHmac('sha256', secret).update(`quiz:${quizId}:${userId}:${expiresAtMs}`).digest('hex');
  return `${expiresAtMs}.${sig}`;
}

export function verifyQuizToken(quizId: string, userId: string, token: string, secret: string): boolean {
  const [expRaw, sig] = token.split('.');
  const exp = Number(expRaw);
  if (!Number.isInteger(exp) || exp <= Date.now() || !sig) return false;
  return hmacEqual(signQuizToken(quizId, userId, exp, secret), token);
}

function gradeQuiz(quiz: LessonQuizRow, input: SubmitQuizAnswerInput): boolean {
  if (quiz.quizType === 'SHORT_ANSWER') {
    if (!input.shortAnswerText) return false;
    return normalizeShortAnswer(input.shortAnswerText) === normalizeShortAnswer(quiz.answerKey);
  }
  if (quiz.options.length > 0) {
    const correctIds = quiz.options.filter((o) => o.isCorrect).map((o) => o.id);
    return isChoiceCorrect(correctIds, input.selectedOptionIds);
  }
  // Legacy fallback: single stored answer id.
  return input.selectedOptionIds.length === 1 && input.selectedOptionIds[0] === quiz.answerKey;
}

@Injectable()
export class QuizEvaluatorService {
  // NOTE: Module wires via useFactory (no param decorators — tsx-safe).
  constructor(
    private readonly quizzes?: QuizRepository,
    private readonly hints?: AiHintGeneratorService,
    private readonly tokenSecret: string = process.env.QUIZ_TOKEN_SECRET || process.env.APP_SECRET || 'AHONG_EMERALD_SECRET_KEY_999',
    private readonly onAttempt?: (event: { userId: string; lessonId: string; quizId: string; timestampSec: number; isCorrect: boolean; attemptNumber: number }) => void,
  ) {}

  async evaluateSubmission(userId: string, rawInput: unknown): Promise<QuizEvaluationResult> {
    const parsed = SubmitQuizAnswerInputSchema.safeParse(rawInput);
    if (!parsed.success) throw new BadRequestException('Invalid quiz submission');
    if (!this.quizzes) throw new NotFoundException('Quiz engine unavailable');
    const input = parsed.data;

    const quiz = await this.quizzes.findQuizWithOptions(input.quizId).catch(() => null);
    if (!quiz || quiz.lessonId !== input.lessonId) throw new NotFoundException('In-Video Quiz not found');

    const priorAttempts = await this.quizzes.countUserAttempts(userId, quiz.id).catch(() => 0);
    if (quiz.maxRetries > 0 && priorAttempts >= quiz.maxRetries) {
      throw new BadRequestException('Retry budget exhausted');
    }
    const attemptNumber = priorAttempts + 1;
    const correct = gradeQuiz(quiz, input);
    const earnedScore = correct ? quiz.passScore : 0;

    await this.quizzes.recordAttempt({
      userId,
      quizId: quiz.id,
      isPassed: correct,
      selectedOpts: input.selectedOptionIds,
      shortAnswer: input.shortAnswerText,
      scoreObtained: earnedScore,
      attemptCount: attemptNumber,
    });
    if (correct) {
      await this.quizzes.markLessonProgress(userId, input.lessonId, Math.floor(input.playbackTimeSec)).catch(() => undefined);
    }
    try {
      this.onAttempt?.({ userId, lessonId: input.lessonId, quizId: quiz.id, timestampSec: quiz.timestampSec, isCorrect: correct, attemptNumber });
    } catch {
      // Analytics must never fail grading (<1s Gate 7).
    }

    if (correct) {
      const expiresAt = Date.now() + QUIZ_UNLOCK_WINDOW_SEC * 1000;
      return {
        success: true,
        isCorrect: true,
        earnedScore,
        explanation: quiz.explanation ?? undefined,
        nextSegmentToken: signQuizToken(quiz.id, userId, expiresAt, this.tokenSecret),
      };
    }
    const aiHint = this.hints
      ? this.hints.hintFor(quiz.explanation ?? null, quiz.aiPromptContext, attemptNumber)
      : 'ทบทวนเนื้อหาในนาทีที่ผ่านมาก่อนตอบอีกครั้ง';
    return { success: true, isCorrect: false, earnedScore: 0, aiHint };
  }
}
