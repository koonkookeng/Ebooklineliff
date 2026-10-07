// SSOT Phase 037 Task 3 — Ebook/course hierarchy DTO (Zod SSOT re-export)
// Canonical: apps/backend/src/modules/catalog/dto/ebook-course.dto.ts
// (legacy src/backend/modules/catalog/dto/ebook-course.dto.ts)
// - Single source: packages/shared/src/schemas/ebook-course-contract.ts (no forked shapes).
import {
  CourseDetailSchema,
  CourseLessonSchema,
  CourseSectionSchema,
  EbookChapterSchema,
  EbookDetailSchema,
  LessonQuizSchema,
} from '@repo/shared';
import type {
  CourseDetail,
  CourseLesson,
  CourseSection,
  EbookChapter,
  EbookDetail,
  LessonQuiz,
} from '@repo/shared';

export { CourseDetailSchema, CourseLessonSchema, CourseSectionSchema, EbookChapterSchema, EbookDetailSchema, LessonQuizSchema };
export type { CourseDetail, CourseLesson, CourseSection, EbookChapter, EbookDetail, LessonQuiz };
export type { CourseDetail as EbookCourseDto };
