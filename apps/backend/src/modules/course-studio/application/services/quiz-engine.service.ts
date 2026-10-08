// SSOT Phase 078 BDD-3/Task 6 — Studio quiz builder service (CRUD)
// Canonical: apps/backend/src/modules/course-studio/application/services/quiz-engine.service.ts
// - saveLessonQuiz: Zod gate -> lesson ownership -> builder invariants ->
//   upsert quiz + replace options (attempt grading stays in the 047 engine).
// - deleteLessonQuiz: ownership -> delete (options cascade).
// - Port-based for DB-free tests. Zero new deps.
import { BadRequestException, Injectable } from '@nestjs/common';
import { StudioLessonQuizSchema } from '@repo/shared';
import { assertCourseOwnership, assertStudioTenant } from '../../domain/entities/course-section.entity';
import { assertQuizBuildable } from '../../domain/entities/lesson-quiz.entity';
import type { CourseStudioRepository } from '../../domain/repositories/course-studio.repository.interface';

@Injectable()
export class QuizEngineService {
  constructor(private readonly repo: CourseStudioRepository) {}

  async saveLessonQuiz(
    headerTenantId: string | undefined,
    actor: { userId: string; role: string | undefined },
    body: unknown,
  ): Promise<{ id: string }> {
    const parsed = StudioLessonQuizSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid quiz payload');
    const quiz = parsed.data;
    assertQuizBuildable(quiz.options, quiz.question);

    const owner = await this.repo.findLessonOwner(quiz.lessonId);
    if (!owner) throw new BadRequestException('Lesson not found');
    assertStudioTenant(headerTenantId, owner.tenantId);
    assertCourseOwnership(owner.sellerId, actor.userId, actor.role);

    return this.repo.saveQuiz({
      id: quiz.id,
      lessonId: quiz.lessonId,
      question: quiz.question,
      explanation: quiz.explanation,
      points: quiz.points,
      options: quiz.options,
    });
  }

  async deleteLessonQuiz(
    headerTenantId: string | undefined,
    actor: { userId: string; role: string | undefined },
    quizId: string,
  ): Promise<boolean> {
    const owner = await this.repo.findQuizOwner(quizId);
    if (!owner) throw new BadRequestException('Quiz not found');
    assertStudioTenant(headerTenantId, owner.tenantId);
    assertCourseOwnership(owner.sellerId, actor.userId, actor.role);
    await this.repo.deleteQuiz(quizId);
    return true;
  }
}
