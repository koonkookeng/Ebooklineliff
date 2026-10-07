// SSOT Phase 037 §3.1 — Ebook/course hierarchy Zod SSOT contract
// Canonical: packages/shared/src/schemas/ebook-course-contract.ts
// (legacy src/shared/schemas/ebook-course-contract.ts)
// - Spec-verbatim: EbookChapterSchema / EbookDetailSchema / LessonQuizSchema /
//   CourseLessonSchema / CourseSectionSchema / CourseDetailSchema.
// - RISK_CALL deviations (documented, additive-only):
//   - id/ebookId/productId/lessonId/sectionId/courseId are z.string().min(1),
//     not uuid: opaque edge identity (Phase 023–036 precedent).
//   - Adds CreateEbookChapterSchema / CreateCourseLessonSchema (creator write
//     intents: ordering is server-assigned, never client-asserted — BDD
//     sequential-order rule) + CurriculumQuerySchema (lightweight TOC/curriculum
//     read shape, Gate 5 RAM budget).
// - Zero new deps (zod only).
import { z } from 'zod';

export const EbookChapterSchema = z.object({
  id: z.string().min(1),
  ebookId: z.string().min(1),
  chapterIndex: z.number().int().positive(),
  title: z.string().min(1).max(200),
  chunkCount: z.number().int().nonnegative(),
  chunkR2Prefix: z.string().min(1),
});
export type EbookChapter = z.infer<typeof EbookChapterSchema>;

export const EbookDetailSchema = z.object({
  id: z.string().min(1),
  productId: z.string().min(1),
  totalPages: z.number().int().positive(),
  previewPages: z.number().int().nonnegative().default(10),
  storagePathR2: z.string().min(1),
  fileHash: z.string().min(1),
  chapters: z.array(EbookChapterSchema).optional(),
});
export type EbookDetail = z.infer<typeof EbookDetailSchema>;

export const LessonQuizSchema = z.object({
  id: z.string().min(1),
  lessonId: z.string().min(1),
  question: z.string().min(1),
  optionsJson: z.record(z.unknown()),
  answerKey: z.string().min(1),
});
export type LessonQuiz = z.infer<typeof LessonQuizSchema>;

export const CourseLessonSchema = z.object({
  id: z.string().min(1),
  sectionId: z.string().min(1),
  lessonOrder: z.number().int().positive(),
  title: z.string().min(1).max(200),
  videoHlsUrl: z.string().url(),
  durationSec: z.number().int().nonnegative(),
  isPreview: z.boolean().default(false),
  quizzes: z.array(LessonQuizSchema).optional(),
});
export type CourseLesson = z.infer<typeof CourseLessonSchema>;

export const CourseSectionSchema = z.object({
  id: z.string().min(1),
  courseId: z.string().min(1),
  sectionOrder: z.number().int().positive(),
  title: z.string().min(1).max(200),
  lessons: z.array(CourseLessonSchema).optional(),
});
export type CourseSection = z.infer<typeof CourseSectionSchema>;

export const CourseDetailSchema = z.object({
  id: z.string().min(1),
  productId: z.string().min(1),
  totalHours: z.number().nonnegative().default(0.0),
  sections: z.array(CourseSectionSchema).optional(),
});
export type CourseDetail = z.infer<typeof CourseDetailSchema>;

export const CreateEbookChapterSchema = z.object({
  ebookId: z.string().min(1),
  title: z.string().min(1).max(200),
  chunkCount: z.number().int().nonnegative().default(0),
  chunkR2Prefix: z.string().min(1),
});
export type CreateEbookChapter = z.infer<typeof CreateEbookChapterSchema>;

export const CreateCourseLessonSchema = z.object({
  sectionId: z.string().min(1),
  title: z.string().min(1).max(200),
  videoHlsUrl: z.string().url(),
  durationSec: z.number().int().nonnegative().default(0),
  isPreview: z.boolean().default(false),
});
export type CreateCourseLesson = z.infer<typeof CreateCourseLessonSchema>;

/** Lightweight curriculum read (id/title/order/media only — Gate 5). */
export const CurriculumQuerySchema = z.object({
  productId: z.string().min(1),
});
export type CurriculumQuery = z.infer<typeof CurriculumQuerySchema>;

/** Sum lesson durations into course hours (pure, tested). */
export function totalHoursOf(durationsSec: number[]): number {
  const total = durationsSec.reduce((sum, d) => sum + (Number.isFinite(d) && d > 0 ? d : 0), 0);
  return Math.round((total / 3600) * 100) / 100;
}

/** Sort helper enforcing lessonOrder ascending (BDD Scenario 2). */
export function byLessonOrder<T extends { lessonOrder: number }>(a: T, b: T): number {
  return a.lessonOrder - b.lessonOrder;
}

/** Sort helper enforcing chapterIndex/sectionOrder ascending. */
export function byOrderIndex<T extends { order: number }>(a: T, b: T): number {
  return a.order - b.order;
}
