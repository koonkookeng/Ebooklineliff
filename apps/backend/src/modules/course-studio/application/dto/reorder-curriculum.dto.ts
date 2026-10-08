// SSOT Phase 078 §5.1 — Reorder curriculum DTO (Zod-gated at the service)
// Canonical: apps/backend/src/modules/course-studio/application/dto/reorder-curriculum.dto.ts
// - Thin transport type; validation lives in course-studio-contract.ts.
// - Zero new deps.
export interface ReorderCurriculumDto {
  courseId: string;
  sections: Array<{
    sectionId: string;
    sectionOrder: number;
    lessons: Array<{ lessonId: string; lessonOrder: number }>;
  }>;
}
