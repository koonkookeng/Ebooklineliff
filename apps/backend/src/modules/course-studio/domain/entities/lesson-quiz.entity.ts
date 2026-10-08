// SSOT Phase 078 §5 — Lesson quiz entity (builder invariants)
// Canonical: apps/backend/src/modules/course-studio/domain/entities/lesson-quiz.entity.ts
// - Guards: >= 2 options, >= 1 correct answer, question >= 3 chars.
//   (Attempt-time grading lives in the 047 quiz engine — no duplication.)
// - Zero new deps.
import { BadRequestException } from '@nestjs/common';

export function assertQuizBuildable(options: Array<{ optionText: string; isCorrect: boolean }>, question: string): void {
  if (question.trim().length < 3) throw new BadRequestException('Question must be at least 3 characters');
  if (options.length < 2) throw new BadRequestException('At least 2 options required');
  if (!options.some((o) => o.isCorrect)) throw new BadRequestException('At least 1 correct answer required');
  if (!options.every((o) => o.optionText.trim().length > 0)) {
    throw new BadRequestException('Option text cannot be empty');
  }
}
