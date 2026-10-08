// SSOT Phase 078 §5.1 — Save quiz DTO (Zod-gated at the service)
// Canonical: apps/backend/src/modules/course-studio/application/dto/save-quiz.dto.ts
// - Thin transport type; validation lives in course-studio-contract.ts.
// - Zero new deps.
export interface SaveQuizDto {
  id?: string;
  lessonId: string;
  question: string;
  explanation?: string;
  points?: number;
  options: Array<{ id: string; optionText: string; isCorrect: boolean }>;
}
