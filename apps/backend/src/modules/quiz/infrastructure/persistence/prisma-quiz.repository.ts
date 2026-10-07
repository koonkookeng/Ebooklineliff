// SSOT Phase 047 §5.1 — PrismaQuizRepository (port adapter)
// Canonical: apps/backend/src/modules/quiz/infrastructure/persistence/prisma-quiz.repository.ts
// (legacy src/backend/modules/quiz/infrastructure/persistence/prisma-quiz.repository.ts)
// - Structural Prisma tables (tsx-safe); attempt + progress land in one
//   $transaction (Gate 7 atomic, <1s).
// - Normalized options table is authoritative; legacy optionsJson/answerKey
//   rows (Phase 037) surface with empty options so the evaluator falls back
//   to the stored answerKey (ADR-047).
// - Zero new deps.
import type { LessonQuizRow, QuizRepository } from '../../domain/repositories/quiz.repository';

export interface PrismaQuizTables {
  lessonQuiz: {
    findUnique(args: unknown): Promise<{
      id: string;
      lessonId: string;
      timestampSec: number;
      question: string;
      quizType: string;
      passScore: number;
      maxRetries: number;
      explanation: string | null;
      aiPromptContext: string | null;
      answerKey: string;
      options: Array<{ id: string; optionText: string; optionOrder: number; isCorrect: boolean }>;
    } | null>;
    findMany(args: unknown): Promise<Array<{
      id: string;
      lessonId: string;
      timestampSec: number;
      question: string;
      quizType: string;
      passScore: number;
      maxRetries: number;
      explanation: string | null;
      aiPromptContext: string | null;
      answerKey: string;
      options: Array<{ id: string; optionText: string; optionOrder: number; isCorrect: boolean }>;
    }>>;
  };
  quizAttempt: {
    count(args: unknown): Promise<number>;
    create(args: unknown): Promise<{ id: string; attemptCount: number }>;
  };
  courseLearningProgress: {
    upsert(args: unknown): Promise<unknown>;
  };
  $transaction<T>(run: (tx: PrismaQuizTables) => Promise<T>): Promise<T>;
}

function toRow(row: {
  id: string;
  lessonId: string;
  timestampSec: number;
  question: string;
  quizType: string;
  passScore: number;
  maxRetries: number;
  explanation: string | null;
  aiPromptContext: string | null;
  answerKey: string;
  options: Array<{ id: string; optionText: string; optionOrder: number; isCorrect: boolean }>;
}): LessonQuizRow {
  // answerKey stays internal (evaluator fallback only — never serialized).
  return { ...row, explanationHint: null };
}

export class PrismaQuizRepository implements QuizRepository {
  // NOTE: Module wires via useFactory (no param decorators — tsx-safe).
  constructor(private readonly tables?: PrismaQuizTables) {}

  private get db(): PrismaQuizTables {
    if (!this.tables) throw new Error('Quiz store unavailable');
    return this.tables;
  }

  async findQuizWithOptions(quizId: string): Promise<LessonQuizRow | null> {
    const row = await this.db.lessonQuiz.findUnique({ where: { id: quizId }, include: { options: { orderBy: { optionOrder: 'asc' } } } }).catch(() => null);
    return row ? toRow(row) : null;
  }

  async listLessonQuizzes(lessonId: string): Promise<LessonQuizRow[]> {
    const rows = await this.db.lessonQuiz
      .findMany({ where: { lessonId }, include: { options: { orderBy: { optionOrder: 'asc' } } }, orderBy: { timestampSec: 'asc' } })
      .catch(() => []);
    return rows.map(toRow);
  }

  async countUserAttempts(userId: string, quizId: string): Promise<number> {
    return this.db.quizAttempt.count({ where: { userId, quizId } }).catch(() => 0);
  }

  async recordAttempt(input: {
    userId: string;
    quizId: string;
    isPassed: boolean;
    selectedOpts: string[];
    shortAnswer?: string;
    scoreObtained: number;
    attemptCount: number;
  }): Promise<{ id: string; attemptCount: number }> {
    return this.db.$transaction(async (tx) => {
      const record = await tx.quizAttempt.create({
        data: {
          userId: input.userId,
          quizId: input.quizId,
          isPassed: input.isPassed,
          selectedOpts: input.selectedOpts,
          shortAnswer: input.shortAnswer,
          scoreObtained: input.scoreObtained,
          attemptCount: input.attemptCount,
        },
      });
      return { id: record.id, attemptCount: input.attemptCount };
    });
  }

  async markLessonProgress(userId: string, lessonId: string, watchedSec: number): Promise<void> {
    await this.db.courseLearningProgress
      .upsert({
        where: { userId_lessonId: { userId, lessonId } },
        create: { userId, lessonId, watchedSec: Math.max(0, Math.floor(watchedSec)) },
        update: { watchedSec: Math.max(0, Math.floor(watchedSec)) },
      })
      .catch(() => undefined);
  }
}
