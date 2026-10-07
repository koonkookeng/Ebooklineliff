// SSOT Phase 037 Task 3 — Create lesson DTO (Zod SSOT re-export)
// Canonical: apps/backend/src/modules/catalog/dto/create-course-lesson.dto.ts
// (legacy src/backend/modules/catalog/dto/create-course-lesson.dto.ts)
// - Ordering is server-assigned (lessonOrder = count + 1); never client-asserted.
import { CreateCourseLessonSchema } from '@repo/shared';
import type { CreateCourseLesson } from '@repo/shared';

export { CreateCourseLessonSchema };
export type CreateCourseLessonDto = CreateCourseLesson;
