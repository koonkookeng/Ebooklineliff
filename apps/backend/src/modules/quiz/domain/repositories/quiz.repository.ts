// SSOT Phase 047 §5.1 — Quiz repository port (structural, tsx-safe)
// Canonical: apps/backend/src/modules/quiz/domain/repositories/quiz.repository.ts
// (legacy src/backend/modules/quiz/domain/repositories/quiz.repository.ts)
// - The evaluator depends ONLY on this port; the Prisma adapter lives in
//   infrastructure/persistence (single swap point).
// - Zero new deps.
export interface QuizOptionRow {
  id: string;
  optionText: string;
  optionOrder: number;
  isCorrect: boolean;
}

export interface LessonQuizRow {
  id: string;
  lessonId: string;
  timestampSec: number;
  question: string;
  quizType: string;
  passScore: number;
  maxRetries: number;
  explanation: string | null;
  explanationHint?: string | null;
  aiPromptContext: string | null;
  /** Legacy Phase 037 answer key (internal only — never serialized, Gate 4). */
  answerKey: string;
  options: QuizOptionRow[];
}

export interface QuizAttemptRow {
  id: string;
  attemptCount: number;
}

export interface QuizRepository {
  findQuizWithOptions(quizId: string): Promise<LessonQuizRow | null>;
  listLessonQuizzes(lessonId: string): Promise<LessonQuizRow[]>;
  countUserAttempts(userId: string, quizId: string): Promise<number>;
  recordAttempt(input: {
    userId: string;
    quizId: string;
    isPassed: boolean;
    selectedOpts: string[];
    shortAnswer?: string;
    scoreObtained: number;
    attemptCount: number;
  }): Promise<QuizAttemptRow>;
  markLessonProgress(userId: string, lessonId: string, watchedSec: number): Promise<void>;
}
