// SSOT Phase 078 §5 — Prisma course-studio repository (owner-scoped)
// Canonical: apps/backend/src/modules/course-studio/infrastructure/repositories/prisma-course-studio.repository.ts
// - Structural typing (077 precedent); ownership resolves through
//   Product.sellerId so the curriculum stays seller-isolated (BDD-1).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../infra/database/prisma.service';
import type { CourseStudioRepository, StudioCourseRow } from '../../domain/repositories/course-studio.repository.interface';

type Db = Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>>;

async function ownerOf(db: Db, courseId: string): Promise<{ sellerId: string | null; tenantId: string | null }> {
  const detail = (await db['courseDetail'].findFirst({
    where: { id: courseId },
    include: { product: true },
  }).catch(() => null)) as { product: { sellerId: string | null; tenantId: string | null } | null } | null;
  return { sellerId: detail?.product?.sellerId ?? null, tenantId: detail?.product?.tenantId ?? null };
}

function toRepo(db: Db): CourseStudioRepository {
  return {
    async findCourse(courseId: string): Promise<StudioCourseRow | null> {
      const detail = (await db['courseDetail'].findFirst({ where: { id: courseId } }).catch(() => null)) as { id: string } | null;
      if (!detail) return null;
      const owner = await ownerOf(db, courseId);
      return { courseId, sellerId: owner.sellerId, tenantId: owner.tenantId };
    },

    async findLessonOwner(lessonId: string) {
      const lesson = (await db['courseLesson'].findUnique({
        where: { id: lessonId },
        include: { section: true },
      }).catch(() => null)) as { section: { courseId: string } } | null;
      if (!lesson) return null;
      const owner = await ownerOf(db, lesson.section.courseId);
      return { courseId: lesson.section.courseId, sellerId: owner.sellerId, tenantId: owner.tenantId };
    },

    async loadStructure(courseId: string) {
      const sections = (await db['courseSection'].findMany({
        where: { courseId },
        include: { lessons: true },
        orderBy: { sectionOrder: 'asc' },
      }).catch(() => [])) as Array<{
        id: string; courseId: string; sectionOrder: number; title: string;
        lessons: Array<{
          id: string; sectionId: string; lessonOrder: number; title: string;
          videoHlsUrl: string | null; durationSec: number; isPreview: boolean; transcodeStatus: string;
        }>;
      }>;
      return {
        sections: sections.map((s) => ({
          ...s,
          lessons: [...s.lessons].sort((a, b) => a.lessonOrder - b.lessonOrder),
        })),
      };
    },

    async applySectionOrder(sectionId: string, sectionOrder: number): Promise<void> {
      await db['courseSection'].update({ where: { id: sectionId }, data: { sectionOrder } });
    },

    async applyLessonOrder(lessonId: string, sectionId: string, lessonOrder: number): Promise<void> {
      await db['courseLesson'].update({ where: { id: lessonId }, data: { sectionId, lessonOrder } });
    },

    async transcodeOf(lessonId: string): Promise<string | null> {
      const lesson = (await db['courseLesson'].findUnique({ where: { id: lessonId } }).catch(() => null)) as {
        transcodeStatus: string;
      } | null;
      return lesson?.transcodeStatus ?? null;
    },

    async markTranscoding(lessonId: string, rawStorageKey: string): Promise<void> {
      await db['courseLesson'].update({
        where: { id: lessonId },
        data: { rawStorageKey, transcodeStatus: 'PROCESSING' },
      });
    },

    async applyHlsCompletion(lessonId: string, videoHlsUrl: string, durationSec: number): Promise<void> {
      await db['courseLesson'].update({
        where: { id: lessonId },
        data: { videoHlsUrl, durationSec, transcodeStatus: 'COMPLETED' },
      });
    },

    async markTranscodeFailed(lessonId: string, _errorMessage: string): Promise<void> {
      await db['courseLesson'].update({
        where: { id: lessonId },
        data: { transcodeStatus: 'FAILED' },
      });
    },

    async saveQuiz(args: {
      id: string | undefined; lessonId: string; question: string; explanation: string | undefined;
      points: number; options: Array<{ id: string; optionText: string; isCorrect: boolean }>;
    }) {
      if (args.id) {
        await db['lessonQuiz'].update({
          where: { id: args.id },
          data: { question: args.question, explanation: args.explanation ?? null, points: args.points },
        });
        await db['quizOption'].deleteMany({ where: { quizId: args.id } }).catch(() => null);
        for (const [ix, o] of args.options.entries()) {
          await db['quizOption'].create({
            data: { quizId: args.id, optionText: o.optionText, isCorrect: o.isCorrect, optionOrder: ix },
          });
        }
        return { id: args.id };
      }
      const quiz = (await db['lessonQuiz'].create({
        data: {
          lessonId: args.lessonId,
          question: args.question,
          explanation: args.explanation ?? null,
          points: args.points,
          optionsJson: args.options,
          answerKey: args.options.filter((o) => o.isCorrect).map((o) => o.id).join(','),
        },
      })) as { id: string };
      for (const [ix, o] of args.options.entries()) {
        await db['quizOption'].create({
          data: { quizId: quiz.id, optionText: o.optionText, isCorrect: o.isCorrect, optionOrder: ix },
        });
      }
      return { id: quiz.id };
    },

    async deleteQuiz(quizId: string): Promise<void> {
      await db['quizOption'].deleteMany({ where: { quizId } }).catch(() => null);
      await db['lessonQuiz'].delete({ where: { id: quizId } });
    },

    async findQuizOwner(quizId: string) {
      const quiz = (await db['lessonQuiz'].findUnique({
        where: { id: quizId },
        include: { lesson: { include: { section: true } } },
      }).catch(() => null)) as { lesson: { section: { courseId: string } } } | null;
      if (!quiz) return null;
      const owner = await ownerOf(db, quiz.lesson.section.courseId);
      return { courseId: quiz.lesson.section.courseId, sellerId: owner.sellerId, tenantId: owner.tenantId };
    },
  };
}

@Injectable()
export class PrismaCourseStudioRepository implements CourseStudioRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get root(): CourseStudioRepository {
    return toRepo(this.prisma as unknown as Db);
  }

  withTx(tx: unknown): CourseStudioRepository {
    return toRepo(tx as Db);
  }

  findCourse(courseId: string) { return this.root.findCourse(courseId); }
  findLessonOwner(lessonId: string) { return this.root.findLessonOwner(lessonId); }
  loadStructure(courseId: string) { return this.root.loadStructure(courseId); }
  applySectionOrder(sectionId: string, sectionOrder: number) { return this.root.applySectionOrder(sectionId, sectionOrder); }
  applyLessonOrder(lessonId: string, sectionId: string, lessonOrder: number) {
    return this.root.applyLessonOrder(lessonId, sectionId, lessonOrder);
  }
  transcodeOf(lessonId: string) { return this.root.transcodeOf(lessonId); }
  markTranscoding(lessonId: string, rawStorageKey: string) { return this.root.markTranscoding(lessonId, rawStorageKey); }
  applyHlsCompletion(lessonId: string, videoHlsUrl: string, durationSec: number) {
    return this.root.applyHlsCompletion(lessonId, videoHlsUrl, durationSec);
  }
  markTranscodeFailed(lessonId: string, errorMessage: string) { return this.root.markTranscodeFailed(lessonId, errorMessage); }
  saveQuiz(args: {
    id: string | undefined; lessonId: string; question: string; explanation: string | undefined;
    points: number; options: Array<{ id: string; optionText: string; isCorrect: boolean }>;
  }) { return this.root.saveQuiz(args); }
  deleteQuiz(quizId: string) { return this.root.deleteQuiz(quizId); }
  findQuizOwner(quizId: string) { return this.root.findQuizOwner(quizId); }
}
